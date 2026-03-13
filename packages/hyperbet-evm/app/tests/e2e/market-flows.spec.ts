import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { GOLD_CLOB_ABI } from "../../src/lib/goldClobAbi";

type E2eState = {
  solanaRpcUrl?: string;
  clobUserBalance?: string;
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
  evmDuelKeyHex?: string;
  evmMarketKey?: string;
  evmOracleAddress?: string;
  evmAdminPrivateKey?: string;
};

type PageDiagnostics = {
  consoleMessages: string[];
  pageErrors: string[];
  requestFailures: string[];
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

type HarnessControl = {
  controlPath: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const controlPath = path.resolve(__dirname, "./control.json");
const processControlScriptPath = path.resolve(
  __dirname,
  "../../../../../scripts/e2e-process-control.sh",
);
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");
const E2E_ARENA_WRITE_KEY =
  process.env.E2E_ARENA_WRITE_KEY?.trim() ||
  process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ||
  process.env.VITE_ARENA_WRITE_KEY?.trim() ||
  "";
const anchorIdlDir = path.resolve(
  __dirname,
  "../../../../hyperbet-solana/anchor/target/idl",
);
const evmArtifactsDir = path.resolve(
  __dirname,
  "../../../../evm-contracts/artifacts/contracts",
);
const evmFoundryOutDir = path.resolve(__dirname, "../../../../evm-contracts/out");

function readFirstExistingJson(candidatePaths: string[]): unknown {
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) continue;
    return JSON.parse(fs.readFileSync(candidatePath, "utf8")) as unknown;
  }
  throw new Error(`Missing artifact. Checked: ${candidatePaths.join(", ")}`);
}

const goldPerpsIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_perps_market.json"), "utf8"),
) as Idl;
const duelOutcomeOracleArtifact = readFirstExistingJson(
  [
    path.join(
      evmArtifactsDir,
      "DuelOutcomeOracle.sol",
      "DuelOutcomeOracle.json",
    ),
    path.join(
      evmFoundryOutDir,
      "DuelOutcomeOracle.sol",
      "DuelOutcomeOracle.json",
    ),
  ],
) as { abi: readonly unknown[] };
const goldClobArtifact = readFirstExistingJson(
  [
    path.join(evmArtifactsDir, "GoldClob.sol", "GoldClob.json"),
    path.join(evmFoundryOutDir, "GoldClob.sol", "GoldClob.json"),
  ],
) as { abi: readonly unknown[] };
const perpsCoder = new BorshAccountsCoder(goldPerpsIdl);
const perpsProgramId = new PublicKey(
  (goldPerpsIdl as Idl & { address: string }).address,
);
const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const SELL_SIDE = 2;

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function loadControl(): HarnessControl {
  return JSON.parse(fs.readFileSync(controlPath, "utf8")) as HarnessControl;
}

