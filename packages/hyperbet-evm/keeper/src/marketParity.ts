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

function lifecycleRank(
  status: PredictionMarketLifecycleRecord["lifecycleStatus"] | null | undefined,
): number {
  switch (status) {
    case "PENDING":
      return 1;
    case "OPEN":
      return 2;
    case "LOCKED":
      return 3;
    case "RESOLVED":
    case "CANCELLED":
      return 4;
    default:
      return 0;
  }
}

function buildEmptyReceipt(chainKey: BettingChainKey): KeeperParityChainReceipt {
  return {
    chainKey,
    preparedAtMs: null,
    openedAtMs: null,
    lockedAtMs: null,
    resolvedAtMs: null,
    cancelledAtMs: null,
    confirmedAtMs: null,
    lifecycleStatus: null,
    txRef: null,
    note: null,
  };
}

function findMatchingParityRecord(
  requiredChain: BettingChainKey,
  markets: readonly PredictionMarketLifecycleRecord[],
  duelKey: string | null,
  duelId: string | null,
): PredictionMarketLifecycleRecord | null {
  return (
    markets.find((record) => {
      if (record.chainKey !== requiredChain) return false;
      if (duelKey && record.duelKey) return record.duelKey === duelKey;
      if (duelId && record.duelId) return record.duelId === duelId;
      return false;
    }) ?? null
  );
}

function redactedReceipt(receipt: KeeperParityChainReceipt): KeeperParityChainReceipt {
  return {
    ...receipt,
    txRef: null,
    note: null,
  };
}

export function isPublicMarketParitySnapshot(
  snapshot: KeeperMarketParitySnapshot | null | undefined,
): boolean {
  if (!snapshot) return false;
  if (
    snapshot.openedAtMs != null &&
    snapshot.state === "awaiting_confirmations"
  ) {
    return true;
  }
  return (
    snapshot.state === "open" ||
    snapshot.state === "locked" ||
    snapshot.state === "resolved" ||
    snapshot.state === "cancelled" ||
    (snapshot.state === "frozen" && snapshot.openedAtMs != null)
  );
}

export function marketParityMatchesDuel(
  snapshot: KeeperMarketParitySnapshot | null | undefined,
  duelKey: string | null | undefined,
  duelId: string | null | undefined,
): boolean {
  if (!snapshot) return false;
  if (snapshot.duelKey && duelKey) return snapshot.duelKey === duelKey;
  if (snapshot.duelId && duelId) return snapshot.duelId === duelId;
  return false;
}

export function isPublicMarketParitySnapshotForSourceDuel(
  snapshot: KeeperMarketParitySnapshot | null | undefined,
  duelKey: string | null | undefined,
  duelId: string | null | undefined,
): boolean {
  if (!isPublicMarketParitySnapshot(snapshot)) return false;
  if (!duelKey && !duelId) return true;
  return marketParityMatchesDuel(snapshot, duelKey, duelId);
}

export function applyMarketParityReceiptsToMarkets(
  markets: readonly PredictionMarketLifecycleRecord[],
  snapshot: KeeperMarketParitySnapshot | null | undefined,
  winner: PredictionMarketLifecycleRecord["winner"] | null = null,
): PredictionMarketLifecycleRecord[] {
  if (!snapshot || !isPublicMarketParitySnapshot(snapshot)) {
    return [...markets];
  }
  return markets.map((market) => {
    if (!marketParityMatchesDuel(snapshot, market.duelKey, market.duelId)) {
      return market;
    }
    const receipt = snapshot.receipts.find(
      (candidate) => candidate.chainKey === market.chainKey,
    );
    if (!receipt?.lifecycleStatus) return market;
    return {
      ...market,
      duelKey: snapshot.duelKey ?? market.duelKey,
      duelId: snapshot.duelId ?? market.duelId,
      lifecycleStatus: receipt.lifecycleStatus,
      winner:
        receipt.lifecycleStatus === "RESOLVED" && winner && winner !== "NONE"
          ? winner
          : market.winner,
      txRef: receipt.txRef ?? market.txRef,
      syncedAt: receipt.confirmedAtMs ?? market.syncedAt,
      metadata: {
        ...(market.metadata ?? {}),
        parityReceiptLifecycleStatus: receipt.lifecycleStatus,
        parityReceiptConfirmedAtMs: receipt.confirmedAtMs,
      },
    };
  });
}

export function redactPendingMarketParity(
  snapshot: KeeperMarketParitySnapshot | null,
): KeeperMarketParitySnapshot | null {
  if (!snapshot) return null;
  if (isPublicMarketParitySnapshot(snapshot)) {
    return snapshot;
  }
  const publicPlaceholderState =
    snapshot.state === "awaiting_confirmations" && snapshot.openedAtMs == null
      ? "preparing"
      : snapshot.state === "frozen"
        ? "aborted"
        : snapshot.state;
  return {
    ...snapshot,
    bundleId: `pending:${snapshot.revision}`,
    duelKey: null,
    duelId: null,
    state: publicPlaceholderState,
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
    preparedAtMs: updatedAtMs,
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

export function buildProjectedMarketParitySnapshot(input: {
  duelKey: string | null;
  duelId: string | null;
  phase: string | null;
  requiredChains: readonly BettingChainKey[];
  markets: readonly PredictionMarketLifecycleRecord[];
  updatedAtMs: number;
  streamSafe: boolean;
}): KeeperMarketParitySnapshot | null {
  const recovered = buildRecoveredMarketParitySnapshot(input);
  if (recovered) {
    return recovered;
  }

  const {
    duelKey,
    duelId,
    phase,
    requiredChains,
    markets,
    updatedAtMs,
  } = input;
  if (!duelKey && !duelId) return null;

  const matchedRecords = requiredChains
    .map((chainKey) =>
      findMatchingParityRecord(chainKey, markets, duelKey, duelId),
    )
    .filter((record): record is PredictionMarketLifecycleRecord => record != null);
  const receipts = requiredChains.map((chainKey) => {
    const record = findMatchingParityRecord(chainKey, markets, duelKey, duelId);
    return record
      ? buildRecoveredReceipt(record, updatedAtMs)
      : buildEmptyReceipt(chainKey);
  });
  const highestRank = matchedRecords.reduce(
    (max, record) => Math.max(max, lifecycleRank(record.lifecycleStatus)),
    0,
  );
  const state =
    highestRank >= 2 ? "awaiting_confirmations" : "preparing";
  const confirmedChains = receipts
    .filter((receipt) => {
      if (state === "preparing") {
        return receipt.lifecycleStatus != null;
      }
      return lifecycleRank(receipt.lifecycleStatus) >= highestRank;
    })
    .map((receipt) => receipt.chainKey);

  return {
    bundleId: `recovered-pending:${duelKey ?? duelId ?? "unknown"}`,
    duelKey,
    duelId,
    revision: 0,
    requiredChains: [...requiredChains],
    confirmedChains,
    state,
    phase: phase ?? "ANNOUNCEMENT",
    safeToBet: false,
    openedAtMs: null,
    lockedAtMs: null,
    resolvedAtMs: null,
    freezeReason: null,
    updatedAtMs,
    receipts,
  };
}
