import { describe, expect, it } from "bun:test";

import {
  assertSolanaManagedOrderBookLinks,
  buildSolanaManagedOrderPlan as buildSolanaManagedOrderPlanWithRent,
  sameSolanaManagedOrderQuote,
  type SolanaManagedOrderSnapshot,
} from "../src/lib/solanaOrderManagement";

const MARKET = "Market1111111111111111111111111111111111111";
const WALLET = "Wallet1111111111111111111111111111111111111";
const ORDER_RENT_LAMPORTS = 1_719n;

function order(
  overrides: Partial<SolanaManagedOrderSnapshot> = {},
): SolanaManagedOrderSnapshot {
  return {
    marketState: MARKET,
    id: 7n,
    side: 1,
    price: 600,
    maker: WALLET,
    amount: 2_000n,
    filled: 500n,
    previousOrderId: 6n,
    nextOrderId: 8n,
    active: true,
    continuationPending: false,
    ...overrides,
  };
}

function buildSolanaManagedOrderPlan(
  input: Omit<
    Parameters<typeof buildSolanaManagedOrderPlanWithRent>[0],
    "orderAccountLamports"
  > & { orderAccountLamports?: bigint },
) {
  return buildSolanaManagedOrderPlanWithRent({
    ...input,
    orderAccountLamports: input.orderAccountLamports ?? ORDER_RENT_LAMPORTS,
  });
}

