import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

type E2eState = {
  solanaTraderPublicKey?: string;
  evmHeadlessAddress?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
  currentMatchId?: number;
  currentDuelKeyHex?: string;
  clobMatchState?: string;
  evmMatchId?: number;
  evmGoldClobAddress?: string;
};

type StreamingStateResponse = {
  cycle: {
    agent1: { name: string } | null;
    agent2: { name: string } | null;
    phase: string;
  };
  leaderboard: Array<{ rank: number; name: string }>;
};

type PointsResponse = {
  totalPoints: number;
  identityWalletCount: number;
  invitedWalletCount: number;
  referredBy: { wallet: string; code: string } | null;
};

type RankResponse = {
  rank: number;
  totalPoints: number;
};

type MultiplierResponse = {
  multiplier: number;
  tier: string;
  goldBalance: string;
  goldHoldDays: number;
};

type HistoryEntry = {
  id: number;
  eventType: string;
  totalPoints: number;
};

type HistoryResponse = {
  entries: HistoryEntry[];
  total: number;
};

type LeaderboardResponse = {
  leaderboard: Array<{ rank: number; wallet: string; totalPoints: number }>;
};

type InviteResponse = {
  inviteCode: string;
};

type PerpsMarketsResponse = {
  markets: Array<{
    characterId: string;
    marketId: number;
    name: string;
  }>;
};

type PerpsOracleHistoryResponse = {
  snapshots: Array<{ spotIndex: number }>;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    winner: string;
    betCloseTime: number | null;
  };
  markets: Array<{
    chainKey: string;
    duelKey: string | null;
    duelId: string | null;
    marketId: string | null;
    marketRef: string | null;
    lifecycleStatus: string;
    winner: string;
    betCloseTime: number | null;
    contractAddress: string | null;
    programId: string | null;
    txRef: string | null;
    syncedAt: number | null;
  }>;
  updatedAt: number | null;
};

type KeeperBotHealthResponse = {
  ok: boolean;
  running: boolean;
  health: {
    chainKey: string;
    updatedAtMs: number;
    running: boolean;
    recovery: string[];
    markets: Array<{
      lifecycleStatus: string;
      marketRef: string | null;
    }>;
  } | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");

const HISTORY_LABELS: Record<string, string> = {
  BET_PLACED: "Bet Placed",
  BET_WON: "Bet Won",
  REFERRAL_WIN: "Referral Win",
  SIGNUP_REFERRER: "Signup Bonus (Referrer)",
  SIGNUP_REFEREE: "Signup Bonus",
  STAKING_DAILY: "Staking Reward",
  WALLET_LINK: "Wallet Link Bonus",
};

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function normalizeHexValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/^0x/, "");
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

