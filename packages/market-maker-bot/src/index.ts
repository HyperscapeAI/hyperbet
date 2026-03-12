import { createHash } from "node:crypto";

import {
  BETTING_EVM_CHAIN_ORDER,
  type BettingAppEnvironment,
  type BettingChainKey,
  type BettingEvmChain,
  type PredictionMarketLifecycleRecord,
  type PredictionMarketLifecycleStatus,
  defaultRpcUrlForEvmNetwork,
  resolveBettingEvmDeploymentForChain,
} from "@hyperbet/chain-registry";
import {
  DEFAULT_MARKET_MAKER_CONFIG,
  buildQuotePlan,
  type MarketMakerConfig,
  type MarketSnapshot,
} from "@hyperbet/mm-core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const MARKET_KIND_DUEL_WINNER = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const MAX_PRICE = 1000;
const SHARE_UNIT_SIZE = 1_000n;

const GOLD_CLOB_ABI = [
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
  clob: ethers.Contract;
  enabled: boolean;
  rpcUrl: string;
  goldClobAddress: string;
};

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
const MM_ENABLE_SOLANA = readEnvBoolean("MM_ENABLE_SOLANA", true);
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

export class CrossChainMarketMaker {
  private readonly instanceId: string;
  private readonly config: MarketMakerConfig;
  private readonly evmRuntimes: EvmRuntime[];
  private readonly solanaConnection: Connection;
  private readonly solanaWallet: Keypair;
  private readonly solanaProgramId: PublicKey;
  private readonly activeOrders: TrackedOrder[] = [];
  private readonly exposureByChain = new Map<BettingChainKey, { yes: number; no: number }>();
  private readonly orderHashToSignature = new Map<string, string>();
  private startupValidated = false;
  private cycleCount = 0;
  private solanaEnabled = MM_ENABLE_SOLANA;
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

