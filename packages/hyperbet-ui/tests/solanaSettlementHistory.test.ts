import "./setup";
import { afterEach, describe, expect, test } from "bun:test";

import {
  fetchSolanaSettlementHistory,
  parseSolanaSettlementHistoryResponse,
} from "../src/lib/solanaSettlementHistory";

const originalFetch = globalThis.fetch;

function payload() {
  return {
    schemaVersion: 1,
    chain: "SOLANA",
    asset: "SOL",
    decimals: 9,
    wallet: "wallet-1",
    ledger: {
      current: true,
      lastIndexedAt: 1_700_000_000_100,
      degradedReason: null,
    },
    entries: [
      {
        betId: "bet-1",
        wallet: "wallet-1",
        marketPda: "market-1",
        duelKey: "ab".repeat(32),
        duelId: "duel-1",
        placeSignature: "place-signature",
        recordedAt: 1_700_000_000_000,
        orderId: "7",
        side: 1,
        limitPrice: 600,
        orderAmountUnits: "1000000000",
        matchedAmountUnits: "1000000000",
        restingAmountUnits: "0",
        releasedAmountUnits: "0",
        sourceAmountLamports: "620000000",
        collateralLamports: "600000000",
        executedCostLamports: "600000000",
        tradeFeeLamports: "20000000",
        orderRefundLamports: "0",
        rewardEligibleLamports: "620000000",
        marketStatus: "resolved",
        winner: "a",
        orderState: "FILLED",
        settlementState: "PAYOUT_CLAIMABLE",
        claimSignature: null,
        terminalGrossLamports: "0",
        terminalPayoutLamports: "0",
        terminalFeeLamports: "0",
        reconciledAt: 1_700_000_000_100,
        settledAt: null,
      },
    ],
    total: 1,
    limit: 5,
    offset: 0,
    updatedAt: 1_700_000_000_200,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Solana settlement history", () => {
  test("parses exact integer order and settlement accounting", () => {
    expect(parseSolanaSettlementHistoryResponse(payload())).toMatchObject({
      wallet: "wallet-1",
      ledger: { current: true },
      entries: [
        {
          orderState: "FILLED",
          settlementState: "PAYOUT_CLAIMABLE",
          executedCostLamports: "600000000",
          tradeFeeLamports: "20000000",
        },
      ],
    });
  });

  test("rejects conservation drift and contradictory index state", () => {
    const badReward = payload();
    badReward.entries[0]!.rewardEligibleLamports = "620000001";
    expect(parseSolanaSettlementHistoryResponse(badReward)).toBeNull();

    const badPending = payload();
    badPending.entries[0]!.orderState = "PENDING_INDEX";
    expect(parseSolanaSettlementHistoryResponse(badPending)).toBeNull();

    expect(
      parseSolanaSettlementHistoryResponse({ ...payload(), asset: "USDC" }),
    ).toBeNull();
  });

  test("requests only the connected wallet and requested history page", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const history = await fetchSolanaSettlementHistory({
      wallet: "wallet-1",
      marketPda: "market-1",
      limit: 5,
      offset: 10,
    });
    expect(history.entries).toHaveLength(1);
    expect(requestedUrl).toContain("/api/arena/settlements/wallet-1");
    expect(requestedUrl).toContain("marketPda=market-1");
    expect(requestedUrl).toContain("limit=5");
    expect(requestedUrl).toContain("offset=10");
  });
});
