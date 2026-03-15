import { createHash } from "node:crypto";

import {
  BETTING_EVM_CHAIN_ORDER,
  type BettingAppEnvironment,
  type BettingChainKey,
  type BettingEvmChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketLifecycleStatus,
  normalizeSolanaCluster,
  resolveBettingEvmRuntimeEnv,
  resolveBettingSolanaDeployment,
} from "@hyperbet/chain-registry";
import {
  DEFAULT_MARKET_MAKER_CONFIG,
  buildQuotePlan,
  evaluateQuoteDecision,
  type MarketMakerConfig,
  type MarketSnapshot,
} from "@hyperbet/mm-core";
import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import { ethers } from "ethers";

import lvrMarketIdl from "./idl/lvr_amm.json" with { type: "json" };
import {
  duelKeyHexToBytes,
  findClobVaultPda,
  findDuelStatePda,
  findMarketConfigPda,
  findMarketPda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
} from "./solana-helpers.ts";

dotenv.config();

const EVM_MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const MAX_PRICE = 1000;
const SHARE_UNIT_SIZE = 1_000n;

const LVR_ROUTER_ABI = [
  "function marketKey(bytes32 duelKey, uint8 marketKind) view returns (bytes32)",
  "function getMarket(bytes32 duelKey, uint8 marketKind) view returns (bool exists, bytes32 duelKeyRef, uint8 status, uint8 winner, uint64 nextOrderId, uint16 bestBid, uint16 bestAsk, uint128 totalAShares, uint128 totalBShares)",
  "function positions(bytes32 marketKey, address user) view returns (uint128 aShares, uint128 bShares, uint128 aStake, uint128 bStake)",
  "function orders(bytes32 marketKey, uint64 orderId) view returns (uint64 id, uint8 side, uint16 price, address maker, uint128 amount, uint128 filled, uint64 prevOrderId, uint64 nextOrderId, bool active)",
  "function tradeTreasuryFeeBps() view returns (uint256)",
  "function tradeMarketMakerFeeBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function placeOrder(bytes32 duelKey, uint8 marketKind, uint8 side, uint16 price, uint128 amount) payable",
  "function cancelOrder(bytes32 duelKey, uint8 marketKind, uint64 orderId)",
  "function claim(bytes32 duelKey, uint8 marketKind)",
  "event OrderPlaced(bytes32 indexed marketKey, uint64 indexed orderId, address indexed maker, uint8 side, uint16 price, uint256 amount)",
] as const;

const IGNORABLE_EVM_CANCEL_ERROR_SELECTORS = new Set([
  "0xf08c50a1", // OrderInactive()
  "0x41a26a63", // AlreadyFilled()
  "0xb331e421", // NotMaker()
]);

type TrackedOrder = {
  orderId: number;
  chainKey: BettingChainKey;
  duelKey: string;
  marketKey: string;
  side: typeof BUY_SIDE | typeof SELL_SIDE;
  price: number;
  amount: number;
  placedAt: number;
};

type DuelSignal = {
  midPrice: number;
  phase: string;
  weight: number;
  updatedAt: number | null;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    betCloseTime: number | null;
  };
  markets: PredictionMarketLifecycleRecord[];
  updatedAt: number | null;
};

type EvmRuntime = {
  chainKey: BettingEvmChain;
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  walletAddress: string;
  clob: ethers.Contract;
  enabled: boolean;
  rpcUrl: string;
  lvrRouterAddress: string;
};

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & {
  payer: Keypair;
};

type SolanaMarketConfig = {
  treasury: PublicKey;
  marketMaker: PublicKey;
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
  winningsMarketMakerFeeBps: number;
};

type SolanaRuntime = {
  connection: Connection;
  provider: AnchorProvider;
  wallet: Keypair;
  walletAddress: string;
  fightOracleProgramId: PublicKey;
  marketProgramId: PublicKey;
  marketProgram: Program<any>;
  marketConfigPda: PublicKey;
  marketConfig: SolanaMarketConfig | null;
  rpcUrl: string;
};

type SolanaManagedOrder = {
  trackedOrder: TrackedOrder;
  remainingUnits: number;
  remainingRawAmount: bigint;
};

const SOLANA_MM_REQUIRED_ACCOUNTS = [
  "marketConfig",
  "marketState",
  "userBalance",
  "order",
] as const;
const SOLANA_MM_REQUIRED_INSTRUCTIONS = [
  "syncMarketFromDuel",
  "placeOrder",
  "cancelOrder",
  "claim",
] as const;

function normalizeIdlSymbolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function idlSupportsExternalSolanaMarketMaking(idlJson: unknown): boolean {
  const idlRecord = asRecord(idlJson);
  const accountNames = new Set(
    Array.isArray(idlRecord?.accounts)
      ? idlRecord.accounts
          .map((entry) => asRecord(entry)?.name)
          .filter((entry): entry is string => typeof entry === "string")
          .map(normalizeIdlSymbolName)
      : [],
  );
  const instructionNames = new Set(
    Array.isArray(idlRecord?.instructions)
      ? idlRecord.instructions
          .map((entry) => asRecord(entry)?.name)
          .filter((entry): entry is string => typeof entry === "string")
          .map(normalizeIdlSymbolName)
      : [],
  );
  return (
    SOLANA_MM_REQUIRED_ACCOUNTS.every((name) =>
      accountNames.has(normalizeIdlSymbolName(name)),
    ) &&
    SOLANA_MM_REQUIRED_INSTRUCTIONS.every((name) =>
      instructionNames.has(normalizeIdlSymbolName(name)),
    )
  );
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvironment(raw: string | undefined): BettingAppEnvironment {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "local":
    case "localnet":
      return "localnet";
    case "e2e":
      return "e2e";
    case "stream-ui":
      return "stream-ui";
    case "mainnet":
    case "mainnet-beta":
    case "production":
    case "prod":
      return "mainnet-beta";
    case "dev":
    case "devnet":
      return "devnet";
    case "test":
    case "testnet":
    default:
      return "testnet";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizePredictionMarketDuelKeyHex(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(trimmed)) return `0x${trimmed}`;
  if (/^0x[0-9a-f]{64}$/.test(trimmed)) return trimmed;
  return null;
}

function normalizeLifecycleStatus(
  value: unknown,
): PredictionMarketLifecycleStatus {
  switch (value) {
    case "PENDING":
    case "OPEN":
    case "LOCKED":
    case "RESOLVED":
    case "CANCELLED":
    case "UNKNOWN":
      return value;
    default:
      return "UNKNOWN";
  }
}

function normalizePredictionMarketsResponse(
  payload: unknown,
): PredictionMarketsResponse | null {
  const candidate = asRecord(payload);
  const duel = asRecord(candidate?.duel);
  if (!candidate || !duel || !Array.isArray(candidate.markets)) {
    return null;
  }

  const markets = candidate.markets
    .map((entry): PredictionMarketLifecycleRecord | null => {
      const record = asRecord(entry);
      if (!record || typeof record.chainKey !== "string") {
        return null;
      }
      const normalized: PredictionMarketLifecycleRecord = {
        chainKey: record.chainKey as BettingChainKey,
        duelKey: normalizePredictionMarketDuelKeyHex(
          typeof record.duelKey === "string" ? record.duelKey : null,
        ),
        duelId: typeof record.duelId === "string" ? record.duelId : null,
        marketId: typeof record.marketId === "string" ? record.marketId : null,
        marketRef:
          typeof record.marketRef === "string" ? record.marketRef : null,
        lifecycleStatus: normalizeLifecycleStatus(record.lifecycleStatus),
        winner:
          record.winner === "A" || record.winner === "B" ? record.winner : "NONE",
        betCloseTime:
          typeof record.betCloseTime === "number" && Number.isFinite(record.betCloseTime)
            ? record.betCloseTime
            : null,
        contractAddress:
          typeof record.contractAddress === "string"
            ? record.contractAddress
            : null,
        programId: typeof record.programId === "string" ? record.programId : null,
        txRef: typeof record.txRef === "string" ? record.txRef : null,
        syncedAt:
          typeof record.syncedAt === "number" && Number.isFinite(record.syncedAt)
            ? record.syncedAt
            : null,
        metadata: asRecord(record.metadata) ?? undefined,
      };
      return normalized;
    })
    .filter((record): record is PredictionMarketLifecycleRecord => record != null);

  return {
    duel: {
      duelKey: normalizePredictionMarketDuelKeyHex(
        typeof duel.duelKey === "string" ? duel.duelKey : null,
      ),
      duelId: typeof duel.duelId === "string" ? duel.duelId : null,
      phase: typeof duel.phase === "string" ? duel.phase : null,
      betCloseTime:
        typeof duel.betCloseTime === "number" && Number.isFinite(duel.betCloseTime)
          ? duel.betCloseTime
          : null,
    },
    markets,
    updatedAt:
      typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : null,
  };
}

export const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("address is required");
  }
  return ethers.getAddress(trimmed);
};