    this.solanaConnection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    );
    try {
      const keyBytes = decodeSolanaSecretKey(process.env.SOLANA_PRIVATE_KEY || "");
      this.solanaWallet =
        keyBytes.length === 32
          ? Keypair.fromSeed(keyBytes)
          : Keypair.fromSecretKey(keyBytes);
    } catch {
      this.solanaWallet = Keypair.generate();
      console.warn(
        "[SOLANA] Using a generated wallet. Set SOLANA_PRIVATE_KEY for production.",
      );
    }
    this.solanaProgramId = new PublicKey(
      process.env.SOLANA_ARENA_MARKET_PROGRAM_ID ||
        "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
    );
  }

  private createEvmRuntime(chainKey: BettingEvmChain): EvmRuntime {
    const deployment = resolveBettingEvmDeploymentForChain(chainKey, TARGET_ENV);
    const chainUpper = chainKey.toUpperCase();
    const enabled = readEnvBoolean(`MM_ENABLE_${chainUpper}`, chainKey !== "avax");
    const sharedKey = process.env.EVM_PRIVATE_KEY || "";
    const privateKey =
      process.env[`EVM_PRIVATE_KEY_${chainUpper}`] || sharedKey;
    if (!privateKey) {
      return {
        chainKey,
        provider: new ethers.JsonRpcProvider("http://127.0.0.1:0"),
        wallet: new ethers.Wallet(
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        ),
        clob: new ethers.Contract(
          ethers.ZeroAddress,
          GOLD_CLOB_ABI,
          new ethers.JsonRpcProvider("http://127.0.0.1:0"),
        ),
        enabled: false,
        rpcUrl: "",
        goldClobAddress: "",
      };
    }

    const rpcUrl =
      process.env[`EVM_${chainUpper}_RPC_URL`] ||
      process.env[deployment.rpcEnvVar] ||
      "";
    const resolvedRpcUrl =
      rpcUrl.trim().length > 0
        ? rpcUrl.trim()
        : defaultRpcUrlForEvmNetwork(deployment.networkKey);
    const provider = new ethers.JsonRpcProvider(resolvedRpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const goldClobAddressRaw =
      process.env[`CLOB_CONTRACT_ADDRESS_${chainUpper}`] || deployment.goldClobAddress;
    const goldClobAddress =
      goldClobAddressRaw.trim().length > 0 ? normalizeAddress(goldClobAddressRaw) : "";
    const clob = new ethers.Contract(goldClobAddress || ethers.ZeroAddress, GOLD_CLOB_ABI, wallet);
    return {
      chainKey,
      provider,
      wallet,
      clob,
      enabled: enabled && goldClobAddress.length > 0,
      rpcUrl: resolvedRpcUrl,
      goldClobAddress,
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

  private async validateChainReadiness() {
    if (this.startupValidated) return;
    this.startupValidated = true;

    await Promise.all(
      this.evmRuntimes.map(async (runtime) => {
        if (!runtime.enabled) return;
        try {
          const [network, code, nativeBalance] = await Promise.all([
            runtime.provider.getNetwork(),
            runtime.provider.getCode(runtime.goldClobAddress),
            runtime.provider.getBalance(runtime.wallet.address),
          ]);
          if (code === "0x") {
            runtime.enabled = false;
            console.warn(
              `[${runtime.chainKey.toUpperCase()}] Disabled: no contract at ${runtime.goldClobAddress}`,
            );
            return;
          }
          if (nativeBalance <= 0n) {
            runtime.enabled = false;
            console.warn(
              `[${runtime.chainKey.toUpperCase()}] Disabled: zero native balance for ${runtime.wallet.address}`,
            );
            return;
          }
          await runtime.clob.feeBps();
          console.log(
            `[${runtime.chainKey.toUpperCase()}] Ready on chain ${network.chainId.toString()} with ${runtime.goldClobAddress}`,
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
      console.log("[SOLANA] Disabled via MM_ENABLE_SOLANA=false");
      return;
    }

    try {
      const [version, account] = await Promise.all([
        this.solanaConnection.getVersion(),
        this.solanaConnection.getAccountInfo(this.solanaProgramId, "confirmed"),
      ]);
      if (!account?.executable) {
        this.solanaEnabled = false;
        console.warn(
          `[SOLANA] Disabled: program ${this.solanaProgramId.toBase58()} missing or not executable.`,
        );
        return;
      }
      console.log(
        `[SOLANA] Ready on RPC ${this.solanaConnection.rpcEndpoint} (core ${version["solana-core"] ?? "unknown"})`,
      );
    } catch (error) {
      this.solanaEnabled = false;
      console.warn(
        `[SOLANA] Disabled during readiness check: ${(error as Error).message}`,
      );
    }
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

    await this.solanaMarketMake(predictionMarkets);
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
        (await runtime.clob.marketKey(duelKey, MARKET_KIND_DUEL_WINNER)),
    );
    const market = await runtime.clob.getMarket(duelKey, MARKET_KIND_DUEL_WINNER);
    const position = await runtime.clob.positions(marketKey, runtime.wallet.address);
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

    await this.reconcileOrder(runtime, duelKey, marketKey, BUY_SIDE, plan.bidPrice, plan.bidUnits);
    await this.reconcileOrder(runtime, duelKey, marketKey, SELL_SIDE, plan.askPrice, plan.askUnits);
  }

  private async reconcileOrder(
    runtime: EvmRuntime,
    duelKey: string,
    marketKey: string,
    side: typeof BUY_SIDE | typeof SELL_SIDE,
    targetPrice: number | null,
    targetUnits: number,
  ) {
    const existing = this.activeOrders.filter(
      (order) =>
        order.chainKey === runtime.chainKey &&
        order.duelKey === duelKey &&
        order.side === side,
    );
    const needsRefresh =
      targetPrice == null ||
      targetUnits <= 0 ||
      existing.length === 0 ||
      existing.some(
        (order) =>
          Date.now() - order.placedAt >= this.config.maxQuoteAgeMs ||
          order.price !== targetPrice ||
          order.amount !== targetUnits,
      );

    if (needsRefresh) {
      for (const order of existing) {
        await this.cancelTrackedOrder(runtime, order);
      }
    }

    if (targetPrice == null || targetUnits <= 0 || !needsRefresh) {
      return;
    }

    const rawAmount = unitsToRawAmount(targetUnits);
    const [tradeTreasuryFeeBps, tradeMarketMakerFeeBps] = await Promise.all([
      runtime.clob.tradeTreasuryFeeBps() as Promise<bigint>,
      runtime.clob.tradeMarketMakerFeeBps() as Promise<bigint>,
    ]);
    const cost = computeCost(side, targetPrice, rawAmount);
    const nativeValue =
      cost +
      (cost * tradeTreasuryFeeBps) / 10_000n +
      (cost * tradeMarketMakerFeeBps) / 10_000n;

    const tx = await runtime.clob.placeOrder(
      duelKey,
      MARKET_KIND_DUEL_WINNER,
      side,
      targetPrice,
      rawAmount,
      { value: nativeValue },
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
      price: targetPrice,
      amount: targetUnits,
      placedAt: Date.now(),
    };
    this.activeOrders.push(trackedOrder);
    this.orderHashToSignature.set(this.orderHash(trackedOrder), receipt?.hash ?? tx.hash);
    console.log(
      `[${runtime.chainKey.toUpperCase()}] quote ${side === BUY_SIDE ? "BID" : "ASK"} @${targetPrice} x${targetUnits} order=${orderId}`,
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
    const iface = new ethers.Interface(GOLD_CLOB_ABI);
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

  private async cancelTrackedOrder(runtime: EvmRuntime, order: TrackedOrder) {
    try {
      const tx = await runtime.clob.cancelOrder(
        duelKeyHex(order.duelKey),
        MARKET_KIND_DUEL_WINNER,
        order.orderId,
      );
      await tx.wait();
    } catch (error) {
      const message = String((error as Error).message || "");
      if (
        !message.includes("order inactive") &&
        !message.includes("already filled") &&
        !message.includes("not maker")
      ) {
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
  }

  private async solanaMarketMake(predictionMarkets: PredictionMarketsResponse | null) {
    if (!this.solanaEnabled) return;
    const now = Date.now();
    if (now - this.lastSolanaHealthcheckAt < SOLANA_HEALTHCHECK_INTERVAL_MS) {
      return;
    }
    this.lastSolanaHealthcheckAt = now;
    try {
      const [latest, account] = await Promise.all([
        this.solanaConnection.getLatestBlockhash("confirmed"),
        this.solanaConnection.getAccountInfo(this.solanaProgramId, "confirmed"),
      ]);
      if (!account?.executable) {
        this.solanaEnabled = false;
        console.warn(
          `[SOLANA] Disabled: program ${this.solanaProgramId.toBase58()} missing or not executable.`,
        );
        return;
      }

      const solanaMarket =
        predictionMarkets?.markets.find((market) => market.chainKey === "solana") ?? null;
      if (solanaMarket?.lifecycleStatus === "OPEN") {
        console.warn(
          `[SOLANA] Lifecycle open for ${solanaMarket.marketRef ?? "unknown"}; external bot execution is not enabled in this tranche.`,
        );
      }
      console.log(`[SOLANA] RPC healthy at ${latest.blockhash}`);
    } catch (error) {
      this.solanaEnabled = false;
      console.error(`[SOLANA] ${(error as Error).message}`);
    }
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
      solanaProgramId: this.solanaProgramId.toBase58(),
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
