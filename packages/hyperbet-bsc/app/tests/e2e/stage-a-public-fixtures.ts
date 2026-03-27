import fs from "node:fs/promises";
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
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
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

import fightOracleIdl from "../../../../hyperbet-solana/anchor/target/idl/fight_oracle.json";
import goldClobIdl from "../../../../hyperbet-solana/anchor/target/idl/gold_clob_market.json";
import goldPerpsIdl from "../../../../hyperbet-solana/anchor/target/idl/gold_perps_market.json";
import duelOutcomeOracleArtifact from "../../../../evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json";
import goldClobArtifact from "../../../../evm-contracts/out/GoldClob.sol/GoldClob.json";
import {
  resolveBettingSolanaDeployment,
  type BettingSolanaCluster,
} from "../../../../hyperbet-chain-registry/src/index.ts";
import {
  deriveOracleConfigPda,
  deriveMarketConfigPda,
  deriveUserBalancePda,
  duelStatusBettingOpen,
  ensureOracleReady,
  ensureVaultRentExempt,
  initializeCanonicalMarket,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
} from "../../../../hyperbet-solana/anchor/tests/clob-test-helpers";
import { confirmSignatureByPolling } from "../../../../hyperbet-solana/anchor/tests/test-anchor";
import { modelMarketIdFromCharacterId } from "../../../../hyperbet-ui/src/lib/modelMarkets";
import {
  resolveAcceptanceDuelSource,
  resolveEvmAcceptanceRuntime,
  resolveReachableSolanaAcceptanceRuntime,
  type AcceptanceEvmChain,
} from "../../../../../scripts/testnet-acceptance-env";

type IdlWithAddress = Idl & { address?: string };
type SignableTransaction = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };
type EnvMap = Record<string, string | undefined>;
type SolanaFixtureState = {
  mode: "public";
  cluster: BettingSolanaCluster;
  solanaRpcUrl: string;
  authority: string;
  bootstrapWalletPath: string;
  solanaTraderPublicKey: string;
  goldMint: string;
  currentMatchId: number;
  currentDuelId: string;
  currentDuelKeyHex: string;
  clobConfig: string;
  clobMatchState: string;
  clobMarketState: string;
  clobDuelState: string;
  clobTreasury: string;
  clobMarketMaker: string;
  clobVault: string;
  clobUserBalance: string;
  expectedSeedSuccess: true;
  canStartNewRound: true;
  placeBetPayAsset: "SOL";
  placeBetAmount: string;
  placeBetSide: "YES";
  currentBetWindowSeconds: number;
  perpsCharacterId: string;
  perpsModelName: string;
  perpsMarketId: number;
  perpsMarketPda: string | null;
  perpsOracleSpotIndex: number;
};
type EvmFixtureState = {
  evmRpcUrl: string;
  evmChainId: number;
  evmHeadlessAddress: string;
  evmGoldTokenAddress: string;
  evmGoldClobAddress: string;
  evmMatchId: number;
  evmDuelId: string;
  evmDuelKeyHex: string;
  evmMarketKey: string;
  evmOracleAddress: string;
  evmCanaryPrivateKey: string;
  evmMatcherPrivateKey: string;
  evmReporterPrivateKey: string;
  evmMarketOperatorPrivateKey: string;
  evmAdminPrivateKey: string;
  evmPauserPrivateKey: string;
  evmFinalizerPrivateKey: string;
  evmSeedNoPrice: number;
  evmSeedYesPrice: number;
  evmSeedOrderAmount: string;
};
type FixtureResult = {
  envLines: Array<string>;
  state: Record<string, unknown>;
  summary: Record<string, unknown>;
};
type LiveHyperscapesCycleResponse = {
  cycle?: {
    cycleId?: string | null;
    duelId?: string | number | null;
    duelKeyHex?: string | null;
    betOpenTime?: number | null;
    betCloseTime?: number | null;
    fightStartTime?: number | null;
    agent1?: { id?: string | null } | null;
    agent2?: { id?: string | null } | null;
  } | null;
};
type SharedEvmDuelContext = {
  duelId: string;
  duelKeyHex: string;
  betOpenTimeMs: number | null;
  betCloseTimeMs: number | null;
  fightStartTimeMs: number | null;
  agent1Id: string;
  agent2Id: string;
};
type GoldClobConfigAccount = {
  treasury: PublicKey;
  marketMaker: PublicKey;
};
type DirectCanarySolanaArtifact = {
  perps?: {
    marketId?: number | string;
    marketPda?: string;
  };
};

const DEFAULT_SOLANA_BET_WINDOW_SECONDS = 600;
const MIN_PUBLIC_SOLANA_TRADER_BALANCE_LAMPORTS = 100_000_000n;
const MIN_PUBLIC_SOLANA_PRIVILEGED_BALANCE_LAMPORTS = 35_000_000n;
const MIN_PUBLIC_SOLANA_CANARY_RESERVE_LAMPORTS = 100_000_000n;
const MIN_PUBLIC_SOLANA_MARKET_MAKER_RESERVE_LAMPORTS = 10_000_000n;
const MIN_PUBLIC_SOLANA_ORACLE_RESERVE_LAMPORTS = 5_000_000n;
const MIN_PUBLIC_SOLANA_SEEDED_MAKER_RESERVE_LAMPORTS = 100_000_000n;
const SOLANA_LAMPORT_TOP_UP_CUSHION = 5_000_000n;
const DEFAULT_SOLANA_BROWSER_BET_AMOUNT = "0.05";
const DEFAULT_EVM_SEED_ORDER_AMOUNT = "0.001";
const DEFAULT_EVM_SEED_NO_PRICE = 600;
const DEFAULT_EVM_SEED_YES_PRICE = 400;
const LIVE_DUEL_MIN_OPEN_WINDOW_MS = 90_000;
const MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const ORDER_FLAG_GTC = 0x01;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ASK_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  14, 22, 189, 71, 203, 44, 97, 156, 18, 240, 85, 132, 53, 199, 4, 220, 91,
  11, 144, 201, 32, 77, 165, 118, 246, 17, 63, 154, 208, 39, 121, 6,
]);

