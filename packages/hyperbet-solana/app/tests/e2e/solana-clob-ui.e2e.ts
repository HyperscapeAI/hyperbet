import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import {
  AnchorProvider,
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
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ORDER_BEHAVIOR_GTC,
  SIDE_ASK,
  deriveClobVaultPda,
  deriveMarketStatePda,
  deriveOrderPda,
  derivePriceLevelPda,
  deriveUserBalancePda,
  duelStatusBettingOpen,
  ensureOracleReady,
  initializeCanonicalMarket,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
} from "../../../anchor/tests/clob-test-helpers";

type E2eState = {
  solanaRpcUrl?: string;
  placeBetAmount?: string;
  bootstrapWalletPath?: string;
  clobConfig?: string;
  clobTreasury?: string;
  clobMarketMaker?: string;
  solanaTraderPublicKey?: string;
};

type UserBalanceAccount = {
  aShares?: unknown;
  bShares?: unknown;
};

type MarketStateAccount = {
  nextOrderId?: unknown;
  bestAsk?: unknown;
};

type PriceLevelAccount = {
  totalOpen?: unknown;
};

type AccountNamespaceFetcher = {
  fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const goldClobIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_clob_market.json"), "utf8"),
) as Idl;
const fightOracleIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "fight_oracle.json"), "utf8"),
) as Idl;
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");
const E2E_ARENA_WRITE_KEY =
  process.env.E2E_ARENA_WRITE_KEY?.trim() ||
  process.env.ARENA_EXTERNAL_BET_WRITE_KEY?.trim() ||
  process.env.VITE_ARENA_WRITE_KEY?.trim() ||
  "";
const E2E_DUEL_SOURCE =
  process.env.E2E_DUEL_SOURCE?.trim().toLowerCase() || "synthetic_publish";
const SEEDED_ASK_LIQUIDITY_LAMPORTS = "100000000";
const MIN_BOOTSTRAP_AUTHORITY_LAMPORTS = 50_000_000n;
const ASK_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  14, 22, 189, 71, 203, 44, 97, 156, 18, 240, 85, 132, 53, 199, 4, 220, 91,
  11, 144, 201, 32, 77, 165, 118, 246, 17, 63, 154, 208, 39, 121, 6,
]);

async function loadState(): Promise<E2eState> {
  const statePath = path.resolve(__dirname, "./state.json");
  const raw = await fsp.readFile(statePath, "utf8");
  return JSON.parse(raw) as E2eState;
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };

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

function loadKeypairFromPath(filepath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filepath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadBootstrapAuthority(state: E2eState): Keypair {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) throw new Error("Missing bootstrapWalletPath in e2e state");
  return loadKeypairFromPath(walletPath);
}

function seededAskLiquidityMaker(): Keypair {
  return Keypair.fromSeed(ASK_LIQUIDITY_MAKER_SEED);
}

async function ensureBootstrapAuthorityLamportBuffer(
  connection: Connection,
  state: E2eState,
  minimumLamports = MIN_BOOTSTRAP_AUTHORITY_LAMPORTS,
): Promise<void> {
  const authority = loadBootstrapAuthority(state);
  const authorityBalance = BigInt(
    await connection.getBalance(authority.publicKey, "confirmed"),
  );
  if (authorityBalance >= minimumLamports) {
    return;
  }

  const candidateEntries: Array<{
    signer: Keypair;
    reserveLamports: bigint;
  }> = [];
  const canaryPath = process.env.SOLANA_CANARY_KEYPAIR?.trim() || "";
  if (canaryPath && canaryPath !== state.bootstrapWalletPath?.trim()) {
    candidateEntries.push({
      signer: loadKeypairFromPath(canaryPath),
      reserveLamports: 250_000_000n,
    });
  }
  candidateEntries.push({
    signer: seededAskLiquidityMaker(),
    reserveLamports: 100_000_000n,
  });

  let currentBalance = authorityBalance;
  for (const candidate of candidateEntries) {
    if (currentBalance >= minimumLamports) {
      break;
    }
    if (candidate.signer.publicKey.equals(authority.publicKey)) {
      continue;
    }
    const candidateBalance = BigInt(
      await connection.getBalance(candidate.signer.publicKey, "confirmed"),
    );
    const transferableLamports =
      candidateBalance > candidate.reserveLamports
        ? candidateBalance - candidate.reserveLamports
        : 0n;
    if (transferableLamports <= 0n) {
      continue;
    }
    const requiredLamports = minimumLamports - currentBalance;
    const transferLamports =
      transferableLamports < requiredLamports
        ? transferableLamports
        : requiredLamports;
    const provider = new AnchorProvider(connection, toWallet(candidate.signer), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: candidate.signer.publicKey,
          toPubkey: authority.publicKey,
          lamports: Number(transferLamports),
        }),
      ),
      [],
    );
    currentBalance = BigInt(
      await connection.getBalance(authority.publicKey, "confirmed"),
    );
  }

  if (currentBalance < minimumLamports) {
    throw new Error(
      `Bootstrap authority underfunded: authority=${authority.publicKey.toBase58()} balance=${currentBalance.toString()} minimum=${minimumLamports.toString()}`,
    );
  }
}

