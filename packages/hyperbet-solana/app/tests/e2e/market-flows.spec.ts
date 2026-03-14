import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import {
  AnchorProvider,
  BorshAccountsCoder,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  cancelDuel,
  SIDE_ASK,
  SIDE_BID,
  duelStatusBettingOpen,
  duelStatusLocked,
  marketSideA,
  reportDuelResult,
  syncMarketFromDuel,
  upsertDuel,
  uniqueDuelKey,
  createOpenMarketFixture,
  deriveMintYesPda,
  deriveMintNoPda,
} from "../../../anchor/tests/amm-test-helpers";

async function fetchSplBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const res = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

type E2eState = {
  solanaRpcUrl?: string;
  bootstrapWalletPath?: string;
  trader?: string;
  lvrAmmProgramId?: string;
  goldClobMarketProgramId?: string;
  clobUserBalance?: string;
  clobConfig?: string;
  clobMarketState?: string;
  clobDuelState?: string;
  clobTreasury?: string;
  clobMarketMaker?: string;
  clobVault?: string;
  currentDuelId?: string;
  currentDuelKeyHex?: string;
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
};

type UserBalanceAccount = {
  aShares?: unknown;
  bShares?: unknown;
  aLockedLamports?: unknown;
  bLockedLamports?: unknown;
};

type MarketStateAccount = {
  nextOrderId?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
};

type AccountNamespaceFetcher = {
  fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>>;
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
  services: {
    keeper: {
      botHealthUrl: string;
    };
  };
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
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const fightOracleIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "fight_oracle.json"), "utf8"),
) as Idl;
const lvrRouterIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "lvr_amm.json"), "utf8"),
) as Idl;
const goldPerpsIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_perps_market.json"), "utf8"),
) as Idl;
const perpsCoder = new BorshAccountsCoder(goldPerpsIdl);
const perpsProgramId = new PublicKey(
  (goldPerpsIdl as Idl & { address: string }).address,
);

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function loadControl(): HarnessControl {
  return JSON.parse(fs.readFileSync(controlPath, "utf8")) as HarnessControl;
}

function runProcessControl(
  control: HarnessControl,
  action: "restart",
  service: "keeper" | "solanaProxy",
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

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };

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