function idlWithAddress(idl: Idl, programId: PublicKey): IdlWithAddress {
  return { ...(idl as IdlWithAddress), address: programId.toBase58() };
}

function toWallet(keypair: Keypair): AnchorLikeWallet {
  const signTransaction = <T extends SignableTransaction>(transaction: T): T => {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([keypair]);
    } else {
      transaction.partialSign(keypair);
    }
    return transaction;
  };

  return {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async <T extends SignableTransaction>(
      transaction: T,
    ): Promise<T> => signTransaction(transaction),
    signAllTransactions: async <T extends Array<SignableTransaction>>(
      transactions: T,
    ): Promise<T> => {
      transactions.forEach((transaction) => signTransaction(transaction));
      return transactions;
    },
  };
}

function cloneTransaction(transaction: Transaction): Transaction {
  const clone = new Transaction();
  clone.instructions = [...transaction.instructions];
  clone.feePayer = transaction.feePayer;
  clone.nonceInfo = transaction.nonceInfo;
  clone.minNonceContextSlot = transaction.minNonceContextSlot;
  return clone;
}

async function sendAndConfirmWithPolling(
  provider: AnchorProvider,
  transaction: Transaction,
  signers: Array<Keypair> = [],
  options?: {
    commitment?: "processed" | "confirmed" | "finalized";
    preflightCommitment?: "processed" | "confirmed" | "finalized";
    skipPreflight?: boolean;
  },
): Promise<string> {
  const opts = {
    ...provider.opts,
    ...options,
  };
  const commitment =
    opts.preflightCommitment ?? opts.commitment ?? "confirmed";
  const tx = cloneTransaction(transaction);
  tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = blockhash;
  if (signers.length > 0) {
    tx.partialSign(...signers);
  }
  const signedTransaction = await provider.wallet.signTransaction(tx);
  const signature = await provider.connection.sendRawTransaction(
    signedTransaction.serialize(),
    {
      maxRetries: 8,
      preflightCommitment: commitment,
      skipPreflight: opts.skipPreflight ?? false,
    },
  );
  await confirmSignatureByPolling(
    provider.connection,
    signature,
    lastValidBlockHeight,
  );
  return signature;
}

function assertNonEmpty(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(`Missing ${label}`);
  }
  return normalized;
}

