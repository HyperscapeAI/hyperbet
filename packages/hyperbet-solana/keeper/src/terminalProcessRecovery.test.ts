import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TerminalLedger,
  type BettingFeedCheckpoint,
  type TerminalOperationInput,
  type TerminalOperationRecord,
} from "./terminalLedger";

type HyperiaCancellationPayload = {
  schemaVersion: 3;
  sourceEpoch: number;
  seq: number;
  emittedAt: number;
  duelId: string;
  duelKey: string;
  competitiveSnapshotDigest: string;
  phase: string;
  winnerId: null;
  outcome: "cancelled";
  cancellationReason: "competitive_snapshot_recovery_window_elapsed";
  seed: null;
  replayHash: null;
  agent1: { id: string };
  agent2: { id: string };
};

type HyperiaFixture = {
  cases: Array<{ name: string; payload: unknown }>;
};

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const hyperbetRepository = path.resolve(sourceDirectory, "../../../..");
const hyperiaRepository =
  process.env.HYPERIA_REPOSITORY_DIR?.trim() ||
  path.resolve(hyperbetRepository, "../hyperia-implementation");
const hyperiaFixturePath = path.resolve(
  hyperiaRepository,
  "packages/server/tests/fixtures/hyperbet/betting-feed-schema-v3.json",
);
const crashWorkerFixturePath = fileURLToPath(
  new URL("./terminalCrashWorker.fixture.ts", import.meta.url),
);

function loadRecoveryWindowElapsedPayload(): HyperiaCancellationPayload {
  if (!existsSync(hyperiaFixturePath)) {
    throw new Error(
      `Hyperia schema-v3 contract fixture is required at ${hyperiaFixturePath}. Set HYPERIA_REPOSITORY_DIR to the Hyperia checkout when the repositories are not siblings.`,
    );
  }
  const fixture = JSON.parse(
    readFileSync(hyperiaFixturePath, "utf8"),
  ) as HyperiaFixture;
  const fixtureCase = fixture.cases.find(
    ({ name }) =>
      name === "cancel-competitive-snapshot-recovery-window-elapsed",
  );
  const payload = fixtureCase?.payload as
    | Partial<HyperiaCancellationPayload>
    | undefined;
  if (
    payload?.schemaVersion !== 3 ||
    !Number.isSafeInteger(payload.sourceEpoch) ||
    !Number.isSafeInteger(payload.seq) ||
    !Number.isSafeInteger(payload.emittedAt) ||
    typeof payload.duelId !== "string" ||
    typeof payload.duelKey !== "string" ||
    typeof payload.competitiveSnapshotDigest !== "string" ||
    typeof payload.phase !== "string" ||
    payload.winnerId !== null ||
    payload.outcome !== "cancelled" ||
    payload.cancellationReason !==
      "competitive_snapshot_recovery_window_elapsed" ||
    payload.seed !== null ||
    payload.replayHash !== null ||
    typeof payload.agent1?.id !== "string" ||
    typeof payload.agent2?.id !== "string"
  ) {
    throw new Error(
      "Hyperia recovery-window-elapsed fixture payload is missing or invalid",
    );
  }
  return payload as HyperiaCancellationPayload;
}

const hyperiaTerminalEvent = loadRecoveryWindowElapsedPayload();

function cancellationInput(): TerminalOperationInput {
  return {
    duelId: hyperiaTerminalEvent.duelId,
    duelKey: hyperiaTerminalEvent.duelKey,
    outcome: "CANCELLED",
    winnerSide: null,
    participantAId: hyperiaTerminalEvent.agent1.id,
    participantBId: hyperiaTerminalEvent.agent2.id,
    winnerId: null,
    reason: hyperiaTerminalEvent.cancellationReason,
    seed: null,
    replayHash: null,
    event: hyperiaTerminalEvent,
  };
}

async function waitForDurableWorkerState(input: {
  child: ReturnType<typeof Bun.spawn>;
  dbPath: string;
  duelId: string;
  fingerprint: string;
  timeoutMs?: number;
}): Promise<{
  operation: TerminalOperationRecord;
  checkpoint: BettingFeedCheckpoint;
}> {
  const deadline = Date.now() + (input.timeoutMs ?? 3_000);
  let lastObserved = "no terminal operation or feed checkpoint";
  while (Date.now() < deadline) {
    const observer = new TerminalLedger(input.dbPath);
    try {
      const operation = observer.getByDuelId(input.duelId);
      const checkpoint = observer.getBettingFeedCheckpoint();
      lastObserved = JSON.stringify({
        operationStatus: operation?.status ?? null,
        leaseOwner: operation?.leaseOwner ?? null,
        checkpoint,
      });
      if (
        operation?.fingerprint === input.fingerprint &&
        operation.status === "PROCESSING" &&
        operation.leaseOwner === "crashed-child" &&
        checkpoint?.duelId === input.duelId &&
        checkpoint.terminal === false
      ) {
        return { operation, checkpoint };
      }
    } finally {
      observer.close();
    }
    if (input.child.exitCode !== null) {
      const stderr =
        input.child.stderr instanceof ReadableStream
          ? (await new Response(input.child.stderr).text()).trim()
          : "stderr was not piped";
      throw new Error(
        `terminal crash worker exited with code ${input.child.exitCode} before durable state was visible: ${stderr}`,
      );
    }
    await Bun.sleep(10);
  }
  throw new Error(
    `timed out waiting for terminal crash worker durable state; last observed ${lastObserved}`,
  );
}

