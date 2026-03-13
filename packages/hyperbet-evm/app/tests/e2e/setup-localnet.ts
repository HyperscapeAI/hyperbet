import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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

import fightOracleIdl from "../../../../hyperbet-solana/anchor/target/idl/fight_oracle.json";
import goldClobIdl from "../../../../hyperbet-solana/anchor/target/idl/gold_clob_market.json";
import goldPerpsIdl from "../../../../hyperbet-solana/anchor/target/idl/gold_perps_market.json";
import { modelMarketIdFromCharacterId } from "../../../../hyperbet-ui/src/lib/modelMarkets";

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };
type IdlWithAddress = Idl & {
  address?: string;
  metadata?: {
    address?: string;
  };
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
const DUEL_WINNER_MARKET_KIND = 1;
const SIDE_BID = 1;
const SIDE_ASK = 2;
const E2E_TRADER_SEED = Uint8Array.from([
  88, 41, 190, 12, 77, 164, 231, 5, 199, 118, 43, 91, 16, 220, 58, 147, 9, 175,
  63, 204, 132, 54, 241, 28, 115, 67, 154, 210, 36, 143, 80, 11,
]);
let currentSendStage = "initializing";

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

function sha256Bytes(label: string): number[] {
  return Array.from(createHash("sha256").update(label).digest());
}

function duelKeyFromLabel(label: string): number[] {
  return sha256Bytes(`hyperbet-e2e:${label}`);
}

function bytesToHex(bytes: readonly number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function enumKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return key ?? null;
}

async function currentChainUnixTimestamp(
  connection: Connection,
): Promise<number> {
  const slot = await withRpcRetry(() => connection.getSlot("confirmed"));
  const blockTime = await withRpcRetry(() => connection.getBlockTime(slot));
  return blockTime ?? Math.floor(Date.now() / 1000);
}

function deriveDuelStateAddress(
  programId: PublicKey,
  duelKey: readonly number[] | Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("duel"), Buffer.from(duelKey)],
    programId,
  )[0];
}

function deriveClobMarketStateAddress(
  programId: PublicKey,
  duelState: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      duelState.toBuffer(),
      Uint8Array.of(DUEL_WINNER_MARKET_KIND),
    ],
    programId,
  )[0];
}

function deriveClobVaultAddress(
  programId: PublicKey,
  marketState: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketState.toBuffer()],
    programId,
  )[0];
}

function deriveClobUserBalanceAddress(
  programId: PublicKey,
  marketState: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), marketState.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

function deriveClobOrderAddress(
  programId: PublicKey,
  marketState: PublicKey,
  orderId: number | bigint,
): PublicKey {
  const orderIdBytes = Buffer.alloc(8);
  orderIdBytes.writeBigUInt64LE(BigInt(orderId), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), marketState.toBuffer(), orderIdBytes],
    programId,
  )[0];
}

function deriveClobPriceLevelAddress(
  programId: PublicKey,
  marketState: PublicKey,
  side: number,
  price: number,
): PublicKey {
  const priceBytes = Buffer.alloc(2);
  priceBytes.writeUInt16LE(price, 0);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("level"),
      marketState.toBuffer(),
      Uint8Array.of(side),
      priceBytes,
    ],
    programId,
  )[0];
}

function lamportsBn(sol: number): BN {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL).toString());
}

