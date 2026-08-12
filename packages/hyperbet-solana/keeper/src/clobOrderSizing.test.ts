import { describe, expect, test } from "bun:test";

import {
  buildClobQuotePlanningSnapshot,
  CLOB_ORDER_LOT_LAMPORTS,
  DEFAULT_MANAGED_CLOB_MAX_QUOTE_AGE_MS,
  DEFAULT_MANAGED_CLOB_MIN_REFRESH_INTERVAL_MS,
  isConfigRevalidationDue,
  isValidClobOrderLamports,
  quantizeClobOrderLamports,
  resolveManagedClobQuoteTiming,
} from "./clobOrderSizing";

describe("Solana CLOB order sizing", () => {
  test("rounds inventory-adjusted quote sizes down to the contract lot", () => {
    expect(quantizeClobOrderLamports(393_749_999)).toBe(393_749_000);
    expect(quantizeClobOrderLamports(437_500_000)).toBe(437_500_000);
  });

  test("does not turn a sub-lot or invalid target into an order", () => {
    expect(quantizeClobOrderLamports(CLOB_ORDER_LOT_LAMPORTS - 1)).toBe(0);
    expect(quantizeClobOrderLamports(0)).toBe(0);
    expect(quantizeClobOrderLamports(Number.NaN)).toBe(0);
    expect(quantizeClobOrderLamports(Number.MAX_SAFE_INTEGER + 1)).toBe(0);
  });

  test("recognizes only positive, lot-aligned safe integers", () => {
    expect(isValidClobOrderLamports(1_000)).toBe(true);
    expect(isValidClobOrderLamports(1_001)).toBe(false);
    expect(isValidClobOrderLamports(-1_000)).toBe(false);
  });

  test("sizes replacements from matched inventory without double-counting managed quotes", () => {
    const snapshot = buildClobQuotePlanningSnapshot({
      chainKey: "solana",
      lifecycleStatus: "OPEN",
      duelKey: "duel-key",
      marketRef: "market-ref",
      bestBid: 300,
      bestAsk: 700,
      exposure: {
        yes: 25_000,
        no: 10_000,
        openYes: 400_000,
        openNo: 500_000,
        drawdownBps: 12,
      },
    });

    expect(snapshot.exposure).toEqual({
      yes: 25_000,
      no: 10_000,
      openYes: 0,
      openNo: 0,
      drawdownBps: 12,
    });
  });

  test("keeps stable managed quotes for five minutes while allowing fast material refreshes", () => {
    expect(resolveManagedClobQuoteTiming()).toEqual({
      minRefreshIntervalMs: DEFAULT_MANAGED_CLOB_MIN_REFRESH_INTERVAL_MS,
      maxQuoteAgeMs: DEFAULT_MANAGED_CLOB_MAX_QUOTE_AGE_MS,
    });
    expect(
      resolveManagedClobQuoteTiming({
        minRefreshIntervalMs: 2_000,
        maxQuoteAgeMs: 60_000,
      }),
    ).toEqual({ minRefreshIntervalMs: 2_000, maxQuoteAgeMs: 60_000 });
  });

  test("rejects quote timing that would churn the book or conceal stale quotes", () => {
    expect(() =>
      resolveManagedClobQuoteTiming({ maxQuoteAgeMs: 12_000 }),
    ).toThrow();
    expect(() =>
      resolveManagedClobQuoteTiming({ minRefreshIntervalMs: 999 }),
    ).toThrow();
    expect(() =>
      resolveManagedClobQuoteTiming({
        minRefreshIntervalMs: 60_000,
        maxQuoteAgeMs: 30_000,
      }),
    ).toThrow();
  });

  test("revalidates on-chain config only when its bounded cache expires", () => {
    expect(
      isConfigRevalidationDue({
        lastVerifiedAtMs: null,
        intervalMs: 60_000,
        nowMs: 100_000,
      }),
    ).toBe(true);
    expect(
      isConfigRevalidationDue({
        lastVerifiedAtMs: 100_000,
        intervalMs: 60_000,
        nowMs: 159_999,
      }),
    ).toBe(false);
    expect(
      isConfigRevalidationDue({
        lastVerifiedAtMs: 100_000,
        intervalMs: 60_000,
        nowMs: 160_000,
      }),
    ).toBe(true);
  });
});
