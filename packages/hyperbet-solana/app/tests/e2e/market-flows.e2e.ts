import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/index.js";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
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
import * as web3 from "@solana/web3.js";

import {
  cancelDuel,
  deriveClobVaultPda,
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
} from "../../../anchor/tests/clob-test-helpers";
import { confirmSignatureByPolling } from "../../../anchor/tests/test-anchor";

const LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL ?? 1_000_000_000;

type E2eState = {
  solanaRpcUrl?: string;
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

type PriceLevelAccount = {
  totalOpen?: unknown;
  headOrderId?: unknown;
};

type OrderAccount = {
  maker?: PublicKey;
  amount?: unknown;
  filled?: unknown;
  nextOrderId?: unknown;
  active?: boolean;
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

type SolanaCyclePhase = "ANNOUNCEMENT" | "COUNTDOWN" | "RESOLUTION";

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
const goldClobIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_clob_market.json"), "utf8"),
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
const ORDER_PRICE = 500;
const SOLANA_PREDICTION_AMOUNT = "0.05";
const SEEDED_LIQUIDITY_LAMPORTS = 60_000_000n;
const MIN_LIQUIDITY_MAKER_LAMPORTS = SEEDED_LIQUIDITY_LAMPORTS;
const MIN_BOOTSTRAP_AUTHORITY_LAMPORTS = 20_000_000n;
const MIN_STAGE_A_PRIVILEGED_RESERVE_LAMPORTS = 15_000_000n;
const MIN_PERPS_TRADER_OVERHEAD_LAMPORTS = 10_000_000n;
const SOLANA_PERPS_TOTAL_TRADE_FEE_BPS = 50n;
const SOLANA_LAMPORT_TOP_UP_CUSHION = 5_000_000n;
const MAX_MATCH_ACCOUNTS = 100;
const ASK_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  14, 22, 189, 71, 203, 44, 97, 156, 18, 240, 85, 132, 53, 199, 4, 220, 91,
  11, 144, 201, 32, 77, 165, 118, 246, 17, 63, 154, 208, 39, 121, 6,
]);
const BID_LIQUIDITY_MAKER_SEED = Uint8Array.from([
  101, 33, 174, 9, 57, 218, 66, 140, 211, 45, 87, 16, 193, 24, 129, 204, 73,
  188, 12, 240, 61, 109, 173, 28, 142, 215, 54, 167, 80, 31, 199, 114,
]);
const E2E_SOLANA_AGENT_A = {
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

function createConfirmedConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: deriveWsUrl(rpcUrl),
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
  const oracleAuthorityPath = process.env.ORACLE_AUTHORITY_KEYPAIR?.trim() || "";
  if (
    oracleAuthorityPath &&
    oracleAuthorityPath !== state.bootstrapWalletPath?.trim() &&
    oracleAuthorityPath !== canaryPath &&
    oracleAuthorityPath !== marketMakerPath
  ) {
    candidateEntries.push({
      label: "oracle-authority",
      signer: loadKeypairFromPath(oracleAuthorityPath),
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
    currentBalance = BigInt(await connection.getBalance(recipient, "confirmed"));
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

function derivePerpsPositionPda(owner: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    perpsProgramId,
  )[0];
}

function derivePerpsConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    perpsProgramId,
  )[0];
}

function derivePerpsMarketPda(marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), encodeMarketId(marketId)],
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
      running: EXPECT_KEEPER_BOT,
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
  const duelState = await upsertDuel(fightProgram as never, authority, duelKey, {
    status: duelStatusBettingOpen(),
    betOpenTs,
    betCloseTs,
    duelStartTs,
    metadataUri: "https://hyperscape.gg/tests/e2e/fresh-open",
  });
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

