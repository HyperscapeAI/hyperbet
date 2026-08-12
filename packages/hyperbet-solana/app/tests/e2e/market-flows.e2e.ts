import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
  type Route,
} from "@playwright/test";
import {
  type AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  cancelDuel,
  deriveClobVaultPda,
  deriveDuelStatePda,
  deriveMarketStatePda,
  deriveOracleConfigPda,
  ensureOracleReady,
  initializeCanonicalMarket,
  ORDER_BEHAVIOR_GTC,
  SIDE_ASK,
  SIDE_BID,
  deriveOrderPda,
  derivePriceLevelPda,
  deriveUserBalancePda,
  duelStatusBettingOpen,
  duelStatusLocked,
  finalizeDuelResult,
  marketSideA,
  proposeDuelResult,
  syncMarketFromDuel,
  upsertDuel,
  uniqueDuelKey,
  currentChainUnixTimestamp,
} from "../../../anchor/tests/clob-test-helpers";
import { confirmSignatureByPolling } from "../../../anchor/tests/test-anchor";
import { buildTestCompetitiveSnapshot } from "../../../keeper/src/testCompetitiveSnapshot";
import { parseDuelCancellationMetadata } from "../../../keeper/src/duelTerminalPolicy";
import { formatSolLamports } from "../../../../hyperbet-ui/src/lib/solanaOrderQuote";

type E2eState = {
  solanaRpcUrl?: string;
  solanaWsUrl?: string;
  bootstrapWalletPath?: string;
  clobUserBalance?: string;
  clobConfig?: string;
  clobMarketState?: string;
  clobDuelState?: string;
  clobTreasury?: string;
  clobMarketMaker?: string;
  clobVault?: string;
  currentDuelId?: string;
  currentDuelKeyHex?: string;
  currentBetOpenTimeMs?: number;
  currentBetCloseTimeMs?: number;
  currentFightStartTimeMs?: number;
  currentPhase?: string;
  currentDuelSource?: "synthetic_publish" | "real_hyperia";
  solanaTraderPublicKey?: string;
};

type UserBalanceAccount = {
  aShares?: unknown;
  bShares?: unknown;
  aLockedLamports?: unknown;
  bLockedLamports?: unknown;
  tradeTreasuryFeeLamports?: unknown;
  tradeMarketMakerFeeLamports?: unknown;
};

type MarketStateAccount = {
  nextOrderId?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
};

type PriceLevelAccount = {
  totalOpen?: unknown;
  headOrderId?: unknown;
  tailOrderId?: unknown;
};

type OrderAccount = {
  id?: unknown;
  marketState?: PublicKey;
  maker?: PublicKey;
  side?: unknown;
  price?: unknown;
  amount?: unknown;
  filled?: unknown;
  prevOrderId?: unknown;
  nextOrderId?: unknown;
  active?: boolean;
  continuationPending?: boolean;
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
    recovery: Array<{
      code: string;
      active: boolean;
    }>;
    markets: Array<{
      lifecycleStatus: string;
      marketRef: string | null;
    }>;
  } | null;
};

type SolanaCyclePhase = "ANNOUNCEMENT" | "COUNTDOWN" | "RESOLUTION";

type StreamingStateResponse = {
  cycle?: {
    cycleId?: string | null;
    duelId?: string | number | null;
    duelKeyHex?: string | null;
  } | null;
};

type DuelStateAccountSnapshot = {
  duelKey?: readonly number[];
  status?: unknown;
  winner?: unknown;
  betOpenTs?: unknown;
  betCloseTs?: unknown;
  duelStartTs?: unknown;
  metadataUri?: unknown;
};

type SolanaTraderFixture = {
  userBalanceAddress: PublicKey;
  duelKey: number[];
  duelKeyHex: string;
  duelId: string;
  duelState: PublicKey;
  marketState: PublicKey;
  marketStatus: string | null;
  marketWinner: string | null;
  duelStatus: string | null;
  pendingWinner: string | null;
  pendingProposedAt: number;
  finalizableAt: number | null;
  betOpenTs: number;
  betCloseTs: number;
  duelStartTs: number;
  aShares: bigint;
  bShares: bigint;
  aLockedLamports: bigint;
  bLockedLamports: bigint;
};

type HarnessControl = {
  controlPath: string;
  services: {
    keeper: {
      botHealthUrl: string;
    };
    solanaProxy: {
      faultControlPath: string;
    };
    hyperia?: {
      healthUrl: string;
    };
  };
};

type HyperiaAuthorityHealth = {
  ready?: boolean;
  sourceEpoch?: number;
  duelId?: string | null;
  duelKeyHex?: string | null;
  snapshotDigest?: string | null;
  phase?: string | null;
  outcome?: string | null;
  cancellationReason?: string | null;
  competitiveSnapshotPersisted?: boolean;
  competitiveSnapshotDiagnostic?: boolean | null;
};

type SolanaRpcFaultControl = {
  version: 1;
  mode: "hold_send_transaction_after_forward";
  state: "armed" | "observed";
  faultId: string;
  requiredAccount: string;
  requiredProgramId: string;
  armedAtMs: number;
  signature?: string;
  observedAtMs?: number;
  holdUntilMs?: number;
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
const E2E_DUEL_SOURCE =
  process.env.E2E_DUEL_SOURCE?.trim().toLowerCase() || "synthetic_publish";
const EXPECT_KEEPER_BOT =
  (process.env.E2E_EXPECT_KEEPER_BOT?.trim().toLowerCase() ?? "true") !==
  "false";
const REQUIRE_MATURED_SOLANA_WIN_CLAIM =
  (process.env.E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM?.trim().toLowerCase() ??
    "false") === "true";
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const fightOracleIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "fight_oracle.json"), "utf8"),
) as Idl;
const duelMarketIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "duel_market.json"), "utf8"),
) as Idl;
const PREPARED_LIVE_DUEL_MIN_OPEN_WINDOW_MS = 60_000;
const COMPETITIVE_SNAPSHOT_RECOVERY_WINDOW_ELAPSED_REASON =
  "competitive_snapshot_recovery_window_elapsed";

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function loadControl(): HarnessControl {
  return JSON.parse(fs.readFileSync(controlPath, "utf8")) as HarnessControl;
}

function armForwardedSolanaTransactionHold(
  control: HarnessControl,
  input: {
    faultId: string;
    requiredAccount: PublicKey;
    requiredProgramId: PublicKey;
  },
): void {
  const faultControlPath = control.services.solanaProxy.faultControlPath;
  if (!path.isAbsolute(faultControlPath)) {
    throw new Error("Solana RPC fault-control path must be absolute");
  }
  const payload: SolanaRpcFaultControl = {
    version: 1,
    mode: "hold_send_transaction_after_forward",
    state: "armed",
    faultId: input.faultId,
    requiredAccount: input.requiredAccount.toBase58(),
    requiredProgramId: input.requiredProgramId.toBase58(),
    armedAtMs: Date.now(),
  };
  fs.writeFileSync(faultControlPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

function readSolanaRpcFaultControl(
  control: HarnessControl,
): SolanaRpcFaultControl | null {
  try {
    return JSON.parse(
      fs.readFileSync(control.services.solanaProxy.faultControlPath, "utf8"),
    ) as SolanaRpcFaultControl;
  } catch {
    return null;
  }
}

function runProcessControl(
  control: HarnessControl,
  action: "start" | "kill" | "restart",
  service: "keeper" | "keeperBot" | "solanaProxy" | "hyperia" | "hyperiaClient",
): void {
  execFileSync(
    "bash",
    [processControlScriptPath, action, control.controlPath, service],
    {
      stdio: "inherit",
    },
  );
}

async function fetchHyperiaAuthorityHealth(
  request: APIRequestContext,
  control: HarnessControl,
): Promise<HyperiaAuthorityHealth> {
  const healthUrl = control.services.hyperia?.healthUrl?.trim() || "";
  if (!healthUrl) {
    throw new Error("real Hyperia authority health URL is missing");
  }
  const response = await request.get(healthUrl, { failOnStatusCode: false });
  if (!response.ok()) {
    throw new Error(
      `Hyperia authority health returned HTTP ${response.status()}`,
    );
  }
  return (await response.json()) as HyperiaAuthorityHealth;
}

async function currentHyperiaAuthorityEpoch(
  control: HarnessControl,
): Promise<number | null> {
  const healthUrl = control.services.hyperia?.healthUrl?.trim() || "";
  if (!healthUrl) {
    throw new Error("real Hyperia authority health URL is missing");
  }
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      headers: { connection: "close" },
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as HyperiaAuthorityHealth;
    return typeof health.sourceEpoch === "number" ? health.sourceEpoch : -1;
  } catch {
    return null;
  }
}

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };
const ORDER_PRICE = 500;
const SOLANA_PREDICTION_AMOUNT = "0.05";
const SEEDED_LIQUIDITY_LAMPORTS = 60_000_000n;
const MIN_LIQUIDITY_MAKER_LAMPORTS = SEEDED_LIQUIDITY_LAMPORTS;
const MIN_BOOTSTRAP_AUTHORITY_LAMPORTS = 20_000_000n;
const MIN_STAGE_A_PRIVILEGED_RESERVE_LAMPORTS = 15_000_000n;
const SOLANA_LAMPORT_TOP_UP_CUSHION = 5_000_000n;
const MAX_MATCH_ACCOUNTS = 100;
const E2E_TRADER_SEED = Uint8Array.from([
  88, 41, 190, 12, 77, 164, 231, 5, 199, 118, 43, 91, 16, 220, 58, 147, 9, 175,
  63, 204, 132, 54, 241, 28, 115, 67, 154, 210, 36, 143, 80, 11,
]);
const ASK_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  14, 22, 189, 71, 203, 44, 97, 156, 18, 240, 85, 132, 53, 199, 4, 220, 91, 11,
  144, 201, 32, 77, 165, 118, 246, 17, 63, 154, 208, 39, 121, 6,
]);
const BID_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  101, 33, 174, 9, 57, 218, 66, 140, 211, 45, 87, 16, 193, 24, 129, 204, 73,
  188, 12, 240, 61, 109, 173, 28, 142, 215, 54, 167, 80, 31, 199, 114,
]);
const E2E_SOLANA_AGENT_A = {
  id: "e2e-solana-agent-a",
  name: "Agent A",
  provider: "Hyperia",
  model: "alpha-local",
  hp: 80,
  maxHp: 100,
  combatLevel: 88,
  wins: 12,
  losses: 4,
  damageDealtThisFight: 148,
  rank: 1,
  headToHeadWins: 3,
  headToHeadLosses: 2,
  inventory: [],
  monologues: [],
};
const E2E_SOLANA_AGENT_B = {
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
  rank: 2,
  headToHeadWins: 2,
  headToHeadLosses: 3,
  inventory: [],
  monologues: [],
};

function deriveWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return httpUrl.replace(/^https:\/\//, "wss://");
  }
  if (httpUrl.startsWith("http://")) {
    return httpUrl.replace(/^http:\/\//, "ws://");
  }
  return httpUrl;
}

function resolveSolanaRpcWsUrl(rpcUrl: string, stateWsUrl?: string): string {
  return (
    stateWsUrl?.trim() ||
    process.env.SOLANA_ALCHEMY_WS_URL?.trim() ||
    process.env.ALCHEMY_SOLANA_WS_URL?.trim() ||
    process.env.SOLANA_RPC_WS_URL?.trim() ||
    process.env.SOLANA_WS_URL?.trim() ||
    process.env.ANCHOR_WS_URL?.trim() ||
    deriveWsUrl(rpcUrl)
  );
}

function createConfirmedConnection(
  rpcUrl: string,
  stateWsUrl?: string,
): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: resolveSolanaRpcWsUrl(rpcUrl, stateWsUrl),
  });
}

function loadKeypairFromPath(filepath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filepath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadBootstrapAuthority(state: E2eState): Keypair {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) {
    throw new Error("Missing bootstrapWalletPath in e2e state");
  }
  return loadKeypairFromPath(walletPath);
}

async function ensureStageASolanaRecipientLamportBuffer(
  connection: Connection,
  state: E2eState,
  recipient: PublicKey,
  minimumLamports: bigint,
): Promise<void> {
  const targetLamports = minimumLamports + SOLANA_LAMPORT_TOP_UP_CUSHION;
  let currentBalance = BigInt(
    await connection.getBalance(recipient, "confirmed"),
  );
  if (currentBalance >= targetLamports) {
    return;
  }

  const authority = loadBootstrapAuthority(state);
  const candidateEntries: Array<{
    label: string;
    signer: Keypair;
    reserveLamports: bigint;
  }> = [
    {
      label: "bootstrap-authority",
      signer: authority,
      reserveLamports: MIN_STAGE_A_PRIVILEGED_RESERVE_LAMPORTS,
    },
  ];
  const canaryPath = process.env.SOLANA_CANARY_KEYPAIR?.trim() || "";
  if (canaryPath && canaryPath !== state.bootstrapWalletPath?.trim()) {
    candidateEntries.push({
      label: "canary",
      signer: loadKeypairFromPath(canaryPath),
      reserveLamports: 100_000_000n,
    });
  }
  const marketMakerPath = process.env.MARKET_MAKER_KEYPAIR?.trim() || "";
  if (
    marketMakerPath &&
    marketMakerPath !== state.bootstrapWalletPath?.trim() &&
    marketMakerPath !== canaryPath
  ) {
    candidateEntries.push({
      label: "market-maker",
      signer: loadKeypairFromPath(marketMakerPath),
      reserveLamports: 10_000_000n,
    });
  }
  const oracleReporterPath = process.env.ORACLE_REPORTER_KEYPAIR?.trim() || "";
  if (
    oracleReporterPath &&
    oracleReporterPath !== state.bootstrapWalletPath?.trim() &&
    oracleReporterPath !== canaryPath &&
    oracleReporterPath !== marketMakerPath
  ) {
    candidateEntries.push({
      label: "oracle-reporter",
      signer: loadKeypairFromPath(oracleReporterPath),
      reserveLamports: 5_000_000n,
    });
  }
  candidateEntries.push({
    label: "seeded-ask-maker",
    signer: seededLiquidityMaker(SIDE_ASK),
    reserveLamports: MIN_LIQUIDITY_MAKER_LAMPORTS / 2n,
  });

  for (const candidate of candidateEntries) {
    if (currentBalance >= targetLamports) {
      break;
    }
    if (candidate.signer.publicKey.equals(recipient)) {
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
    const provider = createPollingProvider(connection, candidate.signer);
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: candidate.signer.publicKey,
          toPubkey: recipient,
          lamports: Number(transferLamports),
        }),
      ),
      [],
    );
    currentBalance = BigInt(
      await connection.getBalance(recipient, "confirmed"),
    );
  }

  if (currentBalance < targetLamports) {
    throw new Error(
      `Stage-A recipient underfunded: recipient=${recipient.toBase58()} balance=${currentBalance.toString()} minimum=${minimumLamports.toString()} target=${targetLamports.toString()}`,
    );
  }
}

async function ensureBootstrapAuthorityLamportBuffer(
  connection: Connection,
  state: E2eState,
  minimumLamports = MIN_BOOTSTRAP_AUTHORITY_LAMPORTS,
): Promise<void> {
  const authority = loadBootstrapAuthority(state);
  await ensureStageASolanaRecipientLamportBuffer(
    connection,
    state,
    authority.publicKey,
    minimumLamports,
  );
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function enumName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return typeof key === "string" && key.length > 0 ? key : null;
}

