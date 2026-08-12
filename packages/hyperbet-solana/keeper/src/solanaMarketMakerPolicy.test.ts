import { describe, expect, test } from "bun:test";

import {
  buildQuotePlan,
  buildRiskState,
  computeFairValue,
  DEFAULT_MARKET_MAKER_CONFIG,
  evaluateQuoteDecision,
  type MarketSnapshot,
} from "./solanaMarketMakerPolicy";

const NOW = 10_500;

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    chainKey: "solana",
    lifecycleStatus: "OPEN",
    duelKey: "duel-key",
    marketRef: "market",
    bestBid: 490,
    bestAsk: 510,
    lastStreamAtMs: 10_000,
    lastOracleAtMs: 10_000,
    lastRpcAtMs: 10_000,
    exposure: { yes: 0, no: 0, openYes: 0, openNo: 0 },
    ...overrides,
  };
}

describe("SOL launch market-maker policy", () => {
  test("blends book/signal value and shifts away from inventory", () => {
    const fairValue = computeFairValue({
      bookBid: 450,
      bookAsk: 550,
      signalPrice: 800,
      signalWeight: 0.5,
      inventorySkew: 0.5,
      inventorySkewBps: 1_000,
    });
    expect(fairValue).toBeGreaterThan(500);
    expect(fairValue).toBeLessThan(650);
  });

  test("quotes only an open, fresh, nonclosing Solana market", () => {
    expect(
      buildRiskState(snapshot(), DEFAULT_MARKET_MAKER_CONFIG, NOW)
        .circuitBreaker,
    ).toEqual({
      active: false,
      reason: null,
    });
    expect(
      buildRiskState(
        snapshot({ lifecycleStatus: "LOCKED" }),
        DEFAULT_MARKET_MAKER_CONFIG,
        NOW,
      ).circuitBreaker.reason,
    ).toBe("market:locked");
    expect(
      buildRiskState(
        snapshot({ lastStreamAtMs: NOW - 10_000 }),
        DEFAULT_MARKET_MAKER_CONFIG,
        NOW,
      ).circuitBreaker.reason,
    ).toBe("stale-stream");
    expect(
      buildRiskState(
        snapshot({ betCloseTimeMs: NOW + 1_000 }),
        DEFAULT_MARKET_MAKER_CONFIG,
        NOW,
      ).circuitBreaker.reason,
    ).toBe("bet-close-guard");
  });

  test("widens and shrinks quotes under toxic flow", () => {
    const plan = buildQuotePlan(
      snapshot({
        bestBid: 300,
        bestAsk: 700,
        exposure: { yes: 100, no: 100, openYes: 0, openNo: 0 },
      }),
      { signalPrice: 500, signalWeight: 0.5 },
      DEFAULT_MARKET_MAKER_CONFIG,
      NOW,
    );
    expect(plan.bidPrice).not.toBeNull();
    expect(plan.askPrice).not.toBeNull();
    expect((plan.askPrice ?? 0) - (plan.bidPrice ?? 0)).toBeGreaterThanOrEqual(
      20,
    );
    expect(plan.bidUnits).toBeLessThanOrEqual(
      DEFAULT_MARKET_MAKER_CONFIG.maxQuoteUnits,
    );
  });

  test("stops overloaded and gross-limit markets", () => {
    const overloaded = buildQuotePlan(
      snapshot({
        exposure: {
          yes: DEFAULT_MARKET_MAKER_CONFIG.maxInventoryPerSide,
          no: 10,
          openYes: 0,
          openNo: 0,
        },
      }),
      {},
      DEFAULT_MARKET_MAKER_CONFIG,
      NOW,
    );
    expect(overloaded.bidUnits).toBe(0);
    expect(overloaded.askUnits).toBeGreaterThan(0);

    const grossLimited = buildRiskState(
      snapshot({
        exposure: {
          yes: DEFAULT_MARKET_MAKER_CONFIG.maxGrossExposure / 2,
          no: DEFAULT_MARKET_MAKER_CONFIG.maxGrossExposure / 2,
          openYes: 10,
          openNo: 10,
        },
      }),
      DEFAULT_MARKET_MAKER_CONFIG,
      NOW,
    );
    expect(grossLimited.circuitBreaker.reason).toBe("market-notional-limit");
  });

  test("enters reduce-only mode on severe side imbalance", () => {
    const plan = buildQuotePlan(
      snapshot({
        exposure: { yes: 300, no: 10, openYes: 0, openNo: 0 },
      }),
      {},
      {
        ...DEFAULT_MARKET_MAKER_CONFIG,
        minQuoteUnits: 10,
        maxQuoteUnits: 40,
        maxInventoryPerSide: 500,
        maxNetExposure: 500,
        maxGrossExposure: 700,
        maxSideImbalanceBps: 6_000,
      },
      NOW,
    );
    expect(plan.risk.reduceOnly).toBe(true);
    expect(plan.bidUnits).toBe(0);
    expect(plan.askUnits).toBeGreaterThan(0);
  });

  test("refreshes changed size only after the refresh window opens", () => {
    const config = {
      ...DEFAULT_MARKET_MAKER_CONFIG,
      minQuoteUnits: 10,
      maxQuoteUnits: 40,
      minRefreshIntervalMs: 5_000,
      maxQuoteAgeMs: 20_000,
    };
    const earlyPlan = buildQuotePlan(
      snapshot({ quoteAgeMs: 2_000 }),
      {},
      config,
      NOW,
    );
    const active = {
      price: earlyPlan.bidPrice ?? 1,
      units: earlyPlan.bidUnits + 5,
      placedAtMs: NOW - 2_000,
    };
    expect(
      evaluateQuoteDecision("BID", earlyPlan, active, config, NOW).shouldKeep,
    ).toBe(true);

    const duePlan = buildQuotePlan(
      snapshot({ quoteAgeMs: 6_000 }),
      {},
      config,
      NOW,
    );
    const decision = evaluateQuoteDecision("BID", duePlan, active, config, NOW);
    expect(decision.shouldCancel).toBe(true);
    expect(decision.shouldPlace).toBe(true);
    expect(decision.reason).toBe("size-refresh");
  });

  test("expires unchanged quotes at the maximum age", () => {
    const config = { ...DEFAULT_MARKET_MAKER_CONFIG, maxQuoteAgeMs: 12_000 };
    const plan = buildQuotePlan(snapshot({ quoteAgeMs: 0 }), {}, config, NOW);
    const decision = evaluateQuoteDecision(
      "ASK",
      plan,
      {
        price: plan.askPrice ?? 1,
        units: plan.askUnits,
        placedAtMs: NOW - 12_000,
      },
      config,
      NOW,
    );
    expect(decision.reason).toBe("quote-expired");
    expect(decision.shouldCancel).toBe(true);
    expect(decision.shouldPlace).toBe(true);
  });
});
