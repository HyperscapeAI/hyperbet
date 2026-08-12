import "./setup";
import { act } from "react";
import { afterEach, describe, expect, it } from "bun:test";

import { SolanaSettlementHistory } from "../src/components/SolanaSettlementHistory";
import { render } from "./render";

const originalFetch = globalThis.fetch;

function historyPayload(current = true) {
  return {
    schemaVersion: 1,
    chain: "SOLANA",
    asset: "SOL",
    decimals: 9,
    wallet: "wallet-1",
    ledger: {
      current,
      lastIndexedAt: 1_700_000_000_100,
      degradedReason: current ? null : "indexer is catching up",
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
    limit: 4,
    offset: 0,
    updatedAt: 1_700_000_000_200,
  };
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Solana settlement history UI", () => {
  it("shows verified exact settlement amounts for the active duel", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return Response.json(historyPayload());
    }) as typeof fetch;

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        marketPda="market-1"
        agent1Name="Nova"
        agent2Name="Rook"
      />,
    );
    await flushEffects();

    expect(requestedUrl).toContain("/api/arena/settlements/wallet-1");
    expect(requestedUrl).toContain("marketPda=market-1");
    expect(container.textContent).toContain("Verified");
    expect(container.textContent).toContain("YES · Nova");
    expect(container.textContent).toContain("Winnings ready to claim");
    expect(container.textContent).toContain("1 SOL");
    expect(container.textContent).toContain("0.02 SOL");
    expect(
      container.querySelectorAll('[data-testid="solana-settlement-entry"]'),
    ).toHaveLength(1);
  });

  it("never presents stale settlement data as final", async () => {
    globalThis.fetch = (async () =>
      Response.json(historyPayload(false))) as typeof fetch;

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        marketPda="market-1"
        agent1Name="Nova"
        agent2Name="Rook"
      />,
    );
    await flushEffects();

    expect(container.textContent).toContain("Updating");
    expect(container.textContent).toContain("Checking settlement");
    expect(container.textContent).toContain("not presented as final");
    expect(container.textContent).not.toContain("Winnings ready to claim");
  });

  it("offers an exact verified prior-market settlement target", async () => {
    globalThis.fetch = (async () =>
      Response.json(historyPayload())) as typeof fetch;
    const requests: unknown[] = [];

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        agent1Name="Nova"
        agent2Name="Rook"
        onRequestSettlement={(request) => requests.push(request)}
      />,
    );
    await flushEffects();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="solana-settlement-action-bet-1"]',
    );
    expect(button?.textContent).toContain("Claim winnings");
    await act(async () => button?.click());
    expect(requests).toEqual([
      {
        betId: "bet-1",
        marketPda: "market-1",
        duelKey: "ab".repeat(32),
        duelId: "duel-1",
        settlementState: "PAYOUT_CLAIMABLE",
      },
    ]);
  });

  it("never offers a stale or identity-incomplete settlement action", async () => {
    const stale = historyPayload(false);
    stale.entries[0]!.duelKey = null;
    globalThis.fetch = (async () => Response.json(stale)) as typeof fetch;

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        agent1Name="Nova"
        agent2Name="Rook"
        onRequestSettlement={() => {
          throw new Error("stale settlement must not be actionable");
        }}
      />,
    );
    await flushEffects();

    expect(
      container.querySelector('[data-testid^="solana-settlement-action-"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid^="solana-order-history-action-"]'),
    ).toBeNull();
  });

  it("offers exact prior-market resting-order recovery without binding to the live market", async () => {
    const reclaimable = historyPayload();
    Object.assign(reclaimable.entries[0]!, {
      matchedAmountUnits: "500000000",
      restingAmountUnits: "500000000",
      executedCostLamports: "300000000",
      tradeFeeLamports: "10000000",
      rewardEligibleLamports: "310000000",
      marketStatus: "cancelled",
      winner: "none",
      orderState: "RECLAIM_REQUIRED",
      settlementState: "REFUND_CLAIMABLE",
    });
    globalThis.fetch = (async () => Response.json(reclaimable)) as typeof fetch;
    const requests: unknown[] = [];

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        agent1Name="Nova"
        agent2Name="Rook"
        onRequestOrderManagement={(request) => requests.push(request)}
      />,
    );
    await flushEffects();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="solana-order-history-action-bet-1"]',
    );
    expect(container.textContent).toContain("Reclaim required");
    expect(button?.textContent).toContain("Reclaim resting order");
    await act(async () => button?.click());
    expect(requests).toEqual([
      {
        betId: "bet-1",
        marketPda: "market-1",
        duelKey: "ab".repeat(32),
        duelId: "duel-1",
        orderId: "7",
        orderState: "RECLAIM_REQUIRED",
      },
    ]);
  });

  it("stays private and idle until a wallet is connected", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return Response.json(historyPayload());
    }) as typeof fetch;

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress={null}
        marketPda="market-1"
        agent1Name="Nova"
        agent2Name="Rook"
      />,
    );
    await flushEffects();

    expect(fetchCount).toBe(0);
    expect(container.textContent).toContain("Connect your wallet");
  });

  it("loads older wallet activity instead of hiding it behind the first page", async () => {
    const first = historyPayload();
    const secondEntry = {
      ...first.entries[0]!,
      betId: "bet-2",
      orderId: "8",
      duelId: "duel-2",
      placeSignature: "place-signature-2",
      recordedAt: 1_699_999_999_000,
    };
    const thirdEntry = {
      ...first.entries[0]!,
      betId: "bet-3",
      orderId: "9",
      duelId: "duel-3",
      placeSignature: "place-signature-3",
      recordedAt: 1_699_999_998_000,
    };
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      const limit = Number(new URL(url).searchParams.get("limit"));
      return Response.json({
        ...first,
        entries:
          limit <= 2
            ? [first.entries[0]!, secondEntry]
            : [first.entries[0]!, secondEntry, thirdEntry],
        total: 3,
        limit,
      });
    }) as typeof fetch;

    const { container } = render(
      <SolanaSettlementHistory
        walletAddress="wallet-1"
        agent1Name="Nova"
        agent2Name="Rook"
        compact
      />,
    );
    await flushEffects();

    const loadMore = container.querySelector<HTMLButtonElement>(
      '[data-testid="solana-settlement-load-more"]',
    );
    expect(loadMore?.textContent).toContain("Show more activity (1)");
    await act(async () => loadMore?.click());
    await flushEffects();

    expect(
      container.querySelectorAll('[data-testid="solana-settlement-entry"]'),
    ).toHaveLength(3);
    expect(requests.some((url) => url.includes("limit=4"))).toBe(true);
    expect(
      container.querySelector('[data-testid="solana-settlement-load-more"]'),
    ).toBeNull();
  });
});
