import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  ConfirmOptions,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";

import fightOracleIdl from "../../../anchor/target/idl/fight_oracle.json";
import goldClobIdl from "../../../anchor/target/idl/gold_clob_market.json";
import goldPerpsIdl from "../../../anchor/target/idl/gold_perps_market.json";
import {
  createOpenMarketFixture,
  deriveUserBalancePda,
  uniqueDuelKey,
} from "../../../anchor/tests/clob-test-helpers";
import { modelMarketIdFromCharacterId } from "../../../../hyperbet-ui/src/lib/modelMarkets";

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };
type IdlWithAddress = Idl & {
  address?: string;
  metadata?: {
    address?: string;
  };
};
type AccountNamespace = {
  fetchNullable: (pubkey: PublicKey) => Promise<unknown>;
};

function resolveIdlAddress(idl: IdlWithAddress, label: string): string {
  const address = idl.address || idl.metadata?.address || "";
  if (!address) {
    throw new Error(`Missing program address in ${label} IDL`);
  }
  return address;
}

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const E2E_PERPS_MAX_ORACLE_STALENESS_SECONDS = 3_600;
const E2E_TRADER_SEED = Uint8Array.from([
  88, 41, 190, 12, 77, 164, 231, 5, 199, 118, 43, 91, 16, 220, 58, 147, 9, 175,
  63, 204, 132, 54, 241, 28, 115, 67, 154, 210, 36, 143, 80, 11,
]);

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function lamportsBn(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL).toString());
}

async function loadBootstrapAuthority(): Promise<{
  keypair: Keypair;
  keypairPath: string;
}> {
  const candidates = [
    process.env.E2E_SOLANA_BOOTSTRAP_KEYPAIR,
    path.join(
      process.env.HOME ?? "",
      ".config/solana/hyperscape-keys/deployer.json",
    ),
    path.join(process.env.HOME ?? "", ".config/solana/id.json"),
  ].filter((value): value is string => Boolean(value?.trim()));

  let keypairPath: string | null = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      keypairPath = candidate;
      break;
    } catch {
      // Try the next configured wallet path.
    }
  }

  if (!keypairPath) {
    throw new Error(
      `Could not find a bootstrap Solana keypair. Checked: ${candidates.join(", ")}`,
    );
  }

  const secret = JSON.parse(await fs.readFile(keypairPath, "utf8")) as number[];
  return {
    keypair: Keypair.fromSecretKey(Uint8Array.from(secret)),
    keypairPath,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getChainUnixTimestamp(
  connection: Connection,
  fallbackUnixSeconds: number,
): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const slot = await connection.getSlot("confirmed");
      const blockTime = await connection.getBlockTime(slot);
      if (typeof blockTime === "number" && Number.isFinite(blockTime) && blockTime > 0) {
        return blockTime;
      }
    } catch {
      // Fall through to the retry sleep and use the host clock as a last resort.
    }
    await sleep(500);
  }
  return fallbackUnixSeconds;
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

async function airdrop(
  connection: Connection,
  recipient: PublicKey,
  lamports: number,
): Promise<void> {
  let lastError: unknown = new Error("Airdrop did not settle");
  const initialBalance = await connection.getBalance(recipient, "confirmed");
  const expectedFloor = initialBalance + lamports;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(recipient, lamports);

      const startedAt = Date.now();
      while (Date.now() - startedAt < 20_000) {
        const balance = await connection.getBalance(recipient, "confirmed");
        if (balance >= expectedFloor) return;

        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        if (status?.err) {
          throw new Error(
            `Airdrop failed for signature ${signature}: ${JSON.stringify(status.err)}`,
          );
        }
        await sleep(600);
      }

      throw new Error(`Airdrop signature ${signature} did not settle in time`);
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function ensureBalance(
  connection: Connection,
  recipient: PublicKey,
  minimumLamports: number,
): Promise<void> {
  let balance = await connection.getBalance(recipient, "confirmed");
  while (balance < minimumLamports) {
    const missingLamports = minimumLamports - balance;
    await airdrop(
      connection,
      recipient,
      Math.min(missingLamports, 10 * LAMPORTS_PER_SOL),
    );
    balance = await connection.getBalance(recipient, "confirmed");
  }
}

async function ensureTransferredBalance(
  connection: Connection,
  provider: AnchorProvider,
  recipient: PublicKey,
  minimumLamports: number,
): Promise<void> {
  const balance = await connection.getBalance(recipient, "confirmed");
  if (balance >= minimumLamports) return;

  const transferLamports = minimumLamports - balance;
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: recipient,
      lamports: transferLamports,
    }),
  );
  await provider.sendAndConfirm(transferTx);
}