function seededLiquidityMaker(side: number): Keypair {
  return Keypair.fromSeed(
    side === SIDE_ASK ? ASK_LIQUIDITY_MAKER_SEED : BID_LIQUIDITY_MAKER_SEED,
  );
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
  const commitment = opts.preflightCommitment ?? opts.commitment ?? "confirmed";
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

function createPollingProvider(
  connection: Connection,
  keypair: Keypair,
): AnchorProvider {
  const provider = new AnchorProvider(connection, toWallet(keypair), {
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
  return provider;
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
  const response = await request.get(`${GAME_API_URL}/api/keeper/bot-health`);
  return (await response.json()) as KeeperBotHealthResponse;
}

async function waitForKeeperBotHealth(
  request: APIRequestContext,
  chainKey: string,
  marketRef: string | null,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const payload = await fetchBotHealth(request);
          return {
            ready: payload.ok,
            running: payload.running,
            chainKey: payload.health?.chainKey ?? null,
            hasRecovery: Array.isArray(payload.health?.recovery),
            hasSnapshot: payload.health != null,
            recoveredMarket:
              marketRef == null ||
              Boolean(
                payload.health?.markets.some(
                  (market) =>
                    market.marketRef === marketRef &&
                    market.lifecycleStatus === "OPEN",
                ),
              ),
          };
        } catch {
          return {
            ready: false,
            running: false,
            chainKey: null,
            hasRecovery: false,
            hasSnapshot: false,
            recoveredMarket: false,
          };
        }
      },
      {
        timeout: 90_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toEqual({
      ready: true,
      running: EXPECT_KEEPER_BOT,
      chainKey,
      hasRecovery: true,
      hasSnapshot: true,
      recoveredMarket: true,
    });
}

function findPredictionMarket(
  payload: PredictionMarketsResponse,
  chainKey: string,
) {
  return payload.markets.find((market) => market.chainKey === chainKey) ?? null;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConfirmedSolanaTimestamp(
  connection: Connection,
  minimumUnixTimestamp: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastObservedTimestamp: number | null = null;
  while (Date.now() < deadline) {
    const slot = await connection.getSlot("confirmed");
    lastObservedTimestamp = await connection.getBlockTime(slot);
    if (
      lastObservedTimestamp != null &&
      lastObservedTimestamp >= minimumUnixTimestamp
    ) {
      return lastObservedTimestamp;
    }
    await sleepMs(250);
  }
  throw new Error(
    `Timed out waiting for confirmed Solana time >= ${minimumUnixTimestamp}; last observed ${lastObservedTimestamp ?? "unavailable"}`,
  );
}

function normalizePreparedSolanaDuelKey(
  duelKeyHex: string | undefined,
): string {
  const normalized = duelKeyHex?.trim().replace(/^0x/i, "").toLowerCase() || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Missing or invalid currentDuelKeyHex in Solana e2e state`);
  }
  return normalized;
}

async function waitForPreparedRealSolanaOpenMarket(
  request: APIRequestContext,
  state: E2eState,
): Promise<{
  duelKey: number[];
  duelKeyHex: string;
  duelId: string;
  duelState: PublicKey;
  marketState: PublicKey;
  betOpenTs: number;
  betCloseTs: number;
  duelStartTs: number;
}> {
  if (E2E_DUEL_SOURCE !== "real_hyperia") {
    throw new Error(
      `Prepared Solana live market requires real_hyperia duel source, got ${E2E_DUEL_SOURCE}`,
    );
  }
  const duelId = (state.currentDuelId || "").trim();
  if (!duelId) {
    throw new Error("Missing currentDuelId in Solana e2e state");
  }
  const duelKeyHex = normalizePreparedSolanaDuelKey(state.currentDuelKeyHex);
  const duelState = new PublicKey(state.clobDuelState || "");
  const marketState = new PublicKey(state.clobMarketState || "");
  const betOpenTs =
    typeof state.currentBetOpenTimeMs === "number"
      ? Math.floor(state.currentBetOpenTimeMs / 1000)
      : Math.floor(Date.now() / 1000) - 60;
  const betCloseTs =
    typeof state.currentBetCloseTimeMs === "number"
      ? Math.floor(state.currentBetCloseTimeMs / 1000)
      : Math.floor(Date.now() / 1000) + 600;
  const duelStartTs =
    typeof state.currentFightStartTimeMs === "number"
      ? Math.floor(state.currentFightStartTimeMs / 1000)
      : betCloseTs + 60;
  const deadline = Date.now() + 180_000;
  let lastError = `prepared solana duel ${duelId} is not active yet`;

  while (Date.now() < deadline) {
    try {
      const predictionMarkets = await fetchPredictionMarkets(request);
      const solanaMarket = findPredictionMarket(predictionMarkets, "solana");
      if (!solanaMarket) {
        lastError =
          "active Solana market is missing from prediction-markets API";
        await sleepMs(1_000);
        continue;
      }
      if ((predictionMarkets.duel.duelId || "").trim() !== duelId) {
        lastError = `prepared Solana duel drifted to ${predictionMarkets.duel.duelId || "missing duel id"}`;
        await sleepMs(1_000);
        continue;
      }
      if (
        (predictionMarkets.duel.duelKey || "").trim().toLowerCase() !==
        duelKeyHex
      ) {
        lastError = `prepared Solana duel key drifted to ${predictionMarkets.duel.duelKey || "missing duel key"}`;
        await sleepMs(1_000);
        continue;
      }
      if ((solanaMarket.marketRef || "").trim() !== marketState.toBase58()) {
        lastError = `prepared Solana market drifted to ${solanaMarket.marketRef || "missing market ref"}`;
        await sleepMs(1_000);
        continue;
      }
      if (solanaMarket.lifecycleStatus !== "OPEN") {
        lastError = `prepared Solana market ${duelId} is ${solanaMarket.lifecycleStatus || "missing lifecycle"}`;
        await sleepMs(1_000);
        continue;
      }
      const betCloseTimeMs =
        typeof predictionMarkets.duel.betCloseTime === "number"
          ? predictionMarkets.duel.betCloseTime
          : (state.currentBetCloseTimeMs ?? null);
      if (
        betCloseTimeMs != null &&
        betCloseTimeMs - Date.now() < PREPARED_LIVE_DUEL_MIN_OPEN_WINDOW_MS
      ) {
        lastError = `prepared Solana duel ${duelId} has less than ${PREPARED_LIVE_DUEL_MIN_OPEN_WINDOW_MS}ms left in the betting window`;
        await sleepMs(1_000);
        continue;
      }
      return {
        duelKey: Array.from(Buffer.from(duelKeyHex, "hex")),
        duelKeyHex,
        duelId,
        duelState,
        marketState,
        betOpenTs,
        betCloseTs,
        duelStartTs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleepMs(1_000);
    }
  }

  throw new Error(
    `Timed out waiting for the prepared live Solana duel on the keeper API: ${lastError}`,
  );
}

async function retireSyntheticSolanaOpenMarkets(
  request: APIRequestContext,
  authority: Keypair,
  fightProgram: Program<Idl>,
  clobProgram: Program<Idl>,
): Promise<void> {
  assertSyntheticDuelSource("retireSyntheticSolanaOpenMarkets");
  const streamState = await fetchJson<StreamingStateResponse>(
    request,
    "/api/streaming/state",
  );
  const currentDuelKeyHex =
    streamState.cycle?.duelKeyHex?.trim().replace(/^0x/i, "").toLowerCase() ??
    null;
  const duelAccounts = (await fightProgram.account.duelState.all()) as Array<{
    publicKey: PublicKey;
    account: DuelStateAccountSnapshot;
  }>;
  const retired: Array<{
    duelKey: number[];
    duelKeyHex: string;
    betOpenTs: number;
    betCloseTs: number;
    duelStartTs: number;
    marketState: PublicKey | null;
  }> = [];

  for (const { publicKey: duelState, account } of duelAccounts) {
    const status = enumName(account.status);
    if (!status || !["scheduled", "bettingOpen", "locked"].includes(status)) {
      continue;
    }
    const duelKey = Array.from(account.duelKey ?? []);
    if (duelKey.length !== 32) {
      throw new Error(
        `Synthetic duel ${duelState.toBase58()} has an invalid on-chain key`,
      );
    }
    const duelKeyHex = Buffer.from(duelKey).toString("hex");
    const derivedDuelState = deriveDuelStatePda(
      fightProgram.programId,
      duelKey,
    );
    if (!derivedDuelState.equals(duelState)) {
      throw new Error(
        `Synthetic duel ${duelKeyHex} is not stored at its canonical PDA`,
      );
    }
    const marketState = deriveMarketStatePda(clobProgram.programId, duelState);
    const marketAccount =
      await clobProgram.account.marketState.fetchNullable(marketState);
    if (duelKeyHex !== currentDuelKeyHex) {
      await cancelDuel(
        fightProgram as never,
        authority,
        duelKey,
        canonicalDuelMetadata(
          `fixture-retired-${duelKeyHex.slice(0, 12)}`,
          duelKeyHex,
          "cancelled",
        ),
      );
      if (marketAccount) {
        await syncMarketFromDuel(clobProgram as never, marketState, duelState);
      }
    }
    retired.push({
      duelKey,
      duelKeyHex,
      betOpenTs: Number(bnLikeToBigInt(account.betOpenTs)),
      betCloseTs: Number(bnLikeToBigInt(account.betCloseTs)),
      duelStartTs: Number(bnLikeToBigInt(account.duelStartTs)),
      marketState: marketAccount ? marketState : null,
    });
  }

  const retiredCurrent = retired.find(
    (duel) => duel.duelKeyHex === currentDuelKeyHex,
  );
  if (retiredCurrent) {
    const duelId =
      streamState.cycle?.duelId != null
        ? String(streamState.cycle.duelId)
        : `fixture-retired-${retiredCurrent.duelKeyHex.slice(0, 12)}`;
    await publishSolanaCycleState(request, {
      cycleId:
        streamState.cycle?.cycleId?.trim() || `fixture-retired-${duelId}`,
      duelId,
      duelKeyHex: retiredCurrent.duelKeyHex,
      betOpenTs: retiredCurrent.betOpenTs,
      betCloseTs: retiredCurrent.betCloseTs,
      duelStartTs: retiredCurrent.duelStartTs,
      phase: "RESOLUTION",
      winner: "NONE",
      duelEndTs: await currentChainUnixTimestamp(
        fightProgram.provider.connection,
      ),
      cancellationReason: "fixture_cancelled",
    });
  }

  if (retired.length === 0) {
    return;
  }
  const retiredMarketRefs = new Set(
    retired
      .map((duel) => duel.marketState?.toBase58() ?? null)
      .filter((marketRef): marketRef is string => marketRef != null),
  );
  await expect
    .poll(
      async () => {
        const payload = await fetchBotHealth(request);
        const activeRetiredMarkets =
          payload.health?.markets.filter(
            (market) =>
              market.marketRef != null &&
              retiredMarketRefs.has(market.marketRef) &&
              !["CANCELLED", "RESOLVED"].includes(market.lifecycleStatus),
          ).length ?? retiredMarketRefs.size;
        const activeRecovery = payload.health?.recovery
          .filter((entry) => entry.active)
          .map((entry) => entry.code)
          .sort() ?? ["missing-health"];
        return {
          running: payload.running,
          activeRetiredMarkets,
          activeRecovery,
        };
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toEqual({
      running: EXPECT_KEEPER_BOT,
      activeRetiredMarkets: 0,
      activeRecovery: [],
    });
}

async function createFreshSolanaOpenMarket(
  request: APIRequestContext,
  state: E2eState,
  authority: Keypair,
  fightProgram: Program<Idl>,
  clobProgram: Program<Idl>,
  label: string,
  options?: {
    betCloseOffsetSeconds?: number;
    duelStartOffsetSeconds?: number;
  },
): Promise<{
  duelKey: number[];
  duelKeyHex: string;
  duelId: string;
  duelState: PublicKey;
  marketState: PublicKey;
  betOpenTs: number;
  betCloseTs: number;
  duelStartTs: number;
}> {
  if (E2E_DUEL_SOURCE === "real_hyperia") {
    return waitForPreparedRealSolanaOpenMarket(request, state);
  }
  await retireSyntheticSolanaOpenMarkets(
    request,
    authority,
    fightProgram,
    clobProgram,
  );
  const duelKey = uniqueDuelKey(label);
  const duelKeyHex = Buffer.from(duelKey).toString("hex");
  const duelId = `${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const betOpenTs = now - 60;
  const betCloseTs = now + (options?.betCloseOffsetSeconds ?? 600);
  const duelStartTs = Math.max(
    betCloseTs,
    now + (options?.duelStartOffsetSeconds ?? 660),
  );
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
      metadataUri: canonicalDuelMetadata(duelId, duelKeyHex, "open"),
    },
  );
  const derivedMarketState = deriveMarketStatePda(
    clobProgram.programId,
    duelState,
  );
  let marketState = derivedMarketState;
  try {
    ({ marketState } = await initializeCanonicalMarket(
      clobProgram as never,
      authority,
      duelState,
      duelKey,
      new PublicKey(state.clobConfig || ""),
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use/i.test(message)) {
      throw error;
    }
    marketState = derivedMarketState;
  }
  await syncMarketFromDuel(clobProgram as never, marketState, duelState);
  await publishSolanaCycleState(request, {
    cycleId: `gate10-solana-${duelId}`,
    duelId,
    duelKeyHex,
    betOpenTs,
    betCloseTs,
    duelStartTs,
    phase: "ANNOUNCEMENT",
    winner: "NONE",
  });
  await waitForKeeperBotHealth(request, "solana", marketState.toBase58());

  return {
    duelKey,
    duelKeyHex,
    duelId,
    duelState,
    marketState,
    betOpenTs,
    betCloseTs,
    duelStartTs,
  };
}

function canonicalDuelMetadata(
  duelId: string,
  duelKeyHex: string,
  lifecycleEvent: string,
): string {
  return JSON.stringify({
    duelId,
    duelKeyHex,
    lifecycleEvent,
    source: "hyperia-e2e",
  });
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

function canonicalDuelIdFromMetadata(
  metadata: unknown,
  duelKeyHex: string,
): string {
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const duelId =
        typeof parsed.duelId === "string" ? parsed.duelId.trim() : "";
      const metadataDuelKey =
        typeof parsed.duelKeyHex === "string"
          ? parsed.duelKeyHex.trim().replace(/^0x/i, "").toLowerCase()
          : "";
      if (duelId && metadataDuelKey === duelKeyHex) {
        return duelId;
      }
    } catch {
      // The explicit error below keeps fixture identity fail-closed.
    }
  }
  throw new Error(
    `Solana fixture ${duelKeyHex} is missing canonical duelId metadata`,
  );
}

function assertSyntheticDuelSource(action: string): void {
  if (E2E_DUEL_SOURCE === "synthetic_publish") {
    return;
  }
  throw new Error(
    `${action} requires synthetic_publish duel source, got ${E2E_DUEL_SOURCE}`,
  );
}

async function publishSolanaCycleState(
  request: APIRequestContext,
  args: {
    cycleId: string;
    duelId: string;
    duelKeyHex: string;
    betOpenTs: number;
    betCloseTs: number;
    duelStartTs: number;
    phase: SolanaCyclePhase;
    winner: "A" | "B" | "NONE";
    duelEndTs?: number | null;
    outcome?: "win" | "draw" | "cancelled" | null;
    cancellationReason?: string | null;
  },
): Promise<void> {
  assertSyntheticDuelSource("publishSolanaCycleState");
  const nowMs = Date.now();
  const countdownSeconds =
    args.phase === "ANNOUNCEMENT"
      ? Math.max(0, args.betCloseTs - Math.floor(nowMs / 1000))
      : args.phase === "COUNTDOWN"
        ? Math.max(0, args.duelStartTs - Math.floor(nowMs / 1000))
        : 0;
  const winnerAgent =
    args.winner === "A"
      ? E2E_SOLANA_AGENT_A
      : args.winner === "B"
        ? E2E_SOLANA_AGENT_B
        : null;
  const isDraw = args.outcome === "draw";
  const competitiveSnapshot = buildTestCompetitiveSnapshot({
    cycleId: args.cycleId,
    duelId: args.duelId,
    duelKey: args.duelKeyHex,
    betOpenTime: args.betOpenTs * 1000,
    betCloseTime: args.betCloseTs * 1000,
    agent1: E2E_SOLANA_AGENT_A,
    agent2: E2E_SOLANA_AGENT_B,
  });

  await postJson<{ ok: boolean; seq: number }>(
    request,
    "/api/streaming/state/publish",
    {
      cycle: {
        cycleId: args.cycleId,
        phase: args.phase,
        duelId: args.duelId,
        duelKeyHex: args.duelKeyHex,
        cycleStartTime: nowMs - 90_000,
        phaseStartTime: nowMs - 5_000,
        phaseEndTime:
          args.phase === "RESOLUTION"
            ? nowMs + 5_000
            : (args.phase === "ANNOUNCEMENT"
                ? args.betCloseTs
                : args.duelStartTs) * 1000,
        betOpenTime: args.betOpenTs * 1000,
        betCloseTime: args.betCloseTs * 1000,
        fightStartTime: args.duelStartTs * 1000,
        duelEndTime: args.duelEndTs != null ? args.duelEndTs * 1000 : null,
        ...competitiveSnapshot,
        countdown: countdownSeconds,
        timeRemaining: countdownSeconds * 1000,
        winnerId: winnerAgent?.id ?? null,
        winnerName: winnerAgent?.name ?? null,
        outcome:
          args.outcome !== undefined
            ? args.outcome
            : args.cancellationReason
              ? "cancelled"
              : winnerAgent
                ? "win"
                : null,
        cancellationReason: args.cancellationReason ?? (isDraw ? "draw" : null),
        winReason: winnerAgent ? "kill" : isDraw ? "draw" : null,
        seed: winnerAgent || isDraw ? "42" : null,
        replayHash: winnerAgent || isDraw ? "ab".repeat(32) : null,
        agent1: E2E_SOLANA_AGENT_A,
        agent2: E2E_SOLANA_AGENT_B,
        arenaPositions: {
          agent1: [-1, 0, 0],
          agent2: [1, 0, 0],
        },
      },
      leaderboard: [],
      cameraTarget: null,
    },
  );
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

async function confirmSolanaOrder(page: Page): Promise<void> {
  for (let quoteAttempt = 0; quoteAttempt < 2; quoteAttempt += 1) {
    const confirmation = page.getByRole("dialog", {
      name: /confirm sol order/i,
    });
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await expect(confirmation).toContainText("Maximum wallet funding required");
    await expect(confirmation).toContainText("not automatically resubmitted");
    const confirmButton = confirmation.getByRole("button", {
      name: /confirm and sign/i,
    });
    await expect(confirmButton).toBeEnabled();
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: /back to edit/i }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirmButton).toBeFocused();

    const trackingAttempts: string[] = [];
    let trackingResponse: Response | null = null;
    const recordTrackingAttempt = (response: Response): void => {
      if (!response.url().includes("/api/arena/bet/record-external")) return;
      if (response.status() !== 425 && response.status() !== 503) {
        trackingResponse ??= response;
      }
      void response
        .json()
        .then(
          (payload: {
            verificationCode?: unknown;
            verificationRpc?: unknown;
            verificationIndex?: unknown;
          }) => {
            const verificationCode =
              typeof payload.verificationCode === "string"
                ? payload.verificationCode
                : "none";
            const verificationRpc =
              typeof payload.verificationRpc === "string"
                ? payload.verificationRpc
                : "none";
            const verificationIndex =
              payload.verificationIndex &&
              typeof payload.verificationIndex === "object"
                ? JSON.stringify(payload.verificationIndex)
                : "none";
            trackingAttempts.push(
              `${response.status()}:${verificationCode}@${verificationRpc}#${verificationIndex}`,
            );
            if (trackingAttempts.length > 12) trackingAttempts.shift();
          },
        )
        .catch(() => {
          trackingAttempts.push(`${response.status()}:unreadable`);
          if (trackingAttempts.length > 12) trackingAttempts.shift();
        });
    };
    page.on("response", recordTrackingAttempt);

    let quoteBecameStale = false;
    try {
      await confirmButton.click();
      await expect(confirmation).toHaveCount(0, { timeout: 45_000 });
      const feedback = page
        .getByTestId("solana-order-transaction-feedback")
        .first();
      const readSubmissionOutcome = async (): Promise<string> => {
        const text = ((await feedback.textContent().catch(() => "")) || "")
          .trim()
          .replace(/\s+/g, " ");
        if (/Order confirmed on-chain/i.test(text)) return "confirmed";
        if (/order book or fee terms changed/i.test(text)) return "stale";
        const state = await feedback
          .getAttribute("data-state")
          .catch(() => null);
        return state === "error" && text ? `error:${text}` : "pending";
      };
      await expect
        .poll(readSubmissionOutcome, {
          timeout: 30_000,
          intervals: [100, 250, 500],
        })
        .not.toBe("pending");
      const submissionOutcome = await readSubmissionOutcome();
      if (submissionOutcome === "stale") {
        await expect(
          feedback.getByTestId("solana-order-transaction-signature"),
          "a stale quote must be rejected before signature or submission",
        ).toHaveCount(0);
        quoteBecameStale = true;
      } else {
        if (submissionOutcome.startsWith("error:")) {
          throw new Error(submissionOutcome.slice("error:".length));
        }
        await expect(
          feedback.getByTestId("solana-order-transaction-signature"),
        ).toHaveText(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
        try {
          await expect
            .poll(() => trackingResponse?.status() ?? null, {
              timeout: 70_000,
              intervals: [100, 250, 500, 1_000],
            })
            .not.toBeNull();
        } catch (error) {
          throw new Error(
            `Timed out waiting for a terminal external-bet record response; recent attempts: ${trackingAttempts.join(", ") || "none"}`,
            { cause: error },
          );
        }
        const terminalResponse = trackingResponse;
        if (!terminalResponse) {
          throw new Error("External-bet tracking completed without a response");
        }
        const trackingPayload = (await terminalResponse.json()) as {
          ok?: unknown;
          error?: unknown;
        };
        expect({
          status: terminalResponse.status(),
          ok: trackingPayload.ok ?? null,
          error: trackingPayload.error ?? null,
        }).toEqual({ status: 200, ok: true, error: null });
        return;
      }
    } finally {
      page.off("response", recordTrackingAttempt);
    }

    if (!quoteBecameStale || quoteAttempt > 0) {
      throw new Error("The refreshed Solana order quote did not remain stable");
    }
    const feedback = page
      .getByTestId("solana-order-transaction-feedback")
      .first();
    await feedback
      .getByRole("button", { name: /review latest quote/i })
      .click();
    await expect(feedback).toHaveCount(0, { timeout: 30_000 });
    const submitButton = page.getByTestId("prediction-submit");
    await expect(submitButton).toBeEnabled({ timeout: 60_000 });
    await submitButton.click({ force: true });
  }
}

async function confirmSolanaManagedOrder(
  page: Page,
  input: {
    orderId: bigint;
    action: "CANCEL" | "RECLAIM" | "CLOSE_FILLED";
    outcomeText: string;
    remainingText: string;
    refundText?: string;
    rentText: string;
    grossCreditText: string;
    historyEntry?: Locator;
  },
): Promise<string> {
  const isCancellation = input.action === "CANCEL";
  const isFilledCleanup = input.action === "CLOSE_FILLED";
  if (input.historyEntry) {
    await expect(input.historyEntry).toBeVisible({ timeout: 30_000 });
    await expect(input.historyEntry).toContainText(
      `Order #${input.orderId.toString()}`,
    );
    await input.historyEntry
      .getByRole("button", {
        name: isFilledCleanup
          ? /recover order rent/i
          : isCancellation
            ? /manage open order/i
            : /reclaim resting order/i,
      })
      .click();
  } else {
    const managedOrderCard = page.getByTestId(
      `solana-managed-order-${input.orderId.toString()}`,
    );
    await expect(managedOrderCard).toBeVisible({ timeout: 30_000 });
    await expect(managedOrderCard).toContainText(input.outcomeText);
    await expect(managedOrderCard).toContainText(input.remainingText);
    if (input.refundText) {
      await expect(managedOrderCard).toContainText(input.refundText);
    }
    await expect(managedOrderCard).toContainText(input.rentText);
    await expect(managedOrderCard).toContainText(input.grossCreditText);
    await expect(page.getByTestId("solana-managed-orders")).toContainText(
      "this Order account's rent return to the original maker",
    );
    await expect(page.getByTestId("solana-managed-orders")).toContainText(
      "shared PriceLevel rent is excluded",
    );

    const actionLabel = isCancellation
      ? `cancel order #${input.orderId}`
      : isFilledCleanup
        ? `recover filled-order rent #${input.orderId}`
        : `reclaim resting order #${input.orderId}`;
    await managedOrderCard
      .getByRole("button", { name: new RegExp(actionLabel, "i") })
      .click();
  }

  const confirmation = page.getByRole("dialog", {
    name: isCancellation
      ? /confirm order cancellation/i
      : isFilledCleanup
        ? /confirm filled-order rent recovery/i
        : /confirm resting-order reclaim/i,
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(`#${input.orderId}`);
  await expect(confirmation).toContainText(input.outcomeText);
  await expect(confirmation).toContainText(input.remainingText);
  if (input.refundText) {
    await expect(confirmation).toContainText(input.refundText);
  }
  await expect(confirmation).toContainText(input.rentText);
  await expect(confirmation).toContainText(input.grossCreditText);
  await expect(confirmation).toContainText(
    "rent returns only to its original maker",
  );
  await expect(confirmation).toContainText(
    "shared PriceLevel rent is excluded",
  );
  const confirmButton = confirmation.getByRole("button", {
    name: isCancellation
      ? /confirm cancellation and sign/i
      : isFilledCleanup
        ? /confirm rent recovery and sign/i
        : /confirm reclaim and sign/i,
  });
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    confirmation.getByRole("button", { name: /back to orders/i }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmButton).toBeFocused();
  await confirmButton.click();
  await expect(confirmation).toHaveCount(0, { timeout: 45_000 });

  const feedback = page
    .getByTestId("solana-managed-order-transaction-feedback")
    .first();
  await expect(feedback).toContainText(
    isCancellation
      ? "Order cancellation confirmed on-chain"
      : isFilledCleanup
        ? "Filled-order rent recovery confirmed on-chain"
        : "Resting-order reclaim confirmed on-chain",
    { timeout: 45_000 },
  );
  const signature = (
    (await feedback
      .getByTestId("solana-managed-order-transaction-signature")
      .textContent()) ?? ""
  ).trim();
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  return signature;
}

async function expectSolanaSettlementReceipt(
  page: Page,
  expectedLabel: RegExp,
): Promise<string> {
  const feedback = page
    .getByTestId("solana-settlement-transaction-feedback")
    .first();
  await expect(feedback).toContainText(expectedLabel, { timeout: 45_000 });
  const signatureLocator = feedback.getByTestId(
    "solana-settlement-transaction-signature",
  );
  await expect(signatureLocator).toHaveText(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  return ((await signatureLocator.textContent()) ?? "").trim();
}

async function gotoApp(
  page: Page,
  options: {
    e2eSolanaDuelKey?: string | null;
    e2eSolanaDuelId?: string | null;
    e2eSolanaMarketRef?: string | null;
  } = {},
): Promise<void> {
  const params = new URLSearchParams({ debug: "1" });
  if (options.e2eSolanaDuelKey) {
    params.set(
      "e2eSolanaDuelKey",
      options.e2eSolanaDuelKey.replace(/^0x/i, ""),
    );
  }
  if (options.e2eSolanaDuelId) {
    params.set("e2eSolanaDuelId", options.e2eSolanaDuelId);
  }
  if (options.e2eSolanaMarketRef) {
    params.set("e2eSolanaMarketRef", options.e2eSolanaMarketRef);
  }
  const appUrl = `/?${params.toString()}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
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
              bodyText.includes("HYPERIA DUEL ARENA") ||
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

async function placeE2eTraderRestingOrder(
  connection: Connection,
  state: E2eState,
  input: {
    marketState: PublicKey;
    duelState: PublicKey;
    side: number;
    price: number;
    amount: bigint;
  },
): Promise<{
  orderId: bigint;
  orderAddress: PublicKey;
  priceLevel: PublicKey;
}> {
  const trader = Keypair.fromSeed(E2E_TRADER_SEED);
  if (trader.publicKey.toBase58() !== state.solanaTraderPublicKey) {
    throw new Error("E2E trader fixture does not match the connected wallet");
  }
  const provider = createPollingProvider(connection, trader);
  const clobProgram = new Program(duelMarketIdl, provider);
  const marketAccount = (await clobProgram.account.marketState.fetch(
    input.marketState,
  )) as MarketStateAccount;
  const orderId = bnLikeToBigInt(marketAccount.nextOrderId);
  if (orderId <= 0n)
    throw new Error("Missing next order id for trader fixture");
  const orderAddress = deriveOrderPda(
    clobProgram.programId,
    input.marketState,
    orderId,
  );
  const priceLevel = derivePriceLevelPda(
    clobProgram.programId,
    input.marketState,
    input.side,
    input.price,
  );
  const level = (await clobProgram.account.priceLevel.fetchNullable(
    priceLevel,
  )) as PriceLevelAccount | null;
  const tailOrderId = bnLikeToBigInt(level?.tailOrderId);
  const remainingAccounts: AccountMeta[] =
    tailOrderId > 0n
      ? [
          {
            pubkey: deriveOrderPda(
              clobProgram.programId,
              input.marketState,
              tailOrderId,
            ),
            isSigner: false,
            isWritable: true,
          },
        ]
      : [];

  await clobProgram.methods
    .placeOrder(
      new BN(orderId.toString()),
      input.side,
      input.price,
      new BN(input.amount.toString()),
      ORDER_BEHAVIOR_GTC,
    )
    .accountsPartial({
      marketState: input.marketState,
      duelState: input.duelState,
      userBalance: deriveUserBalancePda(
        clobProgram.programId,
        input.marketState,
        trader.publicKey,
      ),
      newOrder: orderAddress,
      restingLevel: priceLevel,
      config: new PublicKey(state.clobConfig || ""),
      treasury: new PublicKey(state.clobTreasury || ""),
      marketMaker: new PublicKey(state.clobMarketMaker || ""),
      vault: deriveClobVaultPda(clobProgram.programId, input.marketState),
      user: trader.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([trader])
    .rpc();

  return { orderId, orderAddress, priceLevel };
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
  const authority = loadBootstrapAuthority(state);
  const authorityProvider = createPollingProvider(connection, authority);
  const maker = seededLiquidityMaker(side);
  const provider = createPollingProvider(connection, maker);
  const clobProgram = new Program(duelMarketIdl, provider);
  const marketState =
    overrides?.marketState ?? new PublicKey(state.clobMarketState || "");
  const duelState =
    overrides?.duelState ?? new PublicKey(state.clobDuelState || "");
  const vault =
    overrides?.vault ?? deriveClobVaultPda(clobProgram.programId, marketState);
  const clobAccounts = clobProgram.account as Record<
    string,
    AccountNamespaceFetcher
  >;
  const hasExecutableLiquidity = (
    marketAccount: MarketStateAccount,
  ): boolean => {
    const bestBid = Number(marketAccount.bestBid ?? 0);
    const bestAsk = Number(marketAccount.bestAsk ?? 1000);
    if (side === SIDE_ASK) {
      return bestAsk > 0 && bestAsk <= ORDER_PRICE;
    }
    return bestBid >= ORDER_PRICE && bestBid < 1000;
  };

  const buildPlaceOrderRemainingAccounts = async (
    amount: bigint,
  ): Promise<AccountMeta[]> => {
    const metas: AccountMeta[] = [];
    const marketAccount = (await clobAccounts.marketState.fetch(
      marketState,
    )) as MarketStateAccount;
    const oppositeSide = side === SIDE_BID ? SIDE_ASK : SIDE_BID;
    let remaining = amount;
    let boundary =
      side === SIDE_BID
        ? Number(marketAccount.bestAsk ?? 1000)
        : Number(marketAccount.bestBid ?? 0);
    let matches = 0;

    while (remaining > 0n && matches < MAX_MATCH_ACCOUNTS) {
      const crosses =
        side === SIDE_BID
          ? boundary <= ORDER_PRICE && boundary > 0 && boundary < 1000
          : boundary >= ORDER_PRICE && boundary > 0 && boundary < 1000;
      if (!crosses) break;

      const levelPda = derivePriceLevelPda(
        clobProgram.programId,
        marketState,
        oppositeSide,
        boundary,
      );
      const level = (await clobProgram.account.priceLevel.fetchNullable(
        levelPda,
      )) as PriceLevelAccount | null;
      if (!level) break;

      metas.push({
        pubkey: levelPda,
        isSigner: false,
        isWritable: true,
      });

      const levelOpen = bnLikeToBigInt(level.totalOpen);
      let currentHead = bnLikeToBigInt(level.headOrderId);
      let currentLevelOpen = levelOpen;
      if (levelOpen === 0n || currentHead === 0n) {
        boundary = side === SIDE_BID ? boundary + 1 : boundary - 1;
        matches += 1;
        continue;
      }

      while (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
        const orderPda = deriveOrderPda(
          clobProgram.programId,
          marketState,
          currentHead,
        );
        const order = (await clobProgram.account.order.fetch(
          orderPda,
        )) as OrderAccount;
        const makerBalancePda = deriveUserBalancePda(
          clobProgram.programId,
          marketState,
          order.maker as PublicKey,
        );

        metas.push(
          {
            pubkey: orderPda,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: makerBalancePda,
            isSigner: false,
            isWritable: true,
          },
        );

        const orderRemaining =
          bnLikeToBigInt(order.amount) - bnLikeToBigInt(order.filled);
        if (orderRemaining <= 0n || !order.active) break;

        if (orderRemaining >= remaining) {
          remaining = 0n;
          break;
        }

        remaining -= orderRemaining;
        currentLevelOpen -= orderRemaining;
        currentHead = bnLikeToBigInt(order.nextOrderId);
        matches += 1;
        if (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
          metas.push({
            pubkey: levelPda,
            isSigner: false,
            isWritable: true,
          });
        }
      }

      boundary = side === SIDE_BID ? boundary + 1 : boundary - 1;
      matches += 1;
    }

    const restingLevelPda = derivePriceLevelPda(
      clobProgram.programId,
      marketState,
      side,
      ORDER_PRICE,
    );
    const restingLevel =
      await clobProgram.account.priceLevel.fetchNullable(restingLevelPda);
    if (restingLevel && bnLikeToBigInt(restingLevel.tailOrderId) > 0n) {
      metas.push({
        pubkey: deriveOrderPda(
          clobProgram.programId,
          marketState,
          bnLikeToBigInt(restingLevel.tailOrderId),
        ),
        isSigner: false,
        isWritable: true,
      });
    }

    return metas;
  };

  const maxPlacementAttempts = 8;
  for (let attempt = 0; attempt < maxPlacementAttempts; attempt += 1) {
    const marketAccount = (await clobAccounts.marketState.fetch(
      marketState,
    )) as MarketStateAccount;
    if (hasExecutableLiquidity(marketAccount)) {
      return;
    }

    const makerBalance = BigInt(
      await connection.getBalance(maker.publicKey, "confirmed"),
    );
    if (makerBalance < MIN_LIQUIDITY_MAKER_LAMPORTS) {
      const topUpLamports = MIN_LIQUIDITY_MAKER_LAMPORTS - makerBalance;
      await ensureBootstrapAuthorityLamportBuffer(
        connection,
        state,
        MIN_BOOTSTRAP_AUTHORITY_LAMPORTS + topUpLamports,
      );
      await authorityProvider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: maker.publicKey,
            lamports: Number(topUpLamports),
          }),
        ),
        [],
      );
    }

    const nextOrderId = bnLikeToBigInt(marketAccount.nextOrderId);
    if (nextOrderId <= 0n) {
      throw new Error("Missing next order id for seeded CLOB market");
    }

    const remainingAccounts = await buildPlaceOrderRemainingAccounts(
      SEEDED_LIQUIDITY_LAMPORTS,
    );

    try {
      await clobProgram.methods
        .placeOrder(
          new BN(nextOrderId.toString()),
          side,
          ORDER_PRICE,
          new BN(SEEDED_LIQUIDITY_LAMPORTS.toString()),
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
          newOrder: deriveOrderPda(
            clobProgram.programId,
            marketState,
            nextOrderId,
          ),
          restingLevel: derivePriceLevelPda(
            clobProgram.programId,
            marketState,
            side,
            ORDER_PRICE,
          ),
          config: new PublicKey(state.clobConfig || ""),
          treasury: new PublicKey(state.clobTreasury || ""),
          marketMaker: new PublicKey(state.clobMarketMaker || ""),
          vault,
          user: maker.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([maker])
        .rpc();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt === maxPlacementAttempts - 1 ||
        (!/MissingMatchAccounts|InvalidRemainingAccount|custom program error: 0x0|"Custom":0/i.test(
          message,
        ) &&
          !/Required maker match accounts were not supplied/i.test(message))
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }

    const refreshedMarketAccount = (await clobAccounts.marketState.fetch(
      marketState,
    )) as MarketStateAccount;
    if (hasExecutableLiquidity(refreshedMarketAccount)) {
      return;
    }
  }

  throw new Error(
    `Failed to seed executable ${side === SIDE_ASK ? "ask" : "bid"} liquidity`,
  );
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
  const provider = createPollingProvider(connection, authority);
  const clobProgram = new Program(duelMarketIdl, provider);
  const marketState =
    overrides?.marketState ?? new PublicKey(state.clobMarketState || "");
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
  const provider = createPollingProvider(connection, authority);
  return new Program(duelMarketIdl, provider);
}

function createReadonlyFightProgram(
  connection: Connection,
  state: E2eState,
): Program<Idl> {
  const authority = loadBootstrapAuthority(state);
  const provider = createPollingProvider(connection, authority);
  return new Program(fightOracleIdl, provider);
}

async function createWritablePrograms(
  connection: Connection,
  state: E2eState,
): Promise<{
  authority: Keypair;
  fightProgram: Program<Idl>;
  clobProgram: Program<Idl>;
}> {
  await ensureBootstrapAuthorityLamportBuffer(connection, state);
  const authority = loadBootstrapAuthority(state);
  const provider = createPollingProvider(connection, authority);

  return {
    authority,
    fightProgram: new Program(fightOracleIdl, provider),
    clobProgram: new Program(duelMarketIdl, provider),
  };
}

async function listSolanaTraderFixtures(
  connection: Connection,
  state: E2eState,
): Promise<SolanaTraderFixture[]> {
  const trader = new PublicKey(state.solanaTraderPublicKey || "");
  const clobProgram = createReadonlyClobProgram(connection, state);
  const fightProgram = createReadonlyFightProgram(connection, state);
  const oracleConfigAccount = (await fightProgram.account.oracleConfig.fetch(
    deriveOracleConfigPda(fightProgram.programId),
  )) as {
    disputeWindowSecs?: unknown;
  };
  const disputeWindowSecs = Number(
    bnLikeToBigInt(oracleConfigAccount.disputeWindowSecs),
  );
  const fixtures: SolanaTraderFixture[] = [];

  for (const entry of await clobProgram.account.userBalance.all()) {
    if (!entry.account.user.equals(trader)) continue;
    const aShares = bnLikeToBigInt(entry.account.aShares);
    const bShares = bnLikeToBigInt(entry.account.bShares);
    const aLockedLamports = bnLikeToBigInt(entry.account.aLockedLamports);
    const bLockedLamports = bnLikeToBigInt(entry.account.bLockedLamports);
    if (
      aShares === 0n &&
      bShares === 0n &&
      aLockedLamports === 0n &&
      bLockedLamports === 0n
    ) {
      continue;
    }

    const marketState = (await clobProgram.account.marketState.fetch(
      entry.account.marketState,
    )) as {
      duelState: PublicKey;
      duelKey: readonly number[];
      status?: unknown;
      winner?: unknown;
    };
    const duelState = (await fightProgram.account.duelState.fetch(
      marketState.duelState,
    )) as {
      status?: unknown;
      pendingWinner?: unknown;
      pendingProposedAt?: unknown;
      betOpenTs?: unknown;
      betCloseTs?: unknown;
      duelStartTs?: unknown;
      metadataUri?: unknown;
    };
    const pendingProposedAt = Number(duelState.pendingProposedAt ?? 0);
    const finalizableAt =
      pendingProposedAt > 0
        ? pendingProposedAt + (disputeWindowSecs > 0 ? disputeWindowSecs : 3600)
        : null;

    const duelKeyHex = Buffer.from(marketState.duelKey).toString("hex");
    fixtures.push({
      userBalanceAddress: entry.publicKey,
      duelKey: [...marketState.duelKey],
      duelKeyHex,
      duelId: canonicalDuelIdFromMetadata(duelState.metadataUri, duelKeyHex),
      duelState: marketState.duelState,
      marketState: entry.account.marketState,
      marketStatus: enumName(marketState.status),
      marketWinner: enumName(marketState.winner),
      duelStatus: enumName(duelState.status),
      pendingWinner: enumName(duelState.pendingWinner),
      pendingProposedAt,
      finalizableAt,
      betOpenTs: Number(duelState.betOpenTs ?? 0),
      betCloseTs: Number(duelState.betCloseTs ?? 0),
      duelStartTs: Number(duelState.duelStartTs ?? 0),
      aShares,
      bShares,
      aLockedLamports,
      bLockedLamports,
    });
  }

  fixtures.sort((left, right) => {
    const leftTs = left.pendingProposedAt || left.betCloseTs || 0;
    const rightTs = right.pendingProposedAt || right.betCloseTs || 0;
    return leftTs - rightTs;
  });
  return fixtures;
}

async function fetchSolanaTraderFixtureByAddress(
  connection: Connection,
  state: E2eState,
  userBalanceAddress: PublicKey,
): Promise<SolanaTraderFixture | null> {
  const trader = new PublicKey(state.solanaTraderPublicKey || "");
  const clobProgram = createReadonlyClobProgram(connection, state);
  const fightProgram = createReadonlyFightProgram(connection, state);
  const oracleConfigAccount = (await fightProgram.account.oracleConfig.fetch(
    deriveOracleConfigPda(fightProgram.programId),
  )) as {
    disputeWindowSecs?: unknown;
  };
  const disputeWindowSecs = Number(
    bnLikeToBigInt(oracleConfigAccount.disputeWindowSecs),
  );
  const userBalanceAccount =
    (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as
      | (UserBalanceAccount & {
          user: PublicKey;
          marketState: PublicKey;
        })
      | null;
  if (userBalanceAccount == null || !userBalanceAccount.user.equals(trader)) {
    return null;
  }

  const marketState = (await clobProgram.account.marketState.fetch(
    userBalanceAccount.marketState,
  )) as {
    duelState: PublicKey;
    duelKey: readonly number[];
    status?: unknown;
    winner?: unknown;
  };
  const duelState = (await fightProgram.account.duelState.fetch(
    marketState.duelState,
  )) as {
    status?: unknown;
    pendingWinner?: unknown;
    pendingProposedAt?: unknown;
    betOpenTs?: unknown;
    betCloseTs?: unknown;
    duelStartTs?: unknown;
    metadataUri?: unknown;
  };
  const pendingProposedAt = Number(duelState.pendingProposedAt ?? 0);
  const finalizableAt =
    pendingProposedAt > 0
      ? pendingProposedAt + (disputeWindowSecs > 0 ? disputeWindowSecs : 3600)
      : null;

  const duelKeyHex = Buffer.from(marketState.duelKey).toString("hex");
  return {
    userBalanceAddress,
    duelKey: [...marketState.duelKey],
    duelKeyHex,
    duelId: canonicalDuelIdFromMetadata(duelState.metadataUri, duelKeyHex),
    duelState: marketState.duelState,
    marketState: userBalanceAccount.marketState,
    marketStatus: enumName(marketState.status),
    marketWinner: enumName(marketState.winner),
    duelStatus: enumName(duelState.status),
    pendingWinner: enumName(duelState.pendingWinner),
    pendingProposedAt,
    finalizableAt,
    betOpenTs: Number(duelState.betOpenTs ?? 0),
    betCloseTs: Number(duelState.betCloseTs ?? 0),
    duelStartTs: Number(duelState.duelStartTs ?? 0),
    aShares: bnLikeToBigInt(userBalanceAccount.aShares),
    bShares: bnLikeToBigInt(userBalanceAccount.bShares),
    aLockedLamports: bnLikeToBigInt(userBalanceAccount.aLockedLamports),
    bLockedLamports: bnLikeToBigInt(userBalanceAccount.bLockedLamports),
  };
}

async function fetchPinnedSolanaFixture(
  connection: Connection,
  state: E2eState,
  userBalanceAddress: PublicKey,
): Promise<SolanaTraderFixture | null> {
  if (
    !state.currentDuelId ||
    !state.currentDuelKeyHex ||
    !state.clobMarketState ||
    !state.clobDuelState
  ) {
    return null;
  }
  const clobProgram = createReadonlyClobProgram(connection, state);
  const fightProgram = createReadonlyFightProgram(connection, state);
  const oracleConfigAccount = (await fightProgram.account.oracleConfig.fetch(
    deriveOracleConfigPda(fightProgram.programId),
  )) as {
    disputeWindowSecs?: unknown;
  };
  const disputeWindowSecs = Number(
    bnLikeToBigInt(oracleConfigAccount.disputeWindowSecs),
  );
  const marketStateAddress = new PublicKey(state.clobMarketState);
  const duelStateAddress = new PublicKey(state.clobDuelState);
  const marketState = (await clobProgram.account.marketState.fetch(
    marketStateAddress,
  )) as {
    duelState: PublicKey;
    duelKey: readonly number[];
    status?: unknown;
    winner?: unknown;
  };
  const duelState = (await fightProgram.account.duelState.fetch(
    duelStateAddress,
  )) as {
    status?: unknown;
    pendingWinner?: unknown;
    pendingProposedAt?: unknown;
    betOpenTs?: unknown;
    betCloseTs?: unknown;
    duelStartTs?: unknown;
  };
  const userBalanceAccount =
    (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
  const pendingProposedAt = Number(duelState.pendingProposedAt ?? 0);
  const finalizableAt =
    pendingProposedAt > 0
      ? pendingProposedAt + (disputeWindowSecs > 0 ? disputeWindowSecs : 3600)
      : null;

  return {
    userBalanceAddress,
    duelKey: [...marketState.duelKey],
    duelKeyHex: Buffer.from(marketState.duelKey).toString("hex"),
    duelId: state.currentDuelId,
    duelState: duelStateAddress,
    marketState: marketStateAddress,
    marketStatus: enumName(marketState.status),
    marketWinner: enumName(marketState.winner),
    duelStatus: enumName(duelState.status),
    pendingWinner: enumName(duelState.pendingWinner),
    pendingProposedAt,
    finalizableAt,
    betOpenTs: Number(duelState.betOpenTs ?? 0),
    betCloseTs: Number(duelState.betCloseTs ?? 0),
    duelStartTs: Number(duelState.duelStartTs ?? 0),
    aShares: bnLikeToBigInt(userBalanceAccount?.aShares),
    bShares: bnLikeToBigInt(userBalanceAccount?.bShares),
    aLockedLamports: bnLikeToBigInt(userBalanceAccount?.aLockedLamports),
    bLockedLamports: bnLikeToBigInt(userBalanceAccount?.bLockedLamports),
  };
}

async function findRecentSuccessfulSignatureByLog(
  connection: Connection,
  address: PublicKey,
  logSubstring: string,
): Promise<string | null> {
  const signatures = await connection.getSignaturesForAddress(
    address,
    { limit: 20 },
    "confirmed",
  );
  let fallback: string | null = null;
  for (const entry of signatures) {
    if (entry.err != null) {
      continue;
    }
    fallback ??= entry.signature;
    const tx = await connection.getParsedTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages ?? [];
    if (logs.some((log) => log.includes(logSubstring))) {
      return entry.signature;
    }
  }
  return fallback;
}

async function getWalletLamportDeltaFromSignature(
  connection: Connection,
  signature: string,
  wallet: PublicKey,
): Promise<bigint | null> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (tx?.meta == null) {
    return null;
  }
  const accountKeys = tx.transaction.message.accountKeys.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    if ("pubkey" in entry) {
      const pubkey = entry.pubkey;
      return typeof pubkey === "string" ? pubkey : pubkey.toBase58();
    }
    return entry.toBase58();
  });
  const walletBase58 = wallet.toBase58();
  const accountIndex = accountKeys.findIndex((entry) => entry === walletBase58);
  if (accountIndex === -1) {
    return null;
  }
  return (
    BigInt(tx.meta.postBalances[accountIndex] ?? 0) -
    BigInt(tx.meta.preBalances[accountIndex] ?? 0)
  );
}

async function getTransactionFeeFromSignature(
  connection: Connection,
  signature: string,
): Promise<bigint | null> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  return tx?.meta == null ? null : BigInt(tx.meta.fee);
}

test.describe("market flows", () => {
  test.setTimeout(600_000);

  test("solana lifecycle shell and claim CTA follow the normalized lifecycle API", async ({
    page,
  }) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const duelKeyHex = state.currentDuelKeyHex || "";
    const duelId = state.currentDuelId || "";
    const marketState = new PublicKey(state.clobMarketState || "");
    const userBalanceAddress = new PublicKey(state.clobUserBalance || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    let lifecycleStatus = "OPEN";
    let lifecycleWinner = "NONE";

    await page.route(
      "**/api/arena/prediction-markets/active",
      async (route) => {
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
      },
    );

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaDuelId: duelId,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await seedClobLiquidity(connection, state, SIDE_ASK);
    await page.getByTestId("refresh-market").click();

    const submitButton = page.getByTestId("prediction-submit");
    const claimButton = page.getByTestId("solana-clob-claim-payout");

    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 30_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await expect(claimButton).toHaveCount(0);

    lifecycleStatus = "LOCKED";
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/locked/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeDisabled({ timeout: 15_000 });
    await expect(claimButton).toHaveCount(0);

    lifecycleStatus = "OPEN";
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });

    await page.getByTestId("prediction-amount-input").fill("999999999");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    const orderQuote = page.getByTestId("solana-order-quote");
    await expect(orderQuote).toContainText("Order details before signature");
    await expect(orderQuote).toContainText("Maximum locked collateral");
    await expect(orderQuote).toContainText("Execution fees");
    await expect(orderQuote).toContainText(
      "matched collateral and escrowed execution fees are refundable through claim",
    );
    await expect(orderQuote).toContainText(
      "Cancellation or reclaim separately returns unmatched collateral",
    );
    await expect(orderQuote).toContainText("Maximum wallet funding required");
    await expect(orderQuote).toContainText(
      "Wallet balance cannot cover the worst-case funding requirement",
    );
    await expect(submitButton).toBeDisabled({ timeout: 30_000 });

    await page
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await expect(orderQuote).not.toContainText(
      "Wallet balance cannot cover the worst-case funding requirement",
      { timeout: 30_000 },
    );
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });

    await submitButton.click();
    const rejectedConfirmation = page.getByRole("dialog", {
      name: /confirm sol order/i,
    });
    await expect(rejectedConfirmation).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "hyperbet.e2e.reject-next-wallet-signature",
        "1",
      );
    });
    await rejectedConfirmation
      .getByRole("button", { name: /confirm and sign/i })
      .click();
    const rejectedFeedback = page.getByTestId(
      "solana-order-transaction-feedback",
    );
    await expect(rejectedFeedback).toContainText(
      "Your wallet declined the signature",
      { timeout: 30_000 },
    );
    await expect(
      page.getByTestId("solana-order-transaction-signature"),
    ).toHaveCount(0);
    await expect(submitButton).toBeDisabled();
    await rejectedFeedback
      .getByRole("button", { name: /review latest quote/i })
      .click();
    await expect(rejectedFeedback).toHaveCount(0, { timeout: 30_000 });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);
    let forwardedSignature = "";
    let interceptedSendCount = 0;
    const interruptSubmittedResponse = async (route: Route) => {
      const payload = route.request().postDataJSON() as {
        method?: unknown;
      } | null;
      if (payload?.method !== "sendTransaction") {
        await route.continue();
        return;
      }

      interceptedSendCount += 1;
      if (interceptedSendCount === 1) {
        const upstream = await route.fetch();
        const upstreamPayload = (await upstream.json()) as {
          result?: unknown;
        };
        forwardedSignature =
          typeof upstreamPayload.result === "string"
            ? upstreamPayload.result
            : "";
        if (!forwardedSignature) {
          throw new Error(
            "Fault-injected browser submission did not return a signature",
          );
        }
        await confirmSignatureByPolling(connection, forwardedSignature);
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "E2E response interrupted after send" }),
      });
    };
    await page.route("**/__solana/rpc", interruptSubmittedResponse);
    try {
      await submitButton.click();
      const confirmation = page.getByRole("dialog", {
        name: /confirm sol order/i,
      });
      await expect(confirmation).toBeVisible({ timeout: 15_000 });
      await confirmation
        .getByRole("button", { name: /confirm and sign/i })
        .click();

      const ambiguousFeedback = page.getByTestId(
        "solana-order-transaction-feedback",
      );
      await expect(ambiguousFeedback).toContainText(
        "network response was interrupted",
        { timeout: 30_000 },
      );
      await expect
        .poll(() => forwardedSignature, {
          timeout: 30_000,
          intervals: [100, 250, 500],
        })
        .toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
      await expect(
        page.getByTestId("solana-order-transaction-signature"),
      ).toHaveText(forwardedSignature);
      expect(interceptedSendCount).toBe(2);
      await expect(submitButton).toBeDisabled();

      await ambiguousFeedback
        .getByRole("button", { name: /check transaction status/i })
        .click();
      await expect(ambiguousFeedback).toContainText(
        "Order confirmed on-chain",
        {
          timeout: 60_000,
        },
      );
      await expect(ambiguousFeedback).toHaveAttribute(
        "data-state",
        "confirmed",
      );
      await expect(submitButton).toBeEnabled({ timeout: 60_000 });
    } finally {
      await page.unroute("**/__solana/rpc", interruptSubmittedResponse);
    }

    await expect
      .poll(async () => {
        const balance = (await clobProgram.account.userBalance.fetchNullable(
          userBalanceAddress,
        )) as UserBalanceAccount | null;
        return Number(bnLikeToBigInt(balance?.aShares) - beforeYes);
      })
      .toBeGreaterThan(0);

    lifecycleStatus = "RESOLVED";
    lifecycleWinner = "A";
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/resolved/i, {
      timeout: 15_000,
    });
    await expect(claimButton).toBeEnabled({ timeout: 15_000 });
    await expect(claimButton).toContainText(/claim/i);
  });

  test("solana predictions place YES and NO orders and stage a proposed winner claim", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const {
      duelKey,
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-resolve-claim",
      {
        betCloseOffsetSeconds: 120,
        duelStartOffsetSeconds: 120,
      },
    );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
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

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaDuelId: duelId,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);
    const clobPanel = page.getByTestId("solana-clob-panel").first();

    await expect(page.getByTestId("current-match-id")).toContainText(duelId, {
      timeout: 60_000,
    });

    await seedClobLiquidity(connection, state, SIDE_ASK, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();

    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    const orderQuote = clobPanel.getByTestId("solana-order-quote");
    await expect(orderQuote).toContainText("Order details before signature");
    await expect(orderQuote).toContainText("Maximum locked collateral");
    await expect(orderQuote).toContainText("Execution fees");
    await expect(orderQuote).toContainText(
      "matched collateral and escrowed execution fees are refundable through claim",
    );
    await expect(orderQuote).toContainText(
      "Cancellation or reclaim separately returns unmatched collateral",
    );
    await expect(orderQuote).toContainText("Maximum wallet funding required");
    const buyYesButton = clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first();
    await expect(buyYesButton).toBeEnabled({ timeout: 30_000 });
    await buyYesButton.click({ force: true });
    await confirmSolanaOrder(page);

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
            const balance =
              (await clobProgram.account.userBalance.fetchNullable(
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
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderDebug = await readText(
        page,
        "solana-clob-place-order-debug",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state, {
        marketState,
      });
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderDebug=${currentOrderDebug || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    await page.getByTestId("refresh-market").click();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel.getByTestId("prediction-select-no").click({ force: true });
    const noPriceInput = clobPanel.getByTestId("solana-clob-price-input");
    if (await noPriceInput.isVisible().catch(() => false)) {
      await noPriceInput.fill("500");
    }
    const submitButton = clobPanel
      .getByRole("button", { name: /buy no/i })
      .first();
    await expect(submitButton).toContainText(/buy no/i, {
      timeout: 30_000,
    });
    const previousNoOrderTx = await readText(
      page,
      "solana-clob-place-order-tx",
    );
    const previousNoOrderDebug = await readText(
      page,
      "solana-clob-place-order-debug",
    );
    const beforeNoBalance =
      (await clobProgram.account.userBalance.fetchNullable(
        userBalanceAddress,
      )) as UserBalanceAccount | null;
    const beforeNoShares = bnLikeToBigInt(beforeNoBalance?.bShares);
    const beforeNoLockedLamports = bnLikeToBigInt(
      beforeNoBalance?.bLockedLamports,
    );
    const beforeNoMarket = (await clobProgram.account.marketState.fetch(
      marketState,
    )) as MarketStateAccount;
    const noOrderId = bnLikeToBigInt(beforeNoMarket.nextOrderId);
    const noOrderAddress = deriveOrderPda(
      clobProgram.programId,
      marketState,
      noOrderId,
    );
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await submitButton.click({ force: true });
    await confirmSolanaOrder(page);

    const noStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((noStatus || "").includes("Order failed:")) {
      throw new Error((noStatus || "").trim());
    }

    try {
      const waitForNoOrderResult = async (): Promise<void> => {
        await expect
          .poll(
            async () => {
              const currentStatus = await readText(page, "solana-clob-status");
              if (/Order failed:/i.test(currentStatus)) {
                throw new Error(currentStatus);
              }
              const currentOrderTx = await readText(
                page,
                "solana-clob-place-order-tx",
              );
              if (
                currentOrderTx &&
                currentOrderTx !== previousNoOrderTx &&
                !currentOrderTx.endsWith("-")
              ) {
                return currentOrderTx;
              }
              const currentOrderDebug = await readText(
                page,
                "solana-clob-place-order-debug",
              );
              if (
                currentOrderDebug &&
                currentOrderDebug !== previousNoOrderDebug &&
                /failed /i.test(currentOrderDebug)
              ) {
                throw new Error(currentOrderDebug);
              }
              const currentNoBalance =
                (await clobProgram.account.userBalance.fetchNullable(
                  userBalanceAddress,
                )) as UserBalanceAccount | null;
              const currentNoShares = bnLikeToBigInt(currentNoBalance?.bShares);
              const currentNoLockedLamports = bnLikeToBigInt(
                currentNoBalance?.bLockedLamports,
              );
              if (
                currentNoShares > beforeNoShares ||
                currentNoLockedLamports > beforeNoLockedLamports
              ) {
                return `state:${currentNoShares}:${currentNoLockedLamports}`;
              }
              return "";
            },
            {
              timeout: 20_000,
              intervals: [1_000, 2_000, 5_000],
            },
          )
          .not.toBe("");
      };

      await waitForNoOrderResult();

      await expect
        .poll(
          async () => {
            const currentStatus = await readText(page, "solana-clob-status");
            if (/Order failed:/i.test(currentStatus)) {
              throw new Error(currentStatus);
            }
            const currentOrderTx = await readText(
              page,
              "solana-clob-place-order-tx",
            );
            if (
              currentOrderTx &&
              currentOrderTx !== previousNoOrderTx &&
              !currentOrderTx.endsWith("-")
            ) {
              return currentOrderTx;
            }
            const currentOrderDebug = await readText(
              page,
              "solana-clob-place-order-debug",
            );
            if (
              currentOrderDebug &&
              currentOrderDebug !== previousNoOrderDebug &&
              /failed /i.test(currentOrderDebug)
            ) {
              throw new Error(currentOrderDebug);
            }
            const currentNoBalance =
              (await clobProgram.account.userBalance.fetchNullable(
                userBalanceAddress,
              )) as UserBalanceAccount | null;
            const currentNoShares = bnLikeToBigInt(currentNoBalance?.bShares);
            const currentNoLockedLamports = bnLikeToBigInt(
              currentNoBalance?.bLockedLamports,
            );
            if (
              currentNoShares > beforeNoShares ||
              currentNoLockedLamports > beforeNoLockedLamports
            ) {
              return `state:${currentNoShares}:${currentNoLockedLamports}`;
            }
            return "";
          },
          {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
    } catch (error) {
      const currentStatus = await readText(page, "solana-clob-status");
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderDebug = await readText(
        page,
        "solana-clob-place-order-debug",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state, {
        marketState,
      });
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderDebug=${currentOrderDebug || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    const restingNoOrder = (await clobProgram.account.order.fetch(
      noOrderAddress,
    )) as OrderAccount;
    expect(bnLikeToBigInt(restingNoOrder.id)).toBe(noOrderId);
    expect((restingNoOrder.marketState as PublicKey).equals(marketState)).toBe(
      true,
    );
    expect(Number(restingNoOrder.side)).toBe(SIDE_ASK);
    expect(Number(restingNoOrder.price)).toBe(500);
    expect(bnLikeToBigInt(restingNoOrder.amount)).toBe(50_000_000n);
    expect(bnLikeToBigInt(restingNoOrder.filled)).toBe(0n);
    expect(restingNoOrder.active).toBe(true);
    const previousNoOrderId = bnLikeToBigInt(restingNoOrder.prevOrderId);
    expect(previousNoOrderId).toBeGreaterThan(0n);
    expect(bnLikeToBigInt(restingNoOrder.nextOrderId)).toBe(0n);
    const noPriceLevelAddress = derivePriceLevelPda(
      clobProgram.programId,
      marketState,
      SIDE_ASK,
      500,
    );
    const noPriceLevelBeforeCancel =
      (await clobProgram.account.priceLevel.fetch(
        noPriceLevelAddress,
      )) as PriceLevelAccount;
    const noPriceLevelOpenBeforeCancel = bnLikeToBigInt(
      noPriceLevelBeforeCancel.totalOpen,
    );
    expect(bnLikeToBigInt(noPriceLevelBeforeCancel.headOrderId)).toBe(
      previousNoOrderId,
    );
    expect(bnLikeToBigInt(noPriceLevelBeforeCancel.tailOrderId)).toBe(
      noOrderId,
    );
    const expectedCancelRefundLamports = 25_000_000n;
    const cancelledOrderRentLamports = BigInt(
      await connection.getBalance(noOrderAddress, "confirmed"),
    );
    expect(cancelledOrderRentLamports).toBeGreaterThan(0n);
    const expectedCancelWalletCreditLamports =
      expectedCancelRefundLamports + cancelledOrderRentLamports;

    await page.getByTestId("refresh-market").click();
    const managedOrderCard = page.getByTestId(
      `solana-managed-order-${noOrderId.toString()}`,
    );
    const cancelSignature = await confirmSolanaManagedOrder(page, {
      orderId: noOrderId,
      action: "CANCEL",
      outcomeText: "NO 50.0%",
      remainingText: "0.05",
      refundText: "0.025 SOL",
      rentText: `${formatSolLamports(cancelledOrderRentLamports, 9)} SOL`,
      grossCreditText: `${formatSolLamports(expectedCancelWalletCreditLamports, 9)} SOL`,
    });

    await expect
      .poll(
        async () => {
          const [walletDelta, transactionFee] = await Promise.all([
            getWalletLamportDeltaFromSignature(
              connection,
              cancelSignature,
              trader,
            ),
            getTransactionFeeFromSignature(connection, cancelSignature),
          ]);
          return walletDelta == null || transactionFee == null
            ? null
            : (walletDelta + transactionFee).toString();
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(expectedCancelWalletCreditLamports.toString());

    const cancelledNoOrder = (await clobProgram.account.order.fetchNullable(
      noOrderAddress,
    )) as OrderAccount | null;
    expect(cancelledNoOrder).toBeNull();
    const previousNoOrder = (await clobProgram.account.order.fetch(
      deriveOrderPda(clobProgram.programId, marketState, previousNoOrderId),
    )) as OrderAccount;
    expect(bnLikeToBigInt(previousNoOrder.nextOrderId)).toBe(0n);
    const noPriceLevel = (await clobProgram.account.priceLevel.fetch(
      noPriceLevelAddress,
    )) as PriceLevelAccount;
    expect(bnLikeToBigInt(noPriceLevel.totalOpen)).toBe(
      noPriceLevelOpenBeforeCancel - 50_000_000n,
    );
    expect(bnLikeToBigInt(noPriceLevel.headOrderId)).toBe(previousNoOrderId);
    expect(bnLikeToBigInt(noPriceLevel.tailOrderId)).toBe(previousNoOrderId);
    await expect(managedOrderCard).toHaveCount(0, { timeout: 30_000 });

    const filledOrderFixture = await placeE2eTraderRestingOrder(
      connection,
      state,
      {
        marketState,
        duelState,
        side: SIDE_ASK,
        price: ORDER_PRICE,
        amount: 50_000_000n,
      },
    );
    await seedClobLiquidity(connection, state, SIDE_BID, {
      marketState,
      duelState,
    });
    await expect
      .poll(
        async () => {
          const filledOrder = (await clobProgram.account.order.fetchNullable(
            filledOrderFixture.orderAddress,
          )) as OrderAccount | null;
          return filledOrder
            ? `${filledOrder.active}:${bnLikeToBigInt(filledOrder.filled)}:${bnLikeToBigInt(filledOrder.amount)}:${bnLikeToBigInt(filledOrder.prevOrderId)}:${bnLikeToBigInt(filledOrder.nextOrderId)}`
            : "missing";
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe("false:50000000:50000000:0:0");

    const filledOrderRentLamports = BigInt(
      await connection.getBalance(filledOrderFixture.orderAddress, "confirmed"),
    );
    expect(filledOrderRentLamports).toBeGreaterThan(0n);
    const [filledLevelBeforeCleanup, vaultBeforeFilledCleanup] =
      await Promise.all([
        connection.getAccountInfo(filledOrderFixture.priceLevel, "confirmed"),
        connection.getBalance(
          deriveClobVaultPda(clobProgram.programId, marketState),
          "confirmed",
        ),
      ]);
    expect(filledLevelBeforeCleanup).not.toBeNull();
    const filledLevelStateBeforeCleanup =
      (await clobProgram.account.priceLevel.fetch(
        filledOrderFixture.priceLevel,
      )) as PriceLevelAccount;
    expect(bnLikeToBigInt(filledLevelStateBeforeCleanup.totalOpen)).toBe(0n);
    expect(bnLikeToBigInt(filledLevelStateBeforeCleanup.headOrderId)).toBe(0n);
    expect(bnLikeToBigInt(filledLevelStateBeforeCleanup.tailOrderId)).toBe(0n);
    const balanceBeforeFilledCleanup =
      (await clobProgram.account.userBalance.fetch(
        userBalanceAddress,
      )) as UserBalanceAccount;

    await page.getByTestId("refresh-market").click();
    const filledOrderCard = page.getByTestId(
      `solana-managed-order-${filledOrderFixture.orderId.toString()}`,
    );
    const closeFilledSignature = await confirmSolanaManagedOrder(page, {
      orderId: filledOrderFixture.orderId,
      action: "CLOSE_FILLED",
      outcomeText: "NO 50.0%",
      remainingText: "0.05",
      rentText: `${formatSolLamports(filledOrderRentLamports, 9)} SOL`,
      grossCreditText: `${formatSolLamports(filledOrderRentLamports, 9)} SOL`,
    });
    await expect
      .poll(
        async () => {
          const [walletDelta, transactionFee] = await Promise.all([
            getWalletLamportDeltaFromSignature(
              connection,
              closeFilledSignature,
              trader,
            ),
            getTransactionFeeFromSignature(connection, closeFilledSignature),
          ]);
          return walletDelta == null || transactionFee == null
            ? null
            : (walletDelta + transactionFee).toString();
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(filledOrderRentLamports.toString());
    expect(
      await clobProgram.account.order.fetchNullable(
        filledOrderFixture.orderAddress,
      ),
    ).toBeNull();
    const [filledLevelAfterCleanup, vaultAfterFilledCleanup] =
      await Promise.all([
        connection.getAccountInfo(filledOrderFixture.priceLevel, "confirmed"),
        connection.getBalance(
          deriveClobVaultPda(clobProgram.programId, marketState),
          "confirmed",
        ),
      ]);
    expect(filledLevelAfterCleanup?.lamports).toBe(
      filledLevelBeforeCleanup?.lamports,
    );
    expect(
      Buffer.from(filledLevelAfterCleanup?.data ?? []).equals(
        Buffer.from(filledLevelBeforeCleanup?.data ?? []),
      ),
    ).toBe(true);
    expect(vaultAfterFilledCleanup).toBe(vaultBeforeFilledCleanup);
    const balanceAfterFilledCleanup =
      (await clobProgram.account.userBalance.fetch(
        userBalanceAddress,
      )) as UserBalanceAccount;
    expect({
      aShares: bnLikeToBigInt(balanceAfterFilledCleanup.aShares),
      bShares: bnLikeToBigInt(balanceAfterFilledCleanup.bShares),
      aLockedLamports: bnLikeToBigInt(
        balanceAfterFilledCleanup.aLockedLamports,
      ),
      bLockedLamports: bnLikeToBigInt(
        balanceAfterFilledCleanup.bLockedLamports,
      ),
    }).toEqual({
      aShares: bnLikeToBigInt(balanceBeforeFilledCleanup.aShares),
      bShares: bnLikeToBigInt(balanceBeforeFilledCleanup.bShares),
      aLockedLamports: bnLikeToBigInt(
        balanceBeforeFilledCleanup.aLockedLamports,
      ),
      bLockedLamports: bnLikeToBigInt(
        balanceBeforeFilledCleanup.bLockedLamports,
      ),
    });
    await expect(filledOrderCard).toHaveCount(0, { timeout: 30_000 });

    const resolutionNow = await waitForConfirmedSolanaTimestamp(
      connection,
      duelStartTs,
      120_000,
    );
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: canonicalDuelMetadata(duelId, duelKeyHex, "locked"),
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await proposeDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: resolutionNow,
      metadataUri: canonicalDuelMetadata(duelId, duelKeyHex, "proposed"),
    });
    if (E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishSolanaCycleState(request, {
        cycleId: `gate10-solana-${duelId}`,
        duelId,
        duelKeyHex,
        betOpenTs,
        betCloseTs,
        duelStartTs,
        phase: "RESOLUTION",
        winner: "A",
        duelEndTs: resolutionNow,
      });
    }

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
      .toBe("PROPOSED:NONE");

    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("solana-clob-status")).toContainText(
      /result proposed|dispute window open/i,
      {
        timeout: 30_000,
      },
    );
  });

  test("solana predictions finalize a matured proposal and claim winnings", async ({
    page,
    request,
  }, testInfo) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const clobProgram = createReadonlyClobProgram(connection, state);
    let fixtures = await listSolanaTraderFixtures(connection, state);
    let now = await currentChainUnixTimestamp(connection);
    const preservedUserBalanceAddress = new PublicKey(
      state.clobUserBalance || "",
    );
    const preservedFixture = await fetchSolanaTraderFixtureByAddress(
      connection,
      state,
      preservedUserBalanceAddress,
    );
    const pinnedFixture = await fetchPinnedSolanaFixture(
      connection,
      state,
      preservedUserBalanceAddress,
    );
    let maturedFixture =
      fixtures.find(
        (fixture) =>
          fixture.duelStatus === "proposed" &&
          fixture.pendingWinner === "a" &&
          fixture.aShares > 0n &&
          fixture.finalizableAt != null &&
          fixture.finalizableAt <= now,
      ) ?? null;
    if (maturedFixture == null && REQUIRE_MATURED_SOLANA_WIN_CLAIM) {
      const pendingFixture =
        fixtures.find(
          (fixture) =>
            fixture.duelStatus === "proposed" &&
            fixture.pendingWinner === "a" &&
            fixture.aShares > 0n &&
            fixture.finalizableAt != null,
        ) ?? null;
      if (pendingFixture?.finalizableAt != null) {
        await waitForConfirmedSolanaTimestamp(
          connection,
          pendingFixture.finalizableAt,
          90_000,
        );
        fixtures = await listSolanaTraderFixtures(connection, state);
        now = await currentChainUnixTimestamp(connection);
        maturedFixture =
          fixtures.find(
            (fixture) =>
              fixture.duelStatus === "proposed" &&
              fixture.pendingWinner === "a" &&
              fixture.aShares > 0n &&
              fixture.finalizableAt != null &&
              fixture.finalizableAt <= now,
          ) ?? null;
      }
    }
    const claimedFixture = preservedFixture ?? pinnedFixture;
    const alreadyClaimedFixture =
      E2E_DUEL_SOURCE === "real_hyperia" &&
      maturedFixture == null &&
      claimedFixture != null &&
      claimedFixture.duelKeyHex === state.currentDuelKeyHex &&
      claimedFixture.marketState.toBase58() === state.clobMarketState &&
      claimedFixture.duelStatus === "resolved" &&
      claimedFixture.marketStatus === "resolved" &&
      claimedFixture.marketWinner === "a" &&
      claimedFixture.aShares === 0n &&
      claimedFixture.bShares === 0n &&
      claimedFixture.aLockedLamports === 0n &&
      claimedFixture.bLockedLamports === 0n;
    const activeFixture =
      maturedFixture ?? (alreadyClaimedFixture ? claimedFixture : null);

    if (activeFixture == null) {
      const pendingFixture =
        fixtures.find(
          (fixture) =>
            fixture.duelStatus === "proposed" &&
            fixture.pendingWinner === "a" &&
            fixture.aShares > 0n &&
            fixture.finalizableAt != null,
        ) ?? null;
      const pendingMessage =
        pendingFixture == null
          ? "No Solana proposed winner-claim fixture exists for the canary trader"
          : `No matured Solana winner-claim fixture yet; earliest finalizableAt=${pendingFixture.finalizableAt}`;
      test.skip(
        !REQUIRE_MATURED_SOLANA_WIN_CLAIM,
        `${pendingMessage}; rerun after maturity or set E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM=true to enforce the time-gated lane`,
      );
      throw new Error(pendingMessage);
    }

    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    let beforeWalletLamports = BigInt(
      await connection.getBalance(trader, "confirmed"),
    );
    let afterWalletLamports = beforeWalletLamports;
    let finalizeResultSig: string | null = null;
    let claimTx: string | null = null;
    let claimWalletLamportsDelta: bigint | null = null;
    let expectedClaimPayoutLamports: bigint | null = null;
    let reclaimedBalanceRentLamports: bigint | null = null;

    if (!alreadyClaimedFixture) {
      const claimMarket = (await clobProgram.account.marketState.fetch(
        activeFixture.marketState,
      )) as { winningsMarketMakerFeeBpsSnapshot?: unknown };
      const winningsFeeBps = bnLikeToBigInt(
        claimMarket.winningsMarketMakerFeeBpsSnapshot,
      );
      expectedClaimPayoutLamports =
        activeFixture.aShares -
        (activeFixture.aShares * winningsFeeBps) / 10_000n;
      reclaimedBalanceRentLamports = BigInt(
        await connection.getBalance(
          activeFixture.userBalanceAddress,
          "confirmed",
        ),
      );
      expect(expectedClaimPayoutLamports).toBeGreaterThan(0n);
      expect(reclaimedBalanceRentLamports).toBeGreaterThan(0n);
    }

    await gotoApp(page, {
      e2eSolanaDuelKey: activeFixture.duelKeyHex,
      e2eSolanaDuelId: activeFixture.duelId,
      e2eSolanaMarketRef: activeFixture.marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    if (alreadyClaimedFixture) {
      finalizeResultSig = await findRecentSuccessfulSignatureByLog(
        connection,
        activeFixture.duelState,
        "Instruction: FinalizeResult",
      );
      claimTx = await findRecentSuccessfulSignatureByLog(
        connection,
        activeFixture.userBalanceAddress,
        "Instruction: Claim",
      );
      if (claimTx != null) {
        claimWalletLamportsDelta = await getWalletLamportDeltaFromSignature(
          connection,
          claimTx,
          trader,
        );
        if (claimWalletLamportsDelta != null) {
          beforeWalletLamports -= claimWalletLamportsDelta;
        }
      }
    } else if (E2E_DUEL_SOURCE === "real_hyperia") {
      finalizeResultSig = await fightProgram.methods
        .finalizeResult(
          [...activeFixture.duelKey],
          canonicalDuelMetadata(
            activeFixture.duelId,
            activeFixture.duelKeyHex,
            "finalized",
          ),
        )
        .accountsPartial({
          finalizer: authority.publicKey,
          oracleConfig: deriveOracleConfigPda(fightProgram.programId),
          duelState: activeFixture.duelState,
        })
        .signers([authority])
        .rpc();
    } else {
      try {
        await finalizeDuelResult(
          fightProgram as never,
          authority,
          activeFixture.duelKey,
          canonicalDuelMetadata(
            activeFixture.duelId,
            activeFixture.duelKeyHex,
            "finalized",
          ),
        );
      } catch (error) {
        const racedDuel = (await fightProgram.account.duelState.fetch(
          activeFixture.duelState,
        )) as { status?: unknown };
        if (enumName(racedDuel.status) !== "resolved") {
          throw error;
        }
      }
      const finalizedDuel = (await fightProgram.account.duelState.fetch(
        activeFixture.duelState,
      )) as { status?: unknown; winner?: unknown };
      expect(enumName(finalizedDuel.status)).toBe("resolved");
      expect(enumName(finalizedDuel.winner)).toBe("a");
      finalizeResultSig = await findRecentSuccessfulSignatureByLog(
        connection,
        activeFixture.duelState,
        "Instruction: FinalizeResult",
      );
      expect(finalizeResultSig).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    }
    if (!alreadyClaimedFixture) {
      await syncMarketFromDuel(
        writableClobProgram as never,
        activeFixture.marketState,
        activeFixture.duelState,
      );
    }
    if (!alreadyClaimedFixture && E2E_DUEL_SOURCE === "synthetic_publish") {
      await publishSolanaCycleState(request, {
        cycleId: `gate10-solana-${activeFixture.duelId}`,
        duelId: activeFixture.duelId,
        duelKeyHex: activeFixture.duelKeyHex,
        betOpenTs: activeFixture.betOpenTs,
        betCloseTs: activeFixture.betCloseTs,
        duelStartTs: activeFixture.duelStartTs,
        phase: "RESOLUTION",
        winner: "A",
        duelEndTs: Math.floor(Date.now() / 1000),
      });
    }

    if (E2E_DUEL_SOURCE === "real_hyperia") {
      await expect
        .poll(
          async () => {
            const fixtures = await listSolanaTraderFixtures(connection, state);
            const resolvedFixture =
              fixtures.find((fixture) =>
                fixture.userBalanceAddress.equals(
                  activeFixture.userBalanceAddress,
                ),
              ) ?? null;
            if (resolvedFixture != null) {
              return `${resolvedFixture.marketStatus || "missing"}:${resolvedFixture.marketWinner || "missing"}`;
            }
            if (alreadyClaimedFixture) {
              const preservedResolvedFixture = await fetchPinnedSolanaFixture(
                connection,
                state,
                activeFixture.userBalanceAddress,
              );
              return `${preservedResolvedFixture?.marketStatus || "missing"}:${preservedResolvedFixture?.marketWinner || "missing"}`;
            }
            return "missing:missing";
          },
          {
            timeout: 60_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBe("resolved:a");
    } else {
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
    }

    await page.getByTestId("refresh-market").click();
    if (!alreadyClaimedFixture) {
      const claimButton = page.getByRole("button", { name: /claim/i }).first();
      await expect(claimButton).toBeEnabled({ timeout: 30_000 });
      const previousClaimTx = await readText(page, "solana-clob-claim-tx");
      await claimButton.click({ force: true });
      claimTx = await expectSolanaSettlementReceipt(
        page,
        /claim confirmed on-chain/i,
      );
      const debugClaimTx = await waitForNewText(
        page,
        "solana-clob-claim-tx",
        previousClaimTx,
        120_000,
      );
      expect(debugClaimTx).toContain(claimTx);
      const [signatureWalletDelta, transactionFee] = await Promise.all([
        getWalletLamportDeltaFromSignature(connection, claimTx, trader),
        getTransactionFeeFromSignature(connection, claimTx),
      ]);
      expect(signatureWalletDelta).not.toBeNull();
      expect(transactionFee).not.toBeNull();
      expect((signatureWalletDelta ?? 0n) + (transactionFee ?? 0n)).toBe(
        (expectedClaimPayoutLamports ?? 0n) +
          (reclaimedBalanceRentLamports ?? 0n),
      );
      claimWalletLamportsDelta = signatureWalletDelta;
    }

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            activeFixture.userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.bShares)}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("0:0");

    if (alreadyClaimedFixture) {
      expect(claimWalletLamportsDelta ?? 0n).toBeGreaterThan(0n);
      afterWalletLamports =
        beforeWalletLamports + (claimWalletLamportsDelta ?? 0n);
    } else {
      afterWalletLamports = BigInt(
        await connection.getBalance(trader, "confirmed"),
      );
      claimWalletLamportsDelta = afterWalletLamports - beforeWalletLamports;
      expect(afterWalletLamports).toBeGreaterThan(beforeWalletLamports);
    }
    if (alreadyClaimedFixture) {
      await expect(page.getByTestId("solana-clob-status")).toContainText(
        /result finalized/i,
        {
          timeout: 30_000,
        },
      );
      const lifecycleDebug = page.getByTestId("solana-clob-lifecycle-debug");
      await expect(lifecycleDebug).toContainText(
        `duelKey=${activeFixture.duelKeyHex}`,
        {
          timeout: 30_000,
        },
      );
      await expect(lifecycleDebug).toContainText(
        `pinned=${activeFixture.duelKeyHex}`,
        {
          timeout: 30_000,
        },
      );
      await expect(lifecycleDebug).toContainText("claimKind=NONE", {
        timeout: 30_000,
      });
      await expect(lifecycleDebug).toContainText("canClaim=false", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("solana-clob-wallet-debug")).toContainText(
        ["aShares=0", "bShares=0"].join("\n"),
        {
          timeout: 30_000,
        },
      );
    } else if (E2E_DUEL_SOURCE === "real_hyperia") {
      await expect(
        page.getByTestId("solana-clob-lifecycle-debug"),
      ).toContainText(
        [
          "lifecycleStatus=RESOLVED",
          "winner=A",
          "marketStatus=resolved",
          "marketWinner=a",
          "canClaim=false",
        ].join("\n"),
        {
          timeout: 30_000,
        },
      );
      await expect(page.getByTestId("solana-clob-wallet-debug")).toContainText(
        ["aShares=0", "bShares=0"].join("\n"),
        {
          timeout: 30_000,
        },
      );
    } else {
      await expect(page.getByTestId("solana-clob-status")).toContainText(
        /result finalized/i,
        {
          timeout: 30_000,
        },
      );
      await expect(
        page.getByTestId("solana-clob-lifecycle-debug"),
      ).toContainText("claimKind=NONE", { timeout: 30_000 });
      await expect(page.getByTestId("solana-clob-wallet-debug")).toContainText(
        ["aShares=0", "bShares=0"].join("\n"),
        { timeout: 30_000 },
      );
    }
    await expect(page.getByTestId("solana-clob-claim-payout")).toHaveCount(0, {
      timeout: 30_000,
    });
    if (E2E_DUEL_SOURCE === "real_hyperia") {
      expect(finalizeResultSig).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      expect(claimTx).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    }
    await testInfo.attach("solana-matured-claim-ui", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach("solana-matured-claim-evidence", {
      body: Buffer.from(
        JSON.stringify(
          {
            duelId: activeFixture.duelId,
            duelKeyHex: activeFixture.duelKeyHex,
            marketState: activeFixture.marketState.toBase58(),
            duelState: activeFixture.duelState.toBase58(),
            finalizeResultSig,
            claimTx,
            beforeWalletLamports: beforeWalletLamports.toString(),
            afterWalletLamports: afterWalletLamports.toString(),
            claimWalletLamportsDelta:
              claimWalletLamportsDelta?.toString() ?? null,
            expectedClaimPayoutLamports:
              expectedClaimPayoutLamports?.toString() ?? null,
            reclaimedBalanceRentLamports:
              reclaimedBalanceRentLamports?.toString() ?? null,
            finalizableAt: activeFixture.finalizableAt,
            alreadyClaimedFixture,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  });

  test("solana resolved loser closes the stale balance and recovers exact rent", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      E2E_DUEL_SOURCE === "real_hyperia",
      "loser cleanup remains a synthetic Solana browser lane for now",
    );
    test.setTimeout(300_000);

    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const {
      duelKey,
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-loser-cleanup",
      {
        betCloseOffsetSeconds: 60,
        duelStartOffsetSeconds: 60,
      },
    );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${predictionMarkets.duel.duelKey}:${solanaMarket?.marketRef ?? "missing"}:${solanaMarket?.lifecycleStatus ?? "missing"}`;
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(`${duelKeyHex}:${marketState.toBase58()}:OPEN`);

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaDuelId: duelId,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await seedClobLiquidity(connection, state, SIDE_BID, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    const clobPanel = page.getByTestId("solana-clob-panel").first();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await clobPanel.getByTestId("prediction-select-no").click({ force: true });
    const noPriceInput = clobPanel.getByTestId("solana-clob-price-input");
    if (await noPriceInput.isVisible().catch(() => false)) {
      await noPriceInput.fill(String(ORDER_PRICE));
    }
    const buyNoButton = clobPanel
      .getByRole("button", { name: /buy no/i })
      .first();
    await expect(buyNoButton).toBeEnabled({ timeout: 30_000 });
    await buyNoButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.bShares)}:${bnLikeToBigInt(balance?.aLockedLamports)}:${bnLikeToBigInt(balance?.bLockedLamports)}`;
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("0:50000000:0:25000000");

    const balanceRentLamports = BigInt(
      await connection.getBalance(userBalanceAddress, "confirmed"),
    );
    expect(balanceRentLamports).toBeGreaterThan(0n);

    const resolutionNow = await waitForConfirmedSolanaTimestamp(
      connection,
      duelStartTs,
      120_000,
    );
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: canonicalDuelMetadata(duelId, duelKeyHex, "locked"),
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await proposeDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: resolutionNow,
      metadataUri: canonicalDuelMetadata(duelId, duelKeyHex, "proposed"),
    });

    const proposedFixture = (
      await listSolanaTraderFixtures(connection, state)
    ).find((fixture) => fixture.marketState.equals(marketState));
    expect(proposedFixture?.finalizableAt).not.toBeNull();
    expect(proposedFixture?.finalizableAt).toBeDefined();
    await waitForConfirmedSolanaTimestamp(
      connection,
      proposedFixture?.finalizableAt ?? 0,
      90_000,
    );
    try {
      await finalizeDuelResult(
        fightProgram as never,
        authority,
        duelKey,
        canonicalDuelMetadata(duelId, duelKeyHex, "finalized"),
      );
    } catch (error) {
      const racedDuel = (await fightProgram.account.duelState.fetch(
        duelState,
      )) as { status?: unknown };
      if (enumName(racedDuel.status) !== "resolved") {
        throw error;
      }
    }
    const finalizedLosingDuel = (await fightProgram.account.duelState.fetch(
      duelState,
    )) as { status?: unknown; winner?: unknown };
    expect(enumName(finalizedLosingDuel.status)).toBe("resolved");
    expect(enumName(finalizedLosingDuel.winner)).toBe("a");
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await publishSolanaCycleState(request, {
      cycleId: `gate10-solana-${duelId}`,
      duelId,
      duelKeyHex,
      betOpenTs,
      betCloseTs,
      duelStartTs,
      phase: "RESOLUTION",
      winner: "A",
      duelEndTs: await currentChainUnixTimestamp(connection),
    });

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${solanaMarket?.lifecycleStatus ?? "missing"}:${solanaMarket?.winner ?? "missing"}`;
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("RESOLVED:A");

    await page.getByTestId("refresh-market").click();
    const lifecycleDebug = page.getByTestId("solana-clob-lifecycle-debug");
    await expect(lifecycleDebug).toContainText("claimKind=LOSER_CLEANUP", {
      timeout: 30_000,
    });
    await expect(lifecycleDebug).toContainText("canClaim=true", {
      timeout: 30_000,
    });
    const cleanupButton = page
      .getByRole("button", { name: /clear position/i })
      .first();
    await expect(cleanupButton).toBeEnabled({ timeout: 30_000 });
    const previousCleanupTx = await readText(page, "solana-clob-claim-tx");
    await cleanupButton.click({ force: true });
    const cleanupTx = await expectSolanaSettlementReceipt(
      page,
      /position cleanup confirmed on-chain/i,
    );
    const debugCleanupTx = await waitForNewText(
      page,
      "solana-clob-claim-tx",
      previousCleanupTx,
      120_000,
    );
    expect(debugCleanupTx).toContain(cleanupTx);
    const [cleanupWalletDelta, cleanupTransactionFee] = await Promise.all([
      getWalletLamportDeltaFromSignature(connection, cleanupTx, trader),
      getTransactionFeeFromSignature(connection, cleanupTx),
    ]);
    expect(cleanupWalletDelta).not.toBeNull();
    expect(cleanupTransactionFee).not.toBeNull();
    expect((cleanupWalletDelta ?? 0n) + (cleanupTransactionFee ?? 0n)).toBe(
      balanceRentLamports,
    );
    expect(
      await clobProgram.account.userBalance.fetchNullable(userBalanceAddress),
    ).toBeNull();
    await expect(page.getByTestId("solana-clob-claim-payout")).toHaveCount(0, {
      timeout: 30_000,
    });

    await testInfo.attach("solana-loser-cleanup-ui", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach("solana-loser-cleanup-evidence", {
      body: Buffer.from(
        JSON.stringify(
          {
            duelId,
            duelKeyHex,
            marketState: marketState.toBase58(),
            duelState: duelState.toBase58(),
            cleanupTx,
            cleanupWalletDelta: cleanupWalletDelta?.toString() ?? null,
            cleanupTransactionFee: cleanupTransactionFee?.toString() ?? null,
            balanceRentLamports: balanceRentLamports.toString(),
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  });

  test("solana open prediction markets recover after keeper and proxy restarts", async ({
    page,
    request,
  }) => {
    let browserRpcRequestCount = 0;
    page.on("request", (browserRequest) => {
      try {
        if (new URL(browserRequest.url()).pathname === "/__solana/rpc") {
          browserRpcRequestCount += 1;
        }
      } catch {
        // Ignore non-URL browser-internal requests.
      }
    });
    const state = loadState();
    const control = loadControl();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const { duelKeyHex, duelState, marketState } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-restart",
        {
          betCloseOffsetSeconds: 90,
          duelStartOffsetSeconds: 150,
        },
      );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
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

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
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
    await page
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await page.getByTestId("prediction-select-yes").click({ force: true });

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);

    const restartSubmitButton = page.getByTestId("prediction-submit");
    await expect(restartSubmitButton).toBeEnabled({ timeout: 30_000 });
    await restartSubmitButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
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

    runProcessControl(control, "restart", "keeperBot");
    await waitForKeeperBotHealth(request, "solana", marketState.toBase58());

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

    if (E2E_DUEL_SOURCE !== "real_hyperia") {
      runProcessControl(control, "restart", "solanaProxy");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);
    await page.getByTestId("refresh-market").click();
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 60_000,
    });

    await expect
      .poll(
        async () => {
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

    expect(
      browserRpcRequestCount,
      "the prediction-market panel must not enter a render-triggered RPC refresh loop",
    ).toBeLessThanOrEqual(250);
  });

  test("solana open prediction markets recover after Hyperia restarts", async ({
    page,
    request,
  }) => {
    test.skip(
      E2E_DUEL_SOURCE !== "real_hyperia",
      "Hyperia restart recovery is only meaningful in real-duel mode",
    );
    const state = loadState();
    const control = loadControl();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const { duelKeyHex, duelState, marketState } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-hyperia-restart",
        {
          betCloseOffsetSeconds: 90,
          duelStartOffsetSeconds: 150,
        },
      );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
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

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
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

    runProcessControl(control, "restart", "hyperia");

    await expect
      .poll(
        async () => {
          const streamState = await fetchJson<{
            cycle?: {
              duelId?: string | number | null;
              duelKeyHex?: string | null;
            } | null;
          }>(request, "/api/streaming/state");
          return {
            duelKey: streamState.cycle?.duelKeyHex ?? null,
            duelId:
              streamState.cycle?.duelId != null
                ? String(streamState.cycle.duelId)
                : null,
          };
        },
        {
          timeout: 90_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        duelKey: duelKeyHex,
        duelId: state.currentDuelId ?? null,
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

    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);
    await page.getByTestId("refresh-market").click();
    await page
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await page.getByTestId("prediction-select-yes").click({ force: true });

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);

    const resumedSubmitButton = page.getByTestId("prediction-submit");
    await expect(resumedSubmitButton).toBeEnabled({ timeout: 30_000 });
    await resumedSubmitButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
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
  });

  test("exact Hyperia recovery-window cancellation drives keeper refund and clears claim state", async ({
    page,
    request,
  }) => {
    test.skip(
      E2E_DUEL_SOURCE === "real_hyperia",
      "cancel/refund remains a synthetic Solana browser lane for now",
    );
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const {
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-cancel",
    );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
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

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
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
    const clobPanel = page.getByTestId("solana-clob-panel").first();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    const submitButton = clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first();
    await expect(submitButton).toContainText(/buy yes/i, {
      timeout: 30_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await submitButton.click({ force: true });
    await confirmSolanaOrder(page);

    const yesStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((yesStatus || "").includes("Order failed:")) {
      throw new Error((yesStatus || "").trim());
    }

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

    await page.getByTestId("refresh-market").click();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel.getByTestId("prediction-select-no").click({ force: true });
    const terminalNoPriceInput = clobPanel.getByTestId(
      "solana-clob-price-input",
    );
    if (await terminalNoPriceInput.isVisible().catch(() => false)) {
      await terminalNoPriceInput.fill("500");
    }
    const terminalMarketBeforeOrder =
      (await clobProgram.account.marketState.fetch(
        marketState,
      )) as MarketStateAccount;
    const terminalOrderId = bnLikeToBigInt(
      terminalMarketBeforeOrder.nextOrderId,
    );
    const terminalOrderAddress = deriveOrderPda(
      clobProgram.programId,
      marketState,
      terminalOrderId,
    );
    const terminalNoSubmitButton = clobPanel
      .getByRole("button", { name: /buy no/i })
      .first();
    await expect(terminalNoSubmitButton).toBeEnabled({ timeout: 30_000 });
    await terminalNoSubmitButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
          const order = (await clobProgram.account.order.fetchNullable(
            terminalOrderAddress,
          )) as OrderAccount | null;
          return order?.active
            ? `${Number(order.side)}:${Number(order.price)}:${bnLikeToBigInt(order.amount)}:${bnLikeToBigInt(order.filled)}`
            : "missing";
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(`${SIDE_ASK}:500:50000000:0`);
    const terminalRestingOrder = (await clobProgram.account.order.fetch(
      terminalOrderAddress,
    )) as OrderAccount;
    const terminalPreviousOrderId = bnLikeToBigInt(
      terminalRestingOrder.prevOrderId,
    );
    expect(terminalPreviousOrderId).toBeGreaterThan(0n);
    expect(bnLikeToBigInt(terminalRestingOrder.nextOrderId)).toBe(0n);
    const terminalPriceLevelAddress = derivePriceLevelPda(
      clobProgram.programId,
      marketState,
      SIDE_ASK,
      500,
    );
    const terminalPriceLevelBeforeReclaim =
      (await clobProgram.account.priceLevel.fetch(
        terminalPriceLevelAddress,
      )) as PriceLevelAccount;
    const terminalPriceLevelOpenBeforeReclaim = bnLikeToBigInt(
      terminalPriceLevelBeforeReclaim.totalOpen,
    );
    expect(bnLikeToBigInt(terminalPriceLevelBeforeReclaim.tailOrderId)).toBe(
      terminalOrderId,
    );

    await publishSolanaCycleState(request, {
      cycleId: `gate10-solana-${duelId}`,
      duelId,
      duelKeyHex,
      betOpenTs,
      betCloseTs,
      duelStartTs,
      phase: "RESOLUTION",
      winner: "NONE",
      duelEndTs: await currentChainUnixTimestamp(connection),
      cancellationReason: COMPETITIVE_SNAPSHOT_RECOVERY_WINDOW_ELAPSED_REASON,
    });

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
          const payload = await fetchBotHealth(request);
          const market = payload.health?.markets.find(
            (entry) => entry.marketRef === marketState.toBase58(),
          );
          return {
            running: payload.running,
            lifecycleStatus: market?.lifecycleStatus ?? null,
            activeRecovery:
              payload.health?.recovery
                .filter((entry) => entry.active)
                .map((entry) => entry.code)
                .sort() ?? [],
          };
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual({
        running: EXPECT_KEEPER_BOT,
        lifecycleStatus: "CANCELLED",
        activeRecovery: [],
      });

    const cancelledDuel = (await fightProgram.account.duelState.fetch(
      duelState,
    )) as DuelStateAccountSnapshot;
    expect(enumName(cancelledDuel.status)).toBe("cancelled");
    expect(
      parseDuelCancellationMetadata(String(cancelledDuel.metadataUri)),
    ).toEqual({
      duelId,
      duelKeyHex,
      outcome: "cancelled",
      reason: COMPETITIVE_SNAPSHOT_RECOVERY_WINDOW_ELAPSED_REASON,
    });
    const cancelledMarket = (await clobProgram.account.marketState.fetch(
      marketState,
    )) as MarketStateAccount & { status?: unknown; winner?: unknown };
    expect(enumName(cancelledMarket.status)).toBe("cancelled");
    expect(enumName(cancelledMarket.winner)).toBe("none");

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return {
            aShares: Number(bnLikeToBigInt(balance?.aShares)),
            bShares: Number(bnLikeToBigInt(balance?.bShares)),
            aLockedLamports: Number(bnLikeToBigInt(balance?.aLockedLamports)),
            bLockedLamports: Number(bnLikeToBigInt(balance?.bLockedLamports)),
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
    const cancelledBalance =
      (await clobProgram.account.userBalance.fetchNullable(
        userBalanceAddress,
      )) as UserBalanceAccount | null;
    expect(
      bnLikeToBigInt(cancelledBalance?.aLockedLamports) > 0n,
      "cancelled Solana position should retain refundable locked lamports",
    ).toBeTruthy();

    const reclaimedOrderRentLamports = BigInt(
      await connection.getBalance(terminalOrderAddress, "confirmed"),
    );
    expect(reclaimedOrderRentLamports).toBeGreaterThan(0n);
    const expectedReclaimCollateralLamports = 25_000_000n;
    const expectedReclaimWalletCreditLamports =
      expectedReclaimCollateralLamports + reclaimedOrderRentLamports;

    const rolloverMarket = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-post-cancel-rollover",
    );
    await gotoApp(page, {
      e2eSolanaDuelKey: rolloverMarket.duelKeyHex,
      e2eSolanaMarketRef: rolloverMarket.marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const rolloverExpandButton = page
      .locator('button[title="Expand panel"]')
      .first();
    if (await rolloverExpandButton.isVisible().catch(() => false)) {
      await rolloverExpandButton.click();
    }
    await ensureWalletConnected(page);
    const terminalOrderHistory = page
      .getByTestId("solana-settlement-entry")
      .filter({ hasText: duelId })
      .filter({ hasText: `Order #${terminalOrderId.toString()}` })
      .first();
    await expect(terminalOrderHistory).toContainText("Reclaim required", {
      timeout: 45_000,
    });
    const reclaimSignature = await confirmSolanaManagedOrder(page, {
      orderId: terminalOrderId,
      action: "RECLAIM",
      outcomeText: "NO 50.0%",
      remainingText: "0.05",
      refundText: "0.025 SOL",
      rentText: `${formatSolLamports(reclaimedOrderRentLamports, 9)} SOL`,
      grossCreditText: `${formatSolLamports(expectedReclaimWalletCreditLamports, 9)} SOL`,
      historyEntry: terminalOrderHistory,
    });
    await expect
      .poll(
        async () => {
          const [walletDelta, transactionFee] = await Promise.all([
            getWalletLamportDeltaFromSignature(
              connection,
              reclaimSignature,
              trader,
            ),
            getTransactionFeeFromSignature(connection, reclaimSignature),
          ]);
          return walletDelta == null || transactionFee == null
            ? null
            : (walletDelta + transactionFee).toString();
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(expectedReclaimWalletCreditLamports.toString());

    const reclaimedOrder = (await clobProgram.account.order.fetchNullable(
      terminalOrderAddress,
    )) as OrderAccount | null;
    expect(reclaimedOrder).toBeNull();
    const terminalPreviousOrder = (await clobProgram.account.order.fetch(
      deriveOrderPda(
        clobProgram.programId,
        marketState,
        terminalPreviousOrderId,
      ),
    )) as OrderAccount;
    expect(bnLikeToBigInt(terminalPreviousOrder.nextOrderId)).toBe(0n);
    const terminalPriceLevelAfterReclaim =
      (await clobProgram.account.priceLevel.fetch(
        terminalPriceLevelAddress,
      )) as PriceLevelAccount;
    expect(bnLikeToBigInt(terminalPriceLevelAfterReclaim.totalOpen)).toBe(
      terminalPriceLevelOpenBeforeReclaim - 50_000_000n,
    );
    expect(bnLikeToBigInt(terminalPriceLevelAfterReclaim.headOrderId)).toBe(
      terminalPreviousOrderId,
    );
    expect(bnLikeToBigInt(terminalPriceLevelAfterReclaim.tailOrderId)).toBe(
      terminalPreviousOrderId,
    );
    const balanceAfterOrderReclaim =
      (await clobProgram.account.userBalance.fetchNullable(
        userBalanceAddress,
      )) as UserBalanceAccount | null;
    expect({
      aShares: bnLikeToBigInt(balanceAfterOrderReclaim?.aShares),
      bShares: bnLikeToBigInt(balanceAfterOrderReclaim?.bShares),
      aLockedLamports: bnLikeToBigInt(
        balanceAfterOrderReclaim?.aLockedLamports,
      ),
      bLockedLamports: bnLikeToBigInt(
        balanceAfterOrderReclaim?.bLockedLamports,
      ),
      tradeTreasuryFeeLamports: bnLikeToBigInt(
        balanceAfterOrderReclaim?.tradeTreasuryFeeLamports,
      ),
      tradeMarketMakerFeeLamports: bnLikeToBigInt(
        balanceAfterOrderReclaim?.tradeMarketMakerFeeLamports,
      ),
    }).toEqual({
      aShares: bnLikeToBigInt(cancelledBalance?.aShares),
      bShares: bnLikeToBigInt(cancelledBalance?.bShares),
      aLockedLamports: bnLikeToBigInt(cancelledBalance?.aLockedLamports),
      bLockedLamports: bnLikeToBigInt(cancelledBalance?.bLockedLamports),
      tradeTreasuryFeeLamports: bnLikeToBigInt(
        cancelledBalance?.tradeTreasuryFeeLamports,
      ),
      tradeMarketMakerFeeLamports: bnLikeToBigInt(
        cancelledBalance?.tradeMarketMakerFeeLamports,
      ),
    });
    const expectedMatchedRefundLamports =
      bnLikeToBigInt(balanceAfterOrderReclaim?.aLockedLamports) +
      bnLikeToBigInt(balanceAfterOrderReclaim?.bLockedLamports) +
      bnLikeToBigInt(balanceAfterOrderReclaim?.tradeTreasuryFeeLamports) +
      bnLikeToBigInt(balanceAfterOrderReclaim?.tradeMarketMakerFeeLamports);
    expect(expectedMatchedRefundLamports).toBeGreaterThan(0n);
    const reclaimedUserBalanceRentLamports = BigInt(
      await connection.getBalance(userBalanceAddress, "confirmed"),
    );
    expect(reclaimedUserBalanceRentLamports).toBeGreaterThan(0n);
    const matchedRefundHistory = page
      .getByTestId("solana-settlement-entry")
      .filter({ hasText: duelId })
      .filter({ hasText: "Refund ready to claim" })
      .first();
    await expect(matchedRefundHistory).toBeVisible({ timeout: 30_000 });
    const claimButton = matchedRefundHistory.getByRole("button", {
      name: /claim refund/i,
    });
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    await claimButton.click({ force: true });
    const claimSignature = await expectSolanaSettlementReceipt(
      page,
      /refund confirmed on-chain/i,
    );
    await expect
      .poll(
        async () => {
          const [walletDelta, transactionFee] = await Promise.all([
            getWalletLamportDeltaFromSignature(
              connection,
              claimSignature,
              trader,
            ),
            getTransactionFeeFromSignature(connection, claimSignature),
          ]);
          return walletDelta == null || transactionFee == null
            ? null
            : (walletDelta + transactionFee).toString();
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(
        (
          expectedMatchedRefundLamports + reclaimedUserBalanceRentLamports
        ).toString(),
      );

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.bShares)}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("0:0");
    expect(
      await clobProgram.account.userBalance.fetchNullable(userBalanceAddress),
    ).toBeNull();
  });

  test("authoritative Hyperia draw refunds matched YES and NO exposure exactly", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      E2E_DUEL_SOURCE === "real_hyperia",
      "draw/refund remains a synthetic Solana browser lane for now",
    );
    test.setTimeout(300_000);

    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const {
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-draw-refund",
    );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
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
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toEqual({
        duelKey: duelKeyHex,
        marketRef: marketState.toBase58(),
        lifecycleStatus: "OPEN",
      });

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaDuelId: duelId,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    const clobPanel = page.getByTestId("solana-clob-panel").first();
    await seedClobLiquidity(connection, state, SIDE_ASK, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    const buyYesButton = clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first();
    await expect(buyYesButton).toBeEnabled({ timeout: 30_000 });
    await buyYesButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
          const status = await readText(page, "solana-clob-status");
          if (/Order failed:/i.test(status)) throw new Error(status);
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.aLockedLamports)}`;
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("50000000:25000000");

    await seedClobLiquidity(connection, state, SIDE_BID, {
      marketState,
      duelState,
    });
    await page.getByTestId("refresh-market").click();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel.getByTestId("prediction-select-no").click({ force: true });
    const noPriceInput = clobPanel.getByTestId("solana-clob-price-input");
    if (await noPriceInput.isVisible().catch(() => false)) {
      await noPriceInput.fill(String(ORDER_PRICE));
    }
    const buyNoButton = clobPanel
      .getByRole("button", { name: /buy no/i })
      .first();
    await expect(buyNoButton).toBeEnabled({ timeout: 30_000 });
    await buyNoButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
          const status = await readText(page, "solana-clob-status");
          if (/Order failed:/i.test(status)) throw new Error(status);
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return {
            aShares: bnLikeToBigInt(balance?.aShares).toString(),
            bShares: bnLikeToBigInt(balance?.bShares).toString(),
            aLockedLamports: bnLikeToBigInt(
              balance?.aLockedLamports,
            ).toString(),
            bLockedLamports: bnLikeToBigInt(
              balance?.bLockedLamports,
            ).toString(),
          };
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toEqual({
        aShares: "50000000",
        bShares: "50000000",
        aLockedLamports: "25000000",
        bLockedLamports: "25000000",
      });

    const refundableBalance = (await clobProgram.account.userBalance.fetch(
      userBalanceAddress,
    )) as UserBalanceAccount;
    const expectedRefundLamports =
      bnLikeToBigInt(refundableBalance.aLockedLamports) +
      bnLikeToBigInt(refundableBalance.bLockedLamports) +
      bnLikeToBigInt(refundableBalance.tradeTreasuryFeeLamports) +
      bnLikeToBigInt(refundableBalance.tradeMarketMakerFeeLamports);
    expect(expectedRefundLamports).toBeGreaterThan(50_000_000n);
    const userBalanceRentLamports = BigInt(
      await connection.getBalance(userBalanceAddress, "confirmed"),
    );
    expect(userBalanceRentLamports).toBeGreaterThan(0n);

    await publishSolanaCycleState(request, {
      cycleId: `gate10-solana-${duelId}`,
      duelId,
      duelKeyHex,
      betOpenTs,
      betCloseTs,
      duelStartTs,
      phase: "RESOLUTION",
      winner: "NONE",
      outcome: "draw",
      duelEndTs: await currentChainUnixTimestamp(connection),
    });

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${solanaMarket?.lifecycleStatus ?? "missing"}:${solanaMarket?.winner ?? "missing"}`;
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("CANCELLED:NONE");

    await expect
      .poll(
        async () => {
          const payload = await fetchBotHealth(request);
          const market = payload.health?.markets.find(
            (entry) => entry.marketRef === marketState.toBase58(),
          );
          return {
            running: payload.running,
            lifecycleStatus: market?.lifecycleStatus ?? null,
            activeRecovery:
              payload.health?.recovery
                .filter((entry) => entry.active)
                .map((entry) => entry.code)
                .sort() ?? [],
          };
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toEqual({
        running: EXPECT_KEEPER_BOT,
        lifecycleStatus: "CANCELLED",
        activeRecovery: [],
      });

    const drawnDuel = (await fightProgram.account.duelState.fetch(
      duelState,
    )) as DuelStateAccountSnapshot;
    expect(enumName(drawnDuel.status)).toBe("cancelled");
    expect(enumName(drawnDuel.winner)).toBe("none");
    expect(
      parseDuelCancellationMetadata(String(drawnDuel.metadataUri)),
    ).toEqual({
      duelId,
      duelKeyHex,
      outcome: "draw",
      reason: "draw",
    });
    const drawnMarket = (await clobProgram.account.marketState.fetch(
      marketState,
    )) as MarketStateAccount & { status?: unknown; winner?: unknown };
    expect(enumName(drawnMarket.status)).toBe("cancelled");
    expect(enumName(drawnMarket.winner)).toBe("none");

    await page.getByTestId("refresh-market").click();
    const lifecycleDebug = page.getByTestId("solana-clob-lifecycle-debug");
    const walletDebug = page.getByTestId("solana-clob-wallet-debug");
    const claimButton = page.getByRole("button", { name: /claim/i }).first();
    await expect
      .poll(
        async () => ({
          lifecycle: (await lifecycleDebug.textContent()) ?? "",
          wallet: (await walletDebug.textContent()) ?? "",
          claimEnabled: await claimButton.isEnabled(),
        }),
        { timeout: 30_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toMatchObject({
        lifecycle: expect.stringMatching(/lifecycleStatus=CANCELLED/),
        wallet: expect.stringMatching(
          new RegExp(`refundableAmount=${expectedRefundLamports}`),
        ),
        claimEnabled: true,
      });

    await claimButton.click({ force: true });
    const claimSignature = await expectSolanaSettlementReceipt(
      page,
      /refund confirmed on-chain/i,
    );
    const [walletDelta, transactionFee] = await Promise.all([
      getWalletLamportDeltaFromSignature(connection, claimSignature, trader),
      getTransactionFeeFromSignature(connection, claimSignature),
    ]);
    expect(walletDelta).not.toBeNull();
    expect(transactionFee).not.toBeNull();
    expect((walletDelta ?? 0n) + (transactionFee ?? 0n)).toBe(
      expectedRefundLamports + userBalanceRentLamports,
    );
    expect(
      await clobProgram.account.userBalance.fetchNullable(userBalanceAddress),
    ).toBeNull();
    await expect(page.getByTestId("solana-clob-claim-payout")).toHaveCount(0, {
      timeout: 30_000,
    });

    await testInfo.attach("solana-draw-refund-ui", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach("solana-draw-refund-evidence", {
      body: Buffer.from(
        JSON.stringify(
          {
            duelId,
            duelKeyHex,
            duelState: duelState.toBase58(),
            marketState: marketState.toBase58(),
            outcome: "draw",
            claimSignature,
            aSharesBeforeRefund: bnLikeToBigInt(
              refundableBalance.aShares,
            ).toString(),
            bSharesBeforeRefund: bnLikeToBigInt(
              refundableBalance.bShares,
            ).toString(),
            expectedRefundLamports: expectedRefundLamports.toString(),
            userBalanceRentLamports: userBalanceRentLamports.toString(),
            walletDelta: walletDelta?.toString() ?? null,
            transactionFee: transactionFee?.toString() ?? null,
            userBalanceClosed: true,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  });

  test("hard-killed keeper recovers a forwarded terminal cancellation and exact refund", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(360_000);

    const state = loadState();
    const control = loadControl();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      state.solanaWsUrl,
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const {
      authority,
      fightProgram,
      clobProgram: writableClobProgram,
    } = await createWritablePrograms(connection, state);
    const {
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } = await createFreshSolanaOpenMarket(
      request,
      state,
      authority,
      fightProgram,
      writableClobProgram,
      "gate10-solana-terminal-rpc-crash",
    );
    const userBalanceAddress = deriveUserBalancePda(
      clobProgram.programId,
      marketState,
      trader,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${predictionMarkets.duel.duelKey}:${solanaMarket?.marketRef ?? "missing"}:${solanaMarket?.lifecycleStatus ?? "missing"}`;
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(`${duelKeyHex}:${marketState.toBase58()}:OPEN`);

    await gotoApp(page, {
      e2eSolanaDuelKey: duelKeyHex,
      e2eSolanaDuelId: duelId,
      e2eSolanaMarketRef: marketState.toBase58(),
    });
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
    const clobPanel = page.getByTestId("solana-clob-panel").first();
    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel
      .getByTestId("prediction-amount-input")
      .fill(SOLANA_PREDICTION_AMOUNT);
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    const buyYesButton = clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first();
    await expect(buyYesButton).toBeEnabled({ timeout: 30_000 });
    await buyYesButton.click({ force: true });
    await confirmSolanaOrder(page);

    await expect
      .poll(
        async () => {
          const status = await readText(page, "solana-clob-status");
          if (/Order failed:/i.test(status)) throw new Error(status);
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.aLockedLamports)}`;
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("50000000:25000000");

    const refundableBalance = (await clobProgram.account.userBalance.fetch(
      userBalanceAddress,
    )) as UserBalanceAccount;
    const expectedRefundLamports =
      bnLikeToBigInt(refundableBalance.aLockedLamports) +
      bnLikeToBigInt(refundableBalance.bLockedLamports) +
      bnLikeToBigInt(refundableBalance.tradeTreasuryFeeLamports) +
      bnLikeToBigInt(refundableBalance.tradeMarketMakerFeeLamports);
    expect(expectedRefundLamports).toBeGreaterThan(25_000_000n);
    const userBalanceRentLamports = BigInt(
      await connection.getBalance(userBalanceAddress, "confirmed"),
    );
    expect(userBalanceRentLamports).toBeGreaterThan(0n);

    const isRealHyperia = E2E_DUEL_SOURCE === "real_hyperia";
    const expectedOutcome = isRealHyperia ? "cancelled" : "draw";
    const expectedReason = isRealHyperia
      ? COMPETITIVE_SNAPSHOT_RECOVERY_WINDOW_ELAPSED_REASON
      : "draw";
    const sourceBefore = isRealHyperia
      ? await fetchHyperiaAuthorityHealth(request, control)
      : null;
    if (sourceBefore) {
      expect(sourceBefore).toMatchObject({
        ready: true,
        duelId,
        duelKeyHex,
        competitiveSnapshotPersisted: true,
        competitiveSnapshotDiagnostic: false,
      });
      expect(sourceBefore.sourceEpoch).toEqual(expect.any(Number));
      expect(sourceBefore.snapshotDigest).toEqual(expect.any(String));
    }

    const faultId = `terminal-${expectedOutcome}-${duelId}`;
    armForwardedSolanaTransactionHold(control, {
      faultId,
      requiredAccount: duelState,
      requiredProgramId: fightProgram.programId,
    });
    let sourceAfter: HyperiaAuthorityHealth | null = null;
    if (isRealHyperia) {
      runProcessControl(control, "kill", "hyperia");
      await expect
        .poll(() => currentHyperiaAuthorityEpoch(control), {
          timeout: 10_000,
          intervals: [100, 250, 500],
        })
        .toBeNull();
      await expect
        .poll(() => Math.floor(Date.now() / 1_000), {
          timeout: Math.max(60_000, betCloseTs * 1_000 - Date.now() + 30_000),
          intervals: [250, 500, 1_000],
        })
        .toBeGreaterThanOrEqual(betCloseTs + 1);
      runProcessControl(control, "start", "hyperia");
      await expect
        .poll(
          async () => {
            const recovered = await fetchHyperiaAuthorityHealth(
              request,
              control,
            );
            return {
              sourceEpochChanged:
                recovered.sourceEpoch !== sourceBefore?.sourceEpoch,
              duelId: recovered.duelId,
              duelKeyHex: recovered.duelKeyHex,
              snapshotDigest: recovered.snapshotDigest,
              outcome: recovered.outcome,
              cancellationReason: recovered.cancellationReason,
            };
          },
          { timeout: 30_000, intervals: [250, 500, 1_000] },
        )
        .toEqual({
          sourceEpochChanged: true,
          duelId,
          duelKeyHex,
          snapshotDigest: sourceBefore?.snapshotDigest,
          outcome: expectedOutcome,
          cancellationReason: expectedReason,
        });
      sourceAfter = await fetchHyperiaAuthorityHealth(request, control);
      expect(sourceAfter).toMatchObject({
        ready: true,
        duelId,
        duelKeyHex,
        snapshotDigest: sourceBefore?.snapshotDigest,
        outcome: expectedOutcome,
        cancellationReason: expectedReason,
        competitiveSnapshotPersisted: true,
        competitiveSnapshotDiagnostic: false,
      });
      expect(sourceAfter.sourceEpoch).toEqual(expect.any(Number));
      expect(sourceAfter.sourceEpoch).not.toBe(sourceBefore?.sourceEpoch);
    } else {
      await publishSolanaCycleState(request, {
        cycleId: `gate10-solana-${duelId}`,
        duelId,
        duelKeyHex,
        betOpenTs,
        betCloseTs,
        duelStartTs,
        phase: "RESOLUTION",
        winner: "NONE",
        outcome: "draw",
        duelEndTs: await currentChainUnixTimestamp(connection),
      });
    }

    await expect
      .poll(
        () => {
          const observed = readSolanaRpcFaultControl(control);
          return {
            faultId: observed?.faultId ?? null,
            state: observed?.state ?? null,
            signature: observed?.signature ?? null,
          };
        },
        { timeout: 60_000, intervals: [100, 250, 500, 1_000] },
      )
      .toMatchObject({
        faultId,
        state: "observed",
        signature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/),
      });
    const faultObservation = readSolanaRpcFaultControl(control);
    const forwardedCancellationSignature = faultObservation?.signature ?? "";
    expect(forwardedCancellationSignature).not.toBe("");

    runProcessControl(control, "restart", "keeperBot");
    await waitForKeeperBotHealth(request, "solana", null);

    await expect
      .poll(
        async () => {
          const status = (
            await connection.getSignatureStatuses(
              [forwardedCancellationSignature],
              { searchTransactionHistory: true },
            )
          ).value[0];
          return status
            ? {
                err: status.err,
                confirmationStatus: status.confirmationStatus,
              }
            : null;
        },
        { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] },
      )
      .toEqual({ err: null, confirmationStatus: "finalized" });
    const forwardedTransaction = await connection.getTransaction(
      forwardedCancellationSignature,
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );
    expect(forwardedTransaction).not.toBeNull();
    expect(
      forwardedTransaction?.meta?.logMessages?.filter((message) =>
        message.includes("Instruction: CancelDuel"),
      ),
    ).toHaveLength(1);

    await expect
      .poll(
        async () => {
          const exactMarket = (await clobProgram.account.marketState.fetch(
            marketState,
          )) as MarketStateAccount & { status?: unknown; winner?: unknown };
          return `${enumName(exactMarket.status) ?? "missing"}:${enumName(exactMarket.winner) ?? "missing"}`;
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("cancelled:none");

    await expect
      .poll(
        async () => {
          const payload = await fetchBotHealth(request);
          const market = payload.health?.markets.find(
            (entry) => entry.marketRef === marketState.toBase58(),
          );
          return {
            running: payload.running,
            lifecycleStatus: market?.lifecycleStatus ?? null,
            activeRecovery:
              payload.health?.recovery
                .filter((entry) => entry.active)
                .map((entry) => entry.code)
                .sort() ?? [],
          };
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toEqual({
        running: EXPECT_KEEPER_BOT,
        lifecycleStatus: "CANCELLED",
        activeRecovery: [],
      });

    const cancelledDuel = (await fightProgram.account.duelState.fetch(
      duelState,
    )) as DuelStateAccountSnapshot;
    expect(enumName(cancelledDuel.status)).toBe("cancelled");
    expect(enumName(cancelledDuel.winner)).toBe("none");
    expect(
      parseDuelCancellationMetadata(String(cancelledDuel.metadataUri)),
    ).toEqual({
      duelId,
      duelKeyHex,
      outcome: expectedOutcome,
      reason: expectedReason,
    });
    const drawnMarket = (await clobProgram.account.marketState.fetch(
      marketState,
    )) as MarketStateAccount & { status?: unknown; winner?: unknown };
    expect(enumName(drawnMarket.status)).toBe("cancelled");
    expect(enumName(drawnMarket.winner)).toBe("none");

    await gotoApp(page);
    await selectChain(page, "solana");
    await ensureWalletConnected(page);
    const postRolloverExpandButton = page
      .locator('button[title="Expand panel"]')
      .first();
    if (await postRolloverExpandButton.isVisible().catch(() => false)) {
      await postRolloverExpandButton.click();
    }
    const priorDuelActivity = page
      .getByTestId("solana-settlement-entry")
      .filter({ hasText: duelId })
      .first();
    await expect(priorDuelActivity).toContainText("Refund ready to claim", {
      timeout: 30_000,
    });
    const claimButton = priorDuelActivity.getByRole("button", {
      name: /claim refund/i,
    });
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    await claimButton.click({ force: true });
    const claimSignature = await expectSolanaSettlementReceipt(
      page,
      /refund confirmed on-chain/i,
    );
    const [walletDelta, transactionFee] = await Promise.all([
      getWalletLamportDeltaFromSignature(connection, claimSignature, trader),
      getTransactionFeeFromSignature(connection, claimSignature),
    ]);
    expect(walletDelta).not.toBeNull();
    expect(transactionFee).not.toBeNull();
    expect((walletDelta ?? 0n) + (transactionFee ?? 0n)).toBe(
      expectedRefundLamports + userBalanceRentLamports,
    );
    expect(
      await clobProgram.account.userBalance.fetchNullable(userBalanceAddress),
    ).toBeNull();

    await testInfo.attach("solana-terminal-authority-rpc-crash-refund-ui", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach(
      "solana-terminal-authority-rpc-crash-refund-evidence",
      {
        body: Buffer.from(
          JSON.stringify(
            {
              faultId,
              duelSource: E2E_DUEL_SOURCE,
              expectedOutcome,
              expectedReason,
              sourceBefore,
              sourceAfter,
              forwardedCancellationSignature,
              forwardedAtMs: faultObservation?.observedAtMs ?? null,
              duelId,
              duelKeyHex,
              duelState: duelState.toBase58(),
              marketState: marketState.toBase58(),
              claimSignature,
              expectedRefundLamports: expectedRefundLamports.toString(),
              userBalanceRentLamports: userBalanceRentLamports.toString(),
              walletDelta: walletDelta?.toString() ?? null,
              transactionFee: transactionFee?.toString() ?? null,
              userBalanceClosed: true,
            },
            null,
            2,
          ),
        ),
        contentType: "application/json",
      },
    );
  });
});
