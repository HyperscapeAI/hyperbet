import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type E2eState = {
  evmHeadlessAddress?: string;
  perpsCharacterId?: string;
  perpsModelName?: string;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    winner: string | null;
    betCloseTime: number | null;
  };
  markets: Array<{
    chainKey: string;
    marketRef: string | null;
    lifecycleStatus: string;
    contractAddress: string | null;
    programId: string | null;
  }>;
  updatedAt: number | null;
};

type PerpsMarketsResponse = {
  markets: Array<{
    characterId: string;
    marketId: number;
    name: string;
  }>;
};

type PointsResponse = {
  wallet: string;
  pointsScope?: "WALLET" | "LINKED";
  identityWalletCount?: number;
  invitedWalletCount?: number;
  totalPoints: number;
  referredBy: { wallet: string; code: string } | null;
};

type PointsHistoryResponse = {
  total: number;
};

type InviteResponse = {
  inviteCode: string;
  platformView?: string;
  invitedWalletCount?: number;
};

type KeeperStatusResponse = {
  ok?: boolean;
  predictionMarkets?: {
    activeDuelKey?: string | null;
    marketCount?: number | null;
    chains?: Array<{ chainKey: string; lifecycleStatus: string }> | null;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const BASE_URL = (process.env.E2E_BASE_URL || "http://127.0.0.1:4181")
  .trim()
  .replace(/\/$/, "");
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function requireString(value: string | undefined, label: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    throw new Error(`Missing ${label} in e2e state`);
  }
  return trimmed;
}

async function fetchJson<T>(
  request: APIRequestContext,
  baseUrl: string,
  pathname: string,
): Promise<T> {
  const response = await request.get(`${baseUrl}${pathname}`);
  expect(response.ok(), `GET ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function gotoApp(page: Page): Promise<void> {
  await page.goto("/?debug=1", { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => {
      const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
      return bodyText.trim().length > 0 ? bodyText.trim() : "";
    })
    .not.toBe("");
  await expect(page.locator("#chain-selector").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function ensureWalletConnected(page: Page): Promise<void> {
  const hasConnectedSolanaWallet = async (): Promise<boolean> => {
    const walletButtonCandidates = [
      page.getByRole("button", { name: /^SOL\s+.+/i }).first(),
      page.getByRole("button", { name: /^◎\s*.+/i }).first(),
    ];

    for (const candidate of walletButtonCandidates) {
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const label = (await candidate.textContent().catch(() => ""))?.trim() ?? "";
      if (!label || /connect solana|connect wallet|select wallet/i.test(label)) {
        continue;
      }
      if (/^SOL\s+/i.test(label) || /^◎\s*/i.test(label)) {
        return true;
      }
    }

    return false;
  };

  const selectHeadlessWallet = async (): Promise<boolean> => {
    const walletOption = page.getByRole("button", { name: /E2E Trader/i }).first();
    if (!(await walletOption.isVisible().catch(() => false))) return false;
    await walletOption.click({ force: true });
    await expect(
      page.getByRole("dialog", {
        name: /Connect a wallet on Solana to continue/i,
      }),
    )
      .toBeHidden({ timeout: 30_000 })
      .catch(() => undefined);
    return true;
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasConnectedSolanaWallet()) return;

    if (await selectHeadlessWallet()) {
      await page.waitForTimeout(2_000);
      continue;
    }

    const connectButton = page
      .getByRole("button", {
        name: /connect wallet|select wallet|connect|add sol wallet|connect sol/i,
      })
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }
    await selectHeadlessWallet();
    await page.waitForTimeout(2_000);
  }

  await expect.poll(hasConnectedSolanaWallet, { timeout: 60_000 }).toBe(true);
}

async function clickVisibleTestId(page: Page, testId: string): Promise<void> {
  const locator = page.locator(`[data-testid="${testId}"]:visible`).first();
  await expect(locator).toBeVisible({ timeout: 30_000 });
  try {
    await locator.click({ timeout: 10_000 });
  } catch {
    await locator.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
  }
}

async function selectChain(
  page: Page,
  chain: "solana" | "bsc" | "base" | "avax",
): Promise<void> {
  const selector = page.locator("#chain-selector").first();
  await expect(selector).toBeVisible({ timeout: 30_000 });
  await selector.selectOption(chain);
  await expect(selector).toHaveValue(chain);
}

async function openReferralPanel(page: Page): Promise<void> {
  await clickVisibleTestId(page, "points-drawer-open");
  await expect(page.getByTestId("points-drawer")).toBeVisible({
    timeout: 30_000,
  });
  await clickVisibleTestId(page, "points-drawer-tab-referral");
  await expect(page.getByTestId("points-drawer-panel-referral")).toBeVisible({
    timeout: 30_000,
  });
}

async function readTestIdText(page: Page, testId: string): Promise<string> {
  return (
    (await page.getByTestId(testId).first().textContent().catch(() => "")) || ""
  ).trim();
}

async function waitForTxUpdate(
  page: Page,
  testId: string,
  previous: string,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const current = await readTestIdText(page, testId);
        return current !== previous ? current : "";
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000, 5_000] },
    )
    .toMatch(/^0x[0-9a-f]+$/i);
  return readTestIdText(page, testId);
}

async function waitForChangedText(
  page: Page,
  testId: string,
  previous: string,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const current = await readTestIdText(page, testId);
        return current !== previous && current.trim() && !current.trim().endsWith("-")
          ? current
          : "";
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000, 5_000] },
    )
    .not.toBe("");
  return readTestIdText(page, testId);
}

test.describe("unified bets page coverage", () => {
  test("keeper backend exposes unified markets and points data", async ({
    request,
  }) => {
    const state = loadState();
    const wallet = requireString(state.evmHeadlessAddress, "evmHeadlessAddress");
    const perpsCharacterId = requireString(
      state.perpsCharacterId,
      "perpsCharacterId",
    );

    const status = await fetchJson<KeeperStatusResponse>(
      request,
      GAME_API_URL,
      "/status",
    );
    expect(status.ok).toBe(true);

    await expect
      .poll(async () => {
        const snapshot = await fetchJson<PredictionMarketsResponse>(
          request,
          GAME_API_URL,
          "/api/arena/prediction-markets/active",
        );
        return (
          snapshot.markets.find((market) => market.chainKey === "solana")
            ?.lifecycleStatus ?? null
        );
      }, { timeout: 30_000, intervals: [500, 1_000, 2_000] })
      .toBe("OPEN");
    const markets = await fetchJson<PredictionMarketsResponse>(
      request,
      GAME_API_URL,
      "/api/arena/prediction-markets/active",
    );
    expect(markets.duel.duelKey || markets.duel.duelId).toBeTruthy();
    expect(markets.markets.some((market) => market.chainKey === "solana")).toBe(
      true,
    );
    expect(markets.markets.some((market) => market.chainKey === "bsc")).toBe(
      true,
    );
    const points = await fetchJson<PointsResponse>(
      request,
      GAME_API_URL,
      `/api/arena/points/${encodeURIComponent(wallet)}?scope=linked`,
    );
    expect(points.wallet.toLowerCase()).toContain(wallet.toLowerCase());
    expect(points.totalPoints).toBeGreaterThan(0);

    const invite = await fetchJson<InviteResponse>(
      request,
      GAME_API_URL,
      `/api/arena/invite/${encodeURIComponent(wallet)}?platform=evm`,
    );
    expect(invite.inviteCode).toMatch(/^HS/i);
    const walletHistory = await fetchJson<PointsHistoryResponse>(
      request,
      GAME_API_URL,
      `/api/arena/points/history/${encodeURIComponent(wallet)}?scope=wallet`,
    );
    const linkedHistory = await fetchJson<PointsHistoryResponse>(
      request,
      GAME_API_URL,
      `/api/arena/points/history/${encodeURIComponent(wallet)}?scope=linked`,
    );
    expect(linkedHistory.total).toBeGreaterThan(walletHistory.total);

    const perpsMarkets = await fetchJson<PerpsMarketsResponse>(
      request,
      GAME_API_URL,
      "/api/perps/markets",
    );
    expect(
      perpsMarkets.markets.some(
        (market) => market.characterId === perpsCharacterId,
      ),
    ).toBe(true);
  });

  test("chain selector swaps between Solana and EVM duels on one page", async ({
    page,
  }) => {
    await gotoApp(page);

    const selector = page.locator("#chain-selector").first();
    const optionValues = await selector.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    expect(optionValues).toContain("solana");
    expect(optionValues).toContain("bsc");
    expect(optionValues).not.toContain("avax");
    expect(optionValues).not.toContain("base");

    await selectChain(page, "solana");
    await expect(page.getByTestId("solana-clob-panel")).toBeVisible({
      timeout: 60_000,
    });
    await selectChain(page, "bsc");
    await expect(page.getByTestId("evm-panel").first()).toBeVisible({
      timeout: 60_000,
    });
    await selectChain(page, "solana");
    await expect(page.getByTestId("solana-clob-panel")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("points drawer and referral panel follow the active chain", async ({
    page,
  }) => {
    await gotoApp(page);

    await selectChain(page, "bsc");
    await openReferralPanel(page);
    await expect(page.getByTestId("referral-panel")).toBeVisible();
    await expect(page.getByTestId("referral-panel-points-scope")).toContainText(
      /linked/i,
    );
    await expect(page.getByTestId("referral-panel-referred-by")).toBeVisible();
    await clickVisibleTestId(page, "points-drawer-close");

    await selectChain(page, "solana");
    await openReferralPanel(page);
    await expect(page.getByTestId("referral-panel")).toContainText(
      /connect a wallet/i,
    );
    await expect(page.getByTestId("referral-panel-points-scope")).toHaveCount(0);
  });

  test("solana models tab renders with the shared Solana runtime", async ({
    page,
  }) => {
    const state = loadState();
    const perpsCharacterId = requireString(
      state.perpsCharacterId,
      "perpsCharacterId",
    );
    const perpsModelName = state.perpsModelName?.trim() || "E2E Model Alpha";

    await gotoApp(page);
    await selectChain(page, "solana");
    await clickVisibleTestId(page, "surface-mode-models");

    await expect(page.getByTestId("models-market-view")).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByTestId(`models-market-card-${perpsCharacterId}`),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("models-market-view")).toContainText(
      perpsModelName,
    );
  });

  test("bsc submit path executes on the unified page", async ({
    page,
  }) => {
    await gotoApp(page);
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel.getByTestId("prediction-amount-input").fill("1");
    await evmPanel.getByTestId("evm-price-input").fill("600");
    await evmPanel.getByTestId("prediction-select-yes").click();

    const previousOrderTx = await readTestIdText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-submit").click();
    const nextOrderTx = await waitForTxUpdate(
      page,
      "evm-last-order-tx",
      previousOrderTx,
    );

    expect(nextOrderTx).toMatch(/^0x[0-9a-f]+$/i);
    await expect(page.getByTestId("evm-status")).not.toContainText(/order failed/i);
    await expect(evmPanel.getByTestId("prediction-submit")).toBeVisible();
  });

  test("solana CLOB submit path executes on the unified page", async ({
    page,
  }) => {
    await gotoApp(page);
    await selectChain(page, "solana");
    await ensureWalletConnected(page);
    await page.getByTestId("refresh-market").click();

    await expect(page.getByTestId("current-match-id")).not.toContainText("—", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("solana-clob-panel")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await page.getByTestId("prediction-select-yes").click({ force: true });
    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("solana-clob-price-input").fill("600");

    const previousOrderTx = await readTestIdText(page, "solana-clob-place-order-tx");
    await page.getByTestId("prediction-submit").click({ force: true });
    const nextOrderTx = await waitForChangedText(
      page,
      "solana-clob-place-order-tx",
      previousOrderTx,
    );

    expect(nextOrderTx).toMatch(/LAST_TX:\s*[1-9A-HJ-NP-Za-km-z]{20,}/);
    await expect(page.getByTestId("solana-clob-status")).not.toContainText(
      /order failed/i,
    );
  });
});
