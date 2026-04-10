import type {
  BettingChainKey,
  PredictionMarketLifecycleRecord,
} from "@hyperbet/chain-registry";
import type {
  KeeperMarketParitySnapshot,
  KeeperParityChainReceipt,
} from "@hyperbet/mm-core";

const DEFAULT_REQUIRED_PARITY_CHAINS: readonly BettingChainKey[] = [
  "solana",
  "bsc",
];

function asChainKey(value: string): BettingChainKey | null {
  switch (value.trim().toLowerCase()) {
    case "solana":
    case "bsc":
    case "base":
    case "avax":
      return value.trim().toLowerCase() as BettingChainKey;
    default:
      return null;
  }
}

export function parseRequiredParityChains(
  value: string | undefined,
): BettingChainKey[] {
  const parsed = (value ?? "")
    .split(",")
    .map((entry) => asChainKey(entry))
    .filter((entry): entry is BettingChainKey => entry != null);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...DEFAULT_REQUIRED_PARITY_CHAINS];
}

function parityStateFromLifecycleStatuses(
  statuses: readonly PredictionMarketLifecycleRecord["lifecycleStatus"][],
): KeeperMarketParitySnapshot["state"] | null {
  if (statuses.length === 0) return null;
  if (statuses.every((status) => status === "OPEN")) return "open";
  if (statuses.every((status) => status === "LOCKED")) return "locked";
  if (statuses.every((status) => status === "RESOLVED")) return "resolved";
  if (statuses.every((status) => status === "CANCELLED")) return "cancelled";
  return null;
}

function redactedReceipt(receipt: KeeperParityChainReceipt): KeeperParityChainReceipt {
  return {
    ...receipt,
    txRef: null,
    note: null,
  };
}

export function redactPendingMarketParity(
  snapshot: KeeperMarketParitySnapshot | null,
): KeeperMarketParitySnapshot | null {
  if (!snapshot) return null;
  if (
    snapshot.state === "open" ||
    snapshot.state === "locked" ||
    snapshot.state === "resolved" ||
    snapshot.state === "cancelled" ||
    snapshot.state === "frozen"
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    bundleId: `pending:${snapshot.revision}`,
    duelKey: null,
    duelId: null,
    safeToBet: false,
    freezeReason: null,
    receipts: snapshot.receipts.map(redactedReceipt),
  };
}

function buildRecoveredReceipt(
  record: PredictionMarketLifecycleRecord,
  updatedAtMs: number,
): KeeperParityChainReceipt {
  return {
    chainKey: record.chainKey,
    preparedAtMs: null,
    openedAtMs: record.lifecycleStatus === "OPEN" ? updatedAtMs : null,
    lockedAtMs: record.lifecycleStatus === "LOCKED" ? updatedAtMs : null,
    resolvedAtMs: record.lifecycleStatus === "RESOLVED" ? updatedAtMs : null,
    cancelledAtMs: record.lifecycleStatus === "CANCELLED" ? updatedAtMs : null,
    confirmedAtMs: updatedAtMs,
    lifecycleStatus: record.lifecycleStatus,
    txRef: null,
    note: "recovered-from-market-health",
  };
}

function defaultPhaseForState(
  state: KeeperMarketParitySnapshot["state"],
): string | null {
  switch (state) {
    case "open":
      return "ANNOUNCEMENT";
    case "locked":
      return "COUNTDOWN";
    case "resolved":
    case "cancelled":
      return "RESOLUTION";
    default:
      return null;
  }
}

export function buildRecoveredMarketParitySnapshot(input: {
  duelKey: string | null;
  duelId: string | null;
  phase: string | null;
  requiredChains: readonly BettingChainKey[];
  markets: readonly PredictionMarketLifecycleRecord[];
  updatedAtMs: number;
  streamSafe: boolean;
}): KeeperMarketParitySnapshot | null {
  const {
    duelKey,
    duelId,
    phase,
    requiredChains,
    markets,
    updatedAtMs,
    streamSafe,
  } = input;
  if (!duelKey && !duelId) return null;

  const receipts = requiredChains.map((requiredChain) =>
    markets.find((record) => {
      if (record.chainKey !== requiredChain) return false;
      if (duelKey && record.duelKey) return record.duelKey === duelKey;
      if (duelId && record.duelId) return record.duelId === duelId;
      return false;
    }) ?? null,
  );
  if (receipts.some((record) => record == null)) {
    return null;
  }

  const confirmedRecords = receipts.filter(
    (record): record is PredictionMarketLifecycleRecord => record != null,
  );
  const state = parityStateFromLifecycleStatuses(
    confirmedRecords.map((record) => record.lifecycleStatus),
  );
  if (!state) {
    return null;
  }

  return {
    bundleId: `recovered:${duelKey ?? duelId ?? "unknown"}`,
    duelKey,
    duelId,
    revision: 0,
    requiredChains: [...requiredChains],
    confirmedChains: [...requiredChains],
    state,
    phase: phase ?? defaultPhaseForState(state),
    safeToBet: state === "open" && streamSafe,
    openedAtMs: state === "open" ? updatedAtMs : null,
    lockedAtMs: state === "locked" ? updatedAtMs : null,
    resolvedAtMs:
      state === "resolved" || state === "cancelled" ? updatedAtMs : null,
    freezeReason: null,
    updatedAtMs,
    receipts: confirmedRecords.map((record) =>
      buildRecoveredReceipt(record, updatedAtMs),
    ),
  };
}