function runProcessControl(
  control: HarnessControl,
  action: "restart",
  service: "keeper" | "anvil",
): void {
  execFileSync(
    "bash",
    [processControlScriptPath, action, control.controlPath, service],
    {
      stdio: "inherit",
    },
  );
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function derivePerpsPositionPda(owner: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    perpsProgramId,
  )[0];
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function normalizeHex32(value: string | undefined, label: string): Hash {
  const normalized = value?.trim().toLowerCase().replace(/^0x/, "") || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Missing or invalid ${label} in e2e state`);
  }
  return `0x${normalized}`;
}

async function fetchJson<T>(
  request: APIRequestContext,
  pathname: string,
): Promise<T> {
  const response = await request.get(`${GAME_API_URL}${pathname}`);
  expect(response.ok(), `GET ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function postJson<T>(
  request: APIRequestContext,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await request.post(`${GAME_API_URL}${pathname}`, {
    data: body,
    headers: E2E_ARENA_WRITE_KEY
      ? { "x-arena-write-key": E2E_ARENA_WRITE_KEY }
      : undefined,
  });
  expect(response.ok(), `POST ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function fetchPredictionMarkets(
  request: APIRequestContext,
): Promise<PredictionMarketsResponse> {
  return fetchJson<PredictionMarketsResponse>(
    request,
    "/api/arena/prediction-markets/active",
  );
}

async function fetchBotHealth(
  request: APIRequestContext,
): Promise<KeeperBotHealthResponse> {
  return fetchJson<KeeperBotHealthResponse>(request, "/api/keeper/bot-health");
}

async function waitForKeeperBotHealth(
  request: APIRequestContext,
  chainKey: string,
  _marketRef: string | null,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const payload = await fetchBotHealth(request);
          return {
            ok: payload.ok,
            running: payload.running,
            chainKey: payload.health?.chainKey ?? null,
            hasRecovery: Array.isArray(payload.health?.recovery),
            hasSnapshot: payload.health != null,
          };
        } catch {
          return {
            ok: false,
            running: false,
            chainKey: null,
            hasRecovery: false,
            hasSnapshot: false,
          };
        }
      },
      {
        timeout: 90_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toEqual({
      ok: true,
      running: true,
      chainKey,
      hasRecovery: true,
      hasSnapshot: true,
    });
}

function findPredictionMarket(
  payload: PredictionMarketsResponse,
  chainKey: string,
) {
  return payload.markets.find((market) => market.chainKey === chainKey) ?? null;
}

function hashLabel(label: string): Hash {
  return keccak256(stringToHex(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

async function createFreshEvmOpenMarket(
  request: APIRequestContext,
  publicClient: ReturnType<typeof createPublicClient>,
  adminWalletClient: ReturnType<typeof createWalletClient>,
  oracleAddress: Address,
  contractAddress: Address,
  chainKey: "bsc" | "avax",
): Promise<{ duelKey: Hash; marketKey: Hash }> {
  const uniqueKey = `${chainKey}-gate10-${Date.now()}`;
  const duelKey = keccak256(stringToHex(uniqueKey));
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const duelId = `${Date.now()}`;
  const betOpenTs = latestBlock.timestamp - 15n;
  const betCloseTs = betOpenTs + 300n;
  const duelStartTs = betCloseTs + 60n;

  const upsertTx = await adminWalletClient.writeContract({
    address: oracleAddress,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel(`${chainKey}-fresh-agent-a`),
      hashLabel(`${chainKey}-fresh-agent-b`),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      `${uniqueKey}-open`,
      DUEL_STATUS_BETTING_OPEN,
    ],
  });
  await waitForEvmReceipt(publicClient, upsertTx);

  const createMarketTx = await adminWalletClient.writeContract({
    address: contractAddress,
    abi: goldClobArtifact.abi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForEvmReceipt(publicClient, createMarketTx);

  const seedAmount = parseUnits("1", 18);
  const seedPrice = 600;
  const seedCost = quoteCost(SELL_SIDE, seedPrice, seedAmount);
  const seedFee = seedCost / 100n;
  const seedOrderTx = await adminWalletClient.writeContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "placeOrder",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, SELL_SIDE, seedPrice, seedAmount],
    value: seedCost + seedFee + seedFee,
  });
  await waitForEvmReceipt(publicClient, seedOrderTx);

  const marketKey = (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as Hash;

  await postJson<{ ok: boolean; seq: number }>(
    request,
    "/api/streaming/state/publish",
    {
      cycle: {
        cycleId: `${uniqueKey}-cycle`,
        phase: "FIGHTING",
        duelId,
        duelKeyHex: duelKey.slice(2),
        cycleStartTime: Date.now() - 90_000,
        phaseStartTime: Date.now() - 30_000,
        phaseEndTime: Date.now() + 30_000,
        betOpenTime: Date.now() - 15_000,
        betCloseTime: Date.now() + 300_000,
        fightStartTime: Date.now() + 60_000,
        duelEndTime: null,
        countdown: 30,
        timeRemaining: 30_000,
        winnerId: null,
        winnerName: null,
        winReason: null,
        seed: null,
        replayHash: null,
        agent1: {
          id: `${chainKey}-fresh-agent-a`,
          name: "Agent A",
          provider: "Hyperscape",
          model: "alpha-local",
          hp: 80,
          maxHp: 100,
          combatLevel: 88,
          wins: 12,
          losses: 4,
          damageDealtThisFight: 148,
          inventory: [],
          monologues: [],
        },
        agent2: {
          id: `${chainKey}-fresh-agent-b`,
          name: "Agent B",
          provider: "OpenRouter",
          model: "beta-local",
          hp: 76,
          maxHp: 100,
          combatLevel: 84,
          wins: 10,
          losses: 5,
          damageDealtThisFight: 131,
          inventory: [],
          monologues: [],
        },
      },
      leaderboard: [],
      cameraTarget: null,
    },
  );

  return { duelKey, marketKey };
}

function buildMockEvmPredictionMarketsResponse(
  state: E2eState,
  chainKey: "bsc" | "avax",
  lifecycleStatus: string,
  winner: string,
): PredictionMarketsResponse {
  const duelKey = normalizeHex32(state.evmDuelKeyHex, "evmDuelKeyHex").slice(2);
  const duelId = state.evmMatchId != null ? String(state.evmMatchId) : null;
  const phase =
    lifecycleStatus === "OPEN"
      ? "ANNOUNCEMENT"
      : lifecycleStatus === "LOCKED"
        ? "COUNTDOWN"
        : "RESOLUTION";

  return {
    duel: {
      duelKey,
      duelId,
      phase,
      winner,
      betCloseTime: Date.now(),
    },
    markets: [
      {
        chainKey,
        duelKey,
        duelId,
        marketId: state.evmMarketKey ?? null,
        marketRef: state.evmMarketKey ?? null,
        lifecycleStatus,
        winner,
        betCloseTime: Date.now(),
        contractAddress: state.evmGoldClobAddress ?? null,
        programId: null,
        txRef: null,
        syncedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

async function readText(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return "";
  return ((await locator.textContent().catch(() => "")) || "").trim();
}

async function readTxSignature(page: Page, testId: string): Promise<string> {
  const text = await readText(page, testId);
  if (!text) return "";
  const delimiterIndex = text.indexOf(":");
  if (delimiterIndex >= 0) {
    return text.slice(delimiterIndex + 1).trim();
  }
  return text;
}

function getPageDiagnostics(page: Page): PageDiagnostics {
  const instrumentedPage = page as Page & {
    __hyperbetDiagnostics?: PageDiagnostics;
  };
  if (instrumentedPage.__hyperbetDiagnostics) {
    return instrumentedPage.__hyperbetDiagnostics;
  }

  const diagnostics: PageDiagnostics = {
    consoleMessages: [],
    pageErrors: [],
    requestFailures: [],
  };
  const append = (entries: string[], value: string, limit = 12) => {
    entries.push(value);
    if (entries.length > limit) {
      entries.splice(0, entries.length - limit);
    }
  };

  page.on("console", (message) => {
    const text = `[${message.type()}] ${message.text()}`.trim();
    append(diagnostics.consoleMessages, text);
  });
  page.on("pageerror", (error) => {
    append(
      diagnostics.pageErrors,
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
  page.on("requestfailed", (request) => {
    append(
      diagnostics.requestFailures,
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`,
    );
  });

  instrumentedPage.__hyperbetDiagnostics = diagnostics;
  return diagnostics;
}

