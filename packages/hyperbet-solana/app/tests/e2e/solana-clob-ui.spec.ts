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
import { expect, test, type Page } from "@playwright/test";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  SIDE_ASK,
  deriveOrderPda,
  derivePriceLevelPda,
  deriveUserBalancePda,
} from "../../../anchor/tests/clob-test-helpers";

type E2eState = {
  solanaRpcUrl?: string;
  placeBetAmount?: string;
  bootstrapWalletPath?: string;
  clobConfig?: string;
  clobMarketState?: string;
  clobDuelState?: string;
  clobTreasury?: string;
  clobMarketMaker?: string;
  clobVault?: string;
  clobUserBalance?: string;
  currentDuelId?: string;
};

type UserBalanceAccount = {
  aShares?: unknown;
  bShares?: unknown;
};

type MarketStateAccount = {
  nextOrderId?: unknown;
  bestAsk?: unknown;
};

type AccountNamespaceFetcher = {
  fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const lvrRouterIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "lvr_amm.json"), "utf8"),
) as Idl;

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

async function seedAskLiquidity(
  connection: Connection,
  state: E2eState,
): Promise<void> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) throw new Error("Missing bootstrapWalletPath in e2e state");

  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgram = new Program(lvrRouterIdl, provider);
  const marketState = new PublicKey(state.clobMarketState || "");
  const clobAccounts = clobProgram.account as Record<
    string,
    AccountNamespaceFetcher
  >;
  const marketAccount = (await clobAccounts.marketState.fetch(
    marketState,
  )) as MarketStateAccount;
  const bestAsk = Number(marketAccount.bestAsk ?? 1000);
  if (bestAsk > 0 && bestAsk < 1000) {
    return;
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
      new BN("1000000000"),
    )
    .accountsPartial({
      marketState,
      duelState: new PublicKey(state.clobDuelState || ""),
      userBalance: deriveUserBalancePda(
        clobProgram.programId,
        marketState,
        authority.publicKey,
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
      vault: new PublicKey(state.clobVault || ""),
      user: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
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
  const clobProgram = new Program(lvrRouterIdl, provider);
  const marketState = new PublicKey(state.clobMarketState || "");
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
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(lvrRouterIdl, provider);
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
}) => {
  test.setTimeout(900_000);
  const state = await loadState();
  const connection = new Connection(
    state.solanaRpcUrl || "http://127.0.0.1:8899",
    "confirmed",
  );
  const userBalanceAddress = new PublicKey(state.clobUserBalance || "");
  const clobProgram = createReadonlyClobProgram(connection, state);

  await gotoApp(page);
  await ensureWalletConnected(page);

  if (state.currentDuelId) {
    await expect(page.getByTestId("current-match-id")).toContainText(
      state.currentDuelId,
      { timeout: 60_000 },
    );
  }
  await expect(page.getByTestId("market-status")).not.toContainText("Waiting", {
    timeout: 60_000,
  });

  await seedAskLiquidity(connection, state);
  await page.getByTestId("refresh-market").click();

  const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
    userBalanceAddress,
  )) as UserBalanceAccount | null;
  const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);

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
          return Number(bnLikeToBigInt(balance?.aShares) - beforeYes);
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThan(0);
  } catch (error) {
    const currentStatus = await readText(page, "solana-clob-status");
    const marketBalances = await loadMarketBalances(connection, state);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `status=${currentStatus || "<empty>"}`,
        `marketBalances=${JSON.stringify(marketBalances)}`,
      ].join("\n"),
    );
  }
});
