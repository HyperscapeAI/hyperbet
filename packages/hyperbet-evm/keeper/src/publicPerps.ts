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

function asEvmPerpsChainKey(value: string): EvmPerpsChainKey | null {
  switch (value.trim().toLowerCase()) {
    case "bsc":
    case "base":
    case "avax":
      return value.trim().toLowerCase() as EvmPerpsChainKey;
    default:
      return null;
  }
}

function parseEvmPerpsChainList(
  value: string | null | undefined,
): EvmPerpsChainKey[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((entry) => asEvmPerpsChainKey(entry))
        .filter((entry): entry is EvmPerpsChainKey => entry != null),
    ),
  );
}

export function resolvePublicEvmPerpsChains(params: {
  configuredChains: readonly string[];
  publicChains: string | null | undefined;
}): EvmPerpsChainKey[] {
  const configured = new Set(
    params.configuredChains
      .map((chainKey) => asEvmPerpsChainKey(chainKey))
      .filter((chainKey): chainKey is EvmPerpsChainKey => chainKey != null),
  );
  const requested = parseEvmPerpsChainList(params.publicChains);
  const publishChains: EvmPerpsChainKey[] =
    requested.length > 0 ? requested : ["bsc"];
  return publishChains.filter((chainKey) => configured.has(chainKey));
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
