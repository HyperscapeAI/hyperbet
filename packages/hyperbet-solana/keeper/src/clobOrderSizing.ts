import type { MarketSnapshot } from "./solanaMarketMakerPolicy";

export const CLOB_ORDER_LOT_LAMPORTS = 1_000;
export const DEFAULT_MANAGED_CLOB_MIN_REFRESH_INTERVAL_MS = 5_000;
export const DEFAULT_MANAGED_CLOB_MAX_QUOTE_AGE_MS = 5 * 60_000;

export type ManagedClobQuoteTiming = {
  minRefreshIntervalMs: number;
  maxQuoteAgeMs: number;
};

export function resolveManagedClobQuoteTiming(
  input: {
    minRefreshIntervalMs?: number;
    maxQuoteAgeMs?: number;
  } = {},
): ManagedClobQuoteTiming {
  const minRefreshIntervalMs =
    input.minRefreshIntervalMs ?? DEFAULT_MANAGED_CLOB_MIN_REFRESH_INTERVAL_MS;
  const maxQuoteAgeMs =
    input.maxQuoteAgeMs ?? DEFAULT_MANAGED_CLOB_MAX_QUOTE_AGE_MS;

  if (
    !Number.isSafeInteger(minRefreshIntervalMs) ||
    minRefreshIntervalMs < 1_000 ||
    minRefreshIntervalMs > 60_000
  ) {
    throw new Error(
      "managed CLOB minimum refresh interval must be an integer from 1000 to 60000 milliseconds",
    );
  }
  if (
    !Number.isSafeInteger(maxQuoteAgeMs) ||
    maxQuoteAgeMs < 30_000 ||
    maxQuoteAgeMs > 15 * 60_000 ||
    maxQuoteAgeMs < minRefreshIntervalMs
  ) {
    throw new Error(
      "managed CLOB maximum quote age must be an integer from 30000 to 900000 milliseconds and not shorter than the refresh interval",
    );
  }

  return { minRefreshIntervalMs, maxQuoteAgeMs };
}

export function isConfigRevalidationDue(input: {
  lastVerifiedAtMs: number | null;
  intervalMs: number;
  nowMs?: number;
}): boolean {
  if (input.lastVerifiedAtMs == null) return true;
  const nowMs = input.nowMs ?? Date.now();
  return nowMs - input.lastVerifiedAtMs >= input.intervalMs;
}

export function quantizeClobOrderLamports(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return Math.floor(value / CLOB_ORDER_LOT_LAMPORTS) * CLOB_ORDER_LOT_LAMPORTS;
}

export function isValidClobOrderLamports(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value % CLOB_ORDER_LOT_LAMPORTS === 0
  );
}

export function buildClobQuotePlanningSnapshot(
  snapshot: MarketSnapshot,
): MarketSnapshot {
  return {
    ...snapshot,
    exposure: {
      ...snapshot.exposure,
      // These orders are about to be kept, cancelled, or replaced. Counting
      // them again when calculating the replacement size creates quote churn.
      openYes: 0,
      openNo: 0,
    },
  };
}