describe("Solana managed-order planning", () => {
  it("plans an exact open-market cancellation with neighbors in program order", () => {
    expect(
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order(),
      }),
    ).toEqual({
      action: "CANCEL",
      marketState: MARKET,
      orderId: 7n,
      side: 1,
      outcomeSide: "YES",
      outcomePriceMillis: 600,
      programPriceMillis: 600,
      originalUnits: 2_000n,
      filledUnits: 500n,
      remainingUnits: 1_500n,
      refundableCollateralLamports: 900n,
      returnedOrderAccountRentLamports: ORDER_RENT_LAMPORTS,
      grossWalletCreditLamports: 2_619n,
      previousOrderId: 6n,
      nextOrderId: 8n,
      adjacentOrderIds: [6n, 8n],
      continuationPending: false,
    });
  });

  it("routes non-open ask orders to reclaim using the complementary price", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "resolved",
      marketState: MARKET,
      wallet: WALLET,
      order: order({
        side: 2,
        price: 650,
        amount: 2_000n,
        filled: 1_000n,
      }),
    });
    expect(plan.action).toBe("RECLAIM");
    expect(plan.outcomeSide).toBe("NO");
    expect(plan.outcomePriceMillis).toBe(350);
    expect(plan.refundableCollateralLamports).toBe(350n);
  });

  it("supports continuation-pending orders without linked book accounts", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "locked",
      marketState: MARKET,
      wallet: WALLET,
      order: order({
        previousOrderId: 0n,
        nextOrderId: 0n,
        continuationPending: true,
      }),
    });
    expect(plan.action).toBe("RECLAIM");
    expect(plan.adjacentOrderIds).toEqual([]);
  });

  it("plans maker-only rent cleanup for an inactive fully filled order in any lifecycle", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "unknown",
      marketState: MARKET,
      wallet: WALLET,
      order: order({
        active: false,
        filled: 2_000n,
        previousOrderId: 0n,
        nextOrderId: 0n,
      }),
    });
    expect(plan).toMatchObject({
      action: "CLOSE_FILLED",
      remainingUnits: 0n,
      refundableCollateralLamports: 0n,
      returnedOrderAccountRentLamports: ORDER_RENT_LAMPORTS,
      grossWalletCreditLamports: ORDER_RENT_LAMPORTS,
      adjacentOrderIds: [],
    });
  });

  it("rejects ownership, market, lifecycle, and inactive-order drift", () => {
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: "DifferentWallet",
        order: order(),
      }),
    ).toThrow("Only the order maker");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: "DifferentMarket",
        wallet: WALLET,
        order: order(),
      }),
    ).toThrow("active market");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "unknown",
        marketState: MARKET,
        wallet: WALLET,
        order: order(),
      }),
    ).toThrow("not safe");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order({ active: false }),
      }),
    ).toThrow("Inactive order is not fully filled");
  });

  it("rejects empty, malformed, and imprecise remainder states", () => {
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order(),
        orderAccountLamports: 0n,
      }),
    ).toThrow("positive lamport");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order({ filled: 2_000n }),
      }),
    ).toThrow("no remaining amount");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order({ previousOrderId: 7n }),
      }),
    ).toThrow("invalid linked-list");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order({ amount: 2_001n }),
      }),
    ).toThrow("precision rule");
    expect(() =>
      buildSolanaManagedOrderPlan({
        marketStatus: "open",
        marketState: MARKET,
        wallet: WALLET,
        order: order({
          active: false,
          filled: 2_000n,
          previousOrderId: 6n,
          nextOrderId: 0n,
        }),
      }),
    ).toThrow("still linked");
  });

  it("detects any user-visible or account-graph change before signature", () => {
    const original = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
    });
    const unchanged = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
    });
    const partiallyFilled = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order({ filled: 1_000n }),
    });
    const locked = buildSolanaManagedOrderPlan({
      marketStatus: "locked",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
    });
    const rentChanged = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
      orderAccountLamports: ORDER_RENT_LAMPORTS + 1n,
    });
    expect(sameSolanaManagedOrderQuote(original, unchanged)).toBe(true);
    expect(sameSolanaManagedOrderQuote(original, partiallyFilled)).toBe(false);
    expect(sameSolanaManagedOrderQuote(original, locked)).toBe(false);
    expect(sameSolanaManagedOrderQuote(original, rentChanged)).toBe(false);
  });

  it("validates the complete linked price level before mutation", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
    });
    expect(() =>
      assertSolanaManagedOrderBookLinks({
        plan,
        priceLevel: {
          marketState: MARKET,
          side: 1,
          price: 600,
          headOrderId: 6n,
          tailOrderId: 8n,
          totalOpen: 4_500n,
        },
        adjacentOrders: [
          order({ id: 6n, previousOrderId: 0n, nextOrderId: 7n }),
          order({ id: 8n, previousOrderId: 7n, nextOrderId: 0n }),
        ],
      }),
    ).not.toThrow();
  });

  it("fails closed when a price-level boundary or neighbor link drifts", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order(),
    });
    const headPlan = buildSolanaManagedOrderPlan({
      marketStatus: "open",
      marketState: MARKET,
      wallet: WALLET,
      order: order({ previousOrderId: 0n }),
    });
    const priceLevel = {
      marketState: MARKET,
      side: 1 as const,
      price: 600,
      headOrderId: 6n,
      tailOrderId: 8n,
      totalOpen: 4_500n,
    };
    expect(() =>
      assertSolanaManagedOrderBookLinks({
        plan: headPlan,
        priceLevel,
        adjacentOrders: [order({ id: 8n, previousOrderId: 7n })],
      }),
    ).toThrow("head");
    expect(() =>
      assertSolanaManagedOrderBookLinks({
        plan,
        priceLevel,
        adjacentOrders: [
          order({ id: 6n, previousOrderId: 0n, nextOrderId: 8n }),
          order({ id: 8n, previousOrderId: 7n, nextOrderId: 0n }),
        ],
      }),
    ).toThrow("Previous order");
  });

  it("accepts a continuation-pending order without linked accounts", () => {
    const plan = buildSolanaManagedOrderPlan({
      marketStatus: "locked",
      marketState: MARKET,
      wallet: WALLET,
      order: order({
        previousOrderId: 0n,
        nextOrderId: 0n,
        continuationPending: true,
      }),
    });
    expect(() =>
      assertSolanaManagedOrderBookLinks({
        plan,
        priceLevel: {
          marketState: MARKET,
          side: 1,
          price: 600,
          headOrderId: 0n,
          tailOrderId: 0n,
          totalOpen: 0n,
        },
        adjacentOrders: [],
      }),
    ).not.toThrow();
  });
});
