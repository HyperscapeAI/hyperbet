import "./setup";
import { act } from "react";
import { afterEach, describe, expect, it } from "bun:test";

import { SolanaPointsDisplay } from "../src/components/SolanaPointsDisplay";
import { SolanaReferralPanel } from "../src/components/SolanaReferralPanel";
import { PointsHistory } from "../src/components/PointsHistory";
import { PointsLeaderboard } from "../src/components/PointsLeaderboard";
import { render } from "./render";

const originalFetch = globalThis.fetch;

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Solana launch rewards UI", () => {
  it("renders non-cash points without token balances or multipliers", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/rank/")) {
        return Response.json({ rank: 7 });
      }
      return Response.json({
        totalPoints: 1250,
        selfPoints: 100,
        winPoints: 1000,
        referralPoints: 150,
      });
    }) as typeof fetch;

    const { container } = render(
      <SolanaPointsDisplay walletAddress="wallet-1" />,
    );
    await flushEffects();

    expect(container.textContent).toContain("1,250");
    expect(container.textContent).toContain("Rank #7");
    expect(container.textContent).toContain("100/1000/150");
    expect(container.textContent).not.toContain("multiplier");
  });

  it("keeps referrals Solana-only and does not display cash fee sharing", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/api/arena/invite/")) {
        return Response.json({
          inviteCode: "SOL123",
          invitedWalletCount: 3,
          activeReferralCount: 2,
          pendingSignupBonuses: 1,
          totalReferralWinPoints: 25,
        });
      }
      return Response.json({ totalPoints: 500, referredBy: null });
    }) as typeof fetch;

    const { container } = render(
      <SolanaReferralPanel solanaWallet="solana-wallet-1" />,
    );
    await flushEffects();

    expect(container.textContent).toContain("SOL123");
    expect(
      container.querySelector('[data-testid="referral-panel-invite-code"]')
        ?.textContent,
    ).toBe("SOL123");
    expect(container.textContent).toContain("Referrals: 2/3");
    expect(container.textContent).not.toContain("Fee Share");
    expect(container.textContent).not.toContain("Link Wallets");
  });

  it("renders every points event emitted by the SOL launch ledger", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        entries: [
          {
            id: 1,
            eventType: "BET_FILL",
            status: "CONFIRMED",
            totalPoints: 40,
            referenceType: "BET",
            referenceId: "bet-1",
            relatedWallet: null,
            createdAt: Date.now(),
          },
          {
            id: 2,
            eventType: "REFERRAL_FILL",
            status: "CONFIRMED",
            totalPoints: 4,
            referenceType: "BET",
            referenceId: "bet-1",
            relatedWallet: "referral-wallet",
            createdAt: Date.now(),
          },
        ],
        total: 2,
      })) as unknown as typeof fetch;

    const { container } = render(
      <PointsHistory walletAddress="solana-wallet-1" locale="en" />,
    );
    await flushEffects();

    expect(container.textContent).toContain("Bet Filled");
    expect(container.textContent).toContain("Referral Fill");
    const filterValues = Array.from(
      container.querySelectorAll<HTMLSelectElement>(
        '[data-testid="points-history-filter"] option',
      ),
    ).map((option) => option.value);
    expect(filterValues).toEqual([
      "",
      "BET_PLACED",
      "BET_FILL",
      "REFERRAL_WIN",
      "REFERRAL_FILL",
      "SIGNUP_REFERRER",
      "SIGNUP_REFEREE",
    ]);
    expect(container.textContent).not.toContain("Staking");
    expect(container.textContent).not.toContain("Wallet Link");
  });

  it("requests a wallet-only leaderboard without legacy identity scope", async () => {
    const requestUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      requestUrls.push(String(input));
      return Response.json({
        leaderboard: [
          { rank: 1, wallet: "solana-wallet-1", totalPoints: 1250 },
        ],
      });
    }) as typeof fetch;

    const { container } = render(<PointsLeaderboard locale="en" />);
    await flushEffects();

    expect(requestUrls).toHaveLength(1);
    const requestUrl = new URL(requestUrls[0]!, "http://localhost");
    expect(requestUrl.searchParams.get("scope")).toBeNull();
    expect(requestUrl.searchParams.get("window")).toBe("alltime");
    expect(container.textContent).toContain("1,250");
    expect(
      container.querySelector('[data-testid^="points-leaderboard-scope-"]'),
    ).toBeNull();
  });
});