function firstNonEmptyEnv(
  env: EnvMap,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizeDuelKeyHex(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/^0x/i, "").toLowerCase() || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid duel key hex: ${value ?? ""}`);
  }
  return normalized;
}

function normalizeOptionalTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

async function resolveSharedEvmDuelContext(
  solanaState: SolanaFixtureState,
  env: EnvMap = process.env,
): Promise<SharedEvmDuelContext> {
  if (resolveAcceptanceDuelSource(env) !== "real_hyperscapes") {
    return {
      duelId: String(solanaState.currentMatchId),
      duelKeyHex: solanaState.currentDuelKeyHex,
      betOpenTimeMs: null,
      betCloseTimeMs: null,
      fightStartTimeMs: null,
      agent1Id: "stage-a-agent-a",
      agent2Id: "stage-a-agent-b",
    };
  }

  const gameHttpUrl = assertNonEmpty(
    firstNonEmptyEnv(env, [
      "E2E_GAME_HTTP_URL",
      "GAME_HTTP_URL",
      "HYPERSCAPES_GAME_HTTP_URL",
    ]) ?? "http://127.0.0.1:5555",
    "real Hyperscapes game HTTP URL",
  ).replace(/\/$/, "");
  const deadline = Date.now() + 240_000;
  let lastError = "live duel not available";
  let lastLoggedError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${gameHttpUrl}/api/streaming/state`, {
        headers: { "cache-control": "no-store" },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to load live Hyperscapes cycle from ${gameHttpUrl}: ${response.status} ${response.statusText}`,
        );
      }
      const payload = (await response.json()) as LiveHyperscapesCycleResponse;
      const cycle = payload.cycle;
      const duelId =
        cycle?.duelId != null && String(cycle.duelId).trim()
          ? String(cycle.duelId).trim()
          : null;
      const duelKeyHex = normalizeDuelKeyHex(cycle?.duelKeyHex);
      const betOpenTimeMs = normalizeOptionalTimestamp(cycle?.betOpenTime);
      const betCloseTimeMs = normalizeOptionalTimestamp(cycle?.betCloseTime);
      const fightStartTimeMs = normalizeOptionalTimestamp(cycle?.fightStartTime);
      if (!duelId) {
        lastError = "live Hyperscapes cycle is missing a duelId";
        if (lastError !== lastLoggedError) {
          console.log(`[stage-a-fixture][evm] waiting for live duel: ${lastError}`);
          lastLoggedError = lastError;
        }
        await Bun.sleep(1_000);
        continue;
      }
      if (
        betCloseTimeMs != null &&
        betCloseTimeMs - Date.now() < LIVE_DUEL_MIN_OPEN_WINDOW_MS
      ) {
        lastError = `live duel ${duelId} has less than ${LIVE_DUEL_MIN_OPEN_WINDOW_MS}ms left in the betting window`;
        if (lastError !== lastLoggedError) {
          console.log(`[stage-a-fixture][evm] waiting for live duel: ${lastError}`);
          lastLoggedError = lastError;
        }
        await Bun.sleep(1_000);
        continue;
      }
      console.log(
        `[stage-a-fixture][evm] selected live duel ${duelId} key=${duelKeyHex} closeMs=${betCloseTimeMs ?? "unknown"}`,
      );
      return {
        duelId,
        duelKeyHex,
        betOpenTimeMs,
        betCloseTimeMs,
        fightStartTimeMs,
        agent1Id: assertNonEmpty(cycle?.agent1?.id ?? null, "live duel agent1 id"),
        agent2Id: assertNonEmpty(cycle?.agent2?.id ?? null, "live duel agent2 id"),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError !== lastLoggedError) {
        console.log(`[stage-a-fixture][evm] waiting for live duel: ${lastError}`);
        lastLoggedError = lastError;
      }
      await Bun.sleep(1_000);
    }
  }
  throw new Error(
    `Timed out waiting for an open live Hyperscapes duel from ${gameHttpUrl}: ${lastError}`,
  );
}

async function readKeypairFromPath(filepath: string): Promise<Keypair> {
  const body = await fs.readFile(filepath, "utf8");
  const secret = Uint8Array.from(JSON.parse(body) as Array<number>);
  return Keypair.fromSecretKey(secret);
}

function deriveWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace(/^https:\/\//, "wss://");
  }
  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace(/^http:\/\//, "ws://");
  }
  return httpUrl;
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const priceComponent = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * priceComponent) / 1000n;
}

function seededAskLiquidityMaker(): Keypair {
  return Keypair.fromSeed(ASK_LIQUIDITY_MAKER_SEED);
}

function createEvmChainConfig(chainId: number, rpcUrl: string) {
  return {
    id: chainId,
    name: "stage-a-e2e",
    nativeCurrency: {
      name: "Native",
      symbol: "NATIVE",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  } as const;
}

async function waitForEvmReceipt(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`EVM transaction reverted: ${hash}`);
  }
}

function dedupeEnvLines(lines: Array<string>): Array<string> {
  const ordered = new Map<string, string>();
  for (const line of lines) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    ordered.set(line.slice(0, separatorIndex), line);
  }
  return Array.from(ordered.values());
}

async function ensureMinimumLamportBalance(
  connection: Connection,
  provider: AnchorProvider,
  recipient: PublicKey,
  minimumLamports: bigint,
): Promise<void> {
  const targetLamports = minimumLamports + SOLANA_LAMPORT_TOP_UP_CUSHION;
  const currentBalance = BigInt(
    await connection.getBalance(recipient, "confirmed"),
  );
  if (currentBalance >= targetLamports) {
    return;
  }

  const transferAmount = targetLamports - currentBalance;
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: recipient,
      lamports: Number(transferAmount),
    }),
  );
  await sendAndConfirmWithPolling(provider, transaction, []);
}

async function ensureLamportBufferFromCandidates(
  connection: Connection,
  recipient: Keypair,
  minimumLamports: bigint,
  candidates: Array<{
    signer: Keypair;
    reserveLamports: bigint;
  }>,
): Promise<void> {
  const targetLamports = minimumLamports + SOLANA_LAMPORT_TOP_UP_CUSHION;
  let currentBalance = BigInt(
    await connection.getBalance(recipient.publicKey, "confirmed"),
  );
  if (currentBalance >= targetLamports) {
    return;
  }

  for (const candidate of candidates) {
    if (currentBalance >= targetLamports) {
      break;
    }
    if (candidate.signer.publicKey.equals(recipient.publicKey)) {
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
    const requiredLamports = targetLamports - currentBalance;
    const transferLamports =
      transferableLamports < requiredLamports
        ? transferableLamports
        : requiredLamports;
    const provider = new AnchorProvider(
      connection,
      toWallet(candidate.signer),
      {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      },
    );
    await sendAndConfirmWithPolling(
      provider,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: candidate.signer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: Number(transferLamports),
        }),
      ),
      [],
    );
    currentBalance = BigInt(
      await connection.getBalance(recipient.publicKey, "confirmed"),
    );
  }

  if (currentBalance < targetLamports) {
    throw new Error(
      `Solana privileged signer underfunded: recipient=${recipient.publicKey.toBase58()} balance=${currentBalance.toString()} minimum=${minimumLamports.toString()} target=${targetLamports.toString()}`,
    );
  }
}

function readDirectCanarySolanaArtifactPath(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    dirname,
    "../../../../../.ci-artifacts/stage-a/direct-canaries/solana.json",
  );
}

async function loadDirectCanarySolanaArtifact(): Promise<DirectCanarySolanaArtifact | null> {
  try {
    const body = await fs.readFile(readDirectCanarySolanaArtifactPath(), "utf8");
    return JSON.parse(body) as DirectCanarySolanaArtifact;
  } catch {
    return null;
  }
}

function parseNumberish(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

async function buildStageASolanaPublicFixture(
  env: EnvMap = process.env,
): Promise<FixtureResult> {
  const runtime = await resolveReachableSolanaAcceptanceRuntime(env);
  const deployment = resolveBettingSolanaDeployment(runtime.cluster);
  const bootstrapPath = assertNonEmpty(
    runtime.anchorWallet ?? runtime.oracleAuthorityKeypair,
    "ANCHOR_WALLET",
  );
  const traderPath = assertNonEmpty(
    runtime.canaryKeypair ?? runtime.anchorWallet,
    "SOLANA_CANARY_KEYPAIR",
  );
  const bootstrapAuthority = await readKeypairFromPath(bootstrapPath);
  const configuredOracleSigner =
    runtime.oracleAuthorityKeypair &&
    runtime.oracleAuthorityKeypair !== bootstrapPath
      ? await readKeypairFromPath(runtime.oracleAuthorityKeypair)
      : bootstrapAuthority;
  const trader = await readKeypairFromPath(traderPath);
  const marketMakerSigner =
    runtime.marketMakerKeypair &&
    runtime.marketMakerKeypair !== bootstrapPath &&
    runtime.marketMakerKeypair !== traderPath
      ? await readKeypairFromPath(runtime.marketMakerKeypair)
      : null;
  const connection = new Connection(runtime.rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, toWallet(bootstrapAuthority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const defaultSendAndConfirm = provider.sendAndConfirm.bind(provider);
  provider.sendAndConfirm = async (tx, signers, options) => {
    if (tx instanceof VersionedTransaction) {
      return defaultSendAndConfirm(tx, signers, options);
    }
    return sendAndConfirmWithPolling(
      provider,
      tx,
      (signers ?? []) as Array<Keypair>,
      options,
    );
  };
  const fightProgramId = new PublicKey(runtime.fightOracleProgramId);
  const clobProgramId = new PublicKey(runtime.goldClobProgramId);
  const fightProgram = new Program(
    idlWithAddress(fightOracleIdl as Idl, fightProgramId),
    provider,
  );
  const clobProgram = new Program(
    idlWithAddress(goldClobIdl as Idl, clobProgramId),
    provider,
  );
  const oracleConfig = deriveOracleConfigPda(fightProgram.programId);
  const oracleConfigAccount =
    await fightProgram.account.oracleConfig.fetchNullable(oracleConfig);
  if (!oracleConfigAccount) {
    await ensureOracleReady(
      fightProgram as never,
      bootstrapAuthority,
      configuredOracleSigner.publicKey,
      configuredOracleSigner.publicKey,
      configuredOracleSigner.publicKey,
      60,
    );
  }
  const liveOracleConfig = oracleConfigAccount
    ? oracleConfigAccount
    : await fightProgram.account.oracleConfig.fetch(oracleConfig);
  const reporterSigner = liveOracleConfig.reporter.equals(
    configuredOracleSigner.publicKey,
  )
    ? configuredOracleSigner
    : liveOracleConfig.reporter.equals(bootstrapAuthority.publicKey)
      ? bootstrapAuthority
      : null;
  if (!reporterSigner) {
    throw new Error(
      `Stage-A reporter signer mismatch: live reporter=${liveOracleConfig.reporter.toBase58()} configured=${configuredOracleSigner.publicKey.toBase58()} bootstrap=${bootstrapAuthority.publicKey.toBase58()}`,
    );
  }
  if (liveOracleConfig.paused) {
    throw new Error("Stage-A fight oracle is paused");
  }

  const privilegedFundingCandidates = [
    {
      signer: trader,
      reserveLamports: MIN_PUBLIC_SOLANA_CANARY_RESERVE_LAMPORTS,
    },
    ...(marketMakerSigner
      ? [
          {
            signer: marketMakerSigner,
            reserveLamports: MIN_PUBLIC_SOLANA_MARKET_MAKER_RESERVE_LAMPORTS,
          },
        ]
      : []),
    ...(configuredOracleSigner.publicKey.equals(bootstrapAuthority.publicKey)
      ? []
      : [
          {
            signer: configuredOracleSigner,
            reserveLamports: MIN_PUBLIC_SOLANA_ORACLE_RESERVE_LAMPORTS,
          },
        ]),
    {
      signer: seededAskLiquidityMaker(),
      reserveLamports: MIN_PUBLIC_SOLANA_SEEDED_MAKER_RESERVE_LAMPORTS,
    },
  ];

  await ensureLamportBufferFromCandidates(
    connection,
    bootstrapAuthority,
    MIN_PUBLIC_SOLANA_PRIVILEGED_BALANCE_LAMPORTS,
    privilegedFundingCandidates,
  );
  await ensureLamportBufferFromCandidates(
    connection,
    reporterSigner,
    MIN_PUBLIC_SOLANA_PRIVILEGED_BALANCE_LAMPORTS,
    [
      {
        signer: bootstrapAuthority,
        reserveLamports: MIN_PUBLIC_SOLANA_PRIVILEGED_BALANCE_LAMPORTS,
      },
      {
        signer: trader,
        reserveLamports: MIN_PUBLIC_SOLANA_CANARY_RESERVE_LAMPORTS,
      },
      ...(marketMakerSigner
        ? [
            {
              signer: marketMakerSigner,
              reserveLamports: MIN_PUBLIC_SOLANA_MARKET_MAKER_RESERVE_LAMPORTS,
            },
          ]
        : []),
      {
        signer: seededAskLiquidityMaker(),
        reserveLamports: MIN_PUBLIC_SOLANA_SEEDED_MAKER_RESERVE_LAMPORTS,
      },
    ],
  );

  await ensureMinimumLamportBalance(
    connection,
    provider,
    trader.publicKey,
    MIN_PUBLIC_SOLANA_TRADER_BALANCE_LAMPORTS,
  );

  const now = Math.floor(Date.now() / 1000);
  const currentMatchId = Date.now();
  const duelKey = uniqueDuelKey(`stage-a-public-${currentMatchId}`);
  const currentDuelKeyHex = Buffer.from(duelKey).toString("hex");
  const currentDuelId = String(currentMatchId);
  const betOpenTs = now - 60;
  const betCloseTs = now + DEFAULT_SOLANA_BET_WINDOW_SECONDS;
  const duelStartTs = betCloseTs + 60;

  const duelState = await upsertDuel(
    fightProgram as never,
    reporterSigner,
    duelKey,
    {
      status: duelStatusBettingOpen(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: `https://hyperbet.win/e2e/${currentMatchId}`,
    },
  );
  const clobConfig = deriveMarketConfigPda(clobProgram.programId);
  const { marketState, vault } = await initializeCanonicalMarket(
    clobProgram as never,
    bootstrapAuthority,
    duelState,
    duelKey,
    clobConfig,
  );
  await ensureVaultRentExempt(clobProgram as never, bootstrapAuthority, vault);
  await syncMarketFromDuel(clobProgram as never, marketState, duelState);

  const accountNamespace = clobProgram.account as Record<
    string,
    { fetch: (pubkey: PublicKey) => Promise<unknown> }
  >;
  const configAccount = (await accountNamespace.marketConfig.fetch(
    clobConfig,
  )) as GoldClobConfigAccount;
  const clobUserBalance = deriveUserBalancePda(
    clobProgram.programId,
    marketState,
    trader.publicKey,
  );

  const directCanaryArtifact = await loadDirectCanarySolanaArtifact();
  const perpsCharacterId =
    assertNonEmpty(
      env.E2E_PERPS_CHARACTER_ID ?? "stage-a-model-alpha",
      "E2E_PERPS_CHARACTER_ID",
    );
  const perpsModelName =
    assertNonEmpty(
      env.E2E_PERPS_MODEL_NAME ?? "Stage-A Model Alpha",
      "E2E_PERPS_MODEL_NAME",
    );
  const perpsMarketId =
    parseNumberish(directCanaryArtifact?.perps?.marketId) ??
    modelMarketIdFromCharacterId(perpsCharacterId);
  const perpsMarketPda = directCanaryArtifact?.perps?.marketPda?.trim() || null;
  const goldPerpsProgram = new Program(
    idlWithAddress(
      goldPerpsIdl as Idl,
      new PublicKey(runtime.goldPerpsProgramId),
    ),
    provider,
  );
  const perpsConfigPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    goldPerpsProgram.programId,
  )[0];
  const perpsConfigAccount = (await (
    goldPerpsProgram.account as Record<
      string,
      { fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>> }
    >
  ).configState.fetch(perpsConfigPda)) as {
    minOracleSpotIndex?: unknown;
    maxOracleSpotIndex?: unknown;
  };
  const perpsMinSpotIndex =
    Number(numberLikeToBigInt(perpsConfigAccount.minOracleSpotIndex)) /
    LAMPORTS_PER_SOL;
  const perpsMaxSpotIndex =
    Number(numberLikeToBigInt(perpsConfigAccount.maxOracleSpotIndex)) /
    LAMPORTS_PER_SOL;
  const perpsOracleSpotIndex =
    Math.round(((perpsMinSpotIndex + perpsMaxSpotIndex) / 2) * 100) / 100;
  const keeperUrl = assertNonEmpty(
    runtime.keeperUrl ?? "http://127.0.0.1:18081",
    "HYPERBET_SOLANA_KEEPER_TESTNET_URL",
  ).replace(/\/$/, "");
  const headlessSecretCsv = Array.from(trader.secretKey).join(",");
  const envLines = dedupeEnvLines([
    `VITE_SOLANA_CLUSTER=${runtime.cluster}`,
    `VITE_SOLANA_RPC_URL=${runtime.rpcUrl}`,
    `VITE_SOLANA_WS_URL=${deriveWsUrl(runtime.rpcUrl)}`,
    `VITE_GAME_API_URL=${keeperUrl}`,
    `VITE_GAME_WS_URL=${deriveWsUrl(keeperUrl)}/ws`,
    "VITE_USE_GAME_RPC_PROXY=false",
    "VITE_USE_GAME_EVM_RPC_PROXY=false",
    "VITE_USE_LOCAL_SOLANA_RPC_PROXY=false",
    `VITE_FIGHT_ORACLE_PROGRAM_ID=${fightProgramId.toBase58()}`,
    `VITE_GOLD_CLOB_MARKET_PROGRAM_ID=${clobProgramId.toBase58()}`,
    `VITE_GOLD_BINARY_MARKET_PROGRAM_ID=${clobProgramId.toBase58()}`,
    `VITE_GOLD_PERPS_MARKET_PROGRAM_ID=${runtime.goldPerpsProgramId}`,
    `VITE_GOLD_AMM_MARKET_PROGRAM_ID=${runtime.goldAmmProgramId}`,
    `VITE_GOLD_MINT=${deployment.goldMint}`,
    `VITE_ACTIVE_MATCH_ID=${currentMatchId}`,
    `VITE_BET_WINDOW_SECONDS=${DEFAULT_SOLANA_BET_WINDOW_SECONDS}`,
    `VITE_NEW_ROUND_BET_WINDOW_SECONDS=${DEFAULT_SOLANA_BET_WINDOW_SECONDS}`,
    "VITE_AUTO_SEED_DELAY_SECONDS=10",
    "VITE_MARKET_MAKER_SEED_SOL=1",
    "VITE_MARKET_MAKER_SEED_GOLD=1",
    "VITE_BET_FEE_BPS=200",
    "VITE_GOLD_DECIMALS=9",
    "VITE_REFRESH_INTERVAL_MS=1500",
    "VITE_ENABLE_AUTO_SEED=false",
    `VITE_BINARY_MARKET_MAKER_WALLET=${configAccount.marketMaker.toBase58()}`,
    `VITE_BINARY_TRADE_TREASURY_WALLET=${configAccount.treasury.toBase58()}`,
    `VITE_BINARY_TRADE_MARKET_MAKER_WALLET=${configAccount.marketMaker.toBase58()}`,
    `VITE_HEADLESS_WALLET_SECRET_KEY=${headlessSecretCsv}`,
    "VITE_HEADLESS_WALLET_NAME=E2E Trader",
    "VITE_HEADLESS_WALLET_AUTO_CONNECT=true",
    `VITE_E2E_MODEL_CHARACTER_ID=${perpsCharacterId}`,
    `VITE_E2E_MODEL_MARKET_ID=${perpsMarketId}`,
    `VITE_E2E_MODEL_NAME=${perpsModelName}`,
    "VITE_E2E_MODEL_PROVIDER=Hyperscape",
    "VITE_E2E_MODEL_SLUG=stage-a-model-alpha",
    "VITE_E2E_MODEL_WINS=12",
    "VITE_E2E_MODEL_LOSSES=4",
    "VITE_E2E_MODEL_COMBAT_LEVEL=88",
    "VITE_E2E_MODEL_STREAK=4",
    `VITE_E2E_MODEL_SPOT_INDEX=${perpsOracleSpotIndex}`,
    "VITE_E2E_MODEL_MU=28",
    "VITE_E2E_MODEL_SIGMA=4",
    "VITE_E2E_MODEL_INSURANCE=12",
    `VITE_E2E_MODEL_ORACLE_RECORDED_AT=${Date.now()}`,
  ]);
  const state: SolanaFixtureState = {
    mode: "public",
    cluster: runtime.cluster,
    solanaRpcUrl: runtime.rpcUrl,
    authority: bootstrapAuthority.publicKey.toBase58(),
    bootstrapWalletPath: bootstrapPath,
    solanaTraderPublicKey: trader.publicKey.toBase58(),
    goldMint: deployment.goldMint,
    currentMatchId,
    currentDuelId,
    currentDuelKeyHex,
    clobConfig: clobConfig.toBase58(),
    clobMatchState: marketState.toBase58(),
    clobMarketState: marketState.toBase58(),
    clobDuelState: duelState.toBase58(),
    clobTreasury: configAccount.treasury.toBase58(),
    clobMarketMaker: configAccount.marketMaker.toBase58(),
    clobVault: vault.toBase58(),
    clobUserBalance: clobUserBalance.toBase58(),
    expectedSeedSuccess: true,
    canStartNewRound: true,
    placeBetPayAsset: "SOL",
    placeBetAmount: DEFAULT_SOLANA_BROWSER_BET_AMOUNT,
    placeBetSide: "YES",
    currentBetWindowSeconds: DEFAULT_SOLANA_BET_WINDOW_SECONDS,
    perpsCharacterId,
    perpsModelName,
    perpsMarketId,
    perpsMarketPda,
    perpsOracleSpotIndex,
  };

  return {
    envLines,
    state,
    summary: {
      cluster: runtime.cluster,
      authority: bootstrapAuthority.publicKey.toBase58(),
      reporter: reporterSigner.publicKey.toBase58(),
      trader: trader.publicKey.toBase58(),
      currentDuelId,
      currentDuelKeyHex,
      clobMarketState: marketState.toBase58(),
      perpsMarketId,
    },
  };
}