function defaultPredictionMarketsApiUrl(): string {
  const explicit = process.env.MM_PREDICTION_MARKETS_API_URL?.trim();
  if (explicit) return explicit;
  const duelUrl = (
    process.env.MM_DUEL_STATE_API_URL ||
    "http://127.0.0.1:5555/api/streaming/state"
  ).trim();
  return duelUrl.replace(
    /\/api\/streaming\/state$/,
    "/api/arena/prediction-markets/active",
  );
}

const TARGET_ENV = parseEnvironment(process.env.MM_ENV || process.env.BETTING_APP_ENV);
const RELOAD_DELAY_MIN_MS = Math.max(100, readEnvNumber("RELOAD_DELAY_MIN_MS", 500));
const RELOAD_DELAY_MAX_MS = Math.max(
  RELOAD_DELAY_MIN_MS,
  readEnvNumber("RELOAD_DELAY_MAX_MS", 2000),
);
const SOLANA_HEALTHCHECK_INTERVAL_MS = Math.max(
  1_000,
  readEnvNumber("SOLANA_HEALTHCHECK_INTERVAL_MS", 60_000),
);
const MM_ENABLE_SOLANA = readEnvBoolean("MM_ENABLE_SOLANA", false);
const MM_ENABLE_DUEL_SIGNAL = readEnvBoolean(
  "MM_ENABLE_DUEL_SIGNAL",
  !process.env.VITEST,
);
const MM_DUEL_STATE_API_URL = (
  process.env.MM_DUEL_STATE_API_URL ||
  "http://127.0.0.1:5555/api/streaming/state"
).trim();
const MM_PREDICTION_MARKETS_API_URL = defaultPredictionMarketsApiUrl();
const MM_DUEL_SIGNAL_WEIGHT = Math.max(
  0,
  Math.min(1, readEnvNumber("MM_DUEL_SIGNAL_WEIGHT", 0.75)),
);
const MM_DUEL_HP_EDGE_MULTIPLIER = Math.max(
  0,
  Math.min(0.49, readEnvNumber("MM_DUEL_HP_EDGE_MULTIPLIER", 0.45)),
);
const MM_DUEL_SIGNAL_CACHE_MS = Math.max(
  100,
  readEnvNumber("MM_DUEL_SIGNAL_CACHE_MS", 800),
);
const MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS = Math.max(
  100,
  readEnvNumber("MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS", 2500),
);
const MM_MARKETS_CACHE_MS = Math.max(
  100,
  readEnvNumber("MM_MARKETS_CACHE_MS", 1000),
);
const SOLANA_RPC_BACKOFF_MS = Math.max(
  10_000,
  readEnvNumber("SOLANA_RPC_CHECK_COOLDOWN_MS", 60_000),
);
const SOLANA_CHAIN_CHECK_COOLDOWN_MS = Math.max(
  SOLANA_RPC_BACKOFF_MS,
  readEnvNumber("SOLANA_CHAIN_CHECK_COOLDOWN_MS", 120_000),
);

function buildMarketMakerConfig(): MarketMakerConfig {
  return {
    ...DEFAULT_MARKET_MAKER_CONFIG,
    targetSpreadBps: readEnvNumber(
      "TARGET_SPREAD_BPS",
      DEFAULT_MARKET_MAKER_CONFIG.targetSpreadBps,
    ),
    minQuoteUnits: Math.max(
      1,
      Math.floor(
        readEnvNumber("ORDER_SIZE_MIN", DEFAULT_MARKET_MAKER_CONFIG.minQuoteUnits),
      ),
    ),
    maxQuoteUnits: Math.max(
      1,
      Math.floor(
        readEnvNumber("ORDER_SIZE_MAX", DEFAULT_MARKET_MAKER_CONFIG.maxQuoteUnits),
      ),
    ),
    maxInventoryPerSide: Math.max(
      1,
      Math.floor(
        readEnvNumber(
          "MAX_INVENTORY_CAP",
          DEFAULT_MARKET_MAKER_CONFIG.maxInventoryPerSide,
        ),
      ),
    ),
    maxQuoteAgeMs: Math.max(
      1_000,
      readEnvNumber(
        "CANCEL_STALE_AGE_MS",
        DEFAULT_MARKET_MAKER_CONFIG.maxQuoteAgeMs,
      ),
    ),
  };
}

function defaultSolanaRpcUrl(environment: BettingAppEnvironment): string {
  const cluster = normalizeSolanaCluster(environment);
  if (cluster === "localnet") {
    return "http://127.0.0.1:8899";
  }
  if (cluster === "devnet") {
    return "https://api.devnet.solana.com";
  }
  if (cluster === "mainnet-beta") {
    return "https://api.mainnet-beta.solana.com";
  }
  return "https://api.testnet.solana.com";
}

function solanaClusterForEnvironment(
  environment: BettingAppEnvironment,
): "localnet" | "devnet" | "testnet" | "mainnet-beta" {
  return normalizeSolanaCluster(environment);
}

const decodeSolanaSecretKey = (raw: string): Uint8Array => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("missing key material");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      const bytes = new Uint8Array(parsed);
      if (bytes.length === 32 || bytes.length === 64) {
        return bytes;
      }
    }
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 32 || decoded.length === 64) {
      return decoded;
    }
  } catch {
    // Fall through.
  }

  const decoded = Uint8Array.from(Buffer.from(trimmed, "base64"));
  if (decoded.length === 32 || decoded.length === 64) {
    return decoded;
  }
  throw new Error("unsupported key format");
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeCost(side: number, price: number, amount: bigint): bigint {
  const priceComponent = BigInt(side === BUY_SIDE ? price : MAX_PRICE - price);
  return (amount * priceComponent) / BigInt(MAX_PRICE);
}

function unitsToRawAmount(units: number): bigint {
  return BigInt(Math.max(1, Math.floor(units))) * SHARE_UNIT_SIZE;
}

function rawAmountToUnits(rawAmount: bigint): number {
  return Number(rawAmount / SHARE_UNIT_SIZE);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function signTx(tx: SignableTx, signer: Keypair): SignableTx {
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer]);
  } else {
    tx.partialSign(signer);
  }
  return tx;
}

function toAnchorWallet(signer: Keypair): AnchorLikeWallet {
  return {
    payer: signer,
    publicKey: signer.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> => {
      return signTx(tx, signer) as T;
    },
    signAllTransactions: async <T extends SignableTx[]>(
      txs: T,
    ): Promise<T> => {
      txs.forEach((tx) => signTx(tx, signer));
      return txs;
    },
  };
}

function ensureIdlAddress(idlJson: unknown, programId: PublicKey): Idl {
  const idlWithMaybeAddress = idlJson as Idl & { address?: string };
  return {
    ...idlWithMaybeAddress,
    address: programId.toBase58(),
  } as Idl;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    try {
      return BigInt((value as { toString: () => string }).toString());
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asPublicKey(value: unknown): PublicKey {
  if (value instanceof PublicKey) {
    return value;
  }
  if (value && typeof value === "object" && "toBase58" in value) {
    return new PublicKey(
      (value as { toBase58: () => string }).toBase58(),
    );
  }
  return new PublicKey(String(value));
}

async function fetchAnchorAccount(
  program: Program<any>,
  accountName: string,
  address: PublicKey,
): Promise<Record<string, unknown> | null> {
  const namespace = (program.account as Record<
    string,
    {
      fetchNullable: (
        target: PublicKey,
      ) => Promise<Record<string, unknown> | null>;
    }
  >)[accountName];
  if (!namespace?.fetchNullable) {
    throw new Error(`missing account namespace '${accountName}'`);
  }
  return namespace.fetchNullable(address);
}

function extractSolanaTxSignature(error: unknown): string | null {
  const message = (error as Error)?.message ?? "";
  const match = message.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{32,88})/i);
  return match?.[1] ?? null;
}

