export type EvmPerpsChainKey = "bsc" | "base" | "avax";
export type PerpsChainKey = "solana" | EvmPerpsChainKey;

export interface PerpsOracleHistorySnapshot {
  agentId: string;
  marketId: number;
  spotIndex: number;
  conservativeSkill: number;
  mu: number;
  sigma: number;
  recordedAt: number;
}

export interface PerpsOracleHistoryResponse {
  chainKey: PerpsChainKey | null;
  characterId: string;
  marketId: number;
  snapshots: PerpsOracleHistorySnapshot[];
  updatedAt: number;
}

export type PerpsMarketLifecycleStatus = "ACTIVE" | "CLOSE_ONLY" | "ARCHIVED";

export interface PerpsMarketDirectoryEntry {
  chainKey: PerpsChainKey;
  rank: number | null;
  characterId: string;
  marketId: number;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
  status: PerpsMarketLifecycleStatus;
  lastSeenAt: number;
  deprecatedAt: number | null;
  updatedAt: number;
}

export interface PerpsMarketsResponse {
  chainKey: PerpsChainKey | null;
  markets: PerpsMarketDirectoryEntry[];
  updatedAt: number;
}

export function buildPerpsMarketsEndpoint(
  gameApiUrl: string,
  chainKey: PerpsChainKey,
): string {
  const endpoint = new URL("/api/perps/markets", ensureBaseUrl(gameApiUrl));
  endpoint.searchParams.set("chainKey", chainKey);
  return endpoint.toString();
}

export function buildPerpsOracleHistoryEndpoint(params: {
  gameApiUrl: string;
  chainKey: PerpsChainKey;
  characterId: string;
  limit: number;
}): string {
  const endpoint = new URL(
    "/api/perps/oracle-history",
    ensureBaseUrl(params.gameApiUrl),
  );
  endpoint.searchParams.set("chainKey", params.chainKey);
  endpoint.searchParams.set("characterId", params.characterId);
  endpoint.searchParams.set("limit", String(params.limit));
  return endpoint.toString();
}

function ensureBaseUrl(gameApiUrl: string): string {
  return gameApiUrl.endsWith("/") ? gameApiUrl : `${gameApiUrl}/`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPerpsMarketLifecycleStatus(
  value: unknown,
): value is PerpsMarketLifecycleStatus {
  return value === "ACTIVE" || value === "CLOSE_ONLY" || value === "ARCHIVED";
}

function isPerpsChainKey(value: unknown): value is PerpsChainKey {
  return (
    value === "solana" ||
    value === "bsc" ||
    value === "base" ||
    value === "avax"
  );
}

function isPerpsOracleHistorySnapshot(
  value: unknown,
): value is PerpsOracleHistorySnapshot {
  const maybe = value as Partial<PerpsOracleHistorySnapshot>;
  return (
    typeof maybe?.agentId === "string" &&
    isFiniteNumber(maybe?.marketId) &&
    isFiniteNumber(maybe?.spotIndex) &&
    isFiniteNumber(maybe?.conservativeSkill) &&
    isFiniteNumber(maybe?.mu) &&
    isFiniteNumber(maybe?.sigma) &&
    isFiniteNumber(maybe?.recordedAt)
  );
}

function isPerpsMarketDirectoryEntry(
  value: unknown,
): value is PerpsMarketDirectoryEntry {
  const maybe = value as Partial<PerpsMarketDirectoryEntry>;
  return (
    isPerpsChainKey(maybe?.chainKey) &&
    typeof maybe?.characterId === "string" &&
    isFiniteNumber(maybe?.marketId) &&
    typeof maybe?.name === "string" &&
    typeof maybe?.provider === "string" &&
    typeof maybe?.model === "string" &&
    isFiniteNumber(maybe?.wins) &&
    isFiniteNumber(maybe?.losses) &&
    isFiniteNumber(maybe?.winRate) &&
    isFiniteNumber(maybe?.combatLevel) &&
    isFiniteNumber(maybe?.currentStreak) &&
    isPerpsMarketLifecycleStatus(maybe?.status) &&
    isFiniteNumber(maybe?.lastSeenAt) &&
    isFiniteNumber(maybe?.updatedAt)
  );
}

function coercePerpsMarketDirectoryEntry(
  value: unknown,
  expectedChainKey?: PerpsChainKey | null,
): PerpsMarketDirectoryEntry | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const candidate = { ...(value as Record<string, unknown>) };
  if (expectedChainKey && !isPerpsChainKey(candidate.chainKey)) {
    candidate.chainKey = expectedChainKey;
  }
  if (!isPerpsMarketDirectoryEntry(candidate)) {
    return null;
  }
  if (expectedChainKey && candidate.chainKey !== expectedChainKey) {
    return null;
  }
  return candidate;
}

