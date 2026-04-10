import type { EvmPerpsChainKey } from "./db";

export type PublicPerpsChainKey = "solana" | EvmPerpsChainKey;

export function normalizePublicPerpsChainKeyParam(
  value: string | null,
): PublicPerpsChainKey | null {
  if (
    value === "solana" ||
    value === "bsc" ||
    value === "base" ||
    value === "avax"
  ) {
    return value;
  }
  return null;
}

export function buildExternalPerpsUrl(params: {
  baseUrl: string;
  pathname: "/api/perps/markets" | "/api/perps/oracle-history";
  searchParams: URLSearchParams;
}): string {
  const target = new URL(
    params.pathname,
    params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`,
  );
  for (const [key, value] of params.searchParams.entries()) {
    if (key === "chainKey") {
      continue;
    }
    target.searchParams.set(key, value);
  }
  return target.toString();
}

export function adaptLegacySolanaPerpsMarketsPayload(value: unknown): {
  chainKey: "solana";
  markets: Array<Record<string, unknown>>;
  updatedAt: number;
} {
  const candidate = asRecord(value);
  const markets = Array.isArray(candidate.markets)
    ? candidate.markets.flatMap((market) => {
        const record = asOptionalRecord(market);
        return record ? [{ ...record, chainKey: "solana" }] : [];
      })
    : [];
  return {
    chainKey: "solana",
    markets,
    updatedAt: coerceTimestamp(candidate.updatedAt),
  };
}

export function adaptLegacySolanaPerpsOracleHistoryPayload(
  value: unknown,
): Record<string, unknown> {
  const candidate = asRecord(value);
  return {
    ...candidate,
    chainKey: "solana",
    snapshots: Array.isArray(candidate.snapshots) ? candidate.snapshots : [],
    updatedAt: coerceTimestamp(candidate.updatedAt),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null
    ? (value as Record<string, unknown>)
    : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null
    ? (value as Record<string, unknown>)
    : null;
}

function coerceTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Date.now();
}
