import { TerminalLedger } from "./terminalLedger";

const dbPath = process.argv[2]?.trim();
if (!dbPath) {
  throw new Error("terminal crash worker requires a database path");
}

const ledger = new TerminalLedger(dbPath);
const [claimed] = ledger.claimDue({
  ownerId: "crashed-child",
  now: 1_000,
  leaseMs: 1_000,
  limit: 1,
});
if (!claimed) {
  throw new Error("terminal crash worker found no due operation");
}

const event = claimed.event as Partial<{
  schemaVersion: number;
  sourceEpoch: number;
  seq: number;
  emittedAt: number;
  duelId: string;
  competitiveSnapshotDigest: string;
  cancellationReason: string;
}>;
if (
  event.schemaVersion !== 3 ||
  !Number.isSafeInteger(event.sourceEpoch) ||
  !Number.isSafeInteger(event.seq) ||
  !Number.isSafeInteger(event.emittedAt) ||
  event.duelId !== claimed.duelId ||
  typeof event.competitiveSnapshotDigest !== "string" ||
  !/^[0-9a-f]{64}$/.test(event.competitiveSnapshotDigest) ||
  event.cancellationReason !== "competitive_snapshot_recovery_window_elapsed"
) {
  throw new Error(
    "terminal crash worker requires the canonical Hyperia recovery-window-elapsed event",
  );
}

const checkpoint = ledger.saveBettingFeedCheckpoint({
  sourceEpoch: event.sourceEpoch,
  lastAppliedSeq: event.seq - 1,
  lastEmittedAt: event.emittedAt - 1,
  duelId: claimed.duelId,
  competitiveSnapshotDigest: event.competitiveSnapshotDigest,
  phase: "FIGHTING",
  terminal: false,
  updatedAt: 1_100,
});
if (checkpoint.duelId !== claimed.duelId || checkpoint.terminal) {
  throw new Error("terminal crash worker failed to persist its recovery state");
}

setInterval(() => undefined, 60_000);
await new Promise<never>(() => undefined);