function buildSharedEvmConfigEnvLines(env: EnvMap = process.env): Array<string> {
  const bscRuntime = resolveEvmAcceptanceRuntime("bsc", env);
  const avaxRuntime = resolveEvmAcceptanceRuntime("avax", env);
  return [
    `VITE_BSC_RPC_URL=${bscRuntime.rpcUrl}`,
    `VITE_BSC_CHAIN_ID=${bscRuntime.chainId}`,
    `VITE_BSC_GOLD_CLOB_ADDRESS=${bscRuntime.goldClobAddress}`,
    `VITE_BSC_GOLD_AMM_ROUTER_ADDRESS=${bscRuntime.goldAmmRouterAddress}`,
    `VITE_BSC_GOLD_TOKEN_ADDRESS=${bscRuntime.goldTokenAddress}`,
    `VITE_AVAX_RPC_URL=${avaxRuntime.rpcUrl}`,
    `VITE_AVAX_CHAIN_ID=${avaxRuntime.chainId}`,
    `VITE_AVAX_GOLD_CLOB_ADDRESS=${avaxRuntime.goldClobAddress}`,
    `VITE_AVAX_GOLD_AMM_ROUTER_ADDRESS=${avaxRuntime.goldAmmRouterAddress}`,
    `VITE_AVAX_GOLD_TOKEN_ADDRESS=${avaxRuntime.goldTokenAddress}`,
  ];
}

