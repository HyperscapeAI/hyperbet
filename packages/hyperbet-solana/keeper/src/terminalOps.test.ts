import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { TerminalLedger, type TerminalOperationInput } from "./terminalLedger";

const cliPath = path.resolve(import.meta.dir, "terminalOps.ts");

function terminalInput(): TerminalOperationInput {
  return {
    duelId: "operator-duel-1",
    duelKey: "31".repeat(32),
    outcome: "DRAW",
    winnerSide: null,
    participantAId: "agent-a",
    participantBId: "agent-b",
    winnerId: null,
    reason: "draw",
    seed: null,
    replayHash: null,
    event: { schemaVersion: 3, duelId: "operator-duel-1", outcome: "draw" },
  };
}

describe("terminal operator CLI", () => {
  let tempDir: string;
  let dbPath: string;
  let operationId: number;
  let fingerprint: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "terminal-ops-"));
    dbPath = path.join(tempDir, "keeper.sqlite");
    const ledger = new TerminalLedger(dbPath);
    const queued = ledger.enqueue(terminalInput(), 1_000);
    ledger.claimByDuelId({
      duelId: queued.duelId,
      ownerId: "test-worker",
      now: 1_000,
    });
    ledger.markManualReview(
      queued.id,
      "test-worker",
      "authoritative state requires operator review",
      1_100,
    );
    ledger.saveBettingFeedCheckpoint({
      sourceEpoch: 500,
      lastAppliedSeq: 12,
      lastEmittedAt: 1_700_000_000_000,
      duelId: queued.duelId,
      competitiveSnapshotDigest: "31".repeat(32),
      phase: "FIGHTING",
      terminal: false,
      updatedAt: 1_200,
    });
    operationId = queued.id;
    fingerprint = queued.fingerprint;
    ledger.close();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function runCli(args: string[]): ReturnType<typeof Bun.spawnSync> {
    return Bun.spawnSync({
      cmd: [process.execPath, "--bun", cliPath, ...args],
      cwd: import.meta.dir,
      env: { ...process.env, KEEPER_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("lists and inspects recovery work without exposing the event by default", () => {
    const listed = runCli(["list"]);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(listed.stdout?.toString() ?? "") as {
      operations: Array<Record<string, unknown>>;
    };
    expect(listPayload.operations).toHaveLength(1);
    expect(listPayload.operations[0]).toMatchObject({
      id: operationId,
      status: "MANUAL_REVIEW",
      fingerprint,
    });
    expect(listPayload.operations[0]?.event).toBeUndefined();

    const inspected = runCli(["inspect", String(operationId)]);
    expect(inspected.exitCode).toBe(0);
    const inspectPayload = JSON.parse(inspected.stdout?.toString() ?? "") as {
      operation: Record<string, unknown>;
      conflicts: unknown[];
      auditEvents: unknown[];
    };
    expect(inspectPayload.operation.event).toBeUndefined();
    expect(inspectPayload.conflicts).toEqual([]);
    expect(inspectPayload.auditEvents).toEqual([]);
  });

  test("preserves contradictory truth and hides feed events unless requested", () => {
    const ledger = new TerminalLedger(dbPath);
    expect(() =>
      ledger.enqueue(
        {
          ...terminalInput(),
          outcome: "CANCELLED",
          reason: "authoritative cancellation",
          event: {
            schemaVersion: 3,
            duelId: "operator-duel-1",
            outcome: "cancelled",
            privateDiagnostic: "only visible with explicit event access",
          },
        },
        2_000,
      ),
    ).toThrow("conflicting terminal operation");
    ledger.close();

    const hidden = runCli(["inspect", String(operationId)]);
    expect(hidden.exitCode).toBe(0);
    const hiddenPayload = JSON.parse(hidden.stdout?.toString() ?? "") as {
      conflicts: Array<{
        conflictingInput: Record<string, unknown>;
        observedAt: number;
      }>;
    };
    expect(hiddenPayload.conflicts).toHaveLength(1);
    expect(hiddenPayload.conflicts[0]).toMatchObject({ observedAt: 2_000 });
    expect(hiddenPayload.conflicts[0]?.conflictingInput).toMatchObject({
      outcome: "CANCELLED",
      reason: "authoritative cancellation",
    });
    expect(hiddenPayload.conflicts[0]?.conflictingInput.event).toBeUndefined();

    const included = runCli([
      "inspect",
      String(operationId),
      "--include-event",
    ]);
    expect(included.exitCode).toBe(0);
    const includedPayload = JSON.parse(included.stdout?.toString() ?? "") as {
      conflicts: Array<{
        conflictingInput: { event?: Record<string, unknown> };
      }>;
    };
    expect(includedPayload.conflicts[0]?.conflictingInput.event).toMatchObject({
      outcome: "cancelled",
      privateDiagnostic: "only visible with explicit event access",
    });
  });

  test("shows the durable feed continuity checkpoint without mutation", () => {
    const result = runCli(["feed-status"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout?.toString() ?? "")).toMatchObject({
      checkpoint: {
        sourceEpoch: 500,
        lastAppliedSeq: 12,
        duelId: "operator-duel-1",
        phase: "FIGHTING",
        terminal: false,
        degradedReason: null,
      },
    });
  });

  test("rejects a wrong confirmation and accepts one audited exact requeue", () => {
    const rejected = runCli([
      "requeue",
      String(operationId),
      "--confirm-fingerprint",
      "ff".repeat(32),
      "--actor",
      "release-operator",
      "--reason",
      "Verified the authoritative duel and oracle state",
    ]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr?.toString() ?? "").toContain(
      "fingerprint confirmation failed",
    );

    const accepted = runCli([
      "requeue",
      String(operationId),
      "--confirm-fingerprint",
      fingerprint,
      "--actor",
      "release-operator",
      "--reason",
      "Verified the authoritative duel and oracle state",
    ]);
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout?.toString() ?? "")).toMatchObject({
      ok: true,
      operation: {
        id: operationId,
        status: "PENDING",
        requeueCount: 1,
      },
      auditEvent: {
        operationId,
        actor: "release-operator",
        fromStatus: "MANUAL_REVIEW",
        toStatus: "PENDING",
      },
    });

    const duplicate = runCli([
      "requeue",
      String(operationId),
      "--confirm-fingerprint",
      fingerprint,
      "--actor",
      "second-operator",
      "--reason",
      "Attempting an unsafe duplicate operator recovery",
    ]);
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr?.toString() ?? "").toContain(
      "cannot be requeued from PENDING",
    );

    const history = runCli(["history", "--id", String(operationId)]);
    expect(history.exitCode).toBe(0);
    const historyPayload = JSON.parse(history.stdout?.toString() ?? "") as {
      auditEvents: unknown[];
    };
    expect(historyPayload.auditEvents).toHaveLength(1);
  });
});
