import type { BettingChainKey } from "@hyperbet/chain-registry";

type JsonRecord = Record<string, unknown>;

export type MarketParityState =
  | "preparing"
  | "awaiting_confirmations"
  | "open"
  | "locked"
  | "resolved"
  | "cancelled"
  | "frozen"
  | "aborted";

export type MarketParityReceipt = {
  chainKey: BettingChainKey;
  preparedAtMs: number | null;
  openedAtMs: number | null;
  lockedAtMs: number | null;
  resolvedAtMs: number | null;
  cancelledAtMs: number | null;
  confirmedAtMs: number | null;
  lifecycleStatus: string | null;
  txRef: string | null;
  note: string | null;
};

export type MarketParityInfo = {
  bundleId: string;
  duelKey: string | null;
  duelId: string | null;
  revision: number;
  requiredChains: BettingChainKey[];
  confirmedChains: BettingChainKey[];
  state: MarketParityState;
  phase: string | null;
  safeToBet: boolean;
  openedAtMs: number | null;
  lockedAtMs: number | null;
  resolvedAtMs: number | null;
  freezeReason: string | null;
  updatedAtMs: number;
  receipts: MarketParityReceipt[];
};

export type MarketParityCopy = {
  parityPreparing: string;
  parityAwaitingConfirmations: string;
  parityBettingOpen: string;
  parityLocked: string;
  parityResolved: string;
  parityFrozen: string;
  parityCancelled?: string;
  parityAborted?: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object"
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function normalizeDuelKey(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const normalized = raw.replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizeChains(value: unknown): BettingChainKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is BettingChainKey =>
      entry === "solana" ||
      entry === "bsc" ||
      entry === "base" ||
      entry === "avax",
  );
}

export function parseMarketParity(value: unknown): MarketParityInfo | null {
  const candidate = asRecord(value);
  const bundleId = asString(candidate?.bundleId);
  if (!candidate || !bundleId) {
    return null;
  }

  const state =
    (asString(candidate.state) as MarketParityState | null) ?? "preparing";
  const receipts = Array.isArray(candidate.receipts)
    ? candidate.receipts
        .map((receipt) => {
          const normalized = asRecord(receipt);
          const chainKey = normalizeChains([normalized?.chainKey])[0] ?? null;
          if (!normalized || !chainKey) {
            return null;
          }
          return {
            chainKey,
            preparedAtMs: asFiniteNumber(normalized.preparedAtMs),
            openedAtMs: asFiniteNumber(normalized.openedAtMs),
            lockedAtMs: asFiniteNumber(normalized.lockedAtMs),
            resolvedAtMs: asFiniteNumber(normalized.resolvedAtMs),
            cancelledAtMs: asFiniteNumber(normalized.cancelledAtMs),
            confirmedAtMs: asFiniteNumber(normalized.confirmedAtMs),
            lifecycleStatus: asString(normalized.lifecycleStatus),
            txRef: asString(normalized.txRef),
            note: asString(normalized.note),
          };
        })
        .filter((receipt): receipt is MarketParityReceipt => receipt != null)
    : [];

  return {
    bundleId,
    duelKey: normalizeDuelKey(candidate.duelKey),
    duelId: asString(candidate.duelId),
    revision: Math.max(1, asFiniteNumber(candidate.revision) ?? 1),
    requiredChains: normalizeChains(candidate.requiredChains),
    confirmedChains: normalizeChains(candidate.confirmedChains),
    state,
    phase: asString(candidate.phase),
    safeToBet: candidate.safeToBet === true,
    openedAtMs: asFiniteNumber(candidate.openedAtMs),
    lockedAtMs: asFiniteNumber(candidate.lockedAtMs),
    resolvedAtMs: asFiniteNumber(candidate.resolvedAtMs),
    freezeReason: asString(candidate.freezeReason),
    updatedAtMs: asFiniteNumber(candidate.updatedAtMs) ?? 0,
    receipts,
  };
}

export function isPublicMarketParityState(
  state: MarketParityState | null | undefined,
  openedAtMs?: number | null,
): boolean {
  return (
    state === "open" ||
    state === "locked" ||
    state === "resolved" ||
    state === "cancelled" ||
    (state === "frozen" && openedAtMs != null)
  );
}

export function deriveMarketParityLabel(
  marketParity: MarketParityInfo | null | undefined,
  copy: MarketParityCopy,
): string | null {
  switch (marketParity?.state) {
    case "preparing":
      return copy.parityPreparing;
    case "awaiting_confirmations":
      return copy.parityAwaitingConfirmations;
    case "open":
      return copy.parityBettingOpen;
    case "locked":
      return copy.parityLocked;
    case "resolved":
      return copy.parityResolved;
    case "cancelled":
      return copy.parityCancelled ?? copy.parityResolved;
    case "frozen":
      return copy.parityFrozen;
    case "aborted":
      return copy.parityAborted ?? copy.parityPreparing;
    default:
      return null;
  }
}
