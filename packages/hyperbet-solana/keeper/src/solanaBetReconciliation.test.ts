import { describe, expect, test } from "bun:test";

import bs58 from "bs58";

import {
  reconcileBetExecutionFromIndexedFacts,
  type BetExecutionBaseline,
  type IndexedLifecycleFact,
} from "./solanaBetReconciliation";

const MARKET = bs58.encode(Buffer.alloc(32, 7));
const WALLET = bs58.encode(Buffer.alloc(32, 9));

const baseline: BetExecutionBaseline = {
  betId: "bet-1",
  txSignature: "place-signature",
  marketPda: MARKET,
  wallet: WALLET,
  orderId: "7",
  side: 1,
  limitPrice: 600,
  orderAmountUnits: "10000000000",
  initialMatchedAmountUnits: "4000000000",
  initialRestingAmountUnits: "6000000000",
  initialReleasedAmountUnits: "0",
  initialCollateralLamports: "5600000000",
  initialExecutedCostLamports: "2000000000",
  initialTradeFeeLamports: "40000000",
  initialRewardEligibleLamports: "2040000000",
};

function facts(): IndexedLifecycleFact[] {
  return [
    {
      signature: "place-signature",
      factIndex: 0,
      fact: {
        kind: "ORDER_PLACED",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
        side: 1,
        price: 600,
        orderBehavior: 0,
        amountUnits: "10000000000",
      },
    },
    {
      signature: "place-signature",
      factIndex: 1,
      fact: {
        kind: "TAKER_EXECUTION",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
        side: 1,
        price: 600,
        amountUnits: "4000000000",
        releasedAmountUnits: "0",
        amountLamports: "2000000000",
        feeLamports: "40000000",
        refundLamports: "400000000",
        treasuryFeeLamports: "20000000",
        marketMakerFeeLamports: "20000000",
        selfTradeTriggered: false,
      },
    },
    {
      signature: "maker-fill-signature",
      factIndex: 0,
      fact: {
        kind: "ORDER_MATCHED",
        marketPda: MARKET,
        makerOrderId: "7",
        takerOrderId: "8",
        price: 600,
        amountUnits: "2000000000",
      },
    },
    {
      signature: "cancel-signature",
      factIndex: 0,
      fact: {
        kind: "ORDER_CANCELLED",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
        side: 1,
        price: 600,
        amountUnits: "4000000000",
        amountLamports: "2400000000",
      },
    },
  ];
}

describe("indexed Solana bet reconciliation", () => {
  test("reconciles immediate taker execution, later maker fills, and cancellation", () => {
    expect(
      reconcileBetExecutionFromIndexedFacts({ baseline, facts: facts() }),
    ).toEqual({
      betId: "bet-1",
      matchedAmountUnits: "6000000000",
      restingAmountUnits: "0",
      releasedAmountUnits: "4000000000",
      executedCostLamports: "3200000000",
      tradeFeeLamports: "40000000",
      refundLamports: "2800000000",
      rewardEligibleLamports: "3240000000",
      rewardPointsTotal: 32,
      initialRewardPoints: 20,
    });
  });

  test("records filled-order account closure without classifying rent as collateral or refund", () => {
    const factsWithCleanup = facts();
    factsWithCleanup.push({
      signature: "close-filled-order-signature",
      factIndex: 0,
      fact: {
        kind: "FILLED_ORDER_CLOSED",
        marketPda: MARKET,
        orderId: "7",
        wallet: WALLET,
      },
    });

    expect(
      reconcileBetExecutionFromIndexedFacts({
        baseline,
        facts: factsWithCleanup,
      }),
    ).toEqual(
      reconcileBetExecutionFromIndexedFacts({ baseline, facts: facts() }),
    );
  });

  test("records shared price-level closure without classifying rent as collateral or refund", () => {
    const factsWithCleanup = facts();
    factsWithCleanup.push({
      signature: "close-empty-price-level-signature",
      factIndex: 0,
      fact: {
        kind: "PRICE_LEVEL_CLOSED",
        marketPda: MARKET,
        wallet: WALLET,
        side: 2,
        price: 600,
      },
    });

    expect(
      reconcileBetExecutionFromIndexedFacts({
        baseline,
        facts: factsWithCleanup,
      }),
    ).toEqual(
      reconcileBetExecutionFromIndexedFacts({ baseline, facts: facts() }),
    );
  });

  test("rejects missing placement and drift from immutable initial accounting", () => {
    expect(() =>
      reconcileBetExecutionFromIndexedFacts({
        baseline,
        facts: facts().slice(1),
      }),
    ).toThrow("placement contradicts");
    const drifted = facts();
    drifted[1] = {
      ...drifted[1]!,
      fact: {
        ...drifted[1]!.fact,
        feeLamports: "39999999",
        treasuryFeeLamports: "19999999",
        marketMakerFeeLamports: "20000000",
      },
    };
    expect(() =>
      reconcileBetExecutionFromIndexedFacts({ baseline, facts: drifted }),
    ).toThrow("contradicts immutable place-order accounting");
  });

  test("rejects overfills and release/match double counting", () => {
    const overfilled = facts();
    overfilled.push({
      signature: "bad-fill",
      factIndex: 0,
      fact: {
        kind: "ORDER_MATCHED",
        marketPda: MARKET,
        makerOrderId: "7",
        takerOrderId: "9",
        price: 600,
        amountUnits: "1000000000",
      },
    });
    expect(() =>
      reconcileBetExecutionFromIndexedFacts({ baseline, facts: overfilled }),
    ).toThrow("violate conservation");
  });
});