export function sanitizePerpsOracleHistoryResponse(
  value: unknown,
  characterId: string,
  expectedChainKey?: PerpsChainKey | null,
): PerpsOracleHistoryResponse {
  const candidate = value as Partial<PerpsOracleHistoryResponse>;
  const responseChainKey = isPerpsChainKey(candidate?.chainKey)
    ? candidate.chainKey
    : null;
  const chainKey =
    expectedChainKey && responseChainKey && responseChainKey !== expectedChainKey
      ? expectedChainKey
      : (responseChainKey ?? expectedChainKey ?? null);
  const snapshots =
    expectedChainKey &&
    responseChainKey &&
    responseChainKey !== expectedChainKey
      ? []
      : Array.isArray(candidate?.snapshots)
        ? candidate.snapshots.filter(isPerpsOracleHistorySnapshot)
        : [];

  return {
    chainKey,
    characterId:
      typeof candidate?.characterId === "string" &&
      candidate.characterId.trim().length > 0
        ? candidate.characterId
        : characterId,
    marketId: isFiniteNumber(candidate?.marketId)
      ? candidate.marketId
      : modelMarketIdFromCharacterId(characterId),
    snapshots,
    updatedAt: isFiniteNumber(candidate?.updatedAt)
      ? candidate.updatedAt
      : Date.now(),
  };
}

export function sanitizePerpsMarketsResponse(
  value: unknown,
  expectedChainKey?: PerpsChainKey | null,
): PerpsMarketsResponse {
  const candidate = value as Partial<PerpsMarketsResponse>;
  const responseChainKey = isPerpsChainKey(candidate?.chainKey)
    ? candidate.chainKey
    : null;
  const chainKey =
    responseChainKey ?? expectedChainKey ?? null;
  const markets = Array.isArray(candidate?.markets)
    ? candidate.markets.flatMap((market) => {
        const normalized = coercePerpsMarketDirectoryEntry(
          market,
          expectedChainKey,
        );
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    chainKey,
    markets,
    updatedAt: isFiniteNumber(candidate?.updatedAt)
      ? candidate.updatedAt
      : Date.now(),
  };
}

export function modelMarketIdFromCharacterId(characterId: string): number {
  const namespaced = `hyperscape:model:${characterId.trim().toLowerCase()}`;
  let hash = 0xcbf29ce484222325n;
  const fnvPrime = 0x100000001b3n;
  const maxSafeMarketId = 0x1fffffffffffffn;

  for (let i = 0; i < namespaced.length; i += 1) {
    hash ^= BigInt(namespaced.charCodeAt(i));
    hash = (hash * fnvPrime) & 0xffffffffffffffffn;
  }

  const normalized = hash & maxSafeMarketId;
  return Number(normalized === 0n ? 1n : normalized);
}

export function buildOracleHistoryLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toWinRatePercent(wins: number, losses: number): number {
  const total = wins + losses;
  if (total <= 0) return 0;
  return (wins / total) * 100;
}