async function seedAskLiquidity(
  connection: Connection,
  state: E2eState,
  market?: {
    marketState: PublicKey;
    duelState: PublicKey;
    vault: PublicKey;
  },
): Promise<void> {
  const maker = seededAskLiquidityMaker();
  const provider = new AnchorProvider(connection, toWallet(maker), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgram = new Program(goldClobIdl, provider);
  const marketState = market?.marketState ?? new PublicKey("");
  const duelState = market?.duelState ?? new PublicKey("");
  const vault =
    market?.vault ?? deriveClobVaultPda(clobProgram.programId, marketState);
  const clobAccounts = clobProgram.account as Record<
    string,
    AccountNamespaceFetcher
  >;
  const marketAccount = (await clobAccounts.marketState.fetch(
    marketState,
  )) as MarketStateAccount;
  const bestAsk = Number(marketAccount.bestAsk ?? 1000);
  if (bestAsk > 0 && bestAsk < 1000) {
    const existingLevel = (await clobProgram.account.priceLevel.fetchNullable(
      derivePriceLevelPda(
        clobProgram.programId,
        marketState,
        SIDE_ASK,
        bestAsk,
      ),
    )) as PriceLevelAccount | null;
    if (bnLikeToBigInt(existingLevel?.totalOpen) > 0n) {
      return;
    }
  }
  const nextOrderId = bnLikeToBigInt(marketAccount?.nextOrderId);
  if (nextOrderId <= 0n) {
    throw new Error("Missing next order id for seeded CLOB market");
  }

  await clobProgram.methods
    .placeOrder(
      new BN(nextOrderId.toString()),
      SIDE_ASK,
      500,
      new BN(SEEDED_ASK_LIQUIDITY_LAMPORTS),
      ORDER_BEHAVIOR_GTC,
    )
    .accountsPartial({
      marketState,
      duelState,
      userBalance: deriveUserBalancePda(
        clobProgram.programId,
        marketState,
        maker.publicKey,
      ),
      newOrder: deriveOrderPda(clobProgram.programId, marketState, nextOrderId),
      restingLevel: derivePriceLevelPda(
        clobProgram.programId,
        marketState,
        SIDE_ASK,
        500,
      ),
      config: new PublicKey(state.clobConfig || ""),
      treasury: new PublicKey(state.clobTreasury || ""),
      marketMaker: new PublicKey(state.clobMarketMaker || ""),
      vault,
      user: maker.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([maker])
    .rpc();
}

async function loadMarketBalances(
  connection: Connection,
  state: E2eState,
  overrides?: {
    marketState?: PublicKey;
  },
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
  const authority = loadBootstrapAuthority(state);
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgram = new Program(goldClobIdl, provider);
  const marketState = overrides?.marketState ?? new PublicKey("");
  const balances = await clobProgram.account.userBalance.all();
  return balances
    .filter((entry) => entry.account.marketState.equals(marketState))
    .map((entry) => ({
      pubkey: entry.publicKey.toBase58(),
      user: entry.account.user.toBase58(),
      aShares: bnLikeToBigInt(entry.account.aShares).toString(),
      bShares: bnLikeToBigInt(entry.account.bShares).toString(),
    }));
}

function createReadonlyClobProgram(
  connection: Connection,
  state: E2eState,
): Program<Idl> {
  const authority = loadBootstrapAuthority(state);
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(goldClobIdl, provider);
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

async function createFreshSolanaOpenMarket(
  request: APIRequestContext,
  state: E2eState,
  connection: Connection,
): Promise<{
  duelId: string;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
}> {
  await ensureBootstrapAuthorityLamportBuffer(connection, state);
  const authority = loadBootstrapAuthority(state);
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const fightProgram = new Program(fightOracleIdl, provider);
  const clobProgram = new Program(goldClobIdl, provider);
  const duelKey = uniqueDuelKey("solana-clob-ui");
  const duelKeyHex = Buffer.from(duelKey).toString("hex");
  const duelId = `${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const betOpenTs = now - 60;
  const betCloseTs = now + 600;
  const duelStartTs = now + 660;

  await ensureOracleReady(
    fightProgram as never,
    authority,
    authority.publicKey,
    authority.publicKey,
    authority.publicKey,
    60,
  );
  const duelState = await upsertDuel(
    fightProgram as never,
    authority,
    duelKey,
    {
      status: duelStatusBettingOpen(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: "https://hyperscape.gg/tests/e2e/solana-clob-ui",
    },
  );
  const derivedMarketState = deriveMarketStatePda(
    clobProgram.programId,
    duelState,
  );
  let marketState = derivedMarketState;
  let vault = deriveClobVaultPda(clobProgram.programId, marketState);
  try {
    ({ marketState, vault } = await initializeCanonicalMarket(
      clobProgram as never,
      authority,
      duelState,
      duelKey,
      new PublicKey(state.clobConfig || ""),
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use/i.test(message)) throw error;
  }

  await syncMarketFromDuel(clobProgram as never, marketState, duelState);

  if (E2E_DUEL_SOURCE !== "synthetic_publish") {
    throw new Error(
      `solana-clob-ui synthetic publish requires synthetic_publish duel source, got ${E2E_DUEL_SOURCE}`,
    );
  }
  await postJson<{ ok: boolean; seq: number }>(
    request,
    "/api/streaming/state/publish",
    {
      cycle: {
        cycleId: `solana-clob-ui-${duelId}`,
        phase: "ANNOUNCEMENT",
        duelId,
        duelKeyHex,
        cycleStartTime: Date.now() - 90_000,
        phaseStartTime: Date.now() - 5_000,
        phaseEndTime: betCloseTs * 1000,
        betOpenTime: betOpenTs * 1000,
        betCloseTime: betCloseTs * 1000,
        fightStartTime: duelStartTs * 1000,
        duelEndTime: null,
        countdown: Math.max(0, betCloseTs - now),
        timeRemaining: Math.max(0, betCloseTs - now) * 1000,
        winnerId: null,
        winnerName: null,
        winReason: null,
        seed: null,
        replayHash: null,
        agent1: {
          id: "solana-ui-agent-a",
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
          id: "solana-ui-agent-b",
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
    duelId,
    duelState,
    marketState,
    vault,
  };
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

test("prediction market loads the current duel and mints YES shares on-chain", async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  const state = await loadState();
  const connection = new Connection(
    state.solanaRpcUrl || "http://127.0.0.1:8899",
    "confirmed",
  );
  const clobProgram = createReadonlyClobProgram(connection, state);
  const authority = loadBootstrapAuthority(state);
  const trader = new PublicKey(
    state.solanaTraderPublicKey || authority.publicKey.toBase58(),
  );
  const freshMarket = await createFreshSolanaOpenMarket(
    request,
    state,
    connection,
  );
  const userBalanceAddress = deriveUserBalancePda(
    clobProgram.programId,
    freshMarket.marketState,
    trader,
  );

  await gotoApp(page);
  await ensureWalletConnected(page);
  await page.getByTestId("refresh-market").click();

  await expect(page.getByTestId("current-match-id")).toContainText(freshMarket.duelId, {
    timeout: 60_000,
  });
  await expect
    .poll(() => readText(page, "solana-clob-match"), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toContain(freshMarket.marketState.toBase58());
  await expect(page.getByTestId("market-status")).not.toContainText("Waiting", {
    timeout: 60_000,
  });

  await seedAskLiquidity(connection, state, freshMarket);
  await page.getByTestId("refresh-market").click();

  const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
    userBalanceAddress,
  )) as UserBalanceAccount | null;
  const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);

  await expect
    .poll(
      async () => await page.getByTestId("prediction-submit").isDisabled(),
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBe(false);
  await expect
    .poll(() => readText(page, "market-status"), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toBe("Market: OPEN");
  await expect
    .poll(() => readText(page, "solana-clob-status"), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toMatch(/betting open|market open/i);

  await page.getByTestId("prediction-select-yes").click({ force: true });
  await page
    .getByTestId("prediction-amount-input")
    .fill(state.placeBetAmount ?? "1");
  await page.getByTestId("prediction-submit").click({ force: true });

  const immediateStatus = await page
    .getByTestId("solana-clob-status")
    .textContent()
    .catch(() => "");
  if ((immediateStatus || "").includes("Order failed:")) {
    throw new Error((immediateStatus || "").trim());
  }

  try {
    await expect
      .poll(
        async () => {
          const currentStatus = await readText(page, "solana-clob-status");
          if (/Order failed:/i.test(currentStatus)) {
            throw new Error(currentStatus);
          }
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return Number(bnLikeToBigInt(balance?.aShares));
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  } catch (error) {
    const currentStatus = await readText(page, "solana-clob-status");
    const marketBalances = await loadMarketBalances(connection, state, {
      marketState: freshMarket.marketState,
    });
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `status=${currentStatus || "<empty>"}`,
        `marketBalances=${JSON.stringify(marketBalances)}`,
      ].join("\n"),
    );
  }
});