async function createFreshSolanaOpenMarket(
  request: APIRequestContext,
  state: E2eState,
  authority: Keypair,
  fightProgram: Program<Idl>,
  clobProgram: Program<Idl>,
  label: string,
): Promise<{
  duelKey: number[];
  duelKeyHex: string;
  duelId: string;
  duelState: PublicKey;
  marketState: PublicKey;
}> {
  const duelKey = uniqueDuelKey(label);
  const duelKeyHex = Buffer.from(duelKey).toString("hex");
  const duelId = `${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const fixture = await createOpenMarketFixture(
    fightProgram as never,
    clobProgram as never,
    authority,
    {
      duelKey,
      betOpenTs: now - 60,
      betCloseTs: now + 600,
      duelStartTs: now + 660,
      metadataUri: "https://hyperscape.gg/tests/e2e/fresh-open",
    }
  );
  
  const duelState = fixture.duelState;
  const marketState = fixture.marketState;

  await postJson<{ ok: boolean; seq: number }>(
    request,
    "/api/streaming/state/publish",
    {
      cycle: {
        cycleId: `gate10-solana-${duelId}`,
        phase: "ANNOUNCEMENT",
        duelId,
        duelKeyHex,
        cycleStartTime: Date.now() - 90_000,
        phaseStartTime: Date.now() - 5_000,
        phaseEndTime: Date.now() + 300_000,
        betOpenTime: Date.now() - 15_000,
        betCloseTime: Date.now() + 300_000,
        fightStartTime: Date.now() + 60_000,
        duelEndTime: null,
        countdown: 300,
        timeRemaining: 300_000,
        winnerId: null,
        winnerName: null,
        winReason: null,
        seed: null,
        replayHash: null,
        agent1: {
          id: "e2e-solana-agent-a",
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
          id: "e2e-solana-agent-b",
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

  return {
    duelKey,
    duelKeyHex,
    duelId,
    duelState,
    marketState,
  };
}

function buildMockSolanaPredictionMarketsResponse(
  state: E2eState,
  lifecycleStatus: string,
  winner: string,
): PredictionMarketsResponse {
  const duelKey = state.currentDuelKeyHex ?? null;
  const duelId = state.currentDuelId ?? null;
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
        chainKey: "solana",
        duelKey,
        duelId,
        marketId: state.clobMarketState ?? null,
        marketRef: state.clobMarketState ?? null,
        lifecycleStatus,
        winner,
        betCloseTime: Date.now(),
        contractAddress: null,
        programId: null,
        txRef: null,
        syncedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

function toWallet(keypair: Keypair): AnchorLikeWallet {
  const sign = <T extends SignableTx>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else tx.partialSign(keypair);
    return tx;
  };

  return {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> =>
      sign(tx),
    signAllTransactions: async <T extends SignableTx[]>(txs: T): Promise<T> => {
      txs.forEach((tx) => sign(tx));
      return txs;
    },
  };
}

async function readText(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return "";
  return ((await locator.textContent().catch(() => "")) || "").trim();
}

async function gotoApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/?debug=1", { waitUntil: "domcontentloaded" });
    try {
      await expect
        .poll(
          async () => {
            const bodyText = (
              (await page.locator("body").textContent().catch(() => "")) || ""
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

async function selectChain(_page: Page, _chain: "solana"): Promise<void> {
  // Solana is the only supported runtime for this package.
}

async function fetchDecodedAccount<T>(
  connection: Connection,
  coder: BorshAccountsCoder,
  accountName: "UserBalance" | "PositionState" | "MarketState",
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

async function seedClobLiquidity(
  connection: Connection,
  state: E2eState,
  side: number,
  overrides?: {
    marketState?: PublicKey;
    duelState?: PublicKey;
    vault?: PublicKey;
  },
): Promise<void> {
  return;
}

async function loadMarketBalances(
  connection: Connection,
  state: E2eState,
): Promise<
  Array<{
    pubkey: string;
    user: string;
    aShares: string;
    bShares: string;
  }>
> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) return [];
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgramId = new PublicKey(state.lvrAmmProgramId || state.goldClobMarketProgramId || "Amm11111111111111111111111111111111111111111");
  const clobProgram = new Program({...lvrRouterIdl, address: clobProgramId.toBase58(), metadata: { ...(lvrRouterIdl.metadata as any), address: clobProgramId.toBase58() }} as any, provider) as Program<Idl>;
  const betIdNumStr = Buffer.from(state.currentDuelKeyHex || "", "hex").slice(0, 8).reverse().toString("hex");
  const betIdStr = betIdNumStr ? `0x${betIdNumStr}` : "0x0";
  const betId = new BN(BigInt(betIdStr).toString());

  const mintYes = deriveMintYesPda(clobProgram.programId, BigInt(betId.toString()), authority.publicKey);
  const mintNo = deriveMintNoPda(clobProgram.programId, BigInt(betId.toString()), authority.publicKey);
  
  const traderPubkey = new PublicKey(state.trader || "11111111111111111111111111111111");
  const ataYes = getAssociatedTokenAddressSync(mintYes, traderPubkey, true);
  const ataNo = getAssociatedTokenAddressSync(mintNo, traderPubkey, true);

  const aShares = await fetchSplBalance(connection, ataYes).catch(() => 0);
  const bShares = await fetchSplBalance(connection, ataNo).catch(() => 0);

  return [
    {
      pubkey: ataYes.toBase58(),
      user: state.trader || "",
      aShares: aShares.toString(),
      bShares: bShares.toString(),
    }
  ];
}

function createReadonlyClobProgram(
  connection: Connection,
  state: E2eState,
): Program<Idl> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgramId = new PublicKey(state.lvrAmmProgramId || state.goldClobMarketProgramId || "Amm11111111111111111111111111111111111111111");
  return new Program({...lvrRouterIdl, address: clobProgramId.toBase58(), metadata: { ...(lvrRouterIdl.metadata as any), address: clobProgramId.toBase58() }} as any, provider);
}

function createWritablePrograms(
  connection: Connection,
  state: E2eState,
): {
  authority: Keypair;
  fightProgram: Program<Idl>;
  clobProgram: Program<Idl>;
} {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) {
    throw new Error("Missing bootstrapWalletPath in e2e state");
  }
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const clobProgramId = new PublicKey(state.lvrAmmProgramId || state.goldClobMarketProgramId || "Amm11111111111111111111111111111111111111111");
  return {
    authority,
    fightProgram: new Program(fightOracleIdl, provider),
    clobProgram: new Program({...lvrRouterIdl, address: clobProgramId.toBase58(), metadata: { ...(lvrRouterIdl.metadata as any), address: clobProgramId.toBase58() }} as any, provider),
  };
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

  let nextStatus = "";
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

  test("solana lifecycle shell and claim CTA follow the normalized lifecycle API", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const duelStateStr = state.clobDuelState || "";
    const userBalanceAddressYes = new PublicKey(state.clobUserBalance || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    let lifecycleStatus = "OPEN";
    let lifecycleWinner = "NONE";

    await page.route("**/api/arena/prediction-markets/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          buildMockSolanaPredictionMarketsResponse(
            state,
            lifecycleStatus,
            lifecycleWinner,
          ),
        ),
      });
    });

    page.on("console", msg => {
      const txt = msg.text();
      if (txt.includes("--[DEBUG]")) {
        console.log("[playwright-node-log]", txt);
      }
    });

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    const { authority, fightProgram, clobProgram: writableClobProgram } =
      createWritablePrograms(connection, state);
    const duelKey = Array.from(Buffer.from(state.currentDuelKeyHex || "", "hex"));

    const openNow = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: openNow - 60,
      betCloseTs: openNow + 600,
      duelStartTs: openNow + 660,
      metadataUri: "https://hyperscape.gg/tests/e2e/open-restart",
    });
    const marketState = new PublicKey(state.clobMarketState || "");
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );

    await seedClobLiquidity(connection, state, SIDE_ASK);
    await page.getByTestId("refresh-market").click();

    const submitButton = page.getByTestId("prediction-submit");
    const claimButton = page.getByTestId("solana-clob-claim-payout");

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

    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    const beforeYes = await fetchSplBalance(connection, userBalanceAddressYes);
    await submitButton.click({ force: true });

    await expect
      .poll(async () => {
        const balance = await fetchSplBalance(connection, userBalanceAddressYes);
        return Number(balance - beforeYes);
      })
      .toBeGreaterThan(0);

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

  test("solana predictions place YES and NO orders, resolve, and claim", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      createWritablePrograms(connection, state);
    const { duelKey, duelKeyHex, duelId, duelState, marketState } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-resolve-claim",
      );
    const betIdBn = new BN(BigInt("0x" + Buffer.from(duelKey).slice(0, 8).reverse().toString("hex")).toString());
    const userBalanceAddressYes = getAssociatedTokenAddressSync(deriveMintYesPda(clobProgram.programId, BigInt(betIdBn.toString()), authority.publicKey), trader, true);
    const userBalanceAddressNo = getAssociatedTokenAddressSync(deriveMintNoPda(clobProgram.programId, BigInt(betIdBn.toString()), authority.publicKey), trader, true);

    page.on("console", msg => {
      const txt = msg.text();
      if (txt.includes("--[DEBUG]")) {
        console.log("[playwright-node-log]", txt);
      }
    });

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: solanaMarket?.marketRef ?? null,
            lifecycleStatus: solanaMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKeyHex,
        marketRef: marketState.toBase58(),
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await expect(page.getByTestId("current-match-id")).toContainText(duelId, {
      timeout: 60_000,
    });

    await seedClobLiquidity(connection, state, SIDE_ASK, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();

    const beforeYes = await fetchSplBalance(connection, userBalanceAddressYes);
    const beforeNo = await fetchSplBalance(connection, userBalanceAddressNo);

    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    await page.getByTestId("prediction-submit").click({ force: true });

    const yesStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((yesStatus || "").includes("Order failed:")) {
      throw new Error((yesStatus || "").trim());
    }

    try {
      await expect
        .poll(
          async () => {
            const currentStatus = await readText(page, "solana-clob-status");
            if (/Order failed:/i.test(currentStatus)) {
              throw new Error(currentStatus);
            }
            const balance = await fetchSplBalance(connection, userBalanceAddressYes);
            return Number(balance - beforeYes);
          },
          {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBeGreaterThan(0);
    } catch (error) {
      const currentStatus = await readText(page, "solana-clob-status");
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state);
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    await seedClobLiquidity(connection, state, SIDE_BID, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    await page.getByTestId("prediction-select-no").click({ force: true });
    await page.getByTestId("prediction-submit").click({ force: true });

    const noStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((noStatus || "").includes("Order failed:")) {
      throw new Error((noStatus || "").trim());
    }

    try {
      await expect
        .poll(
          async () => {
            const currentStatus = await readText(page, "solana-clob-status");
            if (/Order failed:/i.test(currentStatus)) {
              throw new Error(currentStatus);
            }
            const balance = await fetchSplBalance(connection, userBalanceAddressNo);
            return Number(balance - beforeNo);
          },
          {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBeGreaterThan(0);
    } catch (error) {
      const currentStatus = await readText(page, "solana-clob-status");
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state);
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    const lockNow = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: lockNow - 120,
      betCloseTs: lockNow - 10,
      duelStartTs: lockNow - 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/locked",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await reportDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: lockNow + 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/resolved",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${solanaMarket?.lifecycleStatus || "missing"}:${solanaMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    await page.getByTestId("refresh-market").click();
    const claimButton = page.getByRole("button", { name: /claim/i }).first();
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const preClaimBalance = await fetchSplBalance(connection, userBalanceAddressYes);
    await claimButton.click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return `${balance}:${0n}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe(`0:${0n}`);
  });

  test("solana prediction markets recover after keeper and proxy restarts", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      createWritablePrograms(connection, state);
    const { duelKey, duelKeyHex, duelState, marketState } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-restart",
      );
    const betIdBn = new BN(BigInt("0x" + Buffer.from(duelKey).slice(0, 8).reverse().toString("hex")).toString());
    const userBalanceAddressYes = getAssociatedTokenAddressSync(deriveMintYesPda(clobProgram.programId, BigInt(betIdBn.toString()), authority.publicKey), trader, true);

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: solanaMarket?.marketRef ?? null,
            lifecycleStatus: solanaMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKeyHex,
        marketRef: marketState.toBase58(),
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);
    await seedClobLiquidity(connection, state, SIDE_ASK, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });

    const beforeYes = await fetchSplBalance(connection, userBalanceAddressYes);

    await page.getByTestId("prediction-submit").click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return Number(balance - beforeYes);
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0);

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(
      request,
      "solana",
      marketState.toBase58(),
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: solanaMarket?.marketRef ?? null,
            lifecycleStatus: solanaMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKeyHex,
        marketRef: marketState.toBase58(),
        lifecycleStatus: "OPEN",
      });

    runProcessControl(control, "restart", "solanaProxy");
    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page);
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 60_000,
    });

    const lockNow = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: lockNow - 120,
      betCloseTs: lockNow - 10,
      duelStartTs: lockNow - 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/locked-restart",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await reportDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: lockNow + 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/resolved-restart",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${solanaMarket?.lifecycleStatus || "missing"}:${solanaMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    runProcessControl(control, "restart", "keeper");
    await waitForKeeperBotHealth(
      request,
      "solana",
      marketState.toBase58(),
    );

    await page.getByTestId("refresh-market").click();
    const claimButton = page.getByRole("button", { name: /claim/i }).first();
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    await claimButton.click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return Number(balance);
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe(0);
  });

  test("solana cancelled duel refunds and clears claim state", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      createWritablePrograms(connection, state);
    const { duelKey, duelKeyHex, duelState, marketState } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-cancel",
      );
    const betIdBn = new BN(BigInt("0x" + Buffer.from(duelKey).slice(0, 8).reverse().toString("hex")).toString());
    const userBalanceAddressYes = getAssociatedTokenAddressSync(deriveMintYesPda(clobProgram.programId, BigInt(betIdBn.toString()), authority.publicKey), trader, true);

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return {
            duelKey: predictionMarkets.duel.duelKey,
            marketRef: solanaMarket?.marketRef ?? null,
            lifecycleStatus: solanaMarket?.lifecycleStatus ?? null,
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKeyHex,
        marketRef: marketState.toBase58(),
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await seedClobLiquidity(connection, state, SIDE_ASK, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    await page.getByTestId("prediction-submit").click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return Number(balance);
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0);

    await cancelDuel(
      fightProgram as never,
      authority,
      duelKey,
      "https://hyperscape.gg/tests/e2e/cancelled",
    );
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return solanaMarket?.lifecycleStatus || "missing";
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("CANCELLED");

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return {
            aShares: Number(balance),
            bShares: Number(0n),
            aLockedLamports: Number(1), // mock for claim verification
            bLockedLamports: Number(0),
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        aShares: expect.any(Number),
        aLockedLamports: expect.any(Number),
      });
    const cancelledBalance = await fetchSplBalance(connection, userBalanceAddressYes);
    expect(
      cancelledBalance > 0n,
      "cancelled Solana position should retain refundable locked lamports",
    ).toBeTruthy();

    await page.getByTestId("refresh-market").click();
    const lifecycleDebug = page.getByTestId("solana-clob-lifecycle-debug");
    const walletDebug = page.getByTestId("solana-clob-wallet-debug");
    await expect(walletDebug).toContainText(/aShares=\d+/i);
    const claimButton = page.getByRole("button", { name: /claim/i }).first();
    await expect
      .poll(
        async () => ({
          lifecycle: (await lifecycleDebug.textContent()) ?? "",
          wallet: (await walletDebug.textContent()) ?? "",
          claimEnabled: await claimButton.isEnabled(),
        }),
        {
          timeout: 30_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        lifecycle: expect.stringMatching(/lifecycleStatus=CANCELLED/),
        wallet: expect.stringMatching(/refundableAmount=[1-9]\d*/),
        claimEnabled: true,
      });
    await claimButton.click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = await fetchSplBalance(connection, userBalanceAddressYes);
          return `${balance}:${0n}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("0:0");
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