function isIgnorableEvmCancelError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? "").toLowerCase();
  if (
    message.includes("order inactive") ||
    message.includes("already filled") ||
    message.includes("not maker")
  ) {
    return true;
  }
  const selector = message.match(/0x[0-9a-f]{8}/i)?.[0]?.toLowerCase() ?? null;
  return selector != null && IGNORABLE_EVM_CANCEL_ERROR_SELECTORS.has(selector);
}

function isSolanaIgnorableRaceError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return (
    message.includes("MarketNotOpen") ||
    message.includes("BettingClosed") ||
    message.includes("MarketAlreadyResolved") ||
    message.includes("OracleNotResolved") ||
    message.includes("MatchAlreadyResolved") ||
    message.includes("BetWindowStillOpen") ||
    message.includes("OrderInactive") ||
    message.includes("already filled") ||
    message.includes("order inactive") ||
    message.includes("NothingToClaim") ||
    message.includes("Nothing to claim") ||
    message.includes("MarketAlreadyCancelled")
  );
}

function isSolanaFundingError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes(
      "attempt to debit an account but found no record of a prior credit",
    ) ||
    message.includes("insufficient funds") ||
    message.includes("insufficient lamports") ||
    message.includes("fee payer")
  );
}

function isSolanaRpcConnectivityError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes("unable to connect") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    message.includes("connection reset") ||
    message.includes("network request failed") ||
    message.includes("timed out") ||
    message.includes("socket hang up")
  );
}

async function waitForSolanaSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status) {
      if (status.err) return false;
      if (status.confirmationStatus) return true;
    }
    await sleep(2_000);
  }
  return false;
}

async function runSolanaWithRecovery<T>(
  fn: () => Promise<T>,
  connection: Connection,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const signature = extractSolanaTxSignature(error);
    if (!signature) throw error;
    const ok = await waitForSolanaSignature(connection, signature);
    if (!ok) throw error;
    return signature as T;
  }
}

export class CrossChainMarketMaker {
  private readonly instanceId: string;
  private readonly config: MarketMakerConfig;
  private readonly evmRuntimes: EvmRuntime[];
  private readonly solanaRuntime: SolanaRuntime | null;
  private readonly activeOrders: TrackedOrder[] = [];
  private readonly exposureByChain = new Map<BettingChainKey, { yes: number; no: number }>();
  private readonly orderHashToSignature = new Map<string, string>();
  private readonly nextNonceByChain = new Map<BettingEvmChain, number>();
  private startupValidated = false;
  private cycleCount = 0;
  private solanaEnabled = MM_ENABLE_SOLANA;
  private solanaDisableReason: string | null = null;
  private solanaChainCheckBlockedUntil = 0;
  private solanaRpcBlockedUntil = 0;
  private solanaReadyLogged = false;
  private lastSuccessfulSolanaRpcAt: number | null = null;
  private lastSolanaTxSignature: string | null = null;
  private lastSolanaRpcWarningAt = 0;
  private lastSolanaChainWarningAt = 0;
  private lastSolanaHealthcheckAt = 0;
  private lastDuelSignal: DuelSignal | null = null;
  private lastDuelSignalAt = 0;
  private lastPredictionMarkets: PredictionMarketsResponse | null = null;
  private lastPredictionMarketsAt = 0;

  constructor() {
    this.instanceId = (process.env.MM_INSTANCE_ID || "mm-1").trim() || "mm-1";
    this.config = buildMarketMakerConfig();
    this.evmRuntimes = BETTING_EVM_CHAIN_ORDER.map((chainKey) =>
      this.createEvmRuntime(chainKey),
    );
    this.solanaRuntime = this.createSolanaRuntime();
  }