describe("terminal recovery across an actual process kill", () => {
  let tempDir: string;
  let dbPath: string;
  let child: ReturnType<typeof Bun.spawn> | null;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "terminal-process-kill-"));
    dbPath = path.join(tempDir, "keeper.sqlite");
    child = null;
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("recovers one exact terminal operation and feed checkpoint after SIGKILL", async () => {
    const seedLedger = new TerminalLedger(dbPath);
    const queued = seedLedger.enqueue(cancellationInput(), 900);
    seedLedger.close();

    child = Bun.spawn([process.execPath, crashWorkerFixturePath, dbPath], {
      cwd: path.dirname(crashWorkerFixturePath),
      env: process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const ready = await waitForDurableWorkerState({
      child,
      dbPath,
      duelId: queued.duelId,
      fingerprint: queued.fingerprint,
    });
    expect(ready.operation).toMatchObject({
      id: queued.id,
      fingerprint: queued.fingerprint,
      status: "PROCESSING",
      attempts: 1,
      leaseOwner: "crashed-child",
      leaseExpiresAt: 2_000,
    });
    expect(ready.checkpoint).toMatchObject({
      sourceEpoch: hyperiaTerminalEvent.sourceEpoch,
      lastAppliedSeq: hyperiaTerminalEvent.seq - 1,
      duelId: hyperiaTerminalEvent.duelId,
      competitiveSnapshotDigest: hyperiaTerminalEvent.competitiveSnapshotDigest,
      phase: "FIGHTING",
      terminal: false,
    });

    child.kill("SIGKILL");
    const exitCode = await child.exited;
    expect(exitCode).not.toBe(0);

    const recoveredLedger = new TerminalLedger(dbPath);
    expect(recoveredLedger.getByDuelId(queued.duelId)).toMatchObject({
      id: queued.id,
      fingerprint: queued.fingerprint,
      status: "PROCESSING",
      attempts: 1,
      leaseOwner: "crashed-child",
      leaseExpiresAt: 2_000,
      event: cancellationInput().event,
    });
    expect(recoveredLedger.getBettingFeedCheckpoint()).toMatchObject({
      sourceEpoch: hyperiaTerminalEvent.sourceEpoch,
      lastAppliedSeq: hyperiaTerminalEvent.seq - 1,
      lastEmittedAt: hyperiaTerminalEvent.emittedAt - 1,
      duelId: hyperiaTerminalEvent.duelId,
      competitiveSnapshotDigest: hyperiaTerminalEvent.competitiveSnapshotDigest,
      phase: "FIGHTING",
      terminal: false,
      degradedReason: null,
      updatedAt: 1_100,
    });

    const replayed = recoveredLedger.enqueue(cancellationInput(), 1_500);
    expect(replayed).toMatchObject({
      id: queued.id,
      fingerprint: queued.fingerprint,
      status: "PROCESSING",
      attempts: 1,
    });
    expect(recoveredLedger.getSummary()).toMatchObject({ PROCESSING: 1 });
    expect(
      recoveredLedger.claimByDuelId({
        duelId: queued.duelId,
        ownerId: "replacement-child",
        now: 1_999,
      }),
    ).toBeNull();

    const recovered = recoveredLedger.claimByDuelId({
      duelId: queued.duelId,
      ownerId: "replacement-child",
      now: 2_000,
      leaseMs: 1_000,
    });
    expect(recovered).toMatchObject({
      id: queued.id,
      fingerprint: queued.fingerprint,
      status: "PROCESSING",
      attempts: 2,
      leaseOwner: "replacement-child",
      leaseExpiresAt: 3_000,
    });
    if (!recovered) throw new Error("expired terminal lease was not recovered");
    recoveredLedger.markSucceeded(recovered.id, "replacement-child", 2_100);
    recoveredLedger.close();

    const verifiedLedger = new TerminalLedger(dbPath);
    expect(verifiedLedger.getByDuelId(queued.duelId)).toMatchObject({
      id: queued.id,
      fingerprint: queued.fingerprint,
      status: "SUCCEEDED",
      attempts: 2,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: 2_100,
      event: cancellationInput().event,
    });
    expect(verifiedLedger.getSummary()).toEqual({
      PENDING: 0,
      PROCESSING: 0,
      SUCCEEDED: 1,
      MANUAL_REVIEW: 0,
      DEAD_LETTER: 0,
    });
    verifiedLedger.close();
  });
});