async function loadBootstrapAuthority(): Promise<Keypair> {
  const candidates = [
    process.env.E2E_SOLANA_BOOTSTRAP_KEYPAIR,
    path.join(
      process.env.HOME ?? "",
      ".config/solana/hyperscape-keys/deployer.json",
    ),
    path.join(process.env.HOME ?? "", ".config/solana/id.json"),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    try {
      const secret = JSON.parse(await fs.readFile(candidate, "utf8")) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(secret));
    } catch {
      // Try the next configured wallet path.
    }
  }

  throw new Error(
    `Could not find a bootstrap Solana keypair. Checked: ${candidates.join(", ")}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markStage(label: string): void {
  currentSendStage = label;
  console.log(`[e2e:setup-localnet] ${label}`);
}

function isRetryableRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unable to connect|ConnectionRefused|fetch failed|ECONNREFUSED/i.test(
    message,
  );
}

async function withRpcRetry<T>(
  operation: () => Promise<T>,
  attempts = 8,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableRpcError(error) || attempt === attempts - 1) {
        throw error;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastError;
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
  const initialBalance = await withRpcRetry(() =>
    connection.getBalance(recipient, "confirmed"),
  );
  const expectedFloor = initialBalance + lamports;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const signature = await connection.requestAirdrop(recipient, lamports);

      const startedAt = Date.now();
      while (Date.now() - startedAt < 20_000) {
        const balance = await withRpcRetry(() =>
          connection.getBalance(recipient, "confirmed"),
        );
        if (balance >= expectedFloor) return;

        const statuses = await withRpcRetry(() =>
          connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          }),
        );
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
  let balance = await withRpcRetry(() =>
    connection.getBalance(recipient, "confirmed"),
  );
  while (balance < minimumLamports) {
    const missingLamports = minimumLamports - balance;
    await airdrop(
      connection,
      recipient,
      Math.min(missingLamports, 10 * LAMPORTS_PER_SOL),
    );
    balance = await withRpcRetry(() =>
      connection.getBalance(recipient, "confirmed"),
    );
  }
}

async function ensureTransferredBalance(
  connection: Connection,
  provider: AnchorProvider,
  recipient: PublicKey,
  minimumLamports: number,
): Promise<void> {
  const balance = await withRpcRetry(() =>
    connection.getBalance(recipient, "confirmed"),
  );
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
  onPendingTick?: () => Promise<void> | void,
): Promise<void> {
  const startedAt = Date.now();
  let lastPendingTickAt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    let shouldTick: boolean;
    try {
      const statuses = await withRpcRetry(() =>
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        }),
      );
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
      shouldTick = !status;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
      shouldTick = true;
    }
    if (
      shouldTick &&
      onPendingTick &&
      Date.now() - lastPendingTickAt >= 5_000
    ) {
      await onPendingTick();
      lastPendingTickAt = Date.now();
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
    const account = await withRpcRetry(() =>
      connection.getAccountInfo(address, "confirmed"),
    );
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
    const latestBlockhash = await withRpcRetry(() =>
      connection.getLatestBlockhash(preflightCommitment),
    );
    tx.recentBlockhash = latestBlockhash.blockhash;
    if (signers && signers.length > 0) {
      for (const signer of signers) {
        tx.partialSign(signer);
      }
    }
  }

  const signedTx = await provider.wallet.signTransaction(tx);
  const serializedTx = signedTx.serialize();
  const sendOptions = {
    skipPreflight: resolvedOpts.skipPreflight,
    maxRetries: resolvedOpts.maxRetries ?? 20,
    preflightCommitment,
  } as const;
  const signature = await withRpcRetry(() =>
    connection.sendRawTransaction(serializedTx, sendOptions),
  );
  try {
    await waitForSignatureConfirmation(connection, signature, 120_000, async () => {
      try {
        await connection.sendRawTransaction(serializedTx, {
          ...sendOptions,
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already(?:\s+been)?\s+processed/i.test(message)) {
          throw error;
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${currentSendStage}: ${message}`, { cause: error });
  }
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
  const authority = await loadBootstrapAuthority();
  const trader = Keypair.fromSeed(E2E_TRADER_SEED);
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  attachReliableSendAndConfirm(provider, connection);

  const fightProgram = new Program(fightOracleIdl as Idl, provider);
  const fight: any = fightProgram;
  const clobProgram = new Program(goldClobIdl as Idl, provider);
  const clob: any = clobProgram;
  const perpsProgram = new Program(goldPerpsIdl as Idl, provider);
  const perps: any = perpsProgram;

  const [oracleConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    fightProgram.programId,
  );

  markStage("fund authority wallet");
  await ensureBalance(connection, authority.publicKey, 30 * LAMPORTS_PER_SOL);
  markStage("fund trader wallet");
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
  const resolvedMatchId = Number(process.env.E2E_RESOLVED_MATCH_ID || 9001);
  const currentMatchId = Number(process.env.E2E_CURRENT_MATCH_ID || 9002);
  const resolvedDuelKey = duelKeyFromLabel(`resolved:${resolvedMatchId}`);
  const currentDuelKey = duelKeyFromLabel(`current:${currentMatchId}`);
  const resolvedDuelPda = deriveDuelStateAddress(
    fightProgram.programId,
    resolvedDuelKey,
  );
  const currentDuelPda = deriveDuelStateAddress(
    fightProgram.programId,
    currentDuelKey,
  );
  const currentUnixTs = await currentChainUnixTimestamp(connection);
  const resolvedBetOpenTs = currentUnixTs - 180;
  const resolvedBetCloseTs = currentUnixTs - 90;
  const resolvedDuelStartTs = currentUnixTs - 60;
  const resolvedDuelEndTs = currentUnixTs - 30;
  const currentBetWindowSeconds = Number(
    process.env.E2E_CURRENT_BET_WINDOW_SECONDS || 300,
  );
  const currentFightDelaySeconds = Number(
    process.env.E2E_CURRENT_DUEL_START_DELAY_SECONDS || 360,
  );
  const currentBetOpenTs = currentUnixTs - 15;
  const currentBetCloseTs = currentUnixTs + currentBetWindowSeconds;
  const currentDuelStartTs = currentUnixTs + currentFightDelaySeconds;

  markStage("initialize fight oracle");
  await fight.methods
    .initializeOracle(authority.publicKey)
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      program: fightProgram.programId,
      programData: deriveProgramDataAddress(fightProgram.programId),
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  const existingResolvedDuel =
    await fight.account.duelState.fetchNullable(resolvedDuelPda);
  const resolvedStatus = enumKey(existingResolvedDuel?.status);
  if (resolvedStatus !== "resolved" && resolvedStatus !== "cancelled") {
    markStage("seed resolved duel");
    await fight.methods
      .upsertDuel(
        [...resolvedDuelKey],
        sha256Bytes("e2e-resolved-agent-a"),
        sha256Bytes("e2e-resolved-agent-b"),
        new BN(resolvedBetOpenTs),
        new BN(resolvedBetCloseTs),
        new BN(resolvedDuelStartTs),
        "https://hyperbet.local/e2e/resolved",
        { locked: {} },
      )
      .accountsPartial({
        reporter: authority.publicKey,
        oracleConfig: oracleConfigPda,
        duelState: resolvedDuelPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    markStage("report resolved duel result");
    await fight.methods
      .reportResult(
        [...resolvedDuelKey],
        { a: {} },
        new BN(42),
        sha256Bytes("e2e-resolved-replay"),
        sha256Bytes("e2e-resolved-result"),
        new BN(resolvedDuelEndTs),
        "https://hyperbet.local/e2e/resolved/result",
      )
      .accountsPartial({
        reporter: authority.publicKey,
        oracleConfig: oracleConfigPda,
        duelState: resolvedDuelPda,
      })
      .signers([authority])
      .rpc();
  }

  markStage("seed current duel");
  await fight.methods
    .upsertDuel(
      [...currentDuelKey],
      sha256Bytes("e2e-active-agent-a"),
      sha256Bytes("e2e-active-agent-b"),
      new BN(currentBetOpenTs),
      new BN(currentBetCloseTs),
      new BN(currentDuelStartTs),
      "https://hyperbet.local/e2e/current",
      { bettingOpen: {} },
    )
    .accountsPartial({
      reporter: authority.publicKey,
      oracleConfig: oracleConfigPda,
      duelState: currentDuelPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  const [clobConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    clobProgram.programId,
  );
  const existingClobConfig =
    await clob.account.marketConfig.fetchNullable(clobConfigPda);
  if (!existingClobConfig) {
    markStage("initialize clob config");
    await clob.methods
      .initializeConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        100,
        100,
        200,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: clobConfigPda,
        program: clobProgram.programId,
        programData: deriveProgramDataAddress(clobProgram.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  const [perpsConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    perpsProgram.programId,
  );
  const [perpsMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), encodeMarketId(e2ePerpsMarketId)],
    perpsProgram.programId,
  );
  const existingPerpsConfig =
    await perps.account.configState.fetchNullable(perpsConfigPda);
  if (!existingPerpsConfig) {
    markStage("initialize perps config");
    await perps.methods
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

  markStage("update perps oracle");
  await perps.methods
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

  markStage("deposit perps insurance");
  await perps.methods
    .depositInsurance(new BN(String(e2ePerpsMarketId)), lamportsBn(12))
    .accountsPartial({
      market: perpsMarketPda,
      payer: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const clobMarketState = deriveClobMarketStateAddress(
    clobProgram.programId,
    currentDuelPda,
  );
  const clobVaultPda = deriveClobVaultAddress(
    clobProgram.programId,
    clobMarketState,
  );
  const existingClobMarket =
    await clob.account.marketState.fetchNullable(clobMarketState);
  if (!existingClobMarket) {
    markStage("initialize clob market");
    await clob.methods
      .initializeMarket([...currentDuelKey], DUEL_WINNER_MARKET_KIND)
      .accountsPartial({
        operator: authority.publicKey,
        config: clobConfigPda,
        duelState: currentDuelPda,
        marketState: clobMarketState,
        vault: clobVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }
  await waitForAccountExists(connection, clobMarketState);

  markStage("sync clob market");
  await clob.methods
    .syncMarketFromDuel()
    .accountsPartial({
      marketState: clobMarketState,
      duelState: currentDuelPda,
    })
    .rpc();

  const clobUserBalancePda = deriveClobUserBalanceAddress(
    clobProgram.programId,
    clobMarketState,
    trader.publicKey,
  );
  const clobAuthorityBalancePda = deriveClobUserBalanceAddress(
    clobProgram.programId,
    clobMarketState,
    authority.publicKey,
  );
  const clobFirstOrderPda = deriveClobOrderAddress(
    clobProgram.programId,
    clobMarketState,
    1,
  );
  const clobSecondOrderPda = deriveClobOrderAddress(
    clobProgram.programId,
    clobMarketState,
    2,
  );
  const clobFirstLevelPda = deriveClobPriceLevelAddress(
    clobProgram.programId,
    clobMarketState,
    SIDE_ASK,
    600,
  );
  const clobSecondLevelPda = deriveClobPriceLevelAddress(
    clobProgram.programId,
    clobMarketState,
    SIDE_BID,
    400,
  );

  const minVaultLamports = await withRpcRetry(() =>
    connection.getMinimumBalanceForRentExemption(0, "confirmed"),
  );
  const currentVaultLamports = await withRpcRetry(() =>
    connection.getBalance(clobVaultPda, "confirmed"),
  );
  if (currentVaultLamports < minVaultLamports) {
    markStage("top up clob vault");
    const topUpLamports = minVaultLamports - currentVaultLamports;
    const topUpTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: clobVaultPda,
        lamports: topUpLamports,
      }),
    );
    await provider.sendAndConfirm(topUpTx);
  }

  const [existingFirstOrder, existingSecondOrder] = await Promise.all([
    clob.account.order.fetchNullable(clobFirstOrderPda),
    clob.account.order.fetchNullable(clobSecondOrderPda),
  ]);
  const seededClobOrderAmount = new BN(
    (2n * BigInt(LAMPORTS_PER_SOL)).toString(),
  );

  if (!existingFirstOrder) {
    markStage("seed first clob order");
    await clob.methods
      .placeOrder(new BN(1), SIDE_ASK, 600, seededClobOrderAmount)
      .accountsPartial({
        marketState: clobMarketState,
        duelState: currentDuelPda,
        userBalance: clobAuthorityBalancePda,
        newOrder: clobFirstOrderPda,
        restingLevel: clobFirstLevelPda,
        config: clobConfigPda,
        treasury: authority.publicKey,
        marketMaker: authority.publicKey,
        vault: clobVaultPda,
        user: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  if (!existingSecondOrder) {
    markStage("seed second clob order");
    await clob.methods
      .placeOrder(new BN(2), SIDE_BID, 400, seededClobOrderAmount)
      .accountsPartial({
        marketState: clobMarketState,
        duelState: currentDuelPda,
        userBalance: clobAuthorityBalancePda,
        newOrder: clobSecondOrderPda,
        restingLevel: clobSecondLevelPda,
        config: clobConfigPda,
        treasury: authority.publicKey,
        marketMaker: authority.publicKey,
        vault: clobVaultPda,
        user: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  const oracleRecordedAt = currentUnixTs * 1000;

  markStage("write local e2e env");
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
    `VITE_E2E_CLOB_MATCH_STATE=${clobMarketState.toBase58()}`,
    `VITE_E2E_CLOB_VAULT=${clobVaultPda.toBase58()}`,
    `VITE_E2E_CLOB_USER_BALANCE=${clobUserBalancePda.toBase58()}`,
    `VITE_E2E_CLOB_FIRST_ORDER=${clobFirstOrderPda.toBase58()}`,
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
        solanaTraderPublicKey: trader.publicKey.toBase58(),
        goldMint: goldMint.toBase58(),
        currentMatchId,
        currentMatchPda: currentDuelPda.toBase58(),
        currentDuelKeyHex: bytesToHex(currentDuelKey),
        currentDuelState: currentDuelPda.toBase58(),
        clobMatchState: clobMarketState.toBase58(),
        clobVault: clobVaultPda.toBase58(),
        clobUserBalance: clobUserBalancePda.toBase58(),
        lastResolvedMatchId: resolvedMatchId,
        lastResolvedDuelKeyHex: bytesToHex(resolvedDuelKey),
        expectedSeedSuccess: true,
        canStartNewRound: true,
        placeBetPayAsset: "GOLD",
        placeBetAmount: "1",
        placeBetSide: "YES",
        currentBetWindowSeconds,
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
        currentDuelKeyHex: bytesToHex(currentDuelKey),
        clobMatchState: clobMarketState.toBase58(),
        clobUserBalance: clobUserBalancePda.toBase58(),
        perpsMarketId: e2ePerpsMarketId,
        lastResolvedMatchId: resolvedMatchId,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