async function gotoApp(page: Page): Promise<void> {
  const diagnostics = getPageDiagnostics(page);

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
            timeout: 60_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      return;
    } catch (error) {
      if (attempt === 2) {
        const [url, title, bodyHtml] = await Promise.all([
          Promise.resolve(page.url()),
          page.title().catch(() => ""),
          page
            .locator("body")
            .evaluate((element) => element.innerHTML.slice(0, 2_000))
            .catch(() => ""),
        ]);
        const diagnosticLines = [
          `url=${url || "-"}`,
          `title=${title || "-"}`,
          bodyHtml ? `body=${bodyHtml}` : "body=-",
        ];
        if (diagnostics.pageErrors.length > 0) {
          diagnosticLines.push(
            `pageErrors=${diagnostics.pageErrors.join(" | ")}`,
          );
        }
        if (diagnostics.requestFailures.length > 0) {
          diagnosticLines.push(
            `requestFailures=${diagnostics.requestFailures.join(" | ")}`,
          );
        }
        if (diagnostics.consoleMessages.length > 0) {
          diagnosticLines.push(
            `console=${diagnostics.consoleMessages.join(" | ")}`,
          );
        }

        throw new Error(
          `[gotoApp] app shell did not render. ${diagnosticLines.join("\n")}`,
          { cause: error },
        );
      }
      await page.goto("about:blank");
    }
  }
}

