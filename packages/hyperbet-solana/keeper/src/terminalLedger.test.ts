import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TerminalLedger,
  TerminalOperationConflictError,
  type TerminalOperationInput,
} from "./terminalLedger";

function terminalInput(
  overrides: Partial<TerminalOperationInput> = {},
): TerminalOperationInput {
  const input: TerminalOperationInput = {
    duelId: "duel-1",
    duelKey: "11".repeat(32),
    outcome: "WIN",
    winnerSide: "A",
    participantAId: "agent-a",
    participantBId: "agent-b",
    winnerId: "agent-a",
    reason: null,
    seed: "42",
    replayHash: "ab".repeat(32),
    event: { schemaVersion: 3, duelId: "duel-1", outcome: "win" },
  };
  return { ...input, ...overrides };
}

describe("persistent terminal operation ledger", () => {
  let tempDir: string;
  let dbPath: string;
  let ledgers: TerminalLedger[];

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "terminal-ledger-"));
    dbPath = path.join(tempDir, "keeper.sqlite");
    ledgers = [];
  });

  afterEach(() => {
    for (const ledger of ledgers) ledger.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function openLedger(): TerminalLedger {
    const ledger = new TerminalLedger(dbPath);
    ledgers.push(ledger);
    return ledger;
  }

  test("enqueues idempotently and persists across reopen", () => {
    const firstLedger = openLedger();
    const first = firstLedger.enqueue(terminalInput(), 1_000);
    const duplicate = firstLedger.enqueue(terminalInput(), 2_000);
    expect(duplicate.id).toBe(first.id);
    expect(firstLedger.getSummary().PENDING).toBe(1);
    firstLedger.close();
    ledgers.splice(ledgers.indexOf(firstLedger), 1);

    const reopened = openLedger();
    expect(reopened.getByDuelId("duel-1")).toMatchObject({
      status: "PENDING",
      attempts: 0,
      outcome: "WIN",
      winnerSide: "A",
    });
  });

  test("quarantines contradictory terminal truth for manual review", () => {
    const ledger = openLedger();
    const retained = ledger.enqueue(terminalInput(), 1_000);

    const conflicting = terminalInput({
      winnerSide: "B",
      winnerId: "agent-b",
      replayHash: "cd".repeat(32),
      event: {
        schemaVersion: 3,
        duelId: "duel-1",
        outcome: "win",
        winnerSide: "B",
      },
    });

    expect(() => ledger.enqueue(conflicting, 2_000)).toThrow(
      TerminalOperationConflictError,
    );
    expect(ledger.getByDuelId("duel-1")).toMatchObject({
      status: "MANUAL_REVIEW",
    });
    expect(ledger.getConflictRecords(retained.id)).toEqual([
      expect.objectContaining({
        operationId: retained.id,
        duelId: retained.duelId,
        retainedFingerprint: retained.fingerprint,
        conflictingInput: conflicting,
        observedAt: 2_000,
      }),
    ]);
    expect(
      ledger.getConflictRecords(retained.id)[0]?.conflictingFingerprint,
    ).not.toBe(retained.fingerprint);
  });

  test("leases each due operation to one owner and marks success", () => {
    const ledger = openLedger();
    const queued = ledger.enqueue(terminalInput(), 1_000);
    const [claimed] = ledger.claimDue({
      ownerId: "worker-a",
      now: 1_000,
      leaseMs: 5_000,
    });
    expect(claimed).toMatchObject({
      id: queued.id,
      status: "PROCESSING",
      attempts: 1,
      leaseOwner: "worker-a",
    });
    expect(
      ledger.claimByDuelId({
        duelId: "duel-1",
        ownerId: "worker-b",
        now: 1_001,
      }),
    ).toBeNull();

    ledger.markSucceeded(queued.id, "worker-a", 1_100);
    expect(ledger.getByDuelId("duel-1")).toMatchObject({
      status: "SUCCEEDED",
      completedAt: 1_100,
      leaseOwner: null,
    });
  });

  test("recovers expired leases after a process crash", () => {
    const ledger = openLedger();
    ledger.enqueue(terminalInput(), 1_000);
    ledger.claimDue({ ownerId: "crashed-worker", now: 1_000, leaseMs: 1_000 });

    expect(ledger.releaseExpiredLeases(1_999)).toBe(0);
    expect(ledger.releaseExpiredLeases(2_000)).toBe(1);
    expect(
      ledger.claimByDuelId({
        duelId: "duel-1",
        ownerId: "replacement",
        now: 2_000,
      }),
    ).toMatchObject({ status: "PROCESSING", attempts: 2 });
  });

  test("uses bounded retries and dead-letters exhausted operations", () => {
    const ledger = openLedger();
    const queued = ledger.enqueue(terminalInput(), 1_000);
    ledger.claimByDuelId({ duelId: "duel-1", ownerId: "worker", now: 1_000 });
    expect(
      ledger.markRetry({
        id: queued.id,
        ownerId: "worker",
        error: new Error("RPC unavailable"),
        nextAttemptAt: 2_000,
        maxAttempts: 2,
        now: 1_100,
      }),
    ).toBe("PENDING");
    expect(
      ledger.claimByDuelId({ duelId: "duel-1", ownerId: "worker", now: 1_999 }),
    ).toBeNull();
    ledger.claimByDuelId({ duelId: "duel-1", ownerId: "worker", now: 2_000 });
    expect(
      ledger.markRetry({
        id: queued.id,
        ownerId: "worker",
        error: "still unavailable",
        nextAttemptAt: 4_000,
        maxAttempts: 2,
        now: 2_100,
      }),
    ).toBe("DEAD_LETTER");
    expect(ledger.getByDuelId("duel-1")).toMatchObject({
      status: "DEAD_LETTER",
      attempts: 2,
      lastError: "still unavailable",
    });
  });

  test("records manual review only while the worker owns the lease", () => {
    const ledger = openLedger();
    const queued = ledger.enqueue(
      terminalInput({
        outcome: "DRAW",
        winnerSide: null,
        reason: "draw",
        seed: null,
        replayHash: null,
      }),
      1_000,
    );
    ledger.claimByDuelId({ duelId: "duel-1", ownerId: "worker", now: 1_000 });
    ledger.markManualReview(queued.id, "worker", "challenged oracle", 1_100);
    expect(ledger.getByDuelId("duel-1")).toMatchObject({
      status: "MANUAL_REVIEW",
      lastError: "challenged oracle",
    });
  });

  test("lists recovery work by status without mutating it", () => {
    const ledger = openLedger();
    ledger.enqueue(terminalInput({ duelId: "duel-pending" }), 1_000);
    const manual = ledger.enqueue(
      terminalInput({ duelId: "duel-manual", duelKey: "22".repeat(32) }),
      2_000,
    );
    ledger.claimByDuelId({
      duelId: "duel-manual",
      ownerId: "worker",
      now: 2_000,
    });
    ledger.markManualReview(manual.id, "worker", "oracle challenged", 2_100);

    expect(
      ledger.listOperations({ statuses: ["MANUAL_REVIEW"] }).map((record) => ({
        duelId: record.duelId,
        status: record.status,
      })),
    ).toEqual([{ duelId: "duel-manual", status: "MANUAL_REVIEW" }]);
    expect(ledger.getSummary()).toMatchObject({
      PENDING: 1,
      MANUAL_REVIEW: 1,
    });
  });

  test("requires exact fingerprint confirmation and records an atomic requeue audit", () => {
    const firstLedger = openLedger();
    const queued = firstLedger.enqueue(terminalInput(), 1_000);
    firstLedger.claimByDuelId({
      duelId: queued.duelId,
      ownerId: "worker",
      now: 1_000,
    });
    firstLedger.markManualReview(
      queued.id,
      "worker",
      "RPC api-key=super-secret unavailable",
      1_100,
    );
    const secondLedger = openLedger();

    expect(() =>
      firstLedger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: "ff".repeat(32),
        actor: "ops@example.com",
        reason: "Verified oracle state and RPC recovery",
        now: 2_000,
      }),
    ).toThrow("fingerprint confirmation failed");
    expect(firstLedger.getOperatorAuditEvents()).toHaveLength(0);

    const result = firstLedger.requeueForOperator({
      id: queued.id,
      expectedFingerprint: queued.fingerprint,
      actor: "ops@example.com",
      reason: "Verified oracle state and RPC recovery",
      now: 2_000,
    });
    expect(result.operation).toMatchObject({
      id: queued.id,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: 2_000,
      lastError: null,
      requeueCount: 1,
      lastRequeuedAt: 2_000,
      lastRequeuedBy: "ops@example.com",
    });
    expect(result.auditEvent).toMatchObject({
      operationId: queued.id,
      duelId: queued.duelId,
      fingerprint: queued.fingerprint,
      action: "REQUEUE",
      actor: "ops@example.com",
      reason: "Verified oracle state and RPC recovery",
      fromStatus: "MANUAL_REVIEW",
      toStatus: "PENDING",
      priorAttempts: 1,
      priorLastError: "RPC api-key=*** unavailable",
      createdAt: 2_000,
    });

    expect(() =>
      secondLedger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: queued.fingerprint,
        actor: "second-operator",
        reason: "Attempting a concurrent duplicate recovery",
        now: 2_001,
      }),
    ).toThrow("cannot be requeued from PENDING");
    expect(
      secondLedger.getOperatorAuditEvents({ operationId: queued.id }),
    ).toHaveLength(1);
  });

  test("requeues dead letters with a fresh bounded-attempt budget", () => {
    const ledger = openLedger();
    const queued = ledger.enqueue(terminalInput(), 1_000);
    ledger.claimByDuelId({
      duelId: queued.duelId,
      ownerId: "worker",
      now: 1_000,
    });
    expect(
      ledger.markRetry({
        id: queued.id,
        ownerId: "worker",
        error: "permanent RPC failure",
        nextAttemptAt: 1_500,
        maxAttempts: 1,
        now: 1_100,
      }),
    ).toBe("DEAD_LETTER");

    ledger.requeueForOperator({
      id: queued.id,
      expectedFingerprint: queued.fingerprint,
      actor: "incident-commander",
      reason: "RPC incident resolved and state independently checked",
      now: 2_000,
    });
    expect(
      ledger.claimByDuelId({
        duelId: queued.duelId,
        ownerId: "replacement-worker",
        now: 2_000,
      }),
    ).toMatchObject({ attempts: 1, requeueCount: 1 });
  });

  test("refuses unsafe operator identities, reasons, and terminal states", () => {
    const ledger = openLedger();
    const queued = ledger.enqueue(terminalInput(), 1_000);
    expect(() =>
      ledger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: queued.fingerprint,
        actor: "x",
        reason: "Verified safe retry state",
      }),
    ).toThrow("operator actor");
    expect(() =>
      ledger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: queued.fingerprint,
        actor: "operator-one",
        reason: "too short",
      }),
    ).toThrow("operator reason");
    expect(() =>
      ledger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: queued.fingerprint,
        actor: "operator-one",
        reason: "Confirmed state but record is still pending",
      }),
    ).toThrow("cannot be requeued from PENDING");
    expect(ledger.getOperatorAuditEvents()).toHaveLength(0);
    expect(() =>
      ledger.listOperations({ statuses: ["PENDING"], limit: Number.NaN }),
    ).toThrow("record limit");
    expect(() => ledger.getOperatorAuditEvents({ operationId: 0 })).toThrow(
      "positive integer",
    );
    expect(() =>
      ledger.requeueForOperator({
        id: queued.id,
        expectedFingerprint: queued.fingerprint,
        actor: "operator-one",
        reason: "Confirmed state but supplied an invalid timestamp",
        now: Number.NaN,
      }),
    ).toThrow("timestamp");
  });

  test("migrates an existing terminal ledger for auditable recovery", () => {
    const legacy = new Database(dbPath, { create: true });
    legacy.run(`CREATE TABLE terminal_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duel_id TEXT NOT NULL UNIQUE,
      duel_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      outcome TEXT NOT NULL,
      winner_side TEXT,
      participant_a_id TEXT,
      participant_b_id TEXT,
      winner_id TEXT,
      reason TEXT,
      seed TEXT,
      replay_hash TEXT,
      event_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )`);
    legacy.close(false);

    const ledger = openLedger();
    expect(ledger.enqueue(terminalInput(), 1_000)).toMatchObject({
      requeueCount: 0,
      lastRequeuedAt: null,
      lastRequeuedBy: null,
    });
    expect(ledger.getOperatorAuditEvents()).toEqual([]);
  });

  test("persists and clears fail-closed betting feed continuity state", () => {
    const ledger = openLedger();
    expect(ledger.getBettingFeedCheckpoint()).toBeNull();

    ledger.markBettingFeedDegraded(
      "gap contains api-key=feed-secret and requires review",
      1_000,
    );
    expect(ledger.getBettingFeedCheckpoint()).toMatchObject({
      sourceEpoch: 0,
      lastAppliedSeq: 0,
      terminal: true,
      degradedReason: "gap contains api-key=*** and requires review",
      updatedAt: 1_000,
    });

    expect(
      ledger.saveBettingFeedCheckpoint({
        sourceEpoch: 100,
        lastAppliedSeq: 9,
        lastEmittedAt: 1_700_000_000_000,
        duelId: "duel-9",
        competitiveSnapshotDigest: "99".repeat(32),
        phase: "FIGHTING",
        terminal: false,
        updatedAt: 2_000,
      }),
    ).toMatchObject({
      sourceEpoch: 100,
      lastAppliedSeq: 9,
      duelId: "duel-9",
      phase: "FIGHTING",
      terminal: false,
      degradedReason: null,
      updatedAt: 2_000,
    });
  });
});