async function fetchJson<T>(
  request: APIRequestContext,
  pathname: string,
): Promise<T> {
  const response = await request.get(`${GAME_API_URL}${pathname}`);
  expect(response.ok(), `GET ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function gotoApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/?debug=1", { waitUntil: "domcontentloaded" });
    try {
      await expect
        .poll(
          async () => {
            const bodyText = (
              (await page
                .locator("body")
                .textContent()
                .catch(() => "")) || ""
            )
              .trim()
              .toUpperCase();
            if (
              bodyText.includes("HYPERSCAPE DUEL ARENA") ||
              bodyText.includes("ULTRA SIMPLE FIGHT BET")
            ) {
              return bodyText;
            }
            return "";
          },
          {
            timeout: 20_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.goto("about:blank");
    }
  }
}

async function selectChain(
  page: Page,
  chain: "solana" | "bsc" | "base",
): Promise<void> {
  const normalizedChain = chain.toLowerCase();
  const debugSelector = page.getByTestId("e2e-chain-select").first();
  const primarySelector = page.locator("#chain-selector").first();

  if (await debugSelector.isVisible().catch(() => false)) {
    await debugSelector.selectOption(normalizedChain);
    await expect(page.getByTestId("e2e-active-chain")).toHaveText(
      normalizedChain,
    );
    return;
  }

  if (await primarySelector.isVisible().catch(() => false)) {
    await primarySelector.selectOption(normalizedChain);
    await expect(primarySelector).toHaveValue(normalizedChain);
    return;
  }

  throw new Error(`Unable to select ${chain} chain`);
}

async function clickTestId(page: Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId).first();
  await locator.waitFor({ state: "visible", timeout: 30_000 });
  try {
    await locator.click({ timeout: 10_000 });
  } catch {
    await locator.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
  }
}

test.describe("app tabs and api coverage", () => {
  test("keeper backend exposes all app-facing data endpoints", async ({
    request,
  }) => {
    const state = loadState();
    const wallet = state.solanaTraderPublicKey || "";
    const characterId = state.perpsCharacterId || "";

    const status = await fetchJson<{ service: string }>(request, "/status");
    expect(status.service).toBe("hyperbet-avax-backend");

    const streamState = await fetchJson<StreamingStateResponse>(
      request,
      "/api/streaming/state",
    );
    expect(streamState.cycle.phase).toBe("FIGHTING");
    expect(streamState.cycle.agent1?.name).toBeTruthy();
    expect(streamState.leaderboard.length).toBeGreaterThan(0);

    const duelContext = await fetchJson<StreamingStateResponse>(
      request,
      "/api/streaming/duel-context",
    );
    expect(duelContext.cycle.agent1?.name).toBe(streamState.cycle.agent1?.name);

    const predictionMarkets = await fetchJson<PredictionMarketsResponse>(
      request,
      "/api/arena/prediction-markets/active",
    );
    expect(predictionMarkets.duel.phase).toBe(streamState.cycle.phase);
    expect(predictionMarkets.duel.duelId).toBe(
      state.currentMatchId != null ? String(state.currentMatchId) : null,
    );
    expect(predictionMarkets.duel.duelKey).toBe(state.currentDuelKeyHex || null);
    const solanaMarket = predictionMarkets.markets.find(
      (market) => market.chainKey === "solana",
    );
    const avaxMarket = predictionMarkets.markets.find(
      (market) => market.chainKey === "avax",
    );
    expect(solanaMarket?.marketRef).toBe(state.clobMatchState || null);
    expect(avaxMarket).toBeTruthy();
    expect(avaxMarket?.contractAddress).toBe(
      state.evmGoldClobAddress || null,
    );
    expect(
      avaxMarket?.marketRef == null ||
        /^[0-9a-f]{64}$/i.test(normalizeHexValue(avaxMarket?.marketRef) || ""),
    ).toBe(true);
    expect([
      "OPEN",
      "LOCKED",
      "PROPOSED",
      "CHALLENGED",
      "RESOLVED",
      "CANCELLED",
      "PENDING",
      "UNKNOWN",
    ]).toContain(avaxMarket?.lifecycleStatus);
    expect(
      avaxMarket?.metadata?.proposalId == null ||
        typeof avaxMarket.metadata.proposalId === "string",
    ).toBe(true);
    expect(
      avaxMarket?.metadata?.challengeWindowEndsAt == null ||
        typeof avaxMarket.metadata.challengeWindowEndsAt === "number",
    ).toBe(true);
    expect(
      avaxMarket?.metadata?.finalizedAt == null ||
        typeof avaxMarket.metadata.finalizedAt === "number",
    ).toBe(true);
    expect(
      avaxMarket?.metadata?.cancellationReason == null ||
        typeof avaxMarket.metadata.cancellationReason === "string",
    ).toBe(true);

    await expect
      .poll(async () => {
        const botHealth = await fetchJson<KeeperBotHealthResponse>(
          request,
          "/api/keeper/bot-health",
        );
        return {
          ok: botHealth.ok,
          running: botHealth.running,
          chainKey: botHealth.health?.chainKey ?? null,
          updatedAtMs: Number(botHealth.health?.updatedAtMs ?? 0),
          hasMarkets: (botHealth.health?.markets.length ?? 0) > 0,
          recovery: Array.isArray(botHealth.health?.recovery),
        };
      })
      .toEqual({
        ok: true,
        running: true,
        chainKey: "avax",
        updatedAtMs: expect.any(Number),
        hasMarkets: true,
        recovery: true,
      });

    const points = await fetchJson<PointsResponse>(
      request,
      `/api/arena/points/${encodeURIComponent(wallet)}?scope=linked`,
    );
    expect(points.totalPoints).toBeGreaterThan(0);
    expect(points.identityWalletCount).toBeGreaterThanOrEqual(2);
    expect(points.invitedWalletCount).toBeGreaterThanOrEqual(1);

    const rank = await fetchJson<RankResponse>(
      request,
      `/api/arena/points/rank/${encodeURIComponent(wallet)}`,
    );
    expect(rank.rank).toBeGreaterThan(0);
    expect(rank.totalPoints).toBe(points.totalPoints);

    const multiplier = await fetchJson<MultiplierResponse>(
      request,
      `/api/arena/points/multiplier/${encodeURIComponent(wallet)}`,
    );
    expect(multiplier.multiplier).toBeGreaterThanOrEqual(2);
    expect(multiplier.goldBalance).not.toBe("0");

    const history = await fetchJson<HistoryResponse>(
      request,
      `/api/arena/points/history/${encodeURIComponent(wallet)}?limit=10`,
    );
    expect(history.total).toBeGreaterThan(0);
    expect(
      history.entries.some((entry) => entry.eventType === "BET_PLACED"),
    ).toBe(true);
    expect(
      history.entries.some((entry) => entry.eventType === "WALLET_LINK"),
    ).toBe(true);

    const leaderboard = await fetchJson<LeaderboardResponse>(
      request,
      "/api/arena/points/leaderboard?scope=linked&window=alltime&limit=5",
    );
    expect(leaderboard.leaderboard.length).toBeGreaterThan(0);

    const invite = await fetchJson<InviteResponse>(
      request,
      `/api/arena/invite/${encodeURIComponent(wallet)}?platform=solana`,
    );
    expect(invite.inviteCode).toMatch(/^HS/);

    const perpsMarkets = await fetchJson<PerpsMarketsResponse>(
      request,
      "/api/perps/markets",
    );
    expect(
      perpsMarkets.markets.some((market) => market.characterId === characterId),
    ).toBe(true);

    const oracleHistory = await fetchJson<PerpsOracleHistoryResponse>(
      request,
      `/api/perps/oracle-history?characterId=${encodeURIComponent(characterId)}&limit=10`,
    );
    expect(oracleHistory.snapshots.length).toBeGreaterThanOrEqual(5);
  });

  test("every duels tab and points drawer tab renders live data", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const wallet = state.evmHeadlessAddress || "";

    const _streamState = await fetchJson<StreamingStateResponse>(
      request,
      "/api/streaming/state",
    );
    const points = await fetchJson<PointsResponse>(
      request,
      `/api/arena/points/${encodeURIComponent(wallet)}?scope=linked`,
    );
    const multiplier = await fetchJson<MultiplierResponse>(
      request,
      `/api/arena/points/multiplier/${encodeURIComponent(wallet)}`,
    );
    const leaderboard = await fetchJson<LeaderboardResponse>(
      request,
      "/api/arena/points/leaderboard?scope=linked&window=alltime&limit=5",
    );
    const history = await fetchJson<HistoryResponse>(
      request,
      `/api/arena/points/history/${encodeURIComponent(wallet)}?limit=10`,
    );
    const invite = await fetchJson<InviteResponse>(
      request,
      `/api/arena/invite/${encodeURIComponent(wallet)}?platform=evm`,
    );

    await gotoApp(page);
    await selectChain(page, "avax");

    await expect(page.getByTestId("duels-bottom-panel-trades")).toBeVisible();

    await clickTestId(page, "duels-bottom-tab-orders");
    await expect(page.getByTestId("duels-bottom-panel-orders")).toBeVisible();
    await expect(page.getByTestId("duels-bottom-panel-orders")).toContainText(
      "BIDS",
    );



    await clickTestId(page, "duels-bottom-tab-positions");
    await expect(
      page.getByTestId("duels-bottom-panel-positions"),
    ).toBeVisible();
    await expect(
      page.getByTestId("duels-bottom-panel-positions"),
    ).toContainText("No open positions");

    await page
      .locator('[data-testid="points-drawer-open"]:visible')
      .evaluateAll((elements) => {
        for (const element of elements) {
          (element as HTMLButtonElement).click();
        }
      });
    await expect(page.getByTestId("points-drawer")).toBeVisible();

    await expect
      .poll(
        async () => {
          return (
            (await page
              .getByTestId("points-display-total")
              .last()
              .textContent()) || ""
          );
        },
        { timeout: 20_000 },
      )
      .toContain(points.totalPoints.toLocaleString());
    await expect(
      page.getByTestId("points-drawer").getByTestId("points-display-gold"),
    ).toContainText(multiplier.goldBalance);

    await expect(
      page.getByTestId("points-drawer-panel-leaderboard"),
    ).toBeVisible();
    await expect(page.getByTestId("points-leaderboard")).toContainText(
      truncateWallet(leaderboard.leaderboard[0]?.wallet || ""),
    );
    await expect(page.getByTestId("points-leaderboard")).toContainText(
      leaderboard.leaderboard[0]?.totalPoints.toLocaleString() || "",
    );

    await clickTestId(page, "points-drawer-tab-history");
    await expect(page.getByTestId("points-drawer-panel-history")).toBeVisible();
    const latestHistory = history.entries[0];
    await expect(page.getByTestId("points-history")).toContainText(
      HISTORY_LABELS[latestHistory.eventType] || latestHistory.eventType,
    );
    await expect(page.getByTestId("points-history")).toContainText(
      `${latestHistory.totalPoints.toLocaleString()} pts`,
    );
    await page.getByTestId("points-history-filter").selectOption("WALLET_LINK");
    await expect(page.getByTestId("points-history")).toContainText(
      HISTORY_LABELS.WALLET_LINK,
    );

    await clickTestId(page, "points-drawer-tab-referral");
    await expect(
      page.getByTestId("points-drawer-panel-referral"),
    ).toBeVisible();
    await expect(page.getByTestId("referral-panel-invite-code")).toContainText(
      invite.inviteCode,
    );
    await expect(page.getByTestId("referral-panel-points-scope")).toContainText(
      String(points.identityWalletCount),
    );
    await expect(page.getByTestId("referral-panel-referred-by")).toBeVisible();
    await expect(page.getByTestId("referral-panel-redeem-input")).toBeVisible();
    await expect(page.getByTestId("referral-panel-link-wallets")).toBeVisible();

    await page.getByTestId("points-drawer-close").click();
    await expect(page.getByTestId("points-drawer")).toBeHidden();
  });

  test("models surface renders seeded model market data", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const characterId = state.perpsCharacterId || "";

    const perpsMarkets = await fetchJson<PerpsMarketsResponse>(
      request,
      "/api/perps/markets",
    );
    const selectedMarket = perpsMarkets.markets.find(
      (market) => market.characterId === characterId,
    );
    expect(selectedMarket).toBeTruthy();

    const oracleHistory = await fetchJson<PerpsOracleHistoryResponse>(
      request,
      `/api/perps/oracle-history?characterId=${encodeURIComponent(characterId)}&limit=10`,
    );
    expect(oracleHistory.snapshots.length).toBeGreaterThan(0);

    await gotoApp(page);
    await selectChain(page, "avax");

    await page
      .locator('[data-testid="surface-mode-models"]:visible')
      .last()
      .click();
    await expect(page.getByTestId("models-market-view")).toBeVisible({
      timeout: 60_000,
    });

    await page
      .getByRole("row", { name: new RegExp(selectedMarket?.name || characterId, "i") })
      .click({ force: true });
    await expect(page.getByTestId("models-market-view")).toContainText(
      selectedMarket?.name || "",
    );
    await expect(page.getByTestId("models-market-view")).toContainText(
      "Oracle History",
    );
    await expect(page.getByTestId("models-market-view")).not.toContainText(
      "Loading oracle history…",
    );
  });
});