async function waitForNewText(
  page: Page,
  testId: string,
  previousValue = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readText(page, testId);
        if (!next || next === "-" || next === previousValue) {
          return "";
        }
        matched = next;
        return next;
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");
  return matched;
}

async function waitForNewEvmTxText(
  page: Page,
  txTestId: string,
  previousValue: string,
  label: string,
  timeoutMs = 60_000,
): Promise<string> {
  const startedAt = Date.now();
  let lastStatus = "";
  let lastTx = "";

  while (Date.now() - startedAt < timeoutMs) {
    lastTx = await readText(page, txTestId);
    lastStatus = await readText(page, "evm-status");
    console.log(
      `[e2e][evm] ${label} status=${lastStatus || "-"} tx=${lastTx || "-"}`,
    );
    if (lastTx && lastTx !== "-" && lastTx !== previousValue) {
      return lastTx;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `[e2e][evm] Timed out waiting for ${label}. status=${lastStatus || "-"} tx=${lastTx || "-"}`,
  );
}

async function waitForNewTxSignature(
  page: Page,
  testId: string,
  previousSignature = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readTxSignature(page, testId);
        if (next && next !== "-" && next !== previousSignature) {
          matched = next;
          return next;
        }
        return "";
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");
  return matched;
}

async function ensureWalletConnected(page: Page): Promise<void> {
  const hasConnectedSolanaWallet = async (): Promise<boolean> => {
    const desktopWalletChip = page
      .getByRole("button", { name: /^SOL\s+[A-Za-z0-9].*/i })
      .first();
    if (await desktopWalletChip.isVisible().catch(() => false)) return true;

    const mobileWalletChip = page
      .getByRole("button", { name: /^◎\s*[A-Za-z0-9].*/i })
      .first();
    if (await mobileWalletChip.isVisible().catch(() => false)) return true;

    return false;
  };

  const selectHeadlessWallet = async (): Promise<boolean> => {
    const walletOption = page
      .getByRole("button", { name: /E2E Trader/i })
      .first();
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
      await page.waitForTimeout(1_500);
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
    await page.waitForTimeout(1_500);
  }

  await expect.poll(hasConnectedSolanaWallet, { timeout: 60_000 }).toBe(true);
}

async function selectChain(
  page: Page,
  chain: "solana" | "bsc" | "base",
): Promise<void> {
  const normalizedChain = chain.toLowerCase();
  const debugSelector = page.getByTestId("e2e-chain-select").first();
  const primarySelector = page.locator("#chain-selector").first();

  let selectorReady = false;
  for (let attempt = 0; attempt < 3 && !selectorReady; attempt += 1) {
    await page.waitForLoadState("domcontentloaded");
    try {
      await expect
        .poll(
          async () => {
            if (await debugSelector.isVisible().catch(() => false))
              return "debug";
            if (await primarySelector.isVisible().catch(() => false))
              return "primary";
            return "";
          },
          {
            timeout: 20_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      selectorReady = true;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

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

  const fallbackComboboxes = page.getByRole("combobox");
  const comboboxCount = await fallbackComboboxes.count();
  for (let index = 0; index < comboboxCount; index += 1) {
    const selector = fallbackComboboxes.nth(index);
    if (!(await selector.isVisible().catch(() => false))) continue;

    const options = await selector
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: node.getAttribute("value") || "",
          label: (node.textContent || "").trim().toLowerCase(),
        })),
      )
      .catch(() => []);
    const matchingOption = options.find((option) =>
      `${option.value} ${option.label}`.includes(
        normalizedChain === "solana" ? "sol" : normalizedChain,
      ),
    );
    if (!matchingOption) continue;

    await selector.selectOption(matchingOption.value || normalizedChain);
    await expect
      .poll(async () => {
        const value = (
          await selector.inputValue().catch(() => "")
        ).toLowerCase();
        const selectedLabel = (
          (await selector
            .locator("option:checked")
            .textContent()
            .catch(() => "")) || ""
        ).toLowerCase();
        return `${value} ${selectedLabel}`;
      })
      .toContain(normalizedChain === "solana" ? "sol" : normalizedChain);
    return;
  }

  throw new Error(`Unable to locate a visible chain selector for ${chain}`);
}

async function openSolanaAdminPanel(page: Page): Promise<void> {
  const adminPanel = page.getByTestId("solana-clob-admin-panel");
  if (await adminPanel.isVisible().catch(() => false)) return;

  const adminToggle = page.getByTestId("solana-clob-admin-toggle").first();
  if (!(await adminToggle.isVisible().catch(() => false))) return;

  await adminToggle.click({ force: true });
  await expect(adminPanel).toBeVisible();
}

async function expectSolanaTxSuccess(
  connection: Connection,
  signature: string,
  label: string,
): Promise<void> {
  expect(signature, `${label} signature missing`).not.toBe("");
  expect(signature, `${label} signature missing`).not.toBe("-");

  const readStatus = async () => {
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      return statuses.value[0] ?? null;
    } catch {
      return null;
    }
  };

  await expect
    .poll(
      async () => {
        const status = await readStatus();
        if (!status) return "missing";
        if (status.err) return "failed";
        return status.confirmationStatus || "confirmed";
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("missing");

  const status = await readStatus();
  expect(status?.err ?? null, `${label} failed on-chain`).toBeNull();
}

async function fetchDecodedAccount<T>(
  connection: Connection,
  coder: BorshAccountsCoder,
  accountName: "UserBalance" | "PositionState",
  address: PublicKey,
): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const accountInfo = await connection.getAccountInfo(address, "confirmed");
      if (!accountInfo?.data) return null;
      return coder.decode(accountName, accountInfo.data) as T;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function waitForEvmReceipt(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}

async function readEvmPosition(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  marketKey: Hash,
  userAddress: Address,
): Promise<[bigint, bigint, bigint, bigint]> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [marketKey, userAddress],
  })) as [bigint, bigint, bigint, bigint];
}