  private createSolanaRuntime(): SolanaRuntime | null {
    if (!this.solanaEnabled) {
      this.solanaDisableReason = "disabled via MM_ENABLE_SOLANA=false";
      return null;
    }

    if (!idlSupportsExternalSolanaMarketMaking(lvrMarketIdl)) {
      this.solanaEnabled = false;
      this.solanaDisableReason =
        "current lvr_amm deployment is AMM-only; external Solana quote-bot execution is unsupported";
      console.warn(`[SOLANA] Disabled: ${this.solanaDisableReason}`);
      return null;
    }

    const solanaPrivateKey = (process.env.SOLANA_PRIVATE_KEY || "").trim();
    if (!solanaPrivateKey) {
      this.solanaEnabled = false;
      this.solanaDisableReason = "missing SOLANA_PRIVATE_KEY";
      console.warn("[SOLANA] Disabled: missing SOLANA_PRIVATE_KEY");
      return null;
    }

    const deployment = resolveBettingSolanaDeployment(
      solanaClusterForEnvironment(TARGET_ENV),
    );
    const rpcUrl =
      (process.env.SOLANA_RPC_URL || "").trim() ||
      defaultSolanaRpcUrl(TARGET_ENV);
    const fightOracleProgramId = new PublicKey(
      (process.env.FIGHT_ORACLE_PROGRAM_ID || "").trim() ||
        deployment.fightOracleProgramId,
    );
    const marketProgramId = new PublicKey(
      (process.env.LVR_AMM_PROGRAM_ID || "").trim() ||
        (process.env.SOLANA_ARENA_MARKET_PROGRAM_ID || "").trim() ||
        deployment.lvrMarketProgramId,
    );

    try {
      const keyBytes = decodeSolanaSecretKey(solanaPrivateKey);
      const wallet =
        keyBytes.length === 32
          ? Keypair.fromSeed(keyBytes)
          : Keypair.fromSecretKey(keyBytes);
      const connection = new Connection(rpcUrl, "confirmed");
      const provider = new AnchorProvider(
        connection,
        toAnchorWallet(wallet),
        {
          commitment: "confirmed",
          preflightCommitment: "confirmed",
        },
      );
      const marketProgram = new Program(
        ensureIdlAddress(lvrMarketIdl, marketProgramId),
        provider,
      ) as Program<any>;
      return {
        connection,
        provider,
        wallet,
        walletAddress: wallet.publicKey.toBase58(),
        fightOracleProgramId,
        marketProgramId,
        marketProgram,
        marketConfigPda: findMarketConfigPda(marketProgramId),
        marketConfig: null,
        rpcUrl,
      };
    } catch (error) {
      this.solanaEnabled = false;
      this.solanaDisableReason =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[SOLANA] Disabled: failed to initialize signer/runtime (${this.solanaDisableReason})`,
      );
      return null;
    }
  }

  private createEvmRuntime(chainKey: BettingEvmChain): EvmRuntime {
    const runtimeEnv = resolveBettingEvmRuntimeEnv(chainKey, TARGET_ENV, process.env);
    const chainUpper = chainKey.toUpperCase();
    const enabled = readEnvBoolean(`MM_ENABLE_${chainUpper}`, true);
    const sharedKey = process.env.EVM_PRIVATE_KEY || "";
    const privateKey =
      process.env[`EVM_PRIVATE_KEY_${chainUpper}`] || sharedKey;
    if (!privateKey) {
      const baseWallet = new ethers.Wallet(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      );
      return {
        chainKey,
        provider: new ethers.JsonRpcProvider("http://127.0.0.1:0"),
        wallet: baseWallet,
        walletAddress: baseWallet.address,
        clob: new ethers.Contract(
          ethers.ZeroAddress,
          LVR_ROUTER_ABI,
          new ethers.JsonRpcProvider("http://127.0.0.1:0"),
        ),
        enabled: false,
        rpcUrl: "",
        lvrRouterAddress: "",
      };
    }

    const provider = new ethers.JsonRpcProvider(runtimeEnv.rpcUrl);
    const baseWallet = new ethers.Wallet(privateKey, provider);
    const lvrRouterAddressRaw = runtimeEnv.lvrRouterAddress;
    const lvrRouterAddress =
      lvrRouterAddressRaw.trim().length > 0 ? normalizeAddress(lvrRouterAddressRaw) : "";
    const clob = new ethers.Contract(
      lvrRouterAddress || ethers.ZeroAddress,
      LVR_ROUTER_ABI,
      baseWallet,
    );
    return {
      chainKey,
      provider,
      wallet: baseWallet,
      walletAddress: baseWallet.address,
      clob,
      enabled: enabled && lvrRouterAddress.length > 0,
      rpcUrl: runtimeEnv.rpcUrl,
      lvrRouterAddress,
    };
  }

  async start() {
    console.log(
      `Hyperbet market-maker [${this.instanceId}] env=${TARGET_ENV} lifecycle=${MM_PREDICTION_MARKETS_API_URL}`,
    );
    await this.validateChainReadiness();
    while (true) {
      try {
        await this.marketMakeCycle();
      } catch (error) {
        console.error(
          `[cycle:${this.cycleCount}] ${(error as Error).message}`,
        );
      }
      const jitter =
        RELOAD_DELAY_MIN_MS +
        Math.random() * (RELOAD_DELAY_MAX_MS - RELOAD_DELAY_MIN_MS);
      await sleep(jitter);
    }
  }

  private disableSolana(reason: string) {
    this.solanaEnabled = false;
    this.solanaDisableReason = reason;
    console.warn(`[SOLANA] Disabled: ${reason}`);
  }

  private markSolanaRpcSuccess() {
    this.lastSuccessfulSolanaRpcAt = Date.now();
    return this.lastSuccessfulSolanaRpcAt;
  }

  private handleSolanaOperationalError(
    error: unknown,
    context: string,
    options: { setChainBackoff?: boolean } = {},
  ): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (isSolanaIgnorableRaceError(error)) {
      console.warn(`[SOLANA] ${context}: ${message}`);
      return true;
    }

    if (isSolanaFundingError(error)) {
      this.disableSolana(`funding error during ${context}: ${message}`);
      return true;
    }

    if (isSolanaRpcConnectivityError(error)) {
      const now = Date.now();
      this.solanaRpcBlockedUntil = now + SOLANA_RPC_BACKOFF_MS;
      if (options.setChainBackoff) {
        this.solanaChainCheckBlockedUntil =
          now + SOLANA_CHAIN_CHECK_COOLDOWN_MS;
      }
      const warningAt = options.setChainBackoff
        ? this.lastSolanaChainWarningAt
        : this.lastSolanaRpcWarningAt;
      if (now - warningAt > 10_000) {
        console.warn(
          `[SOLANA] ${context} unavailable at ${this.solanaRuntime?.rpcUrl ?? "unknown"}: ${message}. Backing off for ${Math.round(
            SOLANA_RPC_BACKOFF_MS / 1000,
          )}s.`,
        );
        if (options.setChainBackoff) {
          this.lastSolanaChainWarningAt = now;
        } else {
          this.lastSolanaRpcWarningAt = now;
        }
      }
      return true;
    }

    return false;
  }

  private async validateSolanaReadiness(forceLog = false) {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime) return;

    const now = Date.now();
    if (!forceLog && now < this.solanaChainCheckBlockedUntil) {
      return;
    }

    try {
      const [version, fightOracleAccount, marketProgramAccount, marketConfig, lamports] =
        await Promise.all([
          runtime.connection.getVersion(),
          runtime.connection.getAccountInfo(runtime.fightOracleProgramId, "confirmed"),
          runtime.connection.getAccountInfo(runtime.marketProgramId, "confirmed"),
          fetchAnchorAccount(
            runtime.marketProgram,
            "marketConfig",
            runtime.marketConfigPda,
          ),
          runtime.connection.getBalance(runtime.wallet.publicKey, "confirmed"),
        ]);
      this.markSolanaRpcSuccess();

      if (!fightOracleAccount?.executable) {
        this.disableSolana(
          `fight oracle program ${runtime.fightOracleProgramId.toBase58()} missing or not executable`,
        );
        return;
      }

      if (!marketProgramAccount?.executable) {
        this.disableSolana(
          `gold CLOB program ${runtime.marketProgramId.toBase58()} missing or not executable`,
        );
        return;
      }

      if (!marketConfig) {
        this.disableSolana(
          `market config ${runtime.marketConfigPda.toBase58()} missing`,
        );
        return;
      }

      if (lamports <= 0) {
        this.disableSolana(
          `zero native balance for ${runtime.wallet.publicKey.toBase58()}`,
        );
        return;
      }

      runtime.marketConfig = {
        treasury: asPublicKey(marketConfig.treasury),
        marketMaker: asPublicKey(marketConfig.marketMaker),
        tradeTreasuryFeeBps: asNumber(marketConfig.tradeTreasuryFeeBps),
        tradeMarketMakerFeeBps: asNumber(marketConfig.tradeMarketMakerFeeBps),
        winningsMarketMakerFeeBps: asNumber(
          marketConfig.winningsMarketMakerFeeBps,
        ),
      };

      if (forceLog || !this.solanaReadyLogged) {
        console.log(
          `[SOLANA] Ready on RPC ${runtime.connection.rpcEndpoint} (core ${version["solana-core"] ?? "unknown"}) wallet=${runtime.wallet.publicKey.toBase58()} program=${runtime.marketProgramId.toBase58()}`,
        );
        this.solanaReadyLogged = true;
      }
    } catch (error) {
      if (
        this.handleSolanaOperationalError(error, "readiness check", {
          setChainBackoff: true,
        })
      ) {
        return;
      }
      throw error;
    }
  }

  private async maybeHealthcheckSolana() {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime) return;
    const now = Date.now();
    if (now - this.lastSolanaHealthcheckAt < SOLANA_HEALTHCHECK_INTERVAL_MS) {
      return;
    }
    this.lastSolanaHealthcheckAt = now;

    try {
      const latest = await runtime.connection.getLatestBlockhash("confirmed");
      this.markSolanaRpcSuccess();
      console.log(`[SOLANA] RPC healthy at ${latest.blockhash}`);
    } catch (error) {
      this.handleSolanaOperationalError(error, "healthcheck");
    }
  }

  private async validateChainReadiness() {
    if (this.startupValidated) return;
    this.startupValidated = true;

    await Promise.all(
      this.evmRuntimes.map(async (runtime) => {
        if (!runtime.enabled) return;
        try {
          const [network, code, nativeBalance] = await Promise.all([
            runtime.provider.getNetwork(),
            runtime.provider.getCode(runtime.lvrRouterAddress),
            runtime.provider.getBalance(runtime.walletAddress),
          ]);
          if (code === "0x") {
            runtime.enabled = false;
            console.warn(
              `[${runtime.chainKey.toUpperCase()}] Disabled: no contract at ${runtime.lvrRouterAddress}`,
            );
            return;
          }
          if (nativeBalance <= 0n) {
            runtime.enabled = false;
            console.warn(
              `[${runtime.chainKey.toUpperCase()}] Disabled: zero native balance for ${runtime.walletAddress}`,
            );
            return;
          }
          await runtime.clob.feeBps();
          console.log(
            `[${runtime.chainKey.toUpperCase()}] Ready on chain ${network.chainId.toString()} with ${runtime.lvrRouterAddress}`,
          );
        } catch (error) {
          runtime.enabled = false;
          console.warn(
            `[${runtime.chainKey.toUpperCase()}] Disabled during readiness check: ${(error as Error).message}`,
          );
        }
      }),
    );

    if (!this.solanaEnabled) {
      console.log(
        `[SOLANA] Disabled${this.solanaDisableReason ? `: ${this.solanaDisableReason}` : ""}`,
      );
      return;
    }

    await this.validateSolanaReadiness(true);
  }

  async marketMakeCycle() {
    if (!this.startupValidated) {
      await this.validateChainReadiness();
    }
    this.cycleCount += 1;

    const [predictionMarkets, duelSignal] = await Promise.all([
      this.getPredictionMarkets(),
      this.getDuelSignal(),
    ]);

    await this.cancelStaleOrders();

    for (const runtime of this.evmRuntimes) {
      if (!runtime.enabled) continue;
      await this.evmMarketMake(runtime, predictionMarkets, duelSignal);
    }

    await this.solanaMarketMake(predictionMarkets, duelSignal);
  }

  private async evmMarketMake(
    runtime: EvmRuntime,
    predictionMarkets: PredictionMarketsResponse | null,
    duelSignal: DuelSignal | null,
  ) {
    const lifecycleRecord =
      predictionMarkets?.markets.find((market) => market.chainKey === runtime.chainKey) ??
      null;
    if (!lifecycleRecord?.duelKey) {
      await this.cancelOrdersForChain(runtime.chainKey, "missing-duel");
      return;
    }

    const duelKey = lifecycleRecord.duelKey;
    if (lifecycleRecord.lifecycleStatus !== "OPEN") {
      await this.cancelOrdersForMarket(runtime.chainKey, duelKey, "lifecycle");
      return;
    }

    const marketKey = String(
      lifecycleRecord.marketRef ||
        (await runtime.clob.marketKey(duelKey, EVM_MARKET_KIND_DUEL_WINNER)),
    );
    const market = await runtime.clob.getMarket(
      duelKey,
      EVM_MARKET_KIND_DUEL_WINNER,
    );
    const position = await runtime.clob.positions(marketKey, runtime.walletAddress);
    const openOrders = this.activeOrders.filter(
      (order) => order.chainKey === runtime.chainKey && order.duelKey === duelKey,
    );
    const openYes = openOrders
      .filter((order) => order.side === BUY_SIDE)
      .reduce((sum, order) => sum + order.amount, 0);
    const openNo = openOrders
      .filter((order) => order.side === SELL_SIDE)
      .reduce((sum, order) => sum + order.amount, 0);
    const quoteAgeMs =
      openOrders.length > 0
        ? Date.now() - Math.min(...openOrders.map((order) => order.placedAt))
        : null;

    const snapshot: MarketSnapshot = {
      chainKey: runtime.chainKey,
      lifecycleStatus: lifecycleRecord.lifecycleStatus,
      duelKey,
      marketRef: marketKey,
      bestBid: Number(market.bestBid),
      bestAsk: Number(market.bestAsk) >= MAX_PRICE ? null : Number(market.bestAsk),
      betCloseTimeMs: predictionMarkets?.duel.betCloseTime ?? lifecycleRecord.betCloseTime,
      lastStreamAtMs: predictionMarkets?.updatedAt ?? duelSignal?.updatedAt ?? null,
      lastOracleAtMs:
        lifecycleRecord.syncedAt ??
        predictionMarkets?.updatedAt ??
        duelSignal?.updatedAt ??
        null,
      lastRpcAtMs: Date.now(),
      quoteAgeMs,
      exposure: {
        yes: rawAmountToUnits(BigInt(position.aShares)),
        no: rawAmountToUnits(BigInt(position.bShares)),
        openYes,
        openNo,
      },
    };
    this.exposureByChain.set(runtime.chainKey, {
      yes: snapshot.exposure.yes + snapshot.exposure.openYes,
      no: snapshot.exposure.no + snapshot.exposure.openNo,
    });

    const plan = buildQuotePlan(
      snapshot,
      {
        signalPrice: duelSignal?.midPrice ?? null,
        signalWeight: duelSignal?.weight ?? null,
      },
      this.config,
      Date.now(),
    );

    if (plan.risk.circuitBreaker.active) {
      await this.cancelOrdersForMarket(
        runtime.chainKey,
        duelKey,
        plan.risk.circuitBreaker.reason ?? "risk",
      );
      return;
    }

    await this.reconcileOrder(runtime, duelKey, marketKey, BUY_SIDE, plan);
    await this.reconcileOrder(runtime, duelKey, marketKey, SELL_SIDE, plan);
  }

  private async reconcileOrder(
    runtime: EvmRuntime,
    duelKey: string,
    marketKey: string,
    side: typeof BUY_SIDE | typeof SELL_SIDE,
    plan: ReturnType<typeof buildQuotePlan>,
  ) {
    const existing = this.activeOrders.filter(
      (order) =>
        order.chainKey === runtime.chainKey &&
        order.duelKey === duelKey &&
        order.side === side,
    );
    const primaryOrder = existing[0] ?? null;
    for (const duplicateOrder of existing.slice(1)) {
      await this.cancelTrackedOrder(runtime, duplicateOrder);
    }

    const now = Date.now();
    const decision = evaluateQuoteDecision(
      side === BUY_SIDE ? "BID" : "ASK",
      plan,
      primaryOrder
        ? {
            price: primaryOrder.price,
            units: primaryOrder.amount,
            placedAtMs: primaryOrder.placedAt,
          }
        : null,
      this.config,
      now,
    );

    if (primaryOrder && decision.shouldCancel) {
      await this.cancelTrackedOrder(runtime, primaryOrder);
    }

    if (
      decision.shouldKeep ||
      !decision.shouldPlace ||
      decision.targetPrice == null ||
      decision.targetUnits <= 0
    ) {
      return;
    }

    const rawAmount = unitsToRawAmount(decision.targetUnits);
    const [tradeTreasuryFeeBps, tradeMarketMakerFeeBps] = await Promise.all([
      runtime.clob.tradeTreasuryFeeBps() as Promise<bigint>,
      runtime.clob.tradeMarketMakerFeeBps() as Promise<bigint>,
    ]);
    const cost = computeCost(side, decision.targetPrice, rawAmount);
    const nativeValue =
      cost +
      (cost * tradeTreasuryFeeBps) / 10_000n +
      (cost * tradeMarketMakerFeeBps) / 10_000n;

    const tx = await runtime.clob.placeOrder(
      duelKey,
      EVM_MARKET_KIND_DUEL_WINNER,
      side,
      decision.targetPrice,
      rawAmount,
      {
        value: nativeValue,
        nonce: await this.nextRuntimeNonce(runtime),
      },
    );
    const receipt = await tx.wait();
    const orderId = this.extractOrderId(receipt?.logs ?? [], marketKey);
    if (orderId == null) {
      throw new Error(
        `failed to parse order id for ${runtime.chainKey} ${duelKey} side=${side}`,
      );
    }
    const trackedOrder: TrackedOrder = {
      orderId,
      chainKey: runtime.chainKey,
      duelKey,
      marketKey,
      side,
      price: decision.targetPrice,
      amount: decision.targetUnits,
      placedAt: Date.now(),
    };
    this.activeOrders.push(trackedOrder);
    this.orderHashToSignature.set(this.orderHash(trackedOrder), receipt?.hash ?? tx.hash);
    console.log(
      `[${runtime.chainKey.toUpperCase()}] quote ${side === BUY_SIDE ? "BID" : "ASK"} @${decision.targetPrice} x${decision.targetUnits} order=${orderId}`,
    );
  }

  private orderHash(order: Pick<TrackedOrder, "chainKey" | "duelKey" | "side" | "orderId">): string {
    return createHash("sha256")
      .update(order.chainKey)
      .update("\n")
      .update(order.duelKey)
      .update("\n")
      .update(String(order.side))
      .update("\n")
      .update(String(order.orderId))
      .digest("hex");
  }

  private extractOrderId(logs: readonly unknown[], marketKey: string): number | null {
    const iface = new ethers.Interface(LVR_ROUTER_ABI);
    for (const log of logs as Array<{ topics: string[]; data: string }>) {
      try {
        const parsed = iface.parseLog(log);
        if (
          parsed?.name === "OrderPlaced" &&
          String(parsed.args.marketKey).toLowerCase() === marketKey.toLowerCase()
        ) {
          return Number(parsed.args.orderId);
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
    return null;
  }

  private async nextRuntimeNonce(runtime: EvmRuntime): Promise<number> {
    const cached = this.nextNonceByChain.get(runtime.chainKey);
    if (cached != null) {
      this.nextNonceByChain.set(runtime.chainKey, cached + 1);
      return cached;
    }
    const fresh = await runtime.provider.getTransactionCount(
      runtime.walletAddress,
      "pending",
    );
    this.nextNonceByChain.set(runtime.chainKey, fresh + 1);
    return fresh;
  }

  private async cancelTrackedOrder(runtime: EvmRuntime, order: TrackedOrder) {
    try {
      const tx = await runtime.clob.cancelOrder(
        duelKeyHex(order.duelKey),
        EVM_MARKET_KIND_DUEL_WINNER,
        order.orderId,
        { nonce: await this.nextRuntimeNonce(runtime) },
      );
      await tx.wait();
    } catch (error) {
      const message = String((error as Error).message || "");
      if (!isIgnorableEvmCancelError(error)) {
        console.warn(
          `[${runtime.chainKey.toUpperCase()}] cancel failed for order ${order.orderId}: ${message}`,
        );
      }
    }
    this.removeTrackedOrder(order);
  }

  private removeTrackedOrder(order: TrackedOrder) {
    const index = this.activeOrders.findIndex(
      (candidate) =>
        candidate.chainKey === order.chainKey &&
        candidate.duelKey === order.duelKey &&
        candidate.side === order.side &&
        candidate.orderId === order.orderId,
    );
    if (index >= 0) {
      this.activeOrders.splice(index, 1);
    }
  }

  private async cancelOrdersForChain(chainKey: BettingEvmChain, reason: string) {
    const runtime = this.evmRuntimes.find((candidate) => candidate.chainKey === chainKey);
    if (!runtime) return;
    const orders = this.activeOrders.filter((order) => order.chainKey === chainKey);
    for (const order of orders) {
      await this.cancelTrackedOrder(runtime, order);
    }
    if (orders.length > 0) {
      console.log(`[${chainKey.toUpperCase()}] cancelled ${orders.length} orders (${reason})`);
    }
  }

  private async cancelOrdersForMarket(
    chainKey: BettingEvmChain,
    duelKey: string,
    reason: string,
  ) {
    const runtime = this.evmRuntimes.find((candidate) => candidate.chainKey === chainKey);
    if (!runtime) return;
    const orders = this.activeOrders.filter(
      (order) => order.chainKey === chainKey && order.duelKey === duelKey,
    );
    for (const order of orders) {
      await this.cancelTrackedOrder(runtime, order);
    }
    if (orders.length > 0) {
      console.log(
        `[${chainKey.toUpperCase()}] cancelled ${orders.length} orders for ${duelKey} (${reason})`,
      );
    }
  }

  private async cancelStaleOrders() {
    const now = Date.now();
    for (const runtime of this.evmRuntimes) {
      if (!runtime.enabled) continue;
      const staleOrders = this.activeOrders.filter(
        (order) =>
          order.chainKey === runtime.chainKey &&
          now - order.placedAt >= this.config.maxQuoteAgeMs,
      );
      for (const order of staleOrders) {
        await this.cancelTrackedOrder(runtime, order);
      }
    }

    const staleSolanaOrders = this.activeOrders.filter(
      (order) =>
        order.chainKey === "solana" &&
        now - order.placedAt >= this.config.maxQuoteAgeMs,
    );
    for (const order of staleSolanaOrders) {
      await this.cancelTrackedSolanaOrder(order, "stale");
    }
  }

  private async syncSolanaMarket(
    duelState: PublicKey,
    marketStatePda: PublicKey,
  ): Promise<boolean> {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime) return false;

    try {
      const signature = await runSolanaWithRecovery(
        () =>
          runtime.marketProgram.methods
            .syncMarketFromDuel()
            .accountsPartial({
              marketState: marketStatePda,
              duelState,
            })
            .rpc(),
        runtime.connection,
      );
      this.markSolanaRpcSuccess();
      if (typeof signature === "string") {
        this.lastSolanaTxSignature = signature;
      }
      return true;
    } catch (error) {
      if (this.handleSolanaOperationalError(error, "sync market")) {
        return false;
      }
      throw error;
    }
  }

  private async getManagedSolanaOrder(
    order: TrackedOrder | null | undefined,
  ): Promise<SolanaManagedOrder | null> {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime || !order || order.chainKey !== "solana") {
      return null;
    }

    const orderPda = findOrderPda(
      runtime.marketProgramId,
      new PublicKey(order.marketKey),
      BigInt(order.orderId),
    );
    let orderAccount: Record<string, unknown> | null = null;
    try {
      orderAccount = await fetchAnchorAccount(
        runtime.marketProgram,
        "order",
        orderPda,
      );
      this.markSolanaRpcSuccess();
    } catch (error) {
      if (this.handleSolanaOperationalError(error, "read order")) {
        return null;
      }
      throw error;
    }
    if (!orderAccount || !Boolean(orderAccount.active)) {
      return null;
    }

    const remainingRawAmount = asBigInt(orderAccount.amount) - asBigInt(orderAccount.filled);
    if (remainingRawAmount <= 0n) {
      return null;
    }

    order.price = asNumber(orderAccount.price, order.price);
    order.amount = rawAmountToUnits(remainingRawAmount);
    return {
      trackedOrder: order,
      remainingUnits: rawAmountToUnits(remainingRawAmount),
      remainingRawAmount,
    };
  }

  private async cancelTrackedSolanaOrder(order: TrackedOrder, reason: string) {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime || order.chainKey !== "solana") return;

    const marketStatePda = new PublicKey(order.marketKey);
    const duelState = findDuelStatePda(
      runtime.fightOracleProgramId,
      duelKeyHexToBytes(order.duelKey),
    );
    const orderPda = findOrderPda(
      runtime.marketProgramId,
      marketStatePda,
      BigInt(order.orderId),
    );
    const priceLevel = findPriceLevelPda(
      runtime.marketProgramId,
      marketStatePda,
      order.side,
      order.price,
    );
    const vaultPda = findClobVaultPda(runtime.marketProgramId, marketStatePda);

    try {
      const signature = await runSolanaWithRecovery(
        () =>
          runtime.marketProgram.methods
            .cancelOrder(new BN(order.orderId), order.side, order.price)
            .accountsPartial({
              marketState: marketStatePda,
              duelState,
              order: orderPda,
              priceLevel,
              vault: vaultPda,
              user: runtime.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        runtime.connection,
      );
      this.markSolanaRpcSuccess();
      if (typeof signature === "string") {
        this.lastSolanaTxSignature = signature;
      }
      this.removeTrackedOrder(order);
      console.log(
        `[SOLANA] cancelled ${order.side === BUY_SIDE ? "BID" : "ASK"} order ${order.orderId} (${reason})`,
      );
    } catch (error) {
      if (isSolanaIgnorableRaceError(error)) {
        this.removeTrackedOrder(order);
        return;
      }
      if (this.handleSolanaOperationalError(error, "cancel order")) {
        return;
      }
      throw error;
    }
  }

  private async cancelSolanaOrdersForChain(reason: string) {
    const orders = this.activeOrders.filter((order) => order.chainKey === "solana");
    for (const order of orders) {
      await this.cancelTrackedSolanaOrder(order, reason);
    }
    if (orders.length > 0) {
      console.log(`[SOLANA] cancelled ${orders.length} orders (${reason})`);
    }
  }

  private async cancelSolanaOrdersForMarket(duelKey: string, reason: string) {
    const orders = this.activeOrders.filter(
      (order) => order.chainKey === "solana" && order.duelKey === duelKey,
    );
    for (const order of orders) {
      await this.cancelTrackedSolanaOrder(order, reason);
    }
    if (orders.length > 0) {
      console.log(
        `[SOLANA] cancelled ${orders.length} orders for ${duelKey} (${reason})`,
      );
    }
  }

  private async claimSolanaMarket(
    duelKey: string,
    duelState: PublicKey,
    marketStatePda: PublicKey,
    userBalancePda: PublicKey,
    vaultPda: PublicKey,
  ) {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime || !runtime.marketConfig) return;

    const userBalance = await fetchAnchorAccount(
      runtime.marketProgram,
      "userBalance",
      userBalancePda,
    );
    this.markSolanaRpcSuccess();
    const yesShares = asBigInt(userBalance?.aShares);
    const noShares = asBigInt(userBalance?.bShares);
    if (yesShares <= 0n && noShares <= 0n) {
      return;
    }

    try {
      const signature = await runSolanaWithRecovery(
        () =>
          runtime.marketProgram.methods
            .claim()
            .accountsPartial({
              marketState: marketStatePda,
              duelState,
              userBalance: userBalancePda,
              config: runtime.marketConfigPda,
              marketMaker: runtime.marketConfig.marketMaker,
              vault: vaultPda,
              user: runtime.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        runtime.connection,
      );
      this.markSolanaRpcSuccess();
      if (typeof signature === "string") {
        this.lastSolanaTxSignature = signature;
      }
      this.exposureByChain.set("solana", { yes: 0, no: 0 });
      console.log(`[SOLANA] claimed resolved market ${duelKey}`);
    } catch (error) {
      if (this.handleSolanaOperationalError(error, "claim")) {
        return;
      }
      throw error;
    }
  }

  private async placeSolanaOrder(
    duelKey: string,
    duelState: PublicKey,
    marketStatePda: PublicKey,
    vaultPda: PublicKey,
    side: typeof BUY_SIDE | typeof SELL_SIDE,
    price: number,
    units: number,
    orderId: bigint,
  ) {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime || !runtime.marketConfig) return;

    const userBalancePda = findUserBalancePda(
      runtime.marketProgramId,
      marketStatePda,
      runtime.wallet.publicKey,
    );
    const orderPda = findOrderPda(
      runtime.marketProgramId,
      marketStatePda,
      orderId,
    );
    const priceLevel = findPriceLevelPda(
      runtime.marketProgramId,
      marketStatePda,
      side,
      price,
    );
    const rawAmount = unitsToRawAmount(units);

    try {
      const signature = await runSolanaWithRecovery(
        () =>
          runtime.marketProgram.methods
            .placeOrder(
              new BN(orderId.toString()),
              side,
              price,
              new BN(rawAmount.toString()),
            )
            .accountsPartial({
              marketState: marketStatePda,
              duelState,
              userBalance: userBalancePda,
              newOrder: orderPda,
              restingLevel: priceLevel,
              config: runtime.marketConfigPda,
              treasury: runtime.marketConfig.treasury,
              marketMaker: runtime.marketConfig.marketMaker,
              vault: vaultPda,
              user: runtime.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        runtime.connection,
      );
      this.markSolanaRpcSuccess();
      if (typeof signature === "string") {
        this.lastSolanaTxSignature = signature;
      }

      const trackedOrder: TrackedOrder = {
        orderId: Number(orderId),
        chainKey: "solana",
        duelKey,
        marketKey: marketStatePda.toBase58(),
        side,
        price,
        amount: units,
        placedAt: Date.now(),
      };
      this.activeOrders.push(trackedOrder);
      if (typeof signature === "string") {
        this.orderHashToSignature.set(this.orderHash(trackedOrder), signature);
      }
      console.log(
        `[SOLANA] quote ${side === BUY_SIDE ? "BID" : "ASK"} @${price} x${units} order=${orderId.toString()}`,
      );
    } catch (error) {
      if (this.handleSolanaOperationalError(error, "place order")) {
        return;
      }
      throw error;
    }
  }

  private async reconcileSolanaOrder(params: {
    duelKey: string;
    duelState: PublicKey;
    marketStatePda: PublicKey;
    vaultPda: PublicKey;
    side: typeof BUY_SIDE | typeof SELL_SIDE;
    plan: ReturnType<typeof buildQuotePlan>;
    nextOrderIdCursor: { value: bigint };
  }) {
    const existing = this.activeOrders.filter(
      (order) =>
        order.chainKey === "solana" &&
        order.duelKey === params.duelKey &&
        order.side === params.side,
    );
    const primaryOrder = existing[0] ?? null;
    for (const duplicateOrder of existing.slice(1)) {
      await this.cancelTrackedSolanaOrder(duplicateOrder, "duplicate");
    }

    const activeOrder =
      primaryOrder != null
        ? await this.getManagedSolanaOrder(primaryOrder)
        : null;
    if (primaryOrder && !activeOrder) {
      this.removeTrackedOrder(primaryOrder);
    }

    const now = Date.now();
    const decision = evaluateQuoteDecision(
      params.side === BUY_SIDE ? "BID" : "ASK",
      params.plan,
      activeOrder
        ? {
            price: activeOrder.trackedOrder.price,
            units: activeOrder.remainingUnits,
            placedAtMs: activeOrder.trackedOrder.placedAt,
          }
        : null,
      this.config,
      now,
    );

    if (activeOrder && decision.shouldCancel) {
      await this.cancelTrackedSolanaOrder(
        activeOrder.trackedOrder,
        decision.reason ?? "quote-refresh",
      );
    } else if (activeOrder && decision.shouldKeep) {
      return;
    }

    if (
      !decision.shouldPlace ||
      decision.targetPrice == null ||
      decision.targetUnits <= 0
    ) {
      return;
    }

    const nextOrderId = params.nextOrderIdCursor.value;
    params.nextOrderIdCursor.value = nextOrderId + 1n;
    await this.placeSolanaOrder(
      params.duelKey,
      params.duelState,
      params.marketStatePda,
      params.vaultPda,
      params.side,
      decision.targetPrice,
      decision.targetUnits,
      nextOrderId,
    );
  }

  private async solanaMarketMake(
    predictionMarkets: PredictionMarketsResponse | null,
    duelSignal: DuelSignal | null,
  ) {
    const runtime = this.solanaRuntime;
    if (!this.solanaEnabled || !runtime) return;

    await this.validateSolanaReadiness();
    await this.maybeHealthcheckSolana();
    const now = Date.now();
    if (
      !this.solanaEnabled ||
      now < this.solanaRpcBlockedUntil ||
      now < this.solanaChainCheckBlockedUntil ||
      !runtime.marketConfig
    ) {
      return;
    }

    const lifecycleRecord =
      predictionMarkets?.markets.find((market) => market.chainKey === "solana") ??
      null;
    if (!lifecycleRecord?.duelKey) {
      await this.cancelSolanaOrdersForChain("missing-duel");
      return;
    }

    const duelKey = lifecycleRecord.duelKey;
    const duelState = findDuelStatePda(
      runtime.fightOracleProgramId,
      duelKeyHexToBytes(duelKey),
    );
    const marketStatePda = findMarketPda(runtime.marketProgramId, duelState);
    const vaultPda = findClobVaultPda(runtime.marketProgramId, marketStatePda);
    const userBalancePda = findUserBalancePda(
      runtime.marketProgramId,
      marketStatePda,
      runtime.wallet.publicKey,
    );

    const synced = await this.syncSolanaMarket(duelState, marketStatePda);
    if (!synced) {
      return;
    }

    const [marketState, userBalance] = await Promise.all([
      fetchAnchorAccount(runtime.marketProgram, "marketState", marketStatePda),
      fetchAnchorAccount(runtime.marketProgram, "userBalance", userBalancePda),
    ]);
    this.markSolanaRpcSuccess();

    if (!marketState) {
      await this.cancelSolanaOrdersForMarket(duelKey, "missing-market");
      return;
    }

    if (lifecycleRecord.lifecycleStatus !== "OPEN") {
      await this.cancelSolanaOrdersForMarket(duelKey, "lifecycle");
      if (lifecycleRecord.lifecycleStatus === "RESOLVED") {
        await this.claimSolanaMarket(
          duelKey,
          duelState,
          marketStatePda,
          userBalancePda,
          vaultPda,
        );
      }
      return;
    }

    const yesBidOrder = await this.getManagedSolanaOrder(
      this.activeOrders.find(
        (order) =>
          order.chainKey === "solana" &&
          order.duelKey === duelKey &&
          order.side === BUY_SIDE,
      ) ?? null,
    ).catch(() => null);
    const noAskOrder = await this.getManagedSolanaOrder(
      this.activeOrders.find(
        (order) =>
          order.chainKey === "solana" &&
          order.duelKey === duelKey &&
          order.side === SELL_SIDE,
      ) ?? null,
    ).catch(() => null);
    const openOrders = [yesBidOrder, noAskOrder].filter(
      (order): order is SolanaManagedOrder => order != null,
    );
    const quoteAgeMs =
      openOrders.length > 0
        ? now - Math.min(...openOrders.map((order) => order.trackedOrder.placedAt))
        : null;
    const openYes = openOrders
      .filter((order) => order.trackedOrder.side === BUY_SIDE)
      .reduce((sum, order) => sum + order.remainingUnits, 0);
    const openNo = openOrders
      .filter((order) => order.trackedOrder.side === SELL_SIDE)
      .reduce((sum, order) => sum + order.remainingUnits, 0);

    const snapshot: MarketSnapshot = {
      chainKey: "solana",
      lifecycleStatus: lifecycleRecord.lifecycleStatus,
      duelKey,
      marketRef: marketStatePda.toBase58(),
      bestBid: Math.max(0, asNumber(marketState.bestBid)) || null,
      bestAsk: (() => {
        const bestAsk = asNumber(marketState.bestAsk, MAX_PRICE);
        return bestAsk <= 0 || bestAsk >= MAX_PRICE ? null : bestAsk;
      })(),
      betCloseTimeMs:
        predictionMarkets?.duel.betCloseTime ?? lifecycleRecord.betCloseTime,
      lastStreamAtMs: predictionMarkets?.updatedAt ?? duelSignal?.updatedAt ?? null,
      lastOracleAtMs:
        lifecycleRecord.syncedAt ??
        predictionMarkets?.updatedAt ??
        duelSignal?.updatedAt ??
        null,
      lastRpcAtMs: this.lastSuccessfulSolanaRpcAt,
      quoteAgeMs,
      exposure: {
        yes: rawAmountToUnits(asBigInt(userBalance?.aShares)),
        no: rawAmountToUnits(asBigInt(userBalance?.bShares)),
        openYes,
        openNo,
      },
    };
    this.exposureByChain.set("solana", {
      yes: snapshot.exposure.yes + snapshot.exposure.openYes,
      no: snapshot.exposure.no + snapshot.exposure.openNo,
    });

    const plan = buildQuotePlan(
      snapshot,
      {
        signalPrice: duelSignal?.midPrice ?? null,
        signalWeight: duelSignal?.weight ?? null,
      },
      this.config,
      now,
    );
    if (plan.risk.circuitBreaker.active) {
      await this.cancelSolanaOrdersForMarket(
        duelKey,
        plan.risk.circuitBreaker.reason ?? "risk",
      );
      return;
    }

    const nextOrderIdCursor = {
      value: asBigInt(marketState.nextOrderId, 0n),
    };
    await this.reconcileSolanaOrder({
      duelKey,
      duelState,
      marketStatePda,
      vaultPda,
      side: BUY_SIDE,
      plan,
      nextOrderIdCursor,
    });
    await this.reconcileSolanaOrder({
      duelKey,
      duelState,
      marketStatePda,
      vaultPda,
      side: SELL_SIDE,
      plan,
      nextOrderIdCursor,
    });
  }

  private async getPredictionMarkets(): Promise<PredictionMarketsResponse | null> {
    const now = Date.now();
    if (
      this.lastPredictionMarkets &&
      now - this.lastPredictionMarketsAt < MM_MARKETS_CACHE_MS
    ) {
      return this.lastPredictionMarkets;
    }

    try {
      const response = await fetch(MM_PREDICTION_MARKETS_API_URL, {
        cache: "no-store",
      });
      if (!response.ok) {
        return this.lastPredictionMarkets;
      }
      const parsed = normalizePredictionMarketsResponse(await response.json());
      if (!parsed) {
        return this.lastPredictionMarkets;
      }
      this.lastPredictionMarkets = parsed;
      this.lastPredictionMarketsAt = now;
      return parsed;
    } catch {
      return this.lastPredictionMarkets;
    }
  }

  private async getDuelSignal(): Promise<DuelSignal | null> {
    if (!MM_ENABLE_DUEL_SIGNAL || !MM_DUEL_STATE_API_URL) {
      return null;
    }

    const now = Date.now();
    if (this.lastDuelSignal && now - this.lastDuelSignalAt < MM_DUEL_SIGNAL_CACHE_MS) {
      return this.lastDuelSignal;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      MM_DUEL_SIGNAL_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(MM_DUEL_STATE_API_URL, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return this.lastDuelSignal;
      const payload = (await response.json()) as { cycle?: Record<string, unknown> };
      const cycle = payload.cycle ?? null;
      if (!cycle) return this.lastDuelSignal;
      const phase = String(cycle.phase ?? cycle.state ?? "").toUpperCase();
      if (!phase) return this.lastDuelSignal;

      const agent1 = asRecord(cycle.agent1);
      const agent2 = asRecord(cycle.agent2);
      const readFiniteNumber = (...candidates: unknown[]): number => {
        for (const candidate of candidates) {
          const parsed = Number(candidate);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        return Number.NaN;
      };
      const readAgentId = (agent: Record<string, unknown> | null): string =>
        String(agent?.id ?? agent?.characterId ?? "");
      const readAgentName = (agent: Record<string, unknown> | null): string =>
        String(agent?.name ?? "").trim().toLowerCase();

      let implied = 500;
      let signalWeight = 0;

      if (phase === "RESOLUTION") {
        const winnerId = String(cycle.winnerId || "");
        const winnerName = String(cycle.winnerName || "").trim().toLowerCase();
        const agent1Id = readAgentId(agent1);
        const agent1Name = readAgentName(agent1);
        if (winnerId && agent1Id && winnerId.toLowerCase() === agent1Id.toLowerCase()) {
          implied = 985;
          signalWeight = MM_DUEL_SIGNAL_WEIGHT;
        } else if (winnerId && agent1Id) {
          implied = 15;
          signalWeight = MM_DUEL_SIGNAL_WEIGHT;
        } else if (winnerName && agent1Name) {
          implied = winnerName === agent1Name ? 985 : 15;
          signalWeight = MM_DUEL_SIGNAL_WEIGHT;
        }
      } else if (phase === "FIGHTING") {
        const hp1 = readFiniteNumber(agent1?.hp, agent1?.currentHp, agent1?.health);
        const max1 = readFiniteNumber(agent1?.maxHp, agent1?.maxHealth, agent1?.startingHp);
        const hp2 = readFiniteNumber(agent2?.hp, agent2?.currentHp, agent2?.health);
        const max2 = readFiniteNumber(agent2?.maxHp, agent2?.maxHealth, agent2?.startingHp);
        if (
          Number.isFinite(hp1) &&
          Number.isFinite(max1) &&
          Number.isFinite(hp2) &&
          Number.isFinite(max2) &&
          max1 > 0 &&
          max2 > 0
        ) {
          const edge = clamp(hp1 / max1 - hp2 / max2, -1, 1);
          implied = Math.round(clamp(0.5 + edge * MM_DUEL_HP_EDGE_MULTIPLIER, 0.02, 0.98) * 1000);
          signalWeight = MM_DUEL_SIGNAL_WEIGHT;
        }
      }

      const signal = {
        midPrice: clamp(implied, 1, 999),
        phase,
        weight: clamp(signalWeight, 0, 1),
        updatedAt: now,
      } satisfies DuelSignal;
      this.lastDuelSignal = signal;
      this.lastDuelSignalAt = now;
      return signal;
    } catch {
      return this.lastDuelSignal;
    } finally {
      clearTimeout(timeout);
    }
  }

  getInventory() {
    const aggregate = { yes: 0, no: 0 };
    for (const exposure of this.exposureByChain.values()) {
      aggregate.yes += exposure.yes;
      aggregate.no += exposure.no;
    }
    return aggregate;
  }

  getActiveOrders() {
    return [...this.activeOrders];
  }

  getConfig() {
    const chainStatus = Object.fromEntries(
      this.evmRuntimes.map((runtime) => [runtime.chainKey, runtime.enabled]),
    ) as Record<BettingEvmChain, boolean>;
    const runtime = this.solanaRuntime;
    return {
      instanceId: this.instanceId,
      targetEnvironment: TARGET_ENV,
      predictionMarketsApiUrl: MM_PREDICTION_MARKETS_API_URL,
      duelSignalApiUrl: MM_DUEL_STATE_API_URL,
      bscEnabled: chainStatus.bsc,
      baseEnabled: chainStatus.base,
      avaxEnabled: chainStatus.avax,
      solanaEnabled: this.solanaEnabled,
      targetSpreadBps: this.config.targetSpreadBps,
      maxInventoryCap: this.config.maxInventoryPerSide,
      toxicityThresholdBps: this.config.toxicityThresholdBps,
      maxOrdersPerSide: 1,
      cancelStaleAgeMs: this.config.maxQuoteAgeMs,
      solanaDisableReason: this.solanaDisableReason,
      solanaWalletPublicKey: runtime?.wallet.publicKey.toBase58() ?? null,
      solanaFightOracleProgramId: runtime?.fightOracleProgramId.toBase58() ?? null,
      solanaLvrRouterProgramId: runtime?.marketProgramId.toBase58() ?? null,
      solanaProgramId: runtime?.marketProgramId.toBase58() ?? null,
      solanaMarketConfigPda: runtime?.marketConfigPda.toBase58() ?? null,
      solanaRpcUrl: runtime?.rpcUrl ?? null,
      solanaLastSuccessfulRpcAt: this.lastSuccessfulSolanaRpcAt,
      solanaLastTxSignature: this.lastSolanaTxSignature,
    };
  }
}

function duelKeyHex(value: string): string {
  const normalized = normalizePredictionMarketDuelKeyHex(value);
  if (!normalized) {
    throw new Error(`invalid duel key '${value}'`);
  }
  return normalized;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mm = new CrossChainMarketMaker();
  mm.start().catch((error) => {
    console.error("[mm] fatal:", error);
    process.exit(1);
  });
}

export type { TrackedOrder };