function solanaFixtureDuelId(
  pendingProposedAt: number,
  betCloseTs: number,
): string {
  return `fixture-${pendingProposedAt || betCloseTs}`;
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
        countdown: countdownSeconds,
        timeRemaining: countdownSeconds * 1000,
        winnerId: winnerAgent?.id ?? null,
        winnerName: winnerAgent?.name ?? null,
        winReason: winnerAgent ? "e2e-resolution" : null,
        seed: null,
        replayHash: null,
        agent1: E2E_SOLANA_AGENT_A,
        agent2: E2E_SOLANA_AGENT_B,
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
  accountName: "ConfigState" | "UserBalance" | "PositionState" | "MarketState",
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

function formatSolInput(lamports: bigint): string {
  const normalized = Number(lamports) / LAMPORTS_PER_SOL;
  return normalized
    .toFixed(3)
    .replace(/\.?0+$/, "");
}

function minimumPerpsCollateralLamports(
  minMarginLamports: bigint,
  leverage: bigint,
): bigint {
  const denominatorBps = 10_000n - leverage * SOLANA_PERPS_TOTAL_TRADE_FEE_BPS;
  if (denominatorBps <= 0n) {
    return minMarginLamports;
  }
  return (
    minMarginLamports * 10_000n + denominatorBps - 1n
  ) / denominatorBps;
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
  const makerBalance = BigInt(await connection.getBalance(maker.publicKey, "confirmed"));
  if (makerBalance < MIN_LIQUIDITY_MAKER_LAMPORTS) {
    await ensureBootstrapAuthorityLamportBuffer(
      connection,
      state,
      MIN_BOOTSTRAP_AUTHORITY_LAMPORTS +
        (MIN_LIQUIDITY_MAKER_LAMPORTS - makerBalance),
    );
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: maker.publicKey,
        lamports: Number(MIN_LIQUIDITY_MAKER_LAMPORTS - makerBalance),
      }),
    );
    await authorityProvider.sendAndConfirm(fundTx, []);
  }
  const provider = createPollingProvider(connection, maker);
  const clobProgram = new Program(goldClobIdl, provider);
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
  const hasExecutableLiquidity = (marketAccount: MarketStateAccount): boolean => {
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
        const orderPda = deriveOrderPda(clobProgram.programId, marketState, currentHead);
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
    const restingLevel = await clobProgram.account.priceLevel.fetchNullable(
      restingLevelPda,
    );
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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const marketAccount = (await clobAccounts.marketState.fetch(
      marketState,
    )) as MarketStateAccount;
    if (hasExecutableLiquidity(marketAccount)) {
      return;
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
          newOrder: deriveOrderPda(clobProgram.programId, marketState, nextOrderId),
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
        attempt === 3 ||
        (!/MissingMatchAccounts|InvalidRemainingAccount|custom program error: 0x0/i.test(
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

  throw new Error(`Failed to seed executable ${side === SIDE_ASK ? "ask" : "bid"} liquidity`);
}

async function refreshPerpsOracleForUiTrade(
  connection: Connection,
  state: E2eState,
  marketId: number,
  spotIndex: number | null | undefined,
): Promise<void> {
  await ensureBootstrapAuthorityLamportBuffer(connection, state);
  const authority = loadBootstrapAuthority(state);
  const provider = createPollingProvider(connection, authority);
  const program = new Program(goldPerpsIdl, provider);
  const configAccount = (await (
    program.account as Record<string, AccountNamespaceFetcher>
  ).configState.fetch(derivePerpsConfigPda())) as {
    minOracleSpotIndex?: unknown;
    maxOracleSpotIndex?: unknown;
  };
  const minSpotIndexLamports = bnLikeToBigInt(configAccount.minOracleSpotIndex);
  const maxSpotIndexLamports = bnLikeToBigInt(configAccount.maxOracleSpotIndex);
  const requestedSpotIndexLamports = BigInt(
    Math.max(
      1,
      Math.round(
        (spotIndex && Number.isFinite(spotIndex) ? spotIndex : 100) *
          LAMPORTS_PER_SOL,
      ),
    ),
  );
  const nextSpotIndexLamports =
    requestedSpotIndexLamports < minSpotIndexLamports
      ? minSpotIndexLamports
      : requestedSpotIndexLamports > maxSpotIndexLamports
        ? maxSpotIndexLamports
        : requestedSpotIndexLamports;
  const tx = await program.methods
    .updateMarketOracle(
      new BN(String(marketId)),
      new BN(nextSpotIndexLamports.toString()),
      new BN((process.env.CANARY_PERPS_MU ?? "1000000000").trim()),
      new BN((process.env.CANARY_PERPS_SIGMA ?? "100000000").trim()),
    )
    .accountsPartial({
      config: derivePerpsConfigPda(),
      market: derivePerpsMarketPda(marketId),
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  await provider.sendAndConfirm(tx, []);
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
  const clobProgram = new Program(goldClobIdl, provider);
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
  return new Program(goldClobIdl, provider);
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
    clobProgram: new Program(goldClobIdl, provider),
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
    };
    const pendingProposedAt = Number(duelState.pendingProposedAt ?? 0);
    const finalizableAt =
      pendingProposedAt > 0
        ? pendingProposedAt + (disputeWindowSecs > 0 ? disputeWindowSecs : 3600)
        : null;

    fixtures.push({
      userBalanceAddress: entry.publicKey,
      duelKey: [...marketState.duelKey],
      duelKeyHex: Buffer.from(marketState.duelKey).toString("hex"),
      duelId: solanaFixtureDuelId(
        pendingProposedAt,
        Number(duelState.betCloseTs ?? 0),
      ),
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
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
    );
    const duelKeyHex = state.currentDuelKeyHex || "";
    const duelId = state.currentDuelId || "";
    const marketState = new PublicKey(state.clobMarketState || "");
    const userBalanceAddress = new PublicKey(state.clobUserBalance || "");
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

    await page.getByTestId("prediction-amount-input").fill(
      SOLANA_PREDICTION_AMOUNT,
    );
    await page.getByTestId("prediction-select-yes").click({ force: true });
    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);
    await submitButton.click({ force: true });

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
    await expect(page.getByTestId("market-status")).toContainText(
      /resolved/i,
      {
        timeout: 15_000,
      },
    );
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
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      await createWritablePrograms(connection, state);
    const {
      duelKey,
      duelKeyHex,
      duelId,
      duelState,
      marketState,
      betOpenTs,
      betCloseTs,
      duelStartTs,
    } =
      await createFreshSolanaOpenMarket(
        request,
        state,
        authority,
        fightProgram,
        writableClobProgram,
        "gate10-solana-resolve-claim",
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

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);
    const beforeNo = bnLikeToBigInt(beforeBalance?.bShares);

    await clobPanel.getByTestId("prediction-tab-buy").click({ force: true });
    await clobPanel.getByTestId("prediction-amount-input").fill(
      SOLANA_PREDICTION_AMOUNT,
    );
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    await clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first()
      .click({ force: true });

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
      await noPriceInput.fill("400");
    }
    const submitButton = clobPanel
      .getByRole("button", { name: /buy no/i })
      .first();
    await expect(submitButton).toContainText(/buy no/i, {
      timeout: 30_000,
    });
    const previousNoOrderTx = await readText(page, "solana-clob-place-order-tx");
    const previousNoOrderDebug = await readText(
      page,
      "solana-clob-place-order-debug",
    );
    const beforeNoBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeNoShares = bnLikeToBigInt(beforeNoBalance?.bShares);
    const beforeNoLockedLamports = bnLikeToBigInt(
      beforeNoBalance?.bLockedLamports,
    );
    await submitButton.click({ force: true });

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

      try {
        await waitForNoOrderResult();
      } catch {
        await submitButton.dispatchEvent("click");
        await waitForNoOrderResult();
      }

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

    await expect
      .poll(
        async () => {
          const slot = await connection.getSlot("confirmed");
          return (await connection.getBlockTime(slot)) ?? 0;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBeGreaterThanOrEqual(betCloseTs + 1);
    const resolutionNow = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs,
      betCloseTs,
      duelStartTs,
      metadataUri: "https://hyperscape.gg/tests/e2e/locked",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await proposeDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: resolutionNow,
      metadataUri: "https://hyperscape.gg/tests/e2e/resolved",
    });
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
  }) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
    );
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      await createWritablePrograms(connection, state);
    const clobProgram = createReadonlyClobProgram(connection, state);
    const fixtures = await listSolanaTraderFixtures(connection, state);
    const now = Math.floor(Date.now() / 1000);
    const maturedFixture =
      fixtures.find(
        (fixture) =>
          fixture.duelStatus === "proposed" &&
          fixture.pendingWinner === "a" &&
          fixture.aShares > 0n &&
          fixture.finalizableAt != null &&
          fixture.finalizableAt <= now,
      ) ?? null;

    if (maturedFixture == null) {
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
      throw new Error(
        pendingMessage,
      );
    }

    await gotoApp(page, {
      e2eSolanaDuelKey: maturedFixture.duelKeyHex,
      e2eSolanaDuelId: maturedFixture.duelId,
      e2eSolanaMarketRef: maturedFixture.marketState.toBase58(),
    });
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await finalizeDuelResult(
      fightProgram as never,
      authority,
      maturedFixture.duelKey,
      "https://hyperscape.gg/tests/e2e/resolved-claim",
    );
    await syncMarketFromDuel(
      writableClobProgram as never,
      maturedFixture.marketState,
      maturedFixture.duelState,
    );
    await publishSolanaCycleState(request, {
      cycleId: `gate10-solana-${maturedFixture.duelId}`,
      duelId: maturedFixture.duelId,
      duelKeyHex: maturedFixture.duelKeyHex,
      betOpenTs: maturedFixture.betOpenTs,
      betCloseTs: maturedFixture.betCloseTs,
      duelStartTs: maturedFixture.duelStartTs,
      phase: "RESOLUTION",
      winner: "A",
      duelEndTs: Math.floor(Date.now() / 1000),
    });

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
    await claimButton.click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            maturedFixture.userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.bShares)}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("0:0");
  });

  test("solana open prediction markets recover after keeper and proxy restarts", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const control = loadControl();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      await createWritablePrograms(connection, state);
    const {
      duelKeyHex,
      duelState,
      marketState,
    } =
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
    await page.getByTestId("prediction-amount-input").fill(
      SOLANA_PREDICTION_AMOUNT,
    );
    await page.getByTestId("prediction-select-yes").click({ force: true });

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);

    await page.getByTestId("prediction-submit").click({ force: true });

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
  });

  test("solana cancelled duel refunds and clears claim state", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      await createWritablePrograms(connection, state);
    const { duelKey, duelKeyHex, duelState, marketState } =
      await createFreshSolanaOpenMarket(
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
    await clobPanel.getByTestId("prediction-amount-input").fill(
      SOLANA_PREDICTION_AMOUNT,
    );
    await clobPanel.getByTestId("prediction-select-yes").click({ force: true });
    const submitButton = clobPanel
      .getByRole("button", { name: /buy yes/i })
      .first();
    await expect(submitButton).toContainText(/buy yes/i, {
      timeout: 30_000,
    });
    await submitButton.click({ force: true });

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
    const cancelledBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    expect(
      bnLikeToBigInt(cancelledBalance?.aLockedLamports) > 0n,
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
  });

  test("solana perps open and close LONG and SHORT positions on-chain", async ({
    page,
  }) => {
    const state = loadState();
    const connection = createConfirmedConnection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const marketId = Number(state.perpsMarketId || 0);
    const positionPda = derivePerpsPositionPda(trader, marketId);
    const configAccount = await fetchDecodedAccount<{
      min_margin_lamports?: unknown;
    }>(connection, perpsCoder, "ConfigState", derivePerpsConfigPda());
    const minMarginLamports = bnLikeToBigInt(configAccount?.min_margin_lamports);
    const targetLeverage = 2n;
    const collateralFloorLamports =
      minMarginLamports > 0n ? minMarginLamports : 100_000_000n;
    const collateralLamports =
      minimumPerpsCollateralLamports(
        collateralFloorLamports,
        targetLeverage,
      ) + 1_000_000n;

    await ensureStageASolanaRecipientLamportBuffer(
      connection,
      state,
      trader,
      collateralLamports + MIN_PERPS_TRADER_OVERHEAD_LAMPORTS,
    );

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
    await page
      .getByTestId("models-market-collateral-input")
      .fill(formatSolInput(collateralLamports));
    await page.getByTestId("models-market-leverage-2x").click({ force: true });

    await expect(page.getByTestId("models-market-open-long")).toBeEnabled({
      timeout: 60_000,
    });
    await refreshPerpsOracleForUiTrade(
      connection,
      state,
      marketId,
      125,
    );
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
    await refreshPerpsOracleForUiTrade(
      connection,
      state,
      marketId,
      125,
    );
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

    await refreshPerpsOracleForUiTrade(
      connection,
      state,
      marketId,
      125,
    );
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
    await refreshPerpsOracleForUiTrade(
      connection,
      state,
      marketId,
      125,
    );
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