async function waitForSolanaUiPosition(
  page: Page,
  side: "YES" | "NO",
): Promise<void> {
  const pattern =
    side === "YES"
      ? /Position YES\s+([0-9]+(?:\.[0-9]+)?)/i
      : /\|\s*NO\s+([0-9]+(?:\.[0-9]+)?)/i;

  await expect
    .poll(
      async () => {
        const panelText =
          (await page.getByTestId("solana-clob-admin-panel").textContent()) ||
          "";
        const match = panelText.match(pattern);
        return match ? Number(match[1]) : 0;
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBeGreaterThan(0);
}

async function submitModelsTrade(
  page: Page,
  tradeButtonTestId:
    | "models-market-open-long"
    | "models-market-open-short"
    | "models-market-close-position",
): Promise<string> {
  const statusTestId = "models-market-last-trade-status";
  const previousStatus = await readText(page, statusTestId);

  const button = page.getByTestId(tradeButtonTestId);
  await button.click({ force: true });

  let nextStatus: string;
  try {
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  } catch {
    await button.dispatchEvent("click");
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  }

  await expect
    .poll(async () => await readText(page, statusTestId), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .not.toMatch(/^(Submitting|Closing)\b/i);

  return (await readText(page, statusTestId)) || nextStatus;
}

test.describe("market flows", () => {
  test.setTimeout(600_000);

  test("solana predictions place YES and NO orders and update on-chain shares", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }

    const clobPanel = page.getByTestId("solana-clob-panel");
    await expect(clobPanel).toBeVisible({ timeout: 60_000 });
    await openSolanaAdminPanel(page);
    await ensureWalletConnected(page);

    await clobPanel.getByTestId("prediction-amount-input").fill("1");
    const solanaPriceInput = clobPanel.getByTestId("solana-clob-price-input");
    if (await solanaPriceInput.isVisible().catch(() => false)) {
      await solanaPriceInput.fill("600");
    }

    const previousYesTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    await clobPanel.getByTestId("prediction-select-yes").click();
    const buyYesButton = clobPanel.getByRole("button", { name: /buy yes/i });
    await buyYesButton.click({ force: true });
    await page.waitForTimeout(1_500);
    const immediateYesTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    if (
      !immediateYesTx ||
      immediateYesTx === "-" ||
      immediateYesTx === previousYesTx
    ) {
      await buyYesButton.click({ force: true });
    }
    await openSolanaAdminPanel(page);

    const yesTx = await waitForNewTxSignature(
      page,
      "solana-clob-place-order-tx",
      previousYesTx,
    );
    await expectSolanaTxSuccess(connection, yesTx, "Solana YES order");

    await waitForSolanaUiPosition(page, "YES");

    await clobPanel.getByTestId("prediction-select-no").click();
    if (await solanaPriceInput.isVisible().catch(() => false)) {
      await solanaPriceInput.fill("400");
    }
    const previousNoTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    const buyNoButton = clobPanel.getByRole("button", { name: /buy no/i });
    await buyNoButton.click({ force: true });
    await page.waitForTimeout(1_500);
    const immediateNoTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    if (
      !immediateNoTx ||
      immediateNoTx === "-" ||
      immediateNoTx === previousNoTx
    ) {
      await buyNoButton.click({ force: true });
    }
    await openSolanaAdminPanel(page);

    const noTx = await waitForNewTxSignature(
      page,
      "solana-clob-place-order-tx",
      previousNoTx,
    );
    await expectSolanaTxSuccess(connection, noTx, "Solana NO order");

    await waitForSolanaUiPosition(page, "NO");
  });

  test("evm lifecycle shell and claim CTA follow the normalized lifecycle API", async ({
    page,
  }) => {
    const state = loadState();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const marketKey = normalizeHex32(state.evmMarketKey, "evmMarketKey");
    let lifecycleStatus = "OPEN";
    let lifecycleWinner = "NONE";

    await page.route("**/api/arena/prediction-markets/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          buildMockEvmPredictionMarketsResponse(
            state,
            "bsc",
            lifecycleStatus,
            lifecycleWinner,
          ),
        ),
      });
    });

    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });

    await gotoApp(page);
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    const submitButton = evmPanel.getByTestId("prediction-submit");
    const claimButton = evmPanel.getByTestId("evm-claim-payout");

    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 30_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await expect(claimButton).toBeDisabled();

    lifecycleStatus = "LOCKED";
    await expect(page.getByTestId("market-status")).toContainText(/locked/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeDisabled({ timeout: 15_000 });
    await expect(claimButton).toBeDisabled();

    lifecycleStatus = "OPEN";
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });

    await evmPanel.getByTestId("prediction-amount-input").fill("1");
    await evmPanel.getByTestId("evm-price-input").fill("600");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await submitButton.click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "lifecycle YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);
    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    lifecycleStatus = "RESOLVED";
    lifecycleWinner = "A";
    await expect(page.getByTestId("market-status")).toContainText(
      /resolved/i,
      {
        timeout: 15_000,
      },
    );
    await expect(claimButton).toBeEnabled({ timeout: 15_000 });
    await expect(claimButton).toContainText(/claim available/i);
  });

  test("evm predictions place YES and NO orders, resolve, and claim", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const marketKey = normalizeHex32(state.evmMarketKey, "evmMarketKey");
    const duelKey = normalizeHex32(state.evmDuelKeyHex, "evmDuelKeyHex");
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = state.evmAdminPrivateKey as `0x${string}`;
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: bscMarket?.marketRef ?? null,
            contractAddress: bscMarket?.contractAddress ?? null,
          };
        },
        {
          timeout: 30_000,
          intervals: [500, 1_000, 2_000],
        },
      )
      .toEqual({
        duelKey: duelKey.slice(2),
        marketRef: state.evmMarketKey || null,
        contractAddress,
      });

    await gotoApp(page);
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel.getByTestId("prediction-amount-input").fill("1");
    await evmPanel.getByTestId("evm-price-input").fill("600");

    console.log("[e2e][evm] placing YES order");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    console.log("[e2e][evm] placing NO order");
    const previousNoTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("evm-price-input").fill("400");
    await evmPanel.getByTestId("prediction-select-no").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const noTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousNoTx,
      "NO order",
    );
    await waitForEvmReceipt(publicClient, noTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[1];
      })
      .toBeGreaterThan(0n);

    console.log("[e2e][evm] resolving YES winner");
    const latestEvmBlock = await publicClient.getBlock({ blockTag: "latest" });
    const reportResultTx = await adminWalletClient.writeContract({
      address: oracleAddress,
      abi: duelOutcomeOracleArtifact.abi,
      functionName: "reportResult",
      args: [
        duelKey,
        1,
        42n,
        `0x${"11".repeat(32)}`,
        `0x${"22".repeat(32)}`,
        latestEvmBlock.timestamp + 360n,
        "e2e-resolved",
      ],
    });
    await waitForEvmReceipt(publicClient, reportResultTx);
    const resolveTx = await adminWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "syncMarketFromOracle",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForEvmReceipt(publicClient, resolveTx);
    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return `${bscMarket?.lifecycleStatus || "missing"}:${bscMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    console.log("[e2e][evm] waiting for auto-claim or zeroed YES position");
    const autoClaimDeadline = Date.now() + 15_000;
    let claimedPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    while (Date.now() < autoClaimDeadline && claimedPosition[0] > 0n) {
      await page.waitForTimeout(1_000);
      claimedPosition = await readEvmPosition(
        publicClient,
        contractAddress,
        marketKey,
        userAddress,
      );
    }

    const claimTx = await readText(page, "evm-last-claim-tx");
    if (
      claimedPosition[0] === 0n &&
      claimTx &&
      claimTx !== "-" &&
      claimTx !== previousClaimTx
    ) {
      console.log("[e2e][evm] observed auto-claim transaction");
      await waitForEvmReceipt(publicClient, claimTx as Hash);
    } else {
      const maybeClaimed = await readEvmPosition(
        publicClient,
        contractAddress,
        marketKey,
        userAddress,
      );
      if (maybeClaimed[0] > 0n) {
        console.log("[e2e][evm] auto-claim not observed, claiming manually");
        const manualClaimTx = await adminWalletClient.writeContract({
          address: contractAddress,
          abi: GOLD_CLOB_ABI,
          functionName: "claim",
          args: [duelKey, MARKET_KIND_DUEL_WINNER],
        });
        await waitForEvmReceipt(publicClient, manualClaimTx);
      }
    }

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
  });

  test("bsc prediction markets recover after keeper and anvil restarts", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = state.evmAdminPrivateKey as `0x${string}`;
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });
    const { duelKey, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      adminWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
    );

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: bscMarket?.marketRef ?? null,
            lifecycleStatus: bscMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKey.slice(2),
        marketRef: marketKey,
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page);
    await selectChain(page, "bsc");
    const evmPanel = page.getByTestId("evm-panel").first();
    const claimButton = evmPanel.getByTestId("evm-claim-payout");
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel.getByTestId("prediction-amount-input").fill("1");
    await evmPanel.getByTestId("evm-price-input").fill("600");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "reliability YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          marketKey,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);

    runProcessControl(control, "restart", "anvil");
    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page);
    await selectChain(page, "bsc");
    await page.getByTestId("refresh-market").click();

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: bscMarket?.marketRef ?? null,
            lifecycleStatus: bscMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKey.slice(2),
        marketRef: marketKey,
        lifecycleStatus: "OPEN",
      });

    const latestEvmBlock = await publicClient.getBlock({ blockTag: "latest" });
    const reportResultTx = await adminWalletClient.writeContract({
      address: oracleAddress,
      abi: duelOutcomeOracleArtifact.abi,
      functionName: "reportResult",
      args: [
        duelKey,
        1,
        42n,
        `0x${"33".repeat(32)}`,
        `0x${"44".repeat(32)}`,
        latestEvmBlock.timestamp + 360n,
        "e2e-resolved-restart",
      ],
    });
    await waitForEvmReceipt(publicClient, reportResultTx);
    const resolveTx = await adminWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "syncMarketFromOracle",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForEvmReceipt(publicClient, resolveTx);

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return `${bscMarket?.lifecycleStatus || "missing"}:${bscMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", state.evmMarketKey || null);

    await page.getByTestId("refresh-market").click();
    await expect
      .poll(
        async () => {
          const result = await readEvmPosition(
            publicClient,
            contractAddress,
            marketKey,
            userAddress,
          );
          return result[0];
        },
        {
          timeout: 30_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0n);
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    await claimButton.click();
    const claimTx = await waitForNewEvmTxText(
      page,
      "evm-last-claim-tx",
      previousClaimTx,
      "reliability claim",
    );
    await waitForEvmReceipt(publicClient, claimTx as Hash);

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
  });

  test("bsc cancelled prediction markets refund and clear positions", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const oracleAddress = state.evmOracleAddress as Address;
    const adminPrivateKey = state.evmAdminPrivateKey as `0x${string}`;
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });
    const { duelKey, marketKey } = await createFreshEvmOpenMarket(
      request,
      publicClient,
      adminWalletClient,
      oracleAddress,
      contractAddress,
      "bsc",
    );

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(request, "bsc", marketKey);
    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: bscMarket?.marketRef ?? null,
            lifecycleStatus: bscMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKey.slice(2),
        marketRef: marketKey,
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page);
    await selectChain(page, "bsc");
    const evmPanel = page.getByTestId("evm-panel").first();
    const claimButton = evmPanel.getByTestId("evm-claim-payout");
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 60_000,
    });
    await expect(evmPanel.getByTestId("prediction-submit")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel.getByTestId("prediction-amount-input").fill("1");
    await evmPanel.getByTestId("evm-price-input").fill("600");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("prediction-select-yes").click();
    await evmPanel.getByTestId("prediction-submit").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "cancel YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    const cancelTx = await adminWalletClient.writeContract({
      address: oracleAddress,
      abi: duelOutcomeOracleArtifact.abi,
      functionName: "cancelDuel",
      args: [duelKey, "e2e-cancelled"],
    });
    await waitForEvmReceipt(publicClient, cancelTx);
    const cancelSyncTx = await adminWalletClient.writeContract({
      address: contractAddress,
      abi: GOLD_CLOB_ABI,
      functionName: "syncMarketFromOracle",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForEvmReceipt(publicClient, cancelSyncTx);

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const bscMarket = findPredictionMarket(predictionMarkets, "bsc");
          return bscMarket?.lifecycleStatus || "missing";
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("CANCELLED");

    await page.getByTestId("refresh-market").click();
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    await claimButton.click();
    const claimTx = await waitForNewEvmTxText(
      page,
      "evm-last-claim-tx",
      previousClaimTx,
      "cancel claim",
    );
    await waitForEvmReceipt(publicClient, claimTx as Hash);

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      marketKey,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBe(0n);
    expect(finalPosition[2]).toBe(0n);
    expect(finalPosition[3]).toBe(0n);
  });

  test("solana perps open and close LONG and SHORT positions on-chain", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const marketId = Number(state.perpsMarketId || 0);
    const positionPda = derivePerpsPositionPda(trader, marketId);

    await gotoApp(page);
    await selectChain(page, "solana");
    await ensureWalletConnected(page);

    await page
      .locator('[data-testid="surface-mode-models"]:visible')
      .first()
      .click();
    await expect(page.getByTestId("models-market-view")).toBeVisible({
      timeout: 60_000,
    });

    await page
      .getByTestId(`models-market-card-${state.perpsCharacterId}`)
      .click({ force: true });
    await page.getByTestId("models-market-collateral-input").fill("0.2");
    await page.getByTestId("models-market-leverage-2x").click({ force: true });

    await expect(page.getByTestId("models-market-open-long")).toBeEnabled({
      timeout: 60_000,
    });
    console.log("[e2e][perps] opening long");
    const longStatus = await submitModelsTrade(page, "models-market-open-long");
    expect(longStatus).toMatch(/opened/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return Number(bnLikeToBigInt(position?.size));
      })
      .toBeGreaterThan(0);

    await expect(page.getByTestId("models-market-close-position")).toBeVisible({
      timeout: 60_000,
    });
    console.log("[e2e][perps] closing long");
    const closeLongStatus = await submitModelsTrade(
      page,
      "models-market-close-position",
    );
    expect(closeLongStatus).toMatch(/closed/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return position ? Number(bnLikeToBigInt(position.size)) : 0;
      })
      .toBe(0);

    console.log("[e2e][perps] opening short");
    const shortStatus = await submitModelsTrade(
      page,
      "models-market-open-short",
    );
    expect(shortStatus).toMatch(/opened/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return Number(bnLikeToBigInt(position?.size));
      })
      .toBeLessThan(0);

    await expect(page.getByTestId("models-market-close-position")).toBeVisible({
      timeout: 60_000,
    });
    console.log("[e2e][perps] closing short");
    const closeShortStatus = await submitModelsTrade(
      page,
      "models-market-close-position",
    );
    expect(closeShortStatus).toMatch(/closed/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return position ? Number(bnLikeToBigInt(position.size)) : 0;
      })
      .toBe(0);
  });
});