async function waitForSignatureConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {

    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = statuses.value[0];
      if (status?.err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err)}`,
        );
      }
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return;
      }
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
    }
    await sleep(500);
  }
  throw new Error(
    `Transaction ${signature} was not confirmed within ${timeoutMs}ms`,
  );
}

async function waitForAccountExists(
  connection: Connection,
  address: PublicKey,
  timeoutMs = 120_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const account = await connection.getAccountInfo(address, "confirmed");
    if (account) return;
    await sleep(500);
  }
  throw new Error(
    `Account ${address.toBase58()} was not visible within ${timeoutMs}ms`,
  );
}

async function reliableSendAndConfirm(
  provider: AnchorProvider,
  connection: Connection,
  tx: SignableTx,
  signers?: Signer[],
  opts?: ConfirmOptions,
): Promise<string> {
  const resolvedOpts = opts ?? provider.opts;
  const preflightCommitment =
    resolvedOpts.preflightCommitment ?? resolvedOpts.commitment ?? "confirmed";

  if (tx instanceof VersionedTransaction) {
    if (signers && signers.length > 0) {
      tx.sign(signers);
    }
  } else {
    tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;
    const latestBlockhash =
      await connection.getLatestBlockhash(preflightCommitment);
    tx.recentBlockhash = latestBlockhash.blockhash;
    if (signers && signers.length > 0) {
      for (const signer of signers) {
        tx.partialSign(signer);
      }
    }
  }

  const signedTx = await provider.wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: resolvedOpts.skipPreflight,
    maxRetries: resolvedOpts.maxRetries,
    preflightCommitment,
  });
  await waitForSignatureConfirmation(connection, signature);
  return signature;
}

function attachReliableSendAndConfirm(
  provider: AnchorProvider,
  connection: Connection,
): void {
  provider.sendAndConfirm = (async (tx, signers, opts) => {
    return reliableSendAndConfirm(provider, connection, tx, signers, opts);
  }) as AnchorProvider["sendAndConfirm"];
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(__dirname, "../..");
  const statePath = path.resolve(__dirname, "./state.json");
  const envPath = path.resolve(appDir, ".env.e2e");
  const solanaRpcUrl =
    process.env.E2E_SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const solanaWsUrl = process.env.E2E_SOLANA_WS_URL || "ws://127.0.0.1:8900";
  const browserSolanaRpcUrl =
    process.env.E2E_BROWSER_SOLANA_RPC_URL || solanaRpcUrl;
  const browserSolanaWsUrl =
    process.env.E2E_BROWSER_SOLANA_WS_URL || solanaWsUrl;
  const clobProgramId = resolveIdlAddress(
    goldClobIdl as unknown as IdlWithAddress,
    "gold_clob_market",
  );
  const connection = new Connection(solanaRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: solanaWsUrl,
    confirmTransactionInitialTimeout: 120_000,
  });
  const bootstrapAuthority = await loadBootstrapAuthority();
  const authority = bootstrapAuthority.keypair;
  const trader = Keypair.fromSeed(E2E_TRADER_SEED);
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  attachReliableSendAndConfirm(provider, connection);

  const fightProgram = new Program(fightOracleIdl as Idl, provider);
  const clobProgram = new Program(goldClobIdl as Idl, provider);
  const perpsProgram = new Program(goldPerpsIdl as Idl, provider);

  await ensureBalance(connection, authority.publicKey, 30 * LAMPORTS_PER_SOL);
  await ensureTransferredBalance(
    connection,
    provider,
    trader.publicKey,
    10 * LAMPORTS_PER_SOL,
  );

  // CLOB settlement uses native SOL in this test stack; the legacy config
  // key still carries a mint address, so point it at wrapped SOL.
  const goldMint = new PublicKey("So11111111111111111111111111111111111111112");
  const e2eModelCharacterId = "e2e-model-alpha";
  const e2eModelName = "E2E Model Alpha";
  const e2eModelProvider = "Hyperscape";
  const e2eModelSlug = "alpha-local";
  const e2eModelWins = 12;
  const e2eModelLosses = 4;
  const e2eModelCombatLevel = 88;
  const e2eModelCurrentStreak = 4;
  const e2eModelSpotIndex = 110;
  const e2eModelMu = 28;
  const e2eModelSigma = 4;
  const e2ePerpsMarketId = modelMarketIdFromCharacterId(e2eModelCharacterId);
  const hostNow = Math.floor(Date.now() / 1000);
  const now = await getChainUnixTimestamp(connection, hostNow);
  const currentMatchId = Math.max(Date.now(), now * 1000);
  const currentDuelMetadata = JSON.stringify({
    duelId: currentMatchId,
    matchId: currentMatchId,
    agent1: "E2E Active Agent A",
    agent2: "E2E Active Agent B",
  });
  const currentMarket = await createOpenMarketFixture(
    fightProgram as never,
    clobProgram as never,
    authority,
    {
      duelKey: uniqueDuelKey(
        `e2e-current-duel:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      ),
      betOpenTs: now - 30,
      // Use validator time, not host wall clock, or the local chain can reject
      // orders as already closed while the UI still thinks the market is open.
      betCloseTs: now + 3_600,
      duelStartTs: now + 3_660,
      metadataUri: currentDuelMetadata,
    },
  );
  const currentDuelKeyHex = Buffer.from(currentMarket.duelKey).toString("hex");

  const [perpsConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    perpsProgram.programId,
  );
  const [perpsMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), encodeMarketId(e2ePerpsMarketId)],
    perpsProgram.programId,
  );
  const perpsAccounts = perpsProgram.account as Record<string, AccountNamespace>;
  const existingPerpsConfig =
    await perpsAccounts.configState.fetchNullable(perpsConfigPda);
  if (!existingPerpsConfig) {
    await perpsProgram.methods
      .initializeConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        lamportsBn(100),
        new BN(1_000),
        new BN(E2E_PERPS_MAX_ORACLE_STALENESS_SECONDS),
        lamportsBn(80),
        lamportsBn(120),
        2_500,
        new BN(5),
        lamportsBn(0.01),
        lamportsBn(25),
        lamportsBn(12),
        500,
        100,
        25,
        25,
      )
      .accountsPartial({
        config: perpsConfigPda,
        authority: authority.publicKey,
        program: perpsProgram.programId,
        programData: deriveProgramDataAddress(perpsProgram.programId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await waitForAccountExists(connection, perpsConfigPda);
  }

  await perpsProgram.methods
    .updateMarketOracle(
      new BN(String(e2ePerpsMarketId)),
      lamportsBn(e2eModelSpotIndex),
      lamportsBn(e2eModelMu),
      lamportsBn(e2eModelSigma),
    )
    .accountsPartial({
      config: perpsConfigPda,
      market: perpsMarketPda,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await perpsProgram.methods
    .depositInsurance(new BN(String(e2ePerpsMarketId)), lamportsBn(12))
    .accountsPartial({
      market: perpsMarketPda,
      payer: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const clobUserBalancePda = deriveUserBalancePda(
    clobProgram.programId,
    currentMarket.marketState,
    trader.publicKey,
  );

  const oracleRecordedAt = Date.now();

  const envBody = [
    "VITE_SOLANA_CLUSTER=localnet",
    `VITE_SOLANA_RPC_URL=${browserSolanaRpcUrl}`,
    `VITE_SOLANA_WS_URL=${browserSolanaWsUrl}`,
    "VITE_USE_LOCAL_SOLANA_RPC_PROXY=true",
    `VITE_FIGHT_ORACLE_PROGRAM_ID=${fightProgram.programId.toBase58()}`,
    `VITE_GOLD_CLOB_MARKET_PROGRAM_ID=${clobProgramId}`,
    `VITE_GOLD_BINARY_MARKET_PROGRAM_ID=${clobProgramId}`,
    `VITE_GOLD_MINT=${goldMint.toBase58()}`,
    `VITE_ACTIVE_MATCH_ID=${currentMatchId}`,
    "VITE_BET_WINDOW_SECONDS=300",
    "VITE_NEW_ROUND_BET_WINDOW_SECONDS=300",
    "VITE_AUTO_SEED_DELAY_SECONDS=10",
    "VITE_MARKET_MAKER_SEED_GOLD=1",
    "VITE_BET_FEE_BPS=200",
    "VITE_GOLD_DECIMALS=9",
    "VITE_REFRESH_INTERVAL_MS=1500",
    "VITE_ENABLE_AUTO_SEED=false",
    "VITE_E2E_FORCE_WINNER=YES",
    `VITE_E2E_MODEL_CHARACTER_ID=${e2eModelCharacterId}`,
    `VITE_E2E_MODEL_NAME=${e2eModelName}`,
    `VITE_E2E_MODEL_PROVIDER=${e2eModelProvider}`,
    `VITE_E2E_MODEL_SLUG=${e2eModelSlug}`,
    `VITE_E2E_MODEL_WINS=${e2eModelWins}`,
    `VITE_E2E_MODEL_LOSSES=${e2eModelLosses}`,
    `VITE_E2E_MODEL_COMBAT_LEVEL=${e2eModelCombatLevel}`,
    `VITE_E2E_MODEL_STREAK=${e2eModelCurrentStreak}`,
    `VITE_E2E_MODEL_SPOT_INDEX=${e2eModelSpotIndex}`,
    `VITE_E2E_MODEL_MU=${e2eModelMu}`,
    `VITE_E2E_MODEL_SIGMA=${e2eModelSigma}`,
    "VITE_E2E_MODEL_INSURANCE=12",
    `VITE_E2E_MODEL_ORACLE_RECORDED_AT=${oracleRecordedAt}`,
    `VITE_BINARY_MARKET_MAKER_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_BINARY_TRADE_TREASURY_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_BINARY_TRADE_MARKET_MAKER_WALLET=${authority.publicKey.toBase58()}`,
    `VITE_HEADLESS_WALLET_SECRET_KEY=${Array.from(trader.secretKey).join(",")}`,
    "VITE_HEADLESS_WALLET_NAME=E2E Trader",
    "VITE_HEADLESS_WALLET_AUTO_CONNECT=true",
  ].join("\n");

  await fs.writeFile(envPath, `${envBody}\n`, "utf8");
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        mode: "localnet",
        cluster: "localnet",
        solanaRpcUrl,
        authority: authority.publicKey.toBase58(),
        bootstrapWalletPath: bootstrapAuthority.keypairPath,
        solanaTraderPublicKey: trader.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        currentMatchId,
        currentDuelId: String(currentMatchId),
        currentDuelKeyHex,
        clobConfig: currentMarket.config.toBase58(),
        clobMarketState: currentMarket.marketState.toBase58(),
        clobDuelState: currentMarket.duelState.toBase58(),
        clobTreasury: currentMarket.treasury.toBase58(),
        clobMarketMaker: currentMarket.marketMaker.toBase58(),
        clobVault: currentMarket.vault.toBase58(),
        clobUserBalance: clobUserBalancePda.toBase58(),
        expectedSeedSuccess: true,
        canStartNewRound: true,
        placeBetPayAsset: "SOL",
        placeBetAmount: "1",
        placeBetSide: "YES",
        currentBetWindowSeconds: 300,
        perpsCharacterId: e2eModelCharacterId,
        perpsModelName: e2eModelName,
        perpsMarketId: e2ePerpsMarketId,
        perpsMarketPda: perpsMarketPda.toBase58(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        envPath,
        statePath,
        authority: authority.publicKey.toBase58(),
        trader: trader.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        browserSolanaRpcUrl,
        browserSolanaWsUrl,
        currentMatchId,
        currentDuelKeyHex,
        clobMarketState: currentMarket.marketState.toBase58(),
        clobUserBalance: clobUserBalancePda.toBase58(),
        perpsMarketId: e2ePerpsMarketId,
      },
      null,
      2,
    ),
  );
}

void main();
