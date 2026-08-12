export type SolanaPredictionMarketLifecycleStatus =
  | "PENDING"
  | "OPEN"
  | "LOCKED"
  | "PROPOSED"
  | "CHALLENGED"
  | "RESOLVED"
  | "CANCELLED"
  | "UNKNOWN";

export type SolanaPredictionMarketWinner = "NONE" | "A" | "B";

export interface SolanaPredictionMarketLifecycleMetadata extends Record<
  string,
  unknown
> {
  proposalId?: string | null;
  challengeWindowEndsAt?: number | null;
  finalizedAt?: number | null;
  cancellationReason?: string | null;
}

export interface SolanaPredictionMarketLifecycleRecord {
  chainKey: "solana";
  duelKey: string | null;
  duelId: string | null;
  marketId: string | null;
  marketRef: string | null;
  lifecycleStatus: SolanaPredictionMarketLifecycleStatus;
  winner: SolanaPredictionMarketWinner;
  betCloseTime: number | null;
  contractAddress: string | null;
  programId: string | null;
  txRef: string | null;
  syncedAt: number | null;
  metadata?: SolanaPredictionMarketLifecycleMetadata;
  marketType?: "clob";
}

const LIFECYCLE_STATUSES = new Set<SolanaPredictionMarketLifecycleStatus>([
  "PENDING",
  "OPEN",
  "LOCKED",
  "PROPOSED",
  "CHALLENGED",
  "RESOLVED",
  "CANCELLED",
  "UNKNOWN",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeSolanaPredictionMarketTimestamp(
  value: unknown,
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeSolanaPredictionMarketWinner(
  value: unknown,
): SolanaPredictionMarketWinner {
  return value === "A" || value === "B" || value === "NONE" ? value : "NONE";
}

export function normalizeSolanaPredictionMarketDuelKeyHex(
  value: string | null | undefined,
  options: { prefix?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const normalized = /^0x[0-9a-f]{64}$/.test(trimmed)
    ? trimmed.slice(2)
    : /^[0-9a-f]{64}$/.test(trimmed)
      ? trimmed
      : null;
  if (!normalized) return null;
  return options.prefix ? `0x${normalized}` : normalized;
}

export function normalizeSolanaPredictionMarketLifecycleRecord(
  value: unknown,
  options: { duelKeyPrefix?: boolean } = {},
): SolanaPredictionMarketLifecycleRecord | null {
  const candidate = asRecord(value);
  const chainKey =
    typeof candidate?.chainKey === "string"
      ? candidate.chainKey.trim().toLowerCase()
      : "";
  if (!candidate || (chainKey !== "sol" && chainKey !== "solana")) {
    return null;
  }
  if (candidate.marketType !== undefined && candidate.marketType !== "clob") {
    return null;
  }

  const lifecycleStatus = LIFECYCLE_STATUSES.has(
    candidate.lifecycleStatus as SolanaPredictionMarketLifecycleStatus,
  )
    ? (candidate.lifecycleStatus as SolanaPredictionMarketLifecycleStatus)
    : "UNKNOWN";
  const rawMetadata = asRecord(candidate.metadata);
  const metadata = rawMetadata
    ? {
        ...rawMetadata,
        proposalId:
          typeof rawMetadata.proposalId === "string"
            ? rawMetadata.proposalId
            : null,
        challengeWindowEndsAt: normalizeSolanaPredictionMarketTimestamp(
          rawMetadata.challengeWindowEndsAt,
        ),
        finalizedAt: normalizeSolanaPredictionMarketTimestamp(
          rawMetadata.finalizedAt,
        ),
        cancellationReason:
          typeof rawMetadata.cancellationReason === "string"
            ? rawMetadata.cancellationReason
            : null,
      }
    : undefined;

  return {
    chainKey: "solana",
    duelKey: normalizeSolanaPredictionMarketDuelKeyHex(
      typeof candidate.duelKey === "string" ? candidate.duelKey : null,
      { prefix: options.duelKeyPrefix },
    ),
    duelId: typeof candidate.duelId === "string" ? candidate.duelId : null,
    marketId:
      typeof candidate.marketId === "string" ? candidate.marketId : null,
    marketRef:
      typeof candidate.marketRef === "string" ? candidate.marketRef : null,
    lifecycleStatus,
    winner: normalizeSolanaPredictionMarketWinner(candidate.winner),
    betCloseTime: normalizeSolanaPredictionMarketTimestamp(
      candidate.betCloseTime,
    ),
    contractAddress:
      typeof candidate.contractAddress === "string"
        ? candidate.contractAddress
        : null,
    programId:
      typeof candidate.programId === "string" ? candidate.programId : null,
    txRef: typeof candidate.txRef === "string" ? candidate.txRef : null,
    syncedAt: normalizeSolanaPredictionMarketTimestamp(candidate.syncedAt),
    metadata,
    ...(candidate.marketType === "clob" ? { marketType: "clob" as const } : {}),
  };
}