async function buildStageAEvmPublicFixture(
  chain: AcceptanceEvmChain,
  sharedDuel: SharedEvmDuelContext,
  env: EnvMap = process.env,
): Promise<FixtureResult> {
  console.log(
    `[stage-a-fixture][${chain}] building EVM public fixture for duel ${sharedDuel.duelId}`,
  );
  const runtime = resolveEvmAcceptanceRuntime(chain, env);
  const canaryPrivateKey = assertNonEmpty(
    runtime.canaryPrivateKey,
    `${chain} canary private key`,
  ) as `0x${string}`;
  const matcherPrivateKey = assertNonEmpty(
    runtime.matcherPrivateKey,
    `${chain} matcher private key`,
  ) as `0x${string}`;
  const reporterPrivateKey = assertNonEmpty(
    runtime.reporterPrivateKey,
    `${chain} reporter private key`,
  ) as `0x${string}`;
  const adminPrivateKey = assertNonEmpty(
    runtime.adminPrivateKey,
    `${chain} admin private key`,
  ) as `0x${string}`;
  const marketOperatorPrivateKey = assertNonEmpty(
    runtime.marketOperatorPrivateKey,
    `${chain} market operator private key`,
  ) as `0x${string}`;
  const pauserPrivateKey = assertNonEmpty(
    runtime.pauserPrivateKey,
    `${chain} pauser private key`,
  ) as `0x${string}`;
  const finalizerPrivateKey = assertNonEmpty(
    env.TESTNET_FINALIZER_PRIVATE_KEY,
    "TESTNET_FINALIZER_PRIVATE_KEY",
  ) as `0x${string}`;
  const chainConfig = createEvmChainConfig(
    runtime.chainId,
    runtime.rpcUrl,
  );
  const publicClient = createPublicClient({
    chain: chainConfig,
    transport: http(runtime.rpcUrl),
  });
  const userAccount = privateKeyToAccount(canaryPrivateKey);
  const matcherAccount = privateKeyToAccount(matcherPrivateKey);
  const reporterAccount = privateKeyToAccount(reporterPrivateKey);
  const marketOperatorAccount = privateKeyToAccount(marketOperatorPrivateKey);
  const reporterWalletClient = createWalletClient({
    account: reporterAccount,
    chain: chainConfig,
    transport: http(runtime.rpcUrl),
  });
  const marketOperatorWalletClient = createWalletClient({
    account: marketOperatorAccount,
    chain: chainConfig,
    transport: http(runtime.rpcUrl),
  });
  const matcherWalletClient = createWalletClient({
    account: matcherAccount,
    chain: chainConfig,
    transport: http(runtime.rpcUrl),
  });
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const sharedDuelKey = normalizeDuelKeyHex(sharedDuel.duelKeyHex);
  const duelId = sharedDuel.duelId;
  const duelKey = `0x${sharedDuelKey}` as Hash;
  const fallbackBetOpenTs = latestBlock.timestamp - 15n;
  const fallbackBetCloseTs = fallbackBetOpenTs + 3600n;
  const fallbackDuelStartTs = fallbackBetCloseTs + 60n;
  const betOpenTs =
    sharedDuel.betOpenTimeMs != null
      ? BigInt(Math.floor(sharedDuel.betOpenTimeMs / 1000))
      : fallbackBetOpenTs;
  const betCloseTs =
    sharedDuel.betCloseTimeMs != null
      ? BigInt(Math.floor(sharedDuel.betCloseTimeMs / 1000))
      : fallbackBetCloseTs;
  const duelStartTs =
    sharedDuel.fightStartTimeMs != null
      ? BigInt(Math.floor(sharedDuel.fightStartTimeMs / 1000))
      : fallbackDuelStartTs;
  const participantAHash = keccak256(
    stringToHex(`${chain}:${sharedDuel.agent1Id}`),
  );
  const participantBHash = keccak256(
    stringToHex(`${chain}:${sharedDuel.agent2Id}`),
  );
  const existingOracleDuel = (await publicClient.readContract({
    address: runtime.duelOracleAddress as Address,
    abi: duelOutcomeOracleArtifact.abi,
    functionName: "getDuel",
    args: [duelKey],
  })) as {
    participantAHash?: Hash;
    participantBHash?: Hash;
  };
  const hasExistingOracleDuel =
    (existingOracleDuel.participantAHash != null &&
      existingOracleDuel.participantAHash !== ZERO_HASH) ||
    (existingOracleDuel.participantBHash != null &&
      existingOracleDuel.participantBHash !== ZERO_HASH);
  const existingMarket = (await publicClient.readContract({
    address: runtime.goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "getMarket",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as { exists?: boolean };
  console.log(
    `[stage-a-fixture][${chain}] existing market=${existingMarket?.exists === true ? "yes" : "no"} duelKey=${duelKey}`,
  );
  if (hasExistingOracleDuel) {
    console.log(
      `[stage-a-fixture][${chain}] reusing existing oracle duel duelKey=${duelKey}`,
    );
  } else {
    const upsertTransaction = await reporterWalletClient.writeContract({
      address: runtime.duelOracleAddress as Address,
      abi: duelOutcomeOracleArtifact.abi,
      functionName: "upsertDuel",
      args: [
        duelKey,
        participantAHash,
        participantBHash,
        betOpenTs,
        betCloseTs,
        duelStartTs,
        `https://hyperbet.win/e2e/${chain}/${duelId}`,
        2,
      ],
    });
    console.log(
      `[stage-a-fixture][${chain}] upsertDuel tx=${upsertTransaction} reporter=${reporterAccount.address}`,
    );
    await waitForEvmReceipt(publicClient, upsertTransaction);
  }

  if (!existingMarket?.exists) {
    const createMarketTransaction = await marketOperatorWalletClient.writeContract({
      address: runtime.goldClobAddress as Address,
      abi: goldClobArtifact.abi,
      functionName: "createMarketForDuel",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    console.log(
      `[stage-a-fixture][${chain}] createMarketForDuel tx=${createMarketTransaction} operator=${marketOperatorAccount.address}`,
    );
    await waitForEvmReceipt(publicClient, createMarketTransaction);
  }

  const marketKey = (await publicClient.readContract({
    address: runtime.goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  })) as Hash;

  const seedAmount = parseUnits(DEFAULT_EVM_SEED_ORDER_AMOUNT, 18);
  const seedNoCost = quoteCost(SELL_SIDE, DEFAULT_EVM_SEED_NO_PRICE, seedAmount);
  const seedYesCost = quoteCost(BUY_SIDE, DEFAULT_EVM_SEED_YES_PRICE, seedAmount);
  const seedNoFee = seedNoCost / 100n;
  const seedYesFee = seedYesCost / 100n;

  const seedNoTransaction = await matcherWalletClient.writeContract({
    address: runtime.goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      DEFAULT_EVM_SEED_NO_PRICE,
      seedAmount,
      ORDER_FLAG_GTC,
    ],
    value: seedNoCost + seedNoFee + seedNoFee,
  });
  console.log(
    `[stage-a-fixture][${chain}] seed NO order tx=${seedNoTransaction} matcher=${matcherAccount.address}`,
  );
  await waitForEvmReceipt(publicClient, seedNoTransaction);

  const seedYesTransaction = await matcherWalletClient.writeContract({
    address: runtime.goldClobAddress as Address,
    abi: goldClobArtifact.abi,
    functionName: "placeOrder",
    args: [
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      DEFAULT_EVM_SEED_YES_PRICE,
      seedAmount,
      ORDER_FLAG_GTC,
    ],
    value: seedYesCost + seedYesFee + seedYesFee,
  });
  console.log(
    `[stage-a-fixture][${chain}] seed YES order tx=${seedYesTransaction} matcher=${matcherAccount.address}`,
  );
  await waitForEvmReceipt(publicClient, seedYesTransaction);

  const envLines = dedupeEnvLines([
    ...(runtime.keeperUrl
      ? [
          `VITE_GAME_API_URL=${runtime.keeperUrl.replace(/\/$/, "")}`,
          `VITE_GAME_WS_URL=${deriveWsUrl(runtime.keeperUrl.replace(/\/$/, ""))}/ws`,
        ]
      : []),
    `VITE_EVM_PRIVATE_KEY=${canaryPrivateKey}`,
    `VITE_HEADLESS_EVM_PRIVATE_KEY=${canaryPrivateKey}`,
    `VITE_HEADLESS_EVM_ADDRESS=${userAccount.address}`,
    `VITE_E2E_EVM_PRIVATE_KEY=${canaryPrivateKey}`,
    `VITE_E2E_EVM_ADDRESS=${userAccount.address}`,
    `VITE_E2E_EVM_DUEL_KEY=${duelKey.replace(/^0x/i, "")}`,
    `VITE_E2E_EVM_DUEL_ID=${duelId}`,
  ]);

  const state: EvmFixtureState = {
    evmRpcUrl: runtime.rpcUrl,
    evmChainId: runtime.chainId,
    evmHeadlessAddress: userAccount.address,
    evmGoldTokenAddress: runtime.goldTokenAddress,
    evmGoldClobAddress: runtime.goldClobAddress,
    evmMatchId: duelId,
    evmDuelId: String(duelId),
    evmDuelKeyHex: duelKey,
    evmMarketKey: marketKey,
    evmOracleAddress: runtime.duelOracleAddress,
    evmCanaryPrivateKey: canaryPrivateKey,
    evmMatcherPrivateKey: matcherPrivateKey,
    evmReporterPrivateKey: reporterPrivateKey,
    evmMarketOperatorPrivateKey: marketOperatorPrivateKey,
    evmAdminPrivateKey: adminPrivateKey,
    evmPauserPrivateKey: pauserPrivateKey,
    evmFinalizerPrivateKey: finalizerPrivateKey,
    evmSeedNoPrice: DEFAULT_EVM_SEED_NO_PRICE,
    evmSeedYesPrice: DEFAULT_EVM_SEED_YES_PRICE,
    evmSeedOrderAmount: DEFAULT_EVM_SEED_ORDER_AMOUNT,
  };

  return {
    envLines,
    state,
    summary: {
      chain,
      duelId,
      duelKey,
      marketKey,
      headlessAddress: userAccount.address,
    },
  };
}

export async function writeStageAPublicFixture(options: {
  appDir: string;
  statePath: string;
  evmChain: AcceptanceEvmChain | null;
  env?: EnvMap;
}): Promise<void> {
  const env = options.env ?? process.env;
  console.log("[stage-a-fixture] building Solana public fixture");
  const solanaFixture = await buildStageASolanaPublicFixture(env);
  const solanaState = solanaFixture.state as SolanaFixtureState;
  const envLines = [...solanaFixture.envLines, ...buildSharedEvmConfigEnvLines(env)];
  const state: Record<string, unknown> = { ...solanaFixture.state };
  const summary: Record<string, unknown> = { solana: solanaFixture.summary };

  if (options.evmChain) {
    console.log(`[stage-a-fixture] resolving shared live duel for ${options.evmChain}`);
    const sharedDuel = await resolveSharedEvmDuelContext(solanaState, env);
    const evmFixture = await buildStageAEvmPublicFixture(
      options.evmChain,
      sharedDuel,
      env,
    );
    envLines.push(...evmFixture.envLines);
    Object.assign(state, evmFixture.state);
    summary.evm = evmFixture.summary;
  }

  const envPath = path.resolve(options.appDir, ".env.e2e");
  await fs.writeFile(
    envPath,
    `${dedupeEnvLines(envLines).join("\n")}\n`,
    "utf8",
  );
  await fs.writeFile(
    options.statePath,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
}
