import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { BN, utils } from "@coral-xyz/anchor";
import {
  type AccountInfo,
  type AccountMeta,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  type Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { findClobConfigPda, findClobVaultPda } from "../lib/clobPdas";
import { duelKeyHexToBytes, shortDuelKey } from "../lib/duelKey";
import { deriveTwoSidedClobProbabilityPercent } from "../lib/solanaMarketPresentation";
import {
  DUEL_WINNER_MARKET_KIND,
  findDuelStatePda,
  findMarketStatePda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
} from "../lib/pdas";
import {
  createPrograms,
  createReadonlyPrograms,
  type DuelProgramAddresses,
  type SigningWalletLike,
} from "../lib/programs";
import {
  confirmSignatureViaRpc,
  fetchPriorityFeeEstimate,
  getLatestBlockhashViaRpc,
  HELIUS_SENDER_MIN_TIP_LAMPORTS,
  inspectSignatureViaRpc,
  randomJitoTipAccount,
  sendRawTransactionViaRpc,
  sendViaHeliusSender,
  startHeliusSenderWarmup,
} from "../lib/solanaRpc";
import { SOLANA_CLUSTER } from "../lib/solanaConfig";
import {
  normalizePredictionMarketDuelKeyHex,
  usePredictionMarketLifecycle,
} from "../lib/solanaPredictionMarkets";
import {
  derivePredictionMarketUiState,
  EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
  type PredictionMarketClaimKind,
  type PredictionMarketWalletSnapshot,
} from "../lib/predictionMarketUiState";
import { derivePredictionMarketClaimUi } from "../lib/predictionMarketClaimUi";
import { recordSolanaPredictionMarketTrade } from "../lib/solanaPredictionMarketTracking";
import { resolveSolanaSettlementInstruction } from "../lib/solanaSettlementAction";
import {
  buildSolanaOrderQuote,
  formatSolLamports,
  parseOutcomePriceMillis,
  parseSolAmountToLamports,
  type SolanaOrderQuote,
  type SolanaRestingOrderQuote,
} from "../lib/solanaOrderQuote";
import { isSolanaOrderConfirmationQuoteCurrent } from "../lib/solanaOrderConfirmation";
import {
  assertSolanaManagedOrderBookLinks,
  buildSolanaManagedOrderPlan,
  sameSolanaManagedOrderQuote,
  type SolanaManagedOrderAction,
  type SolanaManagedOrderPlan,
  type SolanaManagedOrderSnapshot,
} from "../lib/solanaOrderManagement";
import {
  classifySolanaTransactionError,
  SolanaTransactionFlowError,
  type SolanaTransactionStage,
} from "../lib/solanaTransactionFeedback";
import { useStreamingState } from "../spectator/useStreamingState";
import {
  PredictionMarketPanel,
  type ChartDataPoint,
} from "./PredictionMarketPanel";
import { type OrderLevel } from "./OrderBook";
import { SolanaManagedOrders } from "./SolanaManagedOrders";
import { SolanaManagedOrderConfirmationDialog } from "./SolanaManagedOrderConfirmationDialog";
import { SolanaPointsDisplay } from "./SolanaPointsDisplay";
import {
  SolanaSettlementHistory,
  type SolanaHistoricalOrderRequest,
  type SolanaSettlementRequest,
} from "./SolanaSettlementHistory";
import {
  IDLE_SOLANA_TRANSACTION_FEEDBACK,
  SolanaTransactionFeedbackCard,
  type SolanaTransactionFeedbackState,
} from "./SolanaTransactionFeedbackCard";
import { type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";

async function getMultipleAccountInfosConfirmed(
  connection: Connection,
  addresses: readonly PublicKey[],
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (addresses.length === 0) return [];
  const chunks: PublicKey[][] = [];
  for (let offset = 0; offset < addresses.length; offset += 100) {
    chunks.push(addresses.slice(offset, offset + 100));
  }
  return (
    await Promise.all(
      chunks.map((chunk) =>
        connection.getMultipleAccountsInfo(chunk, "confirmed"),
      ),
    )
  ).flat();
}

type UserPosition = {
  aShares: bigint;
  bShares: bigint;
  aLockedLamports: bigint;
  bLockedLamports: bigint;
  tradeTreasuryFeeLamports: bigint;
  tradeMarketMakerFeeLamports: bigint;
};

type MarketSnapshot = {
  duelId: string;
  duelKeyHex: string;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
  marketStatus: string;
  winner: string | null;
  nextOrderId: bigint;
  bestBid: number;
  bestAsk: number;
  betCloseTime: number | null;
  tradeTreasuryFeeBpsSnapshot: number;
  tradeMarketMakerFeeBpsSnapshot: number;
  winningsMarketMakerFeeBpsSnapshot: number;
  restingOrders: SolanaRestingOrderQuote[];
};

type SettlementExecutionTarget = Pick<
  MarketSnapshot,
  "duelState" | "marketState" | "vault" | "marketMaker"
> & {
  claimKind: PredictionMarketClaimKind;
};

type OrderTrackingIntent = {
  bettorWallet: string;
  sourceAmountLamports: bigint;
  feeBps: number;
  marketRef: string;
  duelKey: string;
  duelId: string;
};

function requiresTransactionStatusCheck(
  feedback: SolanaTransactionFeedbackState,
): feedback is Extract<SolanaTransactionFeedbackState, { status: "error" }> & {
  signature: string;
} {
  return (
    feedback.status === "error" &&
    feedback.signature !== null &&
    feedback.recovery.retryMode === "CHECK_STATUS_FIRST"
  );
}

function failedTransactionRecovery(
  signature: string,
  stage: SolanaTransactionStage,
  error: unknown,
) {
  return {
    kind: "ONCHAIN_FAILED" as const,
    stage,
    signature,
    retryMode: "BLOCKED" as const,
    detail:
      error == null
        ? "Transaction failed on-chain"
        : `Transaction failed on-chain: ${JSON.stringify(error)}`,
  };
}

type OrderFundingEstimate = {
  quoteKey: string;
  walletBalanceLamports: bigint;
  accountRentReserveLamports: bigint;
  estimatedNetworkFeeLamports: bigint;
  vaultReady: boolean;
  orderAccountCollision: boolean;
};

type PriceLevelAccount = {
  publicKey: PublicKey;
  account: {
    side: number;
    price: number;
    headOrderId: BN | bigint | number;
    tailOrderId: BN | bigint | number;
    totalOpen: BN | bigint | number;
    marketState: PublicKey;
    rentRecipient: PublicKey;
  };
};

type OrderAccount = {
  publicKey: PublicKey;
  account: {
    id: BN | bigint | number;
    side: number;
    price: number;
    maker: PublicKey;
    amount: BN | bigint | number;
    filled: BN | bigint | number;
    prevOrderId: BN | bigint | number;
    nextOrderId: BN | bigint | number;
    active: boolean;
    continuationPending: boolean;
    marketState: PublicKey;
  };
};

type BalanceAccount = {
  publicKey: PublicKey;
  account: {
    user: PublicKey;
    marketState: PublicKey;
    aShares: BN | bigint | number;
    bShares: BN | bigint | number;
    aLockedLamports: BN | bigint | number;
    bLockedLamports: BN | bigint | number;
    tradeTreasuryFeeLamports: BN | bigint | number;
    tradeMarketMakerFeeLamports: BN | bigint | number;
  };
};

function managedOrderSnapshot(entry: OrderAccount): SolanaManagedOrderSnapshot {
  const side = Number(entry.account.side);
  if (side !== SIDE_BID && side !== SIDE_ASK) {
    throw new Error("Order contains an invalid side");
  }
  return {
    marketState: entry.account.marketState.toBase58(),
    id: asBigInt(entry.account.id),
    side,
    price: Number(entry.account.price),
    maker: entry.account.maker.toBase58(),
    amount: asBigInt(entry.account.amount),
    filled: asBigInt(entry.account.filled),
    previousOrderId: asBigInt(entry.account.prevOrderId),
    nextOrderId: asBigInt(entry.account.nextOrderId),
    active: Boolean(entry.account.active),
    continuationPending: Boolean(entry.account.continuationPending),
  };
}

const SIDE_BID = 1;
const SIDE_ASK = 2;
const ORDER_BEHAVIOR_GTC = 0;
const MAX_MATCHES_PER_TX = 50;
const USER_BALANCE_ACCOUNT_SPACE = 120;
const ORDER_ACCOUNT_SPACE = 119;
const PRICE_LEVEL_ACCOUNT_SPACE = 100;
const ESTIMATED_COMPUTE_UNIT_LIMIT = 200_000;

class ManagedOrderStateChangedError extends Error {
  override name = "ManagedOrderStateChangedError";
}

class ManagedOrderVaultLiquidityError extends Error {
  override name = "ManagedOrderVaultLiquidityError";
}

function walletReady(wallet: SigningWalletLike): boolean {
  return Boolean(
    wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions,
  );
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function enumName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const [key] = Object.keys(value as Record<string, unknown>);
  return key ?? null;
}

function formatStatus(status: string | null, locale: UiLocale): string {
  if (!status) return locale === "zh" ? "未知" : "unknown";
  if (locale === "zh") {
    const normalized = status.toLowerCase();
    if (normalized === "unknown") return "未知";
    return status.replace(/[A-Z]/g, (match, index) =>
      index === 0 ? match.toUpperCase() : ` ${match.toLowerCase()}`,
    );
  }
  return status.replace(/[A-Z]/g, (match, index) =>
    index === 0 ? match.toUpperCase() : ` ${match.toLowerCase()}`,
  );
}

function fmtAmount(value: bigint): number {
  return Number(value) / LAMPORTS_PER_SOL;
}

function sumOrderLevels(levels: OrderLevel[]): number {
  return levels.reduce((total, level) => total + level.amount, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRetryableRefreshError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror|load failed|429/i.test(
    message,
  );
}

function getFallbackLifecycleStatus(status: string | null | undefined) {
  switch (status?.trim().toLowerCase()) {
    case "open":
      return "OPEN";
    case "locked":
      return "LOCKED";
    case "resolved":
      return "RESOLVED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

function effectiveMarketStatusFromDuel(
  duelStatus: string | null | undefined,
  storedMarketStatus: string | null | undefined,
): string {
  switch (duelStatus?.trim().toLowerCase()) {
    case "bettingopen":
      return "open";
    case "scheduled":
    case "locked":
    case "proposed":
    case "challenged":
      return "locked";
    case "resolved":
      return "resolved";
    case "cancelled":
      return "cancelled";
    default:
      return storedMarketStatus?.trim().toLowerCase() || "unknown";
  }
}

function getFallbackWinner(winner: string | null | undefined) {
  switch (winner?.trim().toLowerCase()) {
    case "a":
      return "A";
    case "b":
      return "B";
    default:
      return "NONE";
  }
}

function getCycleDuelStatusLabel(
  phase: string | undefined,
  duelKeyHex: string | null | undefined,
  locale: UiLocale,
  marketStatus?: string | null,
): string {
  if (locale === "zh") {
    if (!duelKeyHex) {
      return "等待实时 Hyperia 对决";
    }
    if (phase === "ANNOUNCEMENT") {
      return marketStatus === "locked" ? "下注已锁定" : "下注开放中";
    }
    if (phase === "COUNTDOWN" || phase === "FIGHTING") {
      return marketStatus === "open" ? "交易进行中" : "下注已锁定";
    }
    if (phase === "PROPOSED") {
      return "结果已提议 — 争议窗口开放中";
    }
    if (phase === "CHALLENGED") {
      return "结果已被质疑 — 等待重新提议";
    }
    if (phase === "RESOLUTION") {
      return "结果已确认";
    }
    if (phase === "CANCELLED") {
      return "对决已取消 — 可申请退款";
    }
    return "正在准备对决市场";
  }
  if (!duelKeyHex) {
    return "Waiting for live Hyperia duel";
  }
  if (phase === "ANNOUNCEMENT") {
    return marketStatus === "locked" ? "Betting locked" : "Betting open";
  }
  if (phase === "COUNTDOWN" || phase === "FIGHTING") {
    return marketStatus === "open" ? "Trading Live" : "Betting locked";
  }
  if (phase === "PROPOSED") {
    return "Result proposed — dispute window open";
  }
  if (phase === "CHALLENGED") {
    return "Result challenged — awaiting re-proposal";
  }
  if (phase === "RESOLUTION") {
    return "Result finalized";
  }
  if (phase === "CANCELLED") {
    return "Duel cancelled — refunds available";
  }
  return "Preparing duel market";
}

function parsePublicKeyOrNull(
  value: string | null | undefined,
): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function readSolanaE2eRuntimeOverride(): {
  duelKey: string | null;
  duelId: string | null;
  marketRef: string | null;
} {
  if (typeof window === "undefined") {
    return {
      duelKey: null,
      duelId: null,
      marketRef: null,
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const duelKey = normalizePredictionMarketDuelKeyHex(
    searchParams.get("e2eSolanaDuelKey") ??
      searchParams.get("e2eDuelKey") ??
      window.localStorage.getItem("hyperbet.e2e.solanaDuelKey") ??
      "",
  );
  const duelId =
    searchParams.get("e2eSolanaDuelId") ??
    searchParams.get("e2eDuelId") ??
    window.localStorage.getItem("hyperbet.e2e.solanaDuelId") ??
    null;
  const marketRef =
    searchParams.get("e2eSolanaMarketRef") ??
    searchParams.get("e2eMarketRef") ??
    window.localStorage.getItem("hyperbet.e2e.solanaMarketRef") ??
    null;

  return {
    duelKey,
    duelId: duelId?.trim() || null,
    marketRef: marketRef?.trim() || null,
  };
}

interface SolanaClobPanelProps {
  agent1Name: string;
  agent2Name: string;
  compact?: boolean;
  onMarketSnapshot?: (snapshot: SolanaClobMarketSnapshot) => void;
  locale?: UiLocale;
  connectionOverride: Connection;
  walletOverride: SigningWalletLike;
  programAddresses: DuelProgramAddresses;
  readOnly?: boolean;
  tradingEnabled?: boolean;
}

export interface SolanaClobMarketSnapshot {
  duelKeyHex: string | null;
  yesProbabilityPercent: number | null;
  matchLabel: string;
  marketStatus: string;
  yesPool: bigint;
  noPool: bigint;
  bids: OrderLevel[];
  asks: OrderLevel[];
  recentTrades: Trade[];
  chartData: ChartDataPoint[];
}

export function SolanaClobPanel({
  agent1Name,
  agent2Name,
  compact = false,
  onMarketSnapshot,
  locale,
  connectionOverride,
  walletOverride,
  programAddresses,
  readOnly = false,
  tradingEnabled = true,
}: SolanaClobPanelProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const isE2eMode =
    !readOnly && (import.meta.env.MODE === "e2e" || import.meta.env.DEV);
  const connection = connectionOverride;
  const wallet = walletOverride;
  const fightOracleProgramId = programAddresses.fightOracleProgramId;
  const duelMarketProgramId = programAddresses.duelMarketProgramId;
  const stableProgramAddresses = useMemo<DuelProgramAddresses>(
    () => ({ fightOracleProgramId, duelMarketProgramId }),
    [duelMarketProgramId, fightOracleProgramId],
  );
  const { state: streamingState } = useStreamingState();

  const [status, setStatus] = useState(() =>
    getCycleDuelStatusLabel(undefined, null, resolvedLocale, null),
  );
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");
  const [priceInput, setPriceInput] = useState("500");
  const [activeMarket, setActiveMarket] = useState<MarketSnapshot | null>(null);
  const [position, setPosition] = useState<UserPosition>({
    aShares: 0n,
    bShares: 0n,
    aLockedLamports: 0n,
    bLockedLamports: 0n,
    tradeTreasuryFeeLamports: 0n,
    tradeMarketMakerFeeLamports: 0n,
  });
  const [yesPool, setYesPool] = useState<bigint>(0n);
  const [noPool, setNoPool] = useState<bigint>(0n);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const recentTrades = useMemo<Trade[]>(() => [], []);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<bigint | null>(null);
  const [lastPlaceOrderTx, setLastPlaceOrderTx] = useState("-");
  const [lastPlaceOrderError, setLastPlaceOrderError] = useState("-");
  const [lastPlaceOrderDebug, setLastPlaceOrderDebug] = useState("-");
  const [orderFundingEstimate, setOrderFundingEstimate] =
    useState<OrderFundingEstimate | null>(null);
  const [orderFundingError, setOrderFundingError] = useState<string | null>(
    null,
  );
  const [orderConfirmationKey, setOrderConfirmationKey] = useState<
    string | null
  >(null);
  const [orderConfirmationRows, setOrderConfirmationRows] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderTransactionFeedback, setOrderTransactionFeedback] =
    useState<SolanaTransactionFeedbackState>(IDLE_SOLANA_TRANSACTION_FEEDBACK);
  const [settlementTransactionFeedback, setSettlementTransactionFeedback] =
    useState<SolanaTransactionFeedbackState>(IDLE_SOLANA_TRANSACTION_FEEDBACK);
  const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false);
  const [settlingHistoryBetId, setSettlingHistoryBetId] = useState<
    string | null
  >(null);
  const [preparingHistoryOrderBetId, setPreparingHistoryOrderBetId] = useState<
    string | null
  >(null);
  const [settlementFeedbackKind, setSettlementFeedbackKind] = useState<
    "claim" | "refund" | "cleanup"
  >("claim");
  const [managedOrders, setManagedOrders] = useState<SolanaManagedOrderPlan[]>(
    [],
  );
  const [selectedManagedOrder, setSelectedManagedOrder] =
    useState<SolanaManagedOrderPlan | null>(null);
  const [managedOrderTransactionFeedback, setManagedOrderTransactionFeedback] =
    useState<SolanaTransactionFeedbackState>(IDLE_SOLANA_TRANSACTION_FEEDBACK);
  const [managedOrderFeedbackAction, setManagedOrderFeedbackAction] =
    useState<SolanaManagedOrderAction>("CANCEL");
  const [managedOrderErrorMessage, setManagedOrderErrorMessage] = useState<
    string | null
  >(null);
  const [submittingManagedOrderId, setSubmittingManagedOrderId] = useState<
    bigint | null
  >(null);
  const [lastClaimTx, setLastClaimTx] = useState("-");
  const [lastClaimError, setLastClaimError] = useState("-");
  const [showDebug, setShowDebug] = useState(
    () =>
      isE2eMode &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug"),
  );
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const lastQuoteRef = useRef<{
    duelKeyHex: string;
    probabilityPercent: number | null;
  } | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const orderConfirmationDialogRef = useRef<HTMLDivElement | null>(null);
  const orderConfirmationReturnFocusRef = useRef<HTMLElement | null>(null);
  const orderSubmissionInProgressRef = useRef(false);
  const managedOrderDialogRef = useRef<HTMLDivElement | null>(null);
  const managedOrderReturnFocusRef = useRef<HTMLElement | null>(null);
  const managedOrderSubmissionInProgressRef = useRef(false);
  const settlementSubmissionInProgressRef = useRef(false);
  const transactionContextRef = useRef<string | null>(null);
  const orderTrackingIntentRef = useRef<OrderTrackingIntent | null>(null);

  const useHeliusSender = SOLANA_CLUSTER === "mainnet-beta";

  // Warm Helius Sender on mount to avoid first-transaction cold-start latency.
  useEffect(() => {
    if (readOnly || !useHeliusSender) return undefined;
    return startHeliusSenderWarmup();
  }, [readOnly, useHeliusSender]);

  const writablePrograms = useMemo(
    () =>
      walletReady(wallet)
        ? createPrograms(connection, wallet, stableProgramAddresses)
        : null,
    [connection, stableProgramAddresses, wallet],
  );
  const readonlyPrograms = useMemo(
    () => createReadonlyPrograms(connection, stableProgramAddresses),
    [connection, stableProgramAddresses],
  );

  const cycle = streamingState?.cycle ?? null;
  const streamedDuelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const streamedDuelId =
    typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const { duel: lifecycleDuel, market: lifecycleMarket } =
    usePredictionMarketLifecycle("solana");
  const runtimeE2eOverride = useMemo(
    () =>
      isE2eMode
        ? readSolanaE2eRuntimeOverride()
        : {
            duelKey: null,
            duelId: null,
            marketRef: null,
          },
    [isE2eMode],
  );
  const pinnedE2eDuelKey = isE2eMode ? runtimeE2eOverride.duelKey : null;
  const lifecycleDuelKey = useMemo(
    () =>
      normalizePredictionMarketDuelKeyHex(
        lifecycleMarket?.duelKey ?? lifecycleDuel?.duelKey,
      ),
    [lifecycleDuel?.duelKey, lifecycleMarket?.duelKey],
  );
  const streamedDuelKey = useMemo(
    () => normalizePredictionMarketDuelKeyHex(streamedDuelKeyHex),
    [streamedDuelKeyHex],
  );
  const duelKeyHex = pinnedE2eDuelKey ?? lifecycleDuelKey ?? streamedDuelKey;
  const lifecycleMatchesActiveDuel =
    lifecycleDuelKey == null || lifecycleDuelKey === duelKeyHex;
  const activeLifecycleDuel = lifecycleMatchesActiveDuel ? lifecycleDuel : null;
  const activeLifecycleMarket = lifecycleMatchesActiveDuel
    ? lifecycleMarket
    : null;
  const lifecycleMarketRef =
    activeLifecycleMarket?.marketRef ??
    (isE2eMode ? runtimeE2eOverride.marketRef : null);
  const duelId =
    activeLifecycleMarket?.duelId ??
    activeLifecycleDuel?.duelId ??
    (isE2eMode ? runtimeE2eOverride.duelId : null) ??
    streamedDuelId;
  const duelLabel = duelId ?? shortDuelKey(duelKeyHex);
  const effectiveAgent1 = cycle?.agent1?.name ?? agent1Name;
  const effectiveAgent2 = cycle?.agent2?.name ?? agent2Name;
  const copy = useMemo(
    () =>
      resolvedLocale === "zh"
        ? {
            unknown: "未知",
            connectWalletFirst: "请先连接钱包",
            vaultNotReady: "市场金库尚未由运营方完成租金准备",
            marketConfigNotDeployed: "市场配置尚未部署",
            waitingOracleReporter: "对局已公布，等待预言机上报",
            waitingMarketOperator: "预言机已上线，等待市场运营方开启",
            resolvedFor: (name: string) => `${name} 已结算获胜`,
            resolved: "已结算",
            marketCancelled: "市场已取消",
            bettingLocked: "下注已锁定",
            resolutionProposed: "结果已提交，等待挑战期结束",
            resolutionChallenged: "结果已被挑战，结算已暂停",
            marketOpen: "市场开放中",
            refreshFailed: "市场数据暂时不可用，正在重试。",
            quoteRefreshFailed: "暂时无法核验钱包余额和网络费用，请稍后重试。",
            connectWalletToTrade: "连接钱包后即可交易",
            amountTooLow: "数量必须大于 0",
            orderPlaced: "订单已提交",
            orderFailed: (message: string) => `下单失败：${message}`,
            connectWalletToClaim: "连接钱包后即可领取",
            claimComplete: "领取完成",
            claimFailed: (message: string) => `领取失败：${message}`,
            clearingPositionContext: "清理已结算仓位",
            positionCleared: "仓位已清理",
            clearPositionFailed: (message: string) =>
              `清理仓位失败：${message}`,
            claimWinningsTitle: "领取收益",
            claimRefundTitle: "领取退款",
            claimLocked: "暂无可领取结算",
            claimHelp: "对局结算后，可在这里领取获胜份额。",
            claimRefundHelp: "若本局取消，可在这里领取退回资金。",
            claimCleanupTitle: "清理已结算仓位",
            claimCleanupHelp: "若本局已判定负方，可在这里清理残留仓位状态。",
            claim: "领取",
            clearPosition: "清理仓位",
            payoutAmountLabel: "完全成交时的最高毛收益（SOL）",
            limitPrice: "所选结果的限价概率（千分比）",
            orderReviewTitle: "签名前订单明细",
            selectedProbability: "所选结果限价概率",
            visibleFill: "当前可见成交",
            worstImmediateFill: "最差即时成交",
            restingAmount: "预计挂单",
            limitCollateral: "最高锁定资金",
            tradeFees: "成交手续费",
            winningsFee: "获胜手续费",
            netPayout: "完全成交且获胜后的净领取",
            netProfit: "完全成交且获胜后的净利润",
            networkFee: "预计网络费/加速费",
            rentReserve: "账户租金准备金",
            maxWalletFunding: "钱包最高需备资金",
            walletBalance: "钱包余额",
            quoteLoading: "正在核对网络费、账户租金和钱包余额…",
            quoteUnavailable: (message: string) => `报价不可用：${message}`,
            insufficientBalance: "钱包余额不足以覆盖最坏情况资金需求",
            refundDisclosure:
              "取消或收回时，未成交抵押与挂单者支付的订单账户租金会返还原始挂单者；已收取的成交手续费不会退回。共享价格档账户租金不包含在内。",
            selfTradeDisclosure:
              "检测到自己的对手盘；程序会停止撮合并退回剩余资金。",
            continuationDisclosure:
              "当前可见订单超过单笔交易撮合上限，剩余部分需要继续处理。",
            quoteFreshness:
              "网络费为估算值；签名前会使用最新区块哈希和优先费重新构建交易。限价单可能完全不即时成交。",
            confirmOrderTitle: "确认 SOL 订单",
            confirmOrderHelp:
              "请核对最高扣款和手续费/退款条款。只有在钱包批准签名后才会发送交易。",
            confirmAndSign: "确认并签名",
            confirmingOrder: "等待钱包…",
            cancelConfirmation: "返回修改",
            quoteChanged:
              "报价已变化。请返回并核对刷新后的订单，再重新确认签名。",
            expirationDisclosure:
              "仅在确认后才获取最新区块哈希。若交易在确认前过期，系统不会自动重发；请核对最新报价后重新签名。",
            transactionExpired:
              "交易在确认前已过期，且未自动重发。请核对最新报价后重新签名。",
            transactionProgress: {
              preparing: "正在复核最新市场与订单账户",
              signing: "等待钱包签名",
              sending: "正在发送交易",
              confirming: "交易已发送，等待链上确认",
              confirmed: "订单已在链上确认",
            },
            settlementProgress: {
              preparing: "正在复核结算状态与账户",
              signing: "等待钱包签署结算交易",
              sending: "正在发送结算交易",
              confirming: "结算交易已发送，等待链上确认",
            },
            settlementConfirmed: {
              claim: "领取已在链上确认",
              refund: "退款已在链上确认",
              cleanup: "仓位清理已在链上确认",
            },
            managedOrderProgress: {
              preparing: "正在复核订单、市场与相邻挂单",
              signing: "等待钱包签署订单管理交易",
              sending: "正在发送订单管理交易",
              confirming: "订单管理交易已发送，等待链上确认",
            },
            managedOrderConfirmed: {
              CANCEL: "订单取消已在链上确认",
              RECLAIM: "挂单收回已在链上确认",
              CLOSE_FILLED: "已成交订单租金取回已在链上确认",
            },
            managedOrderChanged:
              "订单或市场状态已变化，未发送交易。请核对刷新后的活跃订单。",
            managedOrderVaultShortfall:
              "市场金库无法在保留最低租金后覆盖预计返还，未发送交易。此市场需要运营方检查。",
            reviewLatestManagedOrder: "核对最新活跃订单",
            managingOrderContext: "管理活跃订单",
            processingSettlement: "处理中…",
            reviewLatestSettlement: "核对最新结算状态",
            transactionReceipt: "查看交易",
            transactionSignature: "交易签名",
            checkTransactionStatus: "核对链上交易状态",
            reviewLatestQuote: "核对最新报价",
            transactionPendingAfterCheck:
              "链上尚未确认该交易。请勿重复签名，稍后再次核对状态。",
            transactionNotFoundAfterCheck:
              "当前 RPC 尚未查到该签名。请勿重复签名，稍后再次核对状态。",
            transactionStatusCheckFailed:
              "暂时无法核对链上状态。请勿重复签名，待网络恢复后重试核对。",
            reviewRequiredBeforeRetry:
              "请先通过上方状态卡核对或刷新，再提交另一笔交易。",
            trackingDelayed:
              "订单已在链上确认，但活动记录仍在同步。请勿重复下单；可通过交易签名核对状态。",
            recoveryCopy: {
              QUOTE_STALE:
                "订单簿或费用已变化，尚未发送交易。请核对刷新后的报价后再签名。",
              USER_REJECTED: "钱包拒绝了签名，未发送交易。请核对报价后重试。",
              WALLET_DISCONNECTED: "钱包已断开。重新连接并核对最新报价后再试。",
              INSUFFICIENT_FUNDS:
                "钱包资金不足以覆盖订单、手续费与账户租金。补充 SOL 后请重新核对报价。",
              EXPIRED:
                "交易在确认前过期，系统未自动重发。若显示交易签名，请先核对链上状态，再签署新订单。",
              RPC_UNAVAILABLE:
                "网络响应中断。若交易可能已经发送，请先核对交易状态，切勿立即重复签名。",
              SIMULATION_FAILED:
                "交易预检未通过，未确认订单。请刷新市场并核对最新报价。",
              ONCHAIN_FAILED:
                "交易已由链上程序拒绝。资金不会按该订单成交；请刷新市场后查看详情。",
              UNKNOWN:
                "无法确定交易结果。请先核对钱包和链上状态，切勿立即重复签名。",
            },
            hideAdminPanel: "隐藏管理面板",
            showAdminPanel: "显示管理面板",
            match: "市场",
            adminStatus: "状态",
            adminDuel: "对局",
            adminPosition: "持仓",
            adminPools: "资金池",
            adminLastOrder: "最近订单",
            stageBlockhash: "获取区块哈希",
            stageSigning: "签名交易",
            stageSending: "发送交易",
            stageConfirming: "确认交易",
            placingOrderContext: "下单",
            claimingWinningsContext: "领取收益",
          }
        : {
            unknown: "unknown",
            connectWalletFirst: "Connect wallet first",
            vaultNotReady:
              "Market vault rent has not been provisioned by the operator",
            marketConfigNotDeployed: "Market config not deployed",
            waitingOracleReporter:
              "Game announced duel; waiting for oracle reporter",
            waitingMarketOperator:
              "Oracle is live; waiting for market operator",
            resolvedFor: (name: string) => `Resolved for ${name}`,
            resolved: "Resolved",
            marketCancelled: "Market cancelled",
            bettingLocked: "Betting locked",
            resolutionProposed: "Result proposed; challenge window active",
            resolutionChallenged: "Result challenged; settlement paused",
            marketOpen: "Market open",
            refreshFailed: "Market data is temporarily unavailable. Retrying.",
            quoteRefreshFailed:
              "Wallet balance and network fees could not be verified. Please retry shortly.",
            connectWalletToTrade: "Connect wallet to trade",
            amountTooLow: "Amount must be greater than zero",
            orderPlaced: "Order placed",
            orderFailed: (message: string) => `Order failed: ${message}`,
            connectWalletToClaim: "Connect wallet to claim",
            claimComplete: "Claim complete",
            claimFailed: (message: string) => `Claim failed: ${message}`,
            clearingPositionContext: "clearing resolved position",
            positionCleared: "Position cleared",
            clearPositionFailed: (message: string) =>
              `Position cleanup failed: ${message}`,
            claimWinningsTitle: "Claim winnings",
            claimRefundTitle: "Claim refund",
            claimLocked: "Nothing claimable yet",
            claimHelp:
              "Once the duel resolves, claim your winning shares here.",
            claimRefundHelp:
              "If the duel is cancelled, claim your refund here.",
            claimCleanupTitle: "Clear resolved position",
            claimCleanupHelp:
              "If this market resolved against you, clear the stale position state here.",
            claim: "Claim",
            clearPosition: "Clear position",
            payoutAmountLabel: "Maximum gross payout if fully filled (SOL)",
            limitPrice: "Selected-outcome limit probability (per mille)",
            orderReviewTitle: "Order details before signature",
            selectedProbability: "Selected-outcome limit probability",
            visibleFill: "Visible immediate fill",
            worstImmediateFill: "Worst-case immediate fill",
            restingAmount: "Expected to rest",
            limitCollateral: "Maximum locked collateral",
            tradeFees: "Execution fees",
            winningsFee: "Winnings fee",
            netPayout: "Net claim if fully filled and correct",
            netProfit: "Net profit if fully filled and correct",
            networkFee: "Estimated network / priority fee",
            rentReserve: "Account-rent reserve",
            maxWalletFunding: "Maximum wallet funding required",
            walletBalance: "Wallet balance",
            quoteLoading:
              "Checking network fees, account rent, and wallet balance…",
            quoteUnavailable: (message: string) =>
              `Quote unavailable: ${message}`,
            insufficientBalance:
              "Wallet balance cannot cover the worst-case funding requirement",
            refundDisclosure:
              "If the duel is cancelled, matched collateral and escrowed execution fees are refundable through claim. Cancellation or reclaim separately returns unmatched collateral and the maker-funded Order account rent to the original maker; shared PriceLevel rent is excluded.",
            selfTradeDisclosure:
              "Your own opposing order is visible; the program will stop matching and release the remainder.",
            continuationDisclosure:
              "The visible book exceeds the per-transaction match bound; the remainder will require continuation.",
            quoteFreshness:
              "Network cost is an estimate; the transaction is rebuilt with a fresh blockhash and priority fee immediately before signature. A limit order may receive no immediate fill.",
            confirmOrderTitle: "Confirm SOL order",
            confirmOrderHelp:
              "Review the maximum debit and fee/refund terms. Nothing is sent until your wallet approves the signature.",
            confirmAndSign: "Confirm and sign",
            confirmingOrder: "Waiting for wallet…",
            cancelConfirmation: "Back to edit",
            quoteChanged:
              "This quote changed. Go back and review the refreshed order before signing.",
            expirationDisclosure:
              "A fresh blockhash is fetched only after confirmation. If the transaction expires before confirmation, it is not automatically resubmitted; review the latest quote and sign again.",
            transactionExpired:
              "The transaction expired before confirmation and was not automatically resubmitted. Review the latest quote and sign again.",
            transactionProgress: {
              preparing: "Rechecking the live market and order accounts",
              signing: "Waiting for wallet signature",
              sending: "Sending transaction",
              confirming: "Transaction sent; waiting for on-chain confirmation",
              confirmed: "Order confirmed on-chain",
            },
            settlementProgress: {
              preparing: "Rechecking settlement state and accounts",
              signing: "Waiting for settlement signature",
              sending: "Sending settlement transaction",
              confirming:
                "Settlement transaction sent; waiting for on-chain confirmation",
            },
            settlementConfirmed: {
              claim: "Claim confirmed on-chain",
              refund: "Refund confirmed on-chain",
              cleanup: "Position cleanup confirmed on-chain",
            },
            managedOrderProgress: {
              preparing:
                "Rechecking the order, market, and linked book accounts",
              signing: "Waiting for order-management signature",
              sending: "Sending order-management transaction",
              confirming:
                "Order-management transaction sent; waiting for on-chain confirmation",
            },
            managedOrderConfirmed: {
              CANCEL: "Order cancellation confirmed on-chain",
              RECLAIM: "Resting-order reclaim confirmed on-chain",
              CLOSE_FILLED: "Filled-order rent recovery confirmed on-chain",
            },
            managedOrderChanged:
              "The order or market changed, so no transaction was sent. Review the refreshed active order.",
            managedOrderVaultShortfall:
              "The market vault cannot cover the expected return while preserving its rent minimum. No transaction was sent; this market requires operator review.",
            reviewLatestManagedOrder: "Review latest active order",
            managingOrderContext: "managing active order",
            processingSettlement: "Processing…",
            reviewLatestSettlement: "Review latest settlement",
            transactionReceipt: "View transaction",
            transactionSignature: "Transaction signature",
            checkTransactionStatus: "Check transaction status",
            reviewLatestQuote: "Review latest quote",
            transactionPendingAfterCheck:
              "The transaction is not confirmed yet. Do not sign it again; check its status again shortly.",
            transactionNotFoundAfterCheck:
              "This RPC has not found the signature yet. Do not sign it again; check its status again shortly.",
            transactionStatusCheckFailed:
              "Transaction status could not be checked. Do not sign again; retry the status check when the network recovers.",
            reviewRequiredBeforeRetry:
              "Use the transaction status card above to check or refresh before submitting another transaction.",
            trackingDelayed:
              "The order is confirmed on-chain, but activity indexing is still catching up. Do not place it again; use the signature to verify status.",
            recoveryCopy: {
              QUOTE_STALE:
                "The order book or fee terms changed, so no transaction was sent. Review the refreshed quote before signing.",
              USER_REJECTED:
                "Your wallet declined the signature. No transaction was sent; review the quote before trying again.",
              WALLET_DISCONNECTED:
                "Your wallet disconnected. Reconnect and review the latest quote before trying again.",
              INSUFFICIENT_FUNDS:
                "Your wallet cannot cover the order, fees, and account rent. Add SOL, then review the latest quote.",
              EXPIRED:
                "The transaction expired and was not automatically resubmitted. If a signature is shown, check its on-chain status before signing a new order.",
              RPC_UNAVAILABLE:
                "The network response was interrupted. If submission may have started, check the transaction before signing again.",
              SIMULATION_FAILED:
                "Transaction preflight failed and the order was not confirmed. Refresh the market and review the latest quote.",
              ONCHAIN_FAILED:
                "The on-chain program rejected this transaction. The order did not execute; refresh the market before continuing.",
              UNKNOWN:
                "The transaction outcome is uncertain. Check your wallet and on-chain status before signing again.",
            },
            hideAdminPanel: "Hide Admin Panel",
            showAdminPanel: "Show Admin Panel",
            match: "Match",
            adminStatus: "Status",
            adminDuel: "Duel",
            adminPosition: "Position",
            adminPools: "Pools",
            adminLastOrder: "Last order",
            stageBlockhash: "fetching blockhash",
            stageSigning: "signing transaction",
            stageSending: "sending transaction",
            stageConfirming: "confirming transaction",
            placingOrderContext: "placing order",
            claimingWinningsContext: "claiming winnings",
          },
    [resolvedLocale],
  );
  const walletSnapshot = useMemo<PredictionMarketWalletSnapshot>(
    () => ({
      aShares: position.aShares,
      bShares: position.bShares,
      aStake: position.aLockedLamports,
      bStake: position.bLockedLamports,
      refundableAmount:
        position.aLockedLamports +
        position.bLockedLamports +
        position.tradeTreasuryFeeLamports +
        position.tradeMarketMakerFeeLamports,
    }),
    [position],
  );
  const uiState = useMemo(
    () =>
      derivePredictionMarketUiState(
        activeLifecycleMarket,
        walletSnapshot,
        activeMarket
          ? {
              lifecycleStatus: getFallbackLifecycleStatus(
                activeMarket.marketStatus,
              ),
              winner: getFallbackWinner(activeMarket.winner),
            }
          : null,
      ),
    [activeLifecycleMarket, activeMarket, walletSnapshot],
  );
  const lifecycleStatusLabel = useMemo(() => {
    switch (uiState.lifecycleStatus) {
      case "RESOLVED":
        if (uiState.winner === "A") return copy.resolvedFor(effectiveAgent1);
        if (uiState.winner === "B") return copy.resolvedFor(effectiveAgent2);
        return copy.resolved;
      case "CANCELLED":
        return copy.marketCancelled;
      case "LOCKED":
        return copy.bettingLocked;
      case "PROPOSED":
        return copy.resolutionProposed;
      case "CHALLENGED":
        return copy.resolutionChallenged;
      case "OPEN":
        return copy.marketOpen;
      case "PENDING":
      case "UNKNOWN":
        return copy.waitingMarketOperator;
      default:
        return null;
    }
  }, [
    copy,
    effectiveAgent1,
    effectiveAgent2,
    uiState.lifecycleStatus,
    uiState.winner,
  ]);
  const orderQuoteResult = useMemo<{
    quote: SolanaOrderQuote | null;
    error: string | null;
  }>(() => {
    if (!activeMarket) {
      return { quote: null, error: null };
    }
    try {
      return {
        quote: buildSolanaOrderQuote({
          side,
          amountLamports: parseSolAmountToLamports(amountInput),
          outcomePriceMillis: parseOutcomePriceMillis(priceInput),
          tradeTreasuryFeeBps: activeMarket.tradeTreasuryFeeBpsSnapshot,
          tradeMarketMakerFeeBps: activeMarket.tradeMarketMakerFeeBpsSnapshot,
          winningsMarketMakerFeeBps:
            activeMarket.winningsMarketMakerFeeBpsSnapshot,
          wallet: wallet.publicKey?.toBase58() ?? null,
          restingOrders: activeMarket.restingOrders,
        }),
        error: null,
      };
    } catch (error) {
      return {
        quote: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [activeMarket, amountInput, priceInput, side, wallet.publicKey]);
  const orderQuote = orderQuoteResult.quote;
  const orderQuoteKey = useMemo(() => {
    if (!activeMarket || !wallet.publicKey || !orderQuote) return null;
    return [
      activeMarket.marketState.toBase58(),
      activeMarket.nextOrderId.toString(),
      wallet.publicKey.toBase58(),
      orderQuote.side,
      orderQuote.amountLamports.toString(),
      orderQuote.outcomePriceMillis.toString(),
      activeMarket.tradeTreasuryFeeBpsSnapshot.toString(),
      activeMarket.tradeMarketMakerFeeBpsSnapshot.toString(),
      activeMarket.winningsMarketMakerFeeBpsSnapshot.toString(),
    ].join(":");
  }, [activeMarket, orderQuote, wallet.publicKey]);
  const fundingMarketStateAddress =
    activeMarket?.marketState.toBase58() ?? null;
  const fundingVaultAddress = activeMarket?.vault.toBase58() ?? null;
  const fundingNextOrderId = activeMarket?.nextOrderId ?? null;
  const fundingWalletAddress = wallet.publicKey?.toBase58() ?? null;
  const fundingQuoteSide = orderQuote?.side ?? null;
  const fundingMarketPriceMillis = orderQuote?.marketPriceMillis ?? null;
  const fundingClobProgramIdAddress =
    readonlyPrograms.duelMarket.programId.toBase58();

  useEffect(() => {
    let cancelled = false;
    setOrderFundingEstimate((current) =>
      current?.quoteKey === orderQuoteKey ? current : null,
    );
    setOrderFundingError(null);
    if (
      !fundingMarketStateAddress ||
      !fundingVaultAddress ||
      fundingNextOrderId == null ||
      !fundingWalletAddress ||
      !fundingQuoteSide ||
      fundingMarketPriceMillis == null ||
      !orderQuoteKey
    ) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const clobProgramId = new PublicKey(fundingClobProgramIdAddress);
          const marketState = new PublicKey(fundingMarketStateAddress);
          const vault = new PublicKey(fundingVaultAddress);
          const walletPublicKey = new PublicKey(fundingWalletAddress);
          const userBalance = findUserBalancePda(
            clobProgramId,
            marketState,
            walletPublicKey,
          );
          const newOrder = findOrderPda(
            clobProgramId,
            marketState,
            fundingNextOrderId,
          );
          const restingLevel = findPriceLevelPda(
            clobProgramId,
            marketState,
            fundingQuoteSide === "YES" ? SIDE_BID : SIDE_ASK,
            fundingMarketPriceMillis,
          );
          const [
            accountInfos,
            userBalanceRent,
            orderRent,
            priceLevelRent,
            walletBalanceLamports,
            vaultBalanceLamports,
            vaultMinimumLamports,
            latest,
            priorityFeeEstimate,
          ] = await Promise.all([
            connection.getMultipleAccountsInfo(
              [userBalance, newOrder, restingLevel],
              "confirmed",
            ),
            connection.getMinimumBalanceForRentExemption(
              USER_BALANCE_ACCOUNT_SPACE,
              "confirmed",
            ),
            connection.getMinimumBalanceForRentExemption(
              ORDER_ACCOUNT_SPACE,
              "confirmed",
            ),
            connection.getMinimumBalanceForRentExemption(
              PRICE_LEVEL_ACCOUNT_SPACE,
              "confirmed",
            ),
            connection.getBalance(walletPublicKey, "confirmed"),
            connection.getBalance(vault, "confirmed"),
            connection.getMinimumBalanceForRentExemption(0, "confirmed"),
            getLatestBlockhashViaRpc(connection),
            useHeliusSender
              ? fetchPriorityFeeEstimate(connection.rpcEndpoint, [
                  fundingWalletAddress,
                ])
              : Promise.resolve(0),
          ]);

          const feeProbe = new Transaction({
            feePayer: walletPublicKey,
            recentBlockhash: latest.blockhash,
          });
          if (useHeliusSender) {
            feeProbe.add(
              ComputeBudgetProgram.setComputeUnitLimit({
                units: ESTIMATED_COMPUTE_UNIT_LIMIT,
              }),
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: priorityFeeEstimate,
              }),
              SystemProgram.transfer({
                fromPubkey: walletPublicKey,
                toPubkey: new PublicKey(randomJitoTipAccount()),
                lamports: HELIUS_SENDER_MIN_TIP_LAMPORTS,
              }),
            );
          } else {
            feeProbe.add(
              SystemProgram.transfer({
                fromPubkey: walletPublicKey,
                toPubkey: walletPublicKey,
                lamports: 0,
              }),
            );
          }
          const baseFee = await connection.getFeeForMessage(
            feeProbe.compileMessage(),
            "confirmed",
          );
          if (baseFee.value == null) {
            throw new Error("RPC did not return a network fee estimate");
          }

          const priorityFeeLamports = useHeliusSender
            ? Math.ceil(
                (ESTIMATED_COMPUTE_UNIT_LIMIT * priorityFeeEstimate) /
                  1_000_000,
              )
            : 0;
          const accountRentReserveLamports =
            BigInt(accountInfos[0] ? 0 : userBalanceRent) +
            BigInt(accountInfos[1] ? 0 : orderRent) +
            BigInt(accountInfos[2] ? 0 : priceLevelRent);
          const estimatedNetworkFeeLamports =
            BigInt(baseFee.value) +
            BigInt(priorityFeeLamports) +
            BigInt(useHeliusSender ? HELIUS_SENDER_MIN_TIP_LAMPORTS : 0);

          if (!cancelled) {
            setOrderFundingEstimate({
              quoteKey: orderQuoteKey,
              walletBalanceLamports: BigInt(walletBalanceLamports),
              accountRentReserveLamports,
              estimatedNetworkFeeLamports,
              vaultReady: vaultBalanceLamports >= vaultMinimumLamports,
              orderAccountCollision: accountInfos[1] != null,
            });
          }
        } catch {
          if (!cancelled) {
            setOrderFundingError(copy.quoteRefreshFailed);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    connection,
    fundingClobProgramIdAddress,
    fundingMarketPriceMillis,
    fundingMarketStateAddress,
    fundingNextOrderId,
    fundingQuoteSide,
    fundingVaultAddress,
    fundingWalletAddress,
    orderQuoteKey,
    copy.quoteRefreshFailed,
    useHeliusSender,
  ]);

  const updateQuoteChart = useCallback(
    (nextDuelKeyHex: string, bestBid: number, bestAsk: number) => {
      const now = Date.now();
      const probabilityPercent = deriveTwoSidedClobProbabilityPercent(
        bestBid,
        bestAsk,
      );
      const previous = lastQuoteRef.current;
      const changedDuel = previous?.duelKeyHex !== nextDuelKeyHex;
      if (probabilityPercent === null) {
        setChartData([]);
        lastQuoteRef.current = {
          duelKeyHex: nextDuelKeyHex,
          probabilityPercent: null,
        };
        return;
      }

      setChartData((prevChart) => {
        if (changedDuel || prevChart.length === 0) {
          return [{ time: now, pct: probabilityPercent }];
        }
        if (previous?.probabilityPercent === probabilityPercent) {
          return prevChart;
        }
        const next = [...prevChart, { time: now, pct: probabilityPercent }];
        return next.length > 100 ? next.slice(next.length - 100) : next;
      });
      lastQuoteRef.current = { duelKeyHex: nextDuelKeyHex, probabilityPercent };
    },
    [],
  );

  const submitTransaction = useCallback(
    async (
      transaction: Transaction,
      context: string,
      onProgress?: (
        stage: SolanaTransactionStage,
        signature: string | null,
      ) => void,
    ): Promise<string> => {
      let stage: SolanaTransactionStage = "preparing";
      let submittedSignature: string | null = null;
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new SolanaTransactionFlowError({
          message: copy.connectWalletFirst,
          stage,
        });
      }

      try {
        onProgress?.(stage, null);
        transaction.feePayer = wallet.publicKey;

        // Fetch blockhash and dynamic priority fee in parallel.
        const [latest, priorityFeeEstimate] = await Promise.all([
          getLatestBlockhashViaRpc(connection),
          useHeliusSender
            ? fetchPriorityFeeEstimate(connection.rpcEndpoint, [
                wallet.publicKey.toBase58(),
              ])
            : Promise.resolve(0),
        ]);
        transaction.recentBlockhash = latest.blockhash;

        if (useHeliusSender) {
          // Prepend ComputeBudget instructions so validators correctly budget CUs.
          // setComputeUnitLimit MUST come before other instructions.
          transaction.instructions = [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: priorityFeeEstimate,
            }),
            // Jito tip transfer — required by Helius Sender dual-routing.
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: new PublicKey(randomJitoTipAccount()),
              lamports: HELIUS_SENDER_MIN_TIP_LAMPORTS,
            }),
            ...transaction.instructions,
          ];
        }

        stage = "signing";
        onProgress?.(stage, null);
        const signed = await wallet.signTransaction(transaction);
        if (!signed.signature) {
          throw new Error("Wallet returned a transaction without a signature");
        }
        submittedSignature = utils.bytes.bs58.encode(signed.signature);

        stage = "sending";
        onProgress?.(stage, submittedSignature);
        const returnedSignature = useHeliusSender
          ? await sendViaHeliusSender(
              Buffer.from(signed.serialize()).toString("base64"),
            )
          : await sendRawTransactionViaRpc(connection, signed);
        if (returnedSignature !== submittedSignature) {
          throw new Error(
            "Transaction sender returned a signature that does not match the signed payload",
          );
        }

        stage = "confirming";
        onProgress?.(stage, submittedSignature);
        await confirmSignatureViaRpc(connection, submittedSignature, {
          lastValidBlockHeight: latest.lastValidBlockHeight,
        });
        return submittedSignature;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stageLabel =
          stage === "preparing"
            ? copy.stageBlockhash
            : stage === "signing"
              ? copy.stageSigning
              : stage === "sending"
                ? copy.stageSending
                : copy.stageConfirming;
        throw new SolanaTransactionFlowError({
          message: `${context}: ${stageLabel}: ${message}`,
          stage,
          signature: submittedSignature,
          cause: error,
        });
      }
    },
    [
      connection,
      copy.connectWalletFirst,
      copy.stageBlockhash,
      copy.stageConfirming,
      copy.stageSending,
      copy.stageSigning,
      useHeliusSender,
      wallet.publicKey,
      wallet.signTransaction,
    ],
  );

  const verifyVaultRentExempt = useCallback(
    async (vault: PublicKey): Promise<void> => {
      const minimumLamports =
        await connection.getMinimumBalanceForRentExemption(0, "confirmed");
      const currentLamports = await connection.getBalance(vault, "confirmed");
      if (currentLamports < minimumLamports) {
        throw new Error(copy.vaultNotReady);
      }
    },
    [connection, copy.vaultNotReady],
  );

  const runRefreshData = useCallback(async () => {
    const clobProgram: any = readonlyPrograms.duelMarket;
    const oracleProgram: any = readonlyPrograms.fightOracle;
    const runtimeConfigPda = findClobConfigPda(clobProgram.programId);

    const config =
      await clobProgram.account.marketConfig.fetchNullable(runtimeConfigPda);
    if (!config) {
      setStatus(copy.marketConfigNotDeployed);
      setActiveMarket(null);
      setManagedOrders([]);
      return;
    }

    if (!duelKeyHex) {
      setActiveMarket(null);
      setManagedOrders([]);
      setBids([]);
      setAsks([]);
      setYesPool(0n);
      setNoPool(0n);
      setPosition({
        aShares: 0n,
        bShares: 0n,
        aLockedLamports: 0n,
        bLockedLamports: 0n,
        tradeTreasuryFeeLamports: 0n,
        tradeMarketMakerFeeLamports: 0n,
      });
      setStatus(
        lifecycleStatusLabel ??
          getCycleDuelStatusLabel(cycle?.phase, duelKeyHex, resolvedLocale),
      );
      return;
    }

    const duelKeyBytes = duelKeyHexToBytes(duelKeyHex);
    const duelState = findDuelStatePda(oracleProgram.programId, duelKeyBytes);
    const marketState =
      parsePublicKeyOrNull(lifecycleMarketRef) ??
      findMarketStatePda(
        clobProgram.programId,
        duelState,
        DUEL_WINNER_MARKET_KIND,
      );
    const vault = findClobVaultPda(clobProgram.programId, marketState);

    const [duelAccount, marketAccount, allLevels, allOrders, allBalances] =
      await Promise.all([
        oracleProgram.account.duelState.fetchNullable(duelState),
        clobProgram.account.marketState.fetchNullable(marketState),
        clobProgram.account.priceLevel.all(),
        clobProgram.account.order.all(),
        clobProgram.account.userBalance.all(),
      ]);

    if (!duelAccount) {
      setStatus(lifecycleStatusLabel ?? copy.waitingOracleReporter);
      setActiveMarket(null);
      setManagedOrders([]);
      return;
    }

    if (!marketAccount) {
      setStatus(lifecycleStatusLabel ?? copy.waitingMarketOperator);
      setActiveMarket(null);
      setManagedOrders([]);
      return;
    }

    const storedMarketStatus = enumName(marketAccount.status);
    const marketStatus = effectiveMarketStatusFromDuel(
      enumName(duelAccount.status),
      storedMarketStatus,
    );
    const winner = enumName(marketAccount.winner);

    const levels = (allLevels as PriceLevelAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
    );
    const orders = (allOrders as OrderAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
    );
    const balances = (allBalances as BalanceAccount[]).filter((entry) =>
      (entry.account.marketState as PublicKey).equals(marketState),
    );

    const bidRows = levels
      .filter(
        (entry) =>
          Number(entry.account.side) === SIDE_BID &&
          asBigInt(entry.account.totalOpen) > 0n,
      )
      .sort((a, b) => Number(b.account.price) - Number(a.account.price))
      .map((entry) => ({
        price: Number(entry.account.price) / 1000,
        amount: fmtAmount(asBigInt(entry.account.totalOpen)),
        total: 0,
      }));

    const askRows = levels
      .filter(
        (entry) =>
          Number(entry.account.side) === SIDE_ASK &&
          asBigInt(entry.account.totalOpen) > 0n,
      )
      .sort((a, b) => Number(a.account.price) - Number(b.account.price))
      .map((entry) => ({
        price: Number(entry.account.price) / 1000,
        amount: fmtAmount(asBigInt(entry.account.totalOpen)),
        total: 0,
      }));

    let bidTotal = 0;
    const normalizedBids = bidRows.slice(0, 12).map((row) => {
      bidTotal += row.amount;
      return { ...row, total: bidTotal };
    });
    let askTotal = 0;
    const normalizedAsks = askRows.slice(0, 12).map((row) => {
      askTotal += row.amount;
      return { ...row, total: askTotal };
    });

    let nextYesPool = 0n;
    let nextNoPool = 0n;
    let userPosition: UserPosition = {
      aShares: 0n,
      bShares: 0n,
      aLockedLamports: 0n,
      bLockedLamports: 0n,
      tradeTreasuryFeeLamports: 0n,
      tradeMarketMakerFeeLamports: 0n,
    };
    for (const balance of balances) {
      const aShares = asBigInt(balance.account.aShares);
      const bShares = asBigInt(balance.account.bShares);
      const aLockedLamports = asBigInt(balance.account.aLockedLamports);
      const bLockedLamports = asBigInt(balance.account.bLockedLamports);
      const tradeTreasuryFeeLamports = asBigInt(
        balance.account.tradeTreasuryFeeLamports,
      );
      const tradeMarketMakerFeeLamports = asBigInt(
        balance.account.tradeMarketMakerFeeLamports,
      );
      nextYesPool += aShares;
      nextNoPool += bShares;
      if (
        wallet.publicKey &&
        (balance.account.user as PublicKey).equals(wallet.publicKey)
      ) {
        userPosition = {
          aShares,
          bShares,
          aLockedLamports,
          bLockedLamports,
          tradeTreasuryFeeLamports,
          tradeMarketMakerFeeLamports,
        };
      }
    }

    const userManageableOrders = orders
      .filter((entry) => {
        if (
          !wallet.publicKey ||
          !(entry.account.maker as PublicKey).equals(wallet.publicKey)
        ) {
          return false;
        }
        const amount = asBigInt(entry.account.amount);
        const filled = asBigInt(entry.account.filled);
        if (entry.account.active) return amount > filled;
        return (
          amount > 0n &&
          filled === amount &&
          asBigInt(entry.account.prevOrderId) === 0n &&
          asBigInt(entry.account.nextOrderId) === 0n &&
          !entry.account.continuationPending
        );
      })
      .sort((left, right) => {
        const leftId = asBigInt(left.account.id);
        const rightId = asBigInt(right.account.id);
        return leftId === rightId ? 0 : leftId > rightId ? -1 : 1;
      });
    const userOrderAccountInfos = wallet.publicKey
      ? await getMultipleAccountInfosConfirmed(
          connection,
          userManageableOrders.map((entry) => entry.publicKey),
        )
      : [];
    const userManagedOrders = wallet.publicKey
      ? userManageableOrders.flatMap((entry, index) => {
          const accountInfo = userOrderAccountInfos[index];
          if (
            !accountInfo ||
            accountInfo.lamports <= 0 ||
            !accountInfo.owner.equals(clobProgram.programId)
          ) {
            return [];
          }
          return [
            buildSolanaManagedOrderPlan({
              marketStatus: marketStatus ?? "unknown",
              marketState: marketState.toBase58(),
              wallet: wallet.publicKey!.toBase58(),
              order: managedOrderSnapshot(entry),
              orderAccountLamports: BigInt(accountInfo.lamports),
            }),
          ];
        })
      : [];
    const quoteRestingOrders: SolanaRestingOrderQuote[] = orders.map(
      (entry) => ({
        id: asBigInt(entry.account.id),
        side: Number(entry.account.side) === SIDE_BID ? "YES" : "NO",
        marketPriceMillis: Number(entry.account.price),
        amount: asBigInt(entry.account.amount),
        filled: asBigInt(entry.account.filled),
        maker: (entry.account.maker as PublicKey).toBase58(),
        active: Boolean(entry.account.active),
      }),
    );

    setActiveMarket({
      duelId: duelId ?? shortDuelKey(duelKeyHex),
      duelKeyHex,
      duelState,
      marketState,
      vault,
      treasury: marketAccount.treasury as PublicKey,
      marketMaker: marketAccount.marketMaker as PublicKey,
      marketStatus: marketStatus ?? "unknown",
      winner,
      nextOrderId: asBigInt(marketAccount.nextOrderId),
      bestBid: Number(marketAccount.bestBid ?? 0),
      bestAsk: Number(marketAccount.bestAsk ?? 1000),
      betCloseTime:
        activeLifecycleDuel?.betCloseTime ??
        (typeof cycle?.betCloseTime === "number" ? cycle.betCloseTime : null),
      tradeTreasuryFeeBpsSnapshot: Number(
        marketAccount.tradeTreasuryFeeBpsSnapshot,
      ),
      tradeMarketMakerFeeBpsSnapshot: Number(
        marketAccount.tradeMarketMakerFeeBpsSnapshot,
      ),
      winningsMarketMakerFeeBpsSnapshot: Number(
        marketAccount.winningsMarketMakerFeeBpsSnapshot,
      ),
      restingOrders: quoteRestingOrders,
    });
    setManagedOrders(userManagedOrders);
    setPosition(userPosition);
    setYesPool(nextYesPool);
    setNoPool(nextNoPool);
    setBids(normalizedBids);
    setAsks(normalizedAsks);
    setLastOrderId(
      userManagedOrders.length > 0 ? userManagedOrders[0].orderId : null,
    );
    updateQuoteChart(
      duelKeyHex,
      Number(marketAccount.bestBid ?? 0),
      Number(marketAccount.bestAsk ?? 1000),
    );
    const nextUiState = derivePredictionMarketUiState(
      lifecycleMarket,
      {
        aShares: userPosition.aShares,
        bShares: userPosition.bShares,
        aStake: userPosition.aLockedLamports,
        bStake: userPosition.bLockedLamports,
        refundableAmount:
          userPosition.aLockedLamports +
          userPosition.bLockedLamports +
          userPosition.tradeTreasuryFeeLamports +
          userPosition.tradeMarketMakerFeeLamports,
      },
      {
        lifecycleStatus: getFallbackLifecycleStatus(marketStatus),
        winner: getFallbackWinner(winner),
      },
    );
    const resolvedPhase = (() => {
      if (nextUiState.lifecycleStatus === "OPEN") {
        return activeLifecycleDuel?.phase === "FIGHTING"
          ? "FIGHTING"
          : "ANNOUNCEMENT";
      }
      if (nextUiState.lifecycleStatus === "LOCKED") return "FIGHTING";
      if (nextUiState.lifecycleStatus === "PROPOSED") return "PROPOSED";
      if (nextUiState.lifecycleStatus === "CHALLENGED") return "CHALLENGED";
      if (nextUiState.lifecycleStatus === "RESOLVED") return "RESOLUTION";
      if (nextUiState.lifecycleStatus === "CANCELLED") return "CANCELLED";
      return "RESOLUTION";
    })();
    const nextStatusLabel = getCycleDuelStatusLabel(
      resolvedPhase,
      duelKeyHex,
      resolvedLocale,
      marketStatus,
    );
    setStatus(nextStatusLabel);
  }, [
    cycle?.betCloseTime,
    cycle?.phase,
    duelId,
    copy,
    duelKeyHex,
    effectiveAgent1,
    effectiveAgent2,
    activeLifecycleDuel?.betCloseTime,
    activeLifecycleDuel?.phase,
    lifecycleMarketRef,
    lifecycleStatusLabel,
    readonlyPrograms.fightOracle,
    readonlyPrograms.duelMarket,
    resolvedLocale,
    updateQuoteChart,
    wallet.publicKey,
  ]);

  const refreshData = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async () => {
      setIsRefreshing(true);
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await runRefreshData();
            return;
          } catch (error) {
            if (!isRetryableRefreshError(error) || attempt === 2) {
              throw error;
            }
            await sleep(250 * (attempt + 1));
          }
        }
      } catch {
        setStatus(copy.refreshFailed);
      } finally {
        setIsRefreshing(false);
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, [copy, runRefreshData]);

  useEffect(() => {
    if (readOnly) return undefined;
    void refreshData();
    const id = window.setInterval(() => void refreshData(), 5000);
    return () => window.clearInterval(id);
  }, [readOnly, refreshData]);

  useEffect(() => {
    if (readOnly) return undefined;
    const handleMarketRefresh = () => void refreshData();
    window.addEventListener("hyperbet:market-refresh", handleMarketRefresh);
    return () =>
      window.removeEventListener(
        "hyperbet:market-refresh",
        handleMarketRefresh,
      );
  }, [readOnly, refreshData]);

  const buildPlaceOrderRemainingAccounts = useCallback(
    async (
      clobProgram: any,
      market: MarketSnapshot,
      sideValue: number,
      price: number,
      amount: bigint,
    ): Promise<AccountMeta[]> => {
      const metas: AccountMeta[] = [];
      const marketAccount = await clobProgram.account.marketState.fetch(
        market.marketState,
      );
      const oppositeSide = sideValue === SIDE_BID ? SIDE_ASK : SIDE_BID;
      let remaining = amount;
      let boundary =
        sideValue === SIDE_BID
          ? Number(marketAccount.bestAsk)
          : Number(marketAccount.bestBid);
      let matches = 0;

      while (remaining > 0n && matches < MAX_MATCHES_PER_TX) {
        const crosses =
          sideValue === SIDE_BID
            ? boundary <= price && boundary > 0 && boundary < 1000
            : boundary >= price && boundary > 0 && boundary < 1000;
        if (!crosses) {
          break;
        }

        const levelPda = findPriceLevelPda(
          clobProgram.programId,
          market.marketState,
          oppositeSide,
          boundary,
        );
        const level =
          await clobProgram.account.priceLevel.fetchNullable(levelPda);
        if (!level) {
          break;
        }

        metas.push({
          pubkey: levelPda,
          isSigner: false,
          isWritable: true,
        });

        const levelOpen = asBigInt(level.totalOpen);
        const headOrderId = asBigInt(level.headOrderId);
        if (levelOpen === 0n || headOrderId === 0n) {
          boundary = sideValue === SIDE_BID ? boundary + 1 : boundary - 1;
          continue;
        }

        let currentHead = headOrderId;
        let currentLevelOpen = levelOpen;
        while (
          remaining > 0n &&
          currentHead > 0n &&
          currentLevelOpen > 0n &&
          matches < MAX_MATCHES_PER_TX
        ) {
          const orderPda = findOrderPda(
            clobProgram.programId,
            market.marketState,
            currentHead,
          );
          const order = await clobProgram.account.order.fetch(orderPda);
          const makerBalancePda = findUserBalancePda(
            clobProgram.programId,
            market.marketState,
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
            asBigInt(order.amount) - asBigInt(order.filled);
          if (orderRemaining <= 0n || !order.active) {
            break;
          }

          if (orderRemaining >= remaining) {
            remaining = 0n;
            break;
          }

          remaining -= orderRemaining;
          currentLevelOpen -= orderRemaining;
          currentHead = asBigInt(order.nextOrderId);
          matches += 1;
          if (remaining > 0n && currentHead > 0n && currentLevelOpen > 0n) {
            metas.push({
              pubkey: levelPda,
              isSigner: false,
              isWritable: true,
            });
          }
        }

        boundary = sideValue === SIDE_BID ? boundary + 1 : boundary - 1;
      }

      const restingLevelPda = findPriceLevelPda(
        clobProgram.programId,
        market.marketState,
        sideValue,
        price,
      );
      const restingLevel =
        await clobProgram.account.priceLevel.fetchNullable(restingLevelPda);
      if (restingLevel && asBigInt(restingLevel.tailOrderId) > 0n) {
        metas.push({
          pubkey: findOrderPda(
            clobProgram.programId,
            market.marketState,
            asBigInt(restingLevel.tailOrderId),
          ),
          isSigner: false,
          isWritable: true,
        });
      }

      return metas;
    },
    [],
  );

  const handlePlaceOrder = useCallback(
    async (confirmedQuoteKey: string): Promise<boolean> => {
      if (orderTransactionFeedback.status === "error") {
        setStatus(copy.reviewRequiredBeforeRetry);
        return false;
      }
      const clobProgram: any = writablePrograms?.duelMarket;
      const marketRef = activeMarket?.marketState.toBase58() ?? "-";
      const duelRef = duelId ?? "-";
      const walletRef = wallet.publicKey?.toBase58() ?? "-";
      const debugPrefix = [
        `side=${side}`,
        `amountInput=${amountInput}`,
        `priceInput=${priceInput}`,
        `duelId=${duelRef}`,
        `marketRef=${marketRef}`,
        `wallet=${walletRef}`,
      ].join(" ");
      if (!orderQuoteKey || confirmedQuoteKey !== orderQuoteKey) {
        setLastPlaceOrderDebug(`blocked ${debugPrefix} reason=quote-changed`);
        setLastPlaceOrderError(copy.quoteChanged);
        setStatus(copy.quoteChanged);
        return false;
      }
      if (!clobProgram || !wallet.publicKey || !activeMarket || !orderQuote) {
        setLastPlaceOrderDebug(
          `blocked ${debugPrefix} reason=missing-prerequisites`,
        );
        const message = orderQuoteResult.error
          ? copy.quoteUnavailable(orderQuoteResult.error)
          : copy.connectWalletToTrade;
        setLastPlaceOrderError(message);
        setStatus(message);
        return false;
      }
      if (
        !orderFundingEstimate ||
        orderFundingEstimate.quoteKey !== orderQuoteKey ||
        orderFundingError
      ) {
        const message = copy.quoteUnavailable(
          orderFundingError ?? copy.quoteLoading,
        );
        setLastPlaceOrderError(message);
        setStatus(message);
        return false;
      }
      const maxWalletFundingLamports =
        orderQuote.limitCollateralLamports +
        orderQuote.fullFillTradeFeeLamports +
        orderFundingEstimate.accountRentReserveLamports +
        orderFundingEstimate.estimatedNetworkFeeLamports;
      if (orderFundingEstimate.orderAccountCollision) {
        const message = copy.quoteUnavailable(
          "next order account already exists",
        );
        setLastPlaceOrderError(message);
        setStatus(message);
        return false;
      }
      if (!orderFundingEstimate.vaultReady) {
        setLastPlaceOrderError(copy.vaultNotReady);
        setStatus(copy.vaultNotReady);
        return false;
      }
      if (
        orderFundingEstimate.walletBalanceLamports < maxWalletFundingLamports
      ) {
        setLastPlaceOrderError(copy.insufficientBalance);
        setStatus(copy.insufficientBalance);
        return false;
      }

      try {
        setLastPlaceOrderError("-");
        setOrderTransactionFeedback({
          status: "preparing",
          signature: null,
          recovery: null,
          warning: null,
        });
        setLastPlaceOrderDebug(
          `entered ${debugPrefix} nextOrder=${activeMarket.nextOrderId.toString()}`,
        );
        setStatus(copy.placingOrderContext);
        const amount = orderQuote.amountLamports;
        const price = orderQuote.marketPriceMillis;
        const sideValue = side === "YES" ? SIDE_BID : SIDE_ASK;
        const latestMarketAccount = await clobProgram.account.marketState.fetch(
          activeMarket.marketState,
        );
        if (
          Number(latestMarketAccount.tradeTreasuryFeeBpsSnapshot) !==
            activeMarket.tradeTreasuryFeeBpsSnapshot ||
          Number(latestMarketAccount.tradeMarketMakerFeeBpsSnapshot) !==
            activeMarket.tradeMarketMakerFeeBpsSnapshot ||
          Number(latestMarketAccount.winningsMarketMakerFeeBpsSnapshot) !==
            activeMarket.winningsMarketMakerFeeBpsSnapshot
        ) {
          throw new Error(
            "Market fee snapshots changed; review the refreshed quote",
          );
        }
        const snapshotOrderId = activeMarket.nextOrderId;
        const orderId = asBigInt(latestMarketAccount.nextOrderId);
        if (orderId !== snapshotOrderId) {
          throw new Error("Order book changed; review the refreshed quote");
        }
        const userBalance = findUserBalancePda(
          clobProgram.programId,
          activeMarket.marketState,
          wallet.publicKey,
        );
        const newOrder = findOrderPda(
          clobProgram.programId,
          activeMarket.marketState,
          orderId,
        );
        const restingLevel = findPriceLevelPda(
          clobProgram.programId,
          activeMarket.marketState,
          sideValue,
          price,
        );
        const remainingAccounts = await buildPlaceOrderRemainingAccounts(
          clobProgram,
          activeMarket,
          sideValue,
          price,
          amount,
        );
        setLastPlaceOrderDebug(
          `prepared ${debugPrefix} snapshotOrderId=${snapshotOrderId.toString()} chainOrderId=${orderId.toString()} amount=${amount.toString()} price=${price} remainingAccounts=${remainingAccounts.length}`,
        );

        await verifyVaultRentExempt(activeMarket.vault);

        const configPda = findClobConfigPda(clobProgram.programId);

        const tx = await clobProgram.methods
          .placeOrder(
            new BN(orderId.toString()),
            sideValue,
            price,
            new BN(amount.toString()),
            ORDER_BEHAVIOR_GTC,
          )
          .accountsPartial({
            marketState: activeMarket.marketState,
            duelState: activeMarket.duelState,
            userBalance,
            newOrder,
            restingLevel,
            config: configPda,
            treasury: activeMarket.treasury,
            marketMaker: activeMarket.marketMaker,
            vault: activeMarket.vault,
            user: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .transaction();
        setLastPlaceOrderDebug(
          `built ${debugPrefix} snapshotOrderId=${snapshotOrderId.toString()} chainOrderId=${orderId.toString()} amount=${amount.toString()} price=${price}`,
        );

        const trackingIntent: OrderTrackingIntent = {
          bettorWallet: wallet.publicKey.toBase58(),
          sourceAmountLamports: amount,
          feeBps:
            activeMarket.tradeTreasuryFeeBpsSnapshot +
            activeMarket.tradeMarketMakerFeeBpsSnapshot,
          marketRef: activeMarket.marketState.toBase58(),
          duelKey: activeMarket.duelKeyHex,
          duelId: activeMarket.duelId,
        };
        orderTrackingIntentRef.current = trackingIntent;

        const signature = await submitTransaction(
          tx,
          copy.placingOrderContext,
          (transactionStage, submittedSignature) => {
            setOrderTransactionFeedback({
              status: transactionStage,
              signature: submittedSignature,
              recovery: null,
              warning: null,
            });
          },
        );
        setLastPlaceOrderTx(signature);
        setLastPlaceOrderError("-");
        setOrderTransactionFeedback({
          status: "confirmed",
          signature,
          recovery: null,
          warning: null,
        });
        setLastPlaceOrderDebug(
          `submitted ${debugPrefix} snapshotOrderId=${snapshotOrderId.toString()} chainOrderId=${orderId.toString()} signature=${signature}`,
        );
        try {
          const recorded = await recordSolanaPredictionMarketTrade({
            bettorWallet: trackingIntent.bettorWallet,
            sourceAmountLamports: trackingIntent.sourceAmountLamports,
            feeBps: trackingIntent.feeBps,
            txSignature: signature,
            marketRef: trackingIntent.marketRef,
            duelKey: trackingIntent.duelKey,
            duelId: trackingIntent.duelId,
          });
          if (!recorded) {
            throw new Error("verified order tracking was rejected");
          }
        } catch (trackingError) {
          const trackingDetail =
            trackingError instanceof Error
              ? trackingError.message
              : String(trackingError);
          setOrderTransactionFeedback({
            status: "confirmed",
            signature,
            recovery: null,
            warning: copy.trackingDelayed,
          });
          setLastPlaceOrderDebug(
            `tracking-delayed ${debugPrefix} signature=${signature} message=${trackingDetail}`,
          );
        }
        setActiveMarket((current) =>
          current
            ? {
                ...current,
                nextOrderId: orderId + 1n,
              }
            : current,
        );
        setStatus(copy.orderPlaced);
        await refreshData();
        setLastPlaceOrderDebug(
          `refreshed ${debugPrefix} snapshotOrderId=${snapshotOrderId.toString()} chainOrderId=${orderId.toString()} signature=${signature} nextOrder=${(orderId + 1n).toString()}`,
        );
        return true;
      } catch (error) {
        const recovery = classifySolanaTransactionError(error);
        if (!recovery.signature) {
          orderTrackingIntentRef.current = null;
        }
        const message = copy.recoveryCopy[recovery.kind];
        setOrderTransactionFeedback({
          status: "error",
          signature: recovery.signature,
          recovery,
          warning: null,
        });
        setLastPlaceOrderDebug(
          `failed ${debugPrefix} kind=${recovery.kind} stage=${recovery.stage} retryMode=${recovery.retryMode} signature=${recovery.signature ?? "-"} detail=${recovery.detail}`,
        );
        setLastPlaceOrderError(message);
        setStatus(copy.orderFailed(message));
        return false;
      }
    },
    [
      activeMarket,
      amountInput,
      buildPlaceOrderRemainingAccounts,
      copy,
      orderFundingError,
      orderFundingEstimate,
      orderQuote,
      orderQuoteKey,
      orderQuoteResult.error,
      orderTransactionFeedback.status,
      lastPlaceOrderError,
      priceInput,
      refreshData,
      side,
      submitTransaction,
      verifyVaultRentExempt,
      wallet.publicKey,
      writablePrograms,
    ],
  );

  const executeSettlement = useCallback(
    async (
      resolveTarget: () => Promise<SettlementExecutionTarget>,
      historyBetId: string | null = null,
    ) => {
      if (settlementTransactionFeedback.status === "error") {
        setStatus(copy.reviewRequiredBeforeRetry);
        return;
      }
      if (settlementSubmissionInProgressRef.current) return;
      settlementSubmissionInProgressRef.current = true;
      setSettlingHistoryBetId(historyBetId);
      setIsSubmittingSettlement(true);

      let isCleanup = false;
      try {
        setLastClaimTx("-");
        setLastClaimError("-");
        setSettlementTransactionFeedback({
          status: "preparing",
          signature: null,
          recovery: null,
          warning: null,
        });

        const target = await resolveTarget();
        const clobProgram: any = writablePrograms?.duelMarket;
        const settlementInstruction = resolveSolanaSettlementInstruction(
          target.claimKind,
        );
        if (!clobProgram || !wallet.publicKey || !settlementInstruction) {
          throw new Error(copy.connectWalletToClaim);
        }

        isCleanup = settlementInstruction === "closeLosingBalance";
        setSettlementFeedbackKind(
          isCleanup
            ? "cleanup"
            : target.claimKind === "REFUND"
              ? "refund"
              : "claim",
        );
        const userBalance = findUserBalancePda(
          clobProgram.programId,
          target.marketState,
          wallet.publicKey,
        );
        const tx = isCleanup
          ? await clobProgram.methods
              .closeLosingBalance()
              .accountsPartial({
                marketState: target.marketState,
                duelState: target.duelState,
                userBalance,
                user: wallet.publicKey,
              })
              .transaction()
          : await (async () => {
              const configPda = findClobConfigPda(clobProgram.programId);
              return clobProgram.methods
                .claim()
                .accountsPartial({
                  marketState: target.marketState,
                  duelState: target.duelState,
                  userBalance,
                  config: configPda,
                  marketMaker: target.marketMaker,
                  vault: target.vault,
                  user: wallet.publicKey,
                  systemProgram: SystemProgram.programId,
                })
                .transaction();
            })();

        const signature = await submitTransaction(
          tx,
          isCleanup
            ? copy.clearingPositionContext
            : copy.claimingWinningsContext,
          (transactionStage, submittedSignature) => {
            setSettlementTransactionFeedback({
              status: transactionStage,
              signature: submittedSignature,
              recovery: null,
              warning: null,
            });
          },
        );
        setLastClaimTx(signature);
        setStatus(isCleanup ? copy.positionCleared : copy.claimComplete);
        setSettlementTransactionFeedback({
          status: "confirmed",
          signature,
          recovery: null,
          warning: null,
        });
        await refreshData();
        window.dispatchEvent(new CustomEvent("hyperbet:market-refresh"));
      } catch (error) {
        const recovery = classifySolanaTransactionError(error);
        const message = copy.recoveryCopy[recovery.kind];
        setSettlementTransactionFeedback({
          status: "error",
          signature: recovery.signature,
          recovery,
          warning: null,
        });
        setLastClaimError(message);
        setStatus(
          isCleanup
            ? copy.clearPositionFailed(message)
            : copy.claimFailed(message),
        );
      } finally {
        settlementSubmissionInProgressRef.current = false;
        setSettlingHistoryBetId(null);
        setIsSubmittingSettlement(false);
      }
    },
    [
      copy,
      refreshData,
      settlementTransactionFeedback.status,
      submitTransaction,
      wallet.publicKey,
      writablePrograms,
    ],
  );

  const handleClaim = useCallback(async () => {
    if (!activeMarket || !uiState.canClaim) {
      setStatus(copy.claimLocked);
      return;
    }

    await executeSettlement(async () => ({
      duelState: activeMarket.duelState,
      marketState: activeMarket.marketState,
      vault: activeMarket.vault,
      marketMaker: activeMarket.marketMaker,
      claimKind: uiState.claimKind,
    }));
  }, [activeMarket, copy.claimLocked, executeSettlement, uiState]);

  const handleHistoricalSettlement = useCallback(
    async (request: SolanaSettlementRequest) => {
      await executeSettlement(async () => {
        if (!wallet.publicKey) {
          throw new Error(copy.connectWalletToClaim);
        }
        const normalizedDuelKey = normalizePredictionMarketDuelKeyHex(
          request.duelKey,
        );
        const requestedMarketState = parsePublicKeyOrNull(request.marketPda);
        if (!normalizedDuelKey || !requestedMarketState) {
          throw new Error(copy.claimLocked);
        }

        const clobProgram: any = readonlyPrograms.duelMarket;
        const oracleProgram: any = readonlyPrograms.fightOracle;
        const duelState = findDuelStatePda(
          oracleProgram.programId,
          duelKeyHexToBytes(normalizedDuelKey),
        );
        const canonicalMarketState = findMarketStatePda(
          clobProgram.programId,
          duelState,
          DUEL_WINNER_MARKET_KIND,
        );
        if (!requestedMarketState.equals(canonicalMarketState)) {
          throw new Error(copy.claimLocked);
        }

        const userBalancePda = findUserBalancePda(
          clobProgram.programId,
          canonicalMarketState,
          wallet.publicKey,
        );
        const [duelAccount, marketAccount, balanceAccount] = await Promise.all([
          oracleProgram.account.duelState.fetchNullable(duelState),
          clobProgram.account.marketState.fetchNullable(canonicalMarketState),
          clobProgram.account.userBalance.fetchNullable(userBalancePda),
        ]);
        if (!duelAccount || !marketAccount || !balanceAccount) {
          throw new Error(copy.claimLocked);
        }
        if (
          !(marketAccount.duelState as PublicKey).equals(duelState) ||
          Number(marketAccount.marketKind) !== DUEL_WINNER_MARKET_KIND
        ) {
          throw new Error(copy.claimLocked);
        }

        const positionSnapshot: PredictionMarketWalletSnapshot = {
          aShares: asBigInt(balanceAccount.aShares),
          bShares: asBigInt(balanceAccount.bShares),
          aStake: asBigInt(balanceAccount.aLockedLamports),
          bStake: asBigInt(balanceAccount.bLockedLamports),
          refundableAmount:
            asBigInt(balanceAccount.aLockedLamports) +
            asBigInt(balanceAccount.bLockedLamports) +
            asBigInt(balanceAccount.tradeTreasuryFeeLamports) +
            asBigInt(balanceAccount.tradeMarketMakerFeeLamports),
        };
        const historicalUiState = derivePredictionMarketUiState(
          null,
          positionSnapshot,
          {
            lifecycleStatus: getFallbackLifecycleStatus(
              effectiveMarketStatusFromDuel(
                enumName(duelAccount.status),
                enumName(marketAccount.status),
              ),
            ),
            winner: getFallbackWinner(enumName(marketAccount.winner)),
          },
        );
        const expectedClaimKind =
          request.settlementState === "REFUND_CLAIMABLE"
            ? historicalUiState.claimKind === "REFUND"
            : historicalUiState.claimKind === "WINNER_A" ||
              historicalUiState.claimKind === "WINNER_B";
        if (!historicalUiState.canClaim || !expectedClaimKind) {
          throw new Error(copy.claimLocked);
        }

        return {
          duelState,
          marketState: canonicalMarketState,
          vault: findClobVaultPda(clobProgram.programId, canonicalMarketState),
          marketMaker: marketAccount.marketMaker as PublicKey,
          claimKind: historicalUiState.claimKind,
        };
      }, request.betId);
    },
    [
      copy.claimLocked,
      copy.connectWalletToClaim,
      executeSettlement,
      readonlyPrograms.duelMarket,
      readonlyPrograms.fightOracle,
      wallet.publicKey,
    ],
  );

  const handleConfirmManagedOrder = useCallback(async () => {
    if (managedOrderTransactionFeedback.status === "error") {
      setStatus(copy.reviewRequiredBeforeRetry);
      return;
    }
    if (!selectedManagedOrder || managedOrderSubmissionInProgressRef.current) {
      return;
    }
    const clobProgram: any = writablePrograms?.duelMarket;
    const oracleProgram: any = readonlyPrograms.fightOracle;
    const managedMarketState = parsePublicKeyOrNull(
      selectedManagedOrder?.marketState,
    );
    if (!clobProgram || !wallet.publicKey || !managedMarketState) {
      setStatus(copy.connectWalletToTrade);
      return;
    }

    const reviewedPlan = selectedManagedOrder;
    managedOrderSubmissionInProgressRef.current = true;
    setSubmittingManagedOrderId(reviewedPlan.orderId);
    setManagedOrderFeedbackAction(reviewedPlan.action);
    setManagedOrderErrorMessage(null);
    setManagedOrderTransactionFeedback({
      status: "preparing",
      signature: null,
      recovery: null,
      warning: null,
    });
    setStatus(copy.managingOrderContext);

    try {
      const latestMarketAccount =
        await clobProgram.account.marketState.fetch(managedMarketState);
      const managedDuelState = latestMarketAccount.duelState as PublicKey;
      if (
        Number(latestMarketAccount.marketKind) !== DUEL_WINNER_MARKET_KIND ||
        !findMarketStatePda(
          clobProgram.programId,
          managedDuelState,
          DUEL_WINNER_MARKET_KIND,
        ).equals(managedMarketState)
      ) {
        throw new ManagedOrderStateChangedError(
          "The market no longer has its canonical duel identity",
        );
      }
      const orderPda = findOrderPda(
        clobProgram.programId,
        managedMarketState,
        reviewedPlan.orderId,
      );
      const [latestDuelAccount, latestOrderAccount, latestOrderInfo] =
        await Promise.all([
          oracleProgram.account.duelState.fetch(managedDuelState),
          clobProgram.account.order.fetchNullable(orderPda),
          connection.getAccountInfo(orderPda, "confirmed"),
        ]);
      if (
        !latestOrderAccount ||
        !latestOrderInfo ||
        latestOrderInfo.lamports <= 0 ||
        !latestOrderInfo.owner.equals(clobProgram.programId)
      ) {
        throw new ManagedOrderStateChangedError(
          "The selected order account no longer exists",
        );
      }
      if (
        !(latestMarketAccount.duelState as PublicKey).equals(managedDuelState)
      ) {
        throw new ManagedOrderStateChangedError(
          "The market no longer references the selected duel",
        );
      }

      let freshPlan: SolanaManagedOrderPlan;
      try {
        freshPlan = buildSolanaManagedOrderPlan({
          marketStatus: effectiveMarketStatusFromDuel(
            enumName(latestDuelAccount.status),
            enumName(latestMarketAccount.status),
          ),
          marketState: managedMarketState.toBase58(),
          wallet: wallet.publicKey.toBase58(),
          order: managedOrderSnapshot({
            publicKey: orderPda,
            account: latestOrderAccount,
          }),
          orderAccountLamports: BigInt(latestOrderInfo.lamports),
        });
      } catch (error) {
        throw new ManagedOrderStateChangedError(
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!sameSolanaManagedOrderQuote(reviewedPlan, freshPlan)) {
        throw new ManagedOrderStateChangedError(
          "The selected order quote or linked accounts changed",
        );
      }

      let tx: Transaction;
      if (freshPlan.action === "CLOSE_FILLED") {
        tx = await clobProgram.methods
          .closeFilledOrder(new BN(freshPlan.orderId.toString()))
          .accountsPartial({
            marketState: managedMarketState,
            order: orderPda,
            user: wallet.publicKey,
          })
          .transaction();
      } else {
        const priceLevelPda = findPriceLevelPda(
          clobProgram.programId,
          managedMarketState,
          freshPlan.side,
          freshPlan.programPriceMillis,
        );
        const [latestPriceLevel, adjacentAccounts] = await Promise.all([
          clobProgram.account.priceLevel.fetchNullable(priceLevelPda),
          Promise.all(
            freshPlan.adjacentOrderIds.map(async (orderId) => {
              const adjacentPda = findOrderPda(
                clobProgram.programId,
                managedMarketState,
                orderId,
              );
              const adjacentAccount =
                await clobProgram.account.order.fetchNullable(adjacentPda);
              if (!adjacentAccount) {
                throw new ManagedOrderStateChangedError(
                  `Linked order ${orderId.toString()} no longer exists`,
                );
              }
              return managedOrderSnapshot({
                publicKey: adjacentPda,
                account: adjacentAccount,
              });
            }),
          ),
        ]);
        if (!latestPriceLevel) {
          throw new ManagedOrderStateChangedError(
            "The selected price level no longer exists",
          );
        }
        const priceLevelSide = Number(latestPriceLevel.side);
        if (priceLevelSide !== SIDE_BID && priceLevelSide !== SIDE_ASK) {
          throw new ManagedOrderStateChangedError(
            "The selected price level has an invalid side",
          );
        }
        try {
          assertSolanaManagedOrderBookLinks({
            plan: freshPlan,
            priceLevel: {
              marketState: (
                latestPriceLevel.marketState as PublicKey
              ).toBase58(),
              side: priceLevelSide,
              price: Number(latestPriceLevel.price),
              headOrderId: asBigInt(latestPriceLevel.headOrderId),
              tailOrderId: asBigInt(latestPriceLevel.tailOrderId),
              totalOpen: asBigInt(latestPriceLevel.totalOpen),
            },
            adjacentOrders: adjacentAccounts,
          });
        } catch (error) {
          throw new ManagedOrderStateChangedError(
            error instanceof Error ? error.message : String(error),
          );
        }

        const managedVault = findClobVaultPda(
          clobProgram.programId,
          managedMarketState,
        );
        const [vaultBalance, vaultRentMinimum] = await Promise.all([
          connection.getBalance(managedVault, "confirmed"),
          connection.getMinimumBalanceForRentExemption(0, "confirmed"),
        ]);
        if (
          BigInt(vaultBalance) <
          BigInt(vaultRentMinimum) + freshPlan.refundableCollateralLamports
        ) {
          throw new ManagedOrderVaultLiquidityError(
            "Market vault cannot cover the exact collateral return",
          );
        }

        const remainingAccounts: AccountMeta[] = freshPlan.adjacentOrderIds.map(
          (orderId) => ({
            pubkey: findOrderPda(
              clobProgram.programId,
              managedMarketState,
              orderId,
            ),
            isSigner: false,
            isWritable: true,
          }),
        );
        const instructionBuilder =
          freshPlan.action === "CANCEL"
            ? clobProgram.methods.cancelOrder(
                new BN(freshPlan.orderId.toString()),
                freshPlan.side,
                freshPlan.programPriceMillis,
              )
            : clobProgram.methods.reclaimRestingOrder(
                new BN(freshPlan.orderId.toString()),
                freshPlan.side,
                freshPlan.programPriceMillis,
              );
        tx = await instructionBuilder
          .accountsPartial({
            marketState: managedMarketState,
            duelState: managedDuelState,
            order: orderPda,
            priceLevel: priceLevelPda,
            vault: managedVault,
            user: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(remainingAccounts)
          .transaction();
      }
      const signature = await submitTransaction(
        tx,
        copy.managingOrderContext,
        (transactionStage, submittedSignature) => {
          setManagedOrderTransactionFeedback({
            status: transactionStage,
            signature: submittedSignature,
            recovery: null,
            warning: null,
          });
        },
      );
      setManagedOrderTransactionFeedback({
        status: "confirmed",
        signature,
        recovery: null,
        warning: null,
      });
      setStatus(copy.managedOrderConfirmed[freshPlan.action]);
      setSelectedManagedOrder(null);
      await refreshData();
    } catch (error) {
      const recovery = classifySolanaTransactionError(error);
      const message =
        error instanceof ManagedOrderStateChangedError
          ? copy.managedOrderChanged
          : error instanceof ManagedOrderVaultLiquidityError
            ? copy.managedOrderVaultShortfall
            : copy.recoveryCopy[recovery.kind];
      setManagedOrderErrorMessage(message);
      setManagedOrderTransactionFeedback({
        status: "error",
        signature: recovery.signature,
        recovery,
        warning: null,
      });
      setStatus(message);
      if (error instanceof ManagedOrderStateChangedError) {
        await refreshData();
      }
    } finally {
      managedOrderSubmissionInProgressRef.current = false;
      setSubmittingManagedOrderId(null);
    }
  }, [
    connection,
    copy,
    managedOrderTransactionFeedback.status,
    readonlyPrograms.fightOracle,
    refreshData,
    selectedManagedOrder,
    submitTransaction,
    wallet.publicKey,
    writablePrograms,
  ]);

  useEffect(() => {
    if (!onMarketSnapshot) {
      return;
    }

    onMarketSnapshot({
      duelKeyHex,
      matchLabel: duelLabel,
      marketStatus: activeMarket?.marketStatus ?? "unavailable",
      yesProbabilityPercent: deriveTwoSidedClobProbabilityPercent(
        activeMarket?.bestBid,
        activeMarket?.bestAsk,
      ),
      yesPool,
      noPool,
      bids,
      asks,
      recentTrades,
      chartData,
    });
  }, [
    activeMarket?.bestAsk,
    activeMarket?.bestBid,
    activeMarket?.marketStatus,
    asks,
    bids,
    chartData,
    duelKeyHex,
    duelLabel,
    noPool,
    onMarketSnapshot,
    recentTrades,
    yesPool,
  ]);

  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const currentFundingEstimate =
    orderFundingEstimate?.quoteKey === orderQuoteKey
      ? orderFundingEstimate
      : null;
  const maxWalletFundingLamports =
    orderQuote && currentFundingEstimate
      ? orderQuote.limitCollateralLamports +
        orderQuote.fullFillTradeFeeLamports +
        currentFundingEstimate.accountRentReserveLamports +
        currentFundingEstimate.estimatedNetworkFeeLamports
      : null;
  const orderQuoteRows = orderQuote
    ? [
        {
          label: copy.selectedProbability,
          value: `${(orderQuote.outcomePriceMillis / 10).toFixed(1)}%`,
        },
        {
          label: copy.visibleFill,
          value: `${formatSolLamports(orderQuote.visibleMatchedLamports)} SOL`,
        },
        {
          label: copy.worstImmediateFill,
          value: "0 SOL",
        },
        {
          label: copy.restingAmount,
          value: `${formatSolLamports(orderQuote.visibleRemainingLamports)} SOL`,
        },
        {
          label: copy.limitCollateral,
          value: `${formatSolLamports(orderQuote.limitCollateralLamports)} SOL`,
        },
        {
          label: `${copy.tradeFees} (${activeMarket?.tradeTreasuryFeeBpsSnapshot ?? 0} + ${activeMarket?.tradeMarketMakerFeeBpsSnapshot ?? 0} bps)`,
          value: `${formatSolLamports(orderQuote.visibleTradeFeeLamports)} SOL / ≤ ${formatSolLamports(orderQuote.fullFillTradeFeeLamports)} SOL`,
        },
        {
          label: `${copy.winningsFee} (${activeMarket?.winningsMarketMakerFeeBpsSnapshot ?? 0} bps)`,
          value: `${formatSolLamports(orderQuote.fullFillWinningsFeeLamports)} SOL`,
        },
        {
          label: copy.netPayout,
          value: `${formatSolLamports(orderQuote.fullFillNetPayoutLamports)} SOL`,
        },
        {
          label: copy.netProfit,
          value: `${formatSolLamports(orderQuote.fullFillNetProfitLamports)} SOL`,
        },
        ...(currentFundingEstimate
          ? [
              {
                label: copy.networkFee,
                value: `≈ ${formatSolLamports(currentFundingEstimate.estimatedNetworkFeeLamports)} SOL`,
              },
              {
                label: copy.rentReserve,
                value: `≤ ${formatSolLamports(currentFundingEstimate.accountRentReserveLamports)} SOL`,
              },
              {
                label: copy.maxWalletFunding,
                value: `≤ ${formatSolLamports(maxWalletFundingLamports ?? 0n)} SOL`,
              },
              {
                label: copy.walletBalance,
                value: `${formatSolLamports(currentFundingEstimate.walletBalanceLamports)} SOL`,
              },
            ]
          : []),
      ]
    : [];
  const orderTransactionBlocked =
    orderTransactionFeedback.status !== "idle" &&
    orderTransactionFeedback.status !== "confirmed";
  const settlementTransactionBlocked =
    settlementTransactionFeedback.status !== "idle" &&
    settlementTransactionFeedback.status !== "confirmed";
  const managedOrderTransactionBlocked =
    managedOrderTransactionFeedback.status !== "idle" &&
    managedOrderTransactionFeedback.status !== "confirmed";
  const transactionSubmissionBlocked =
    orderTransactionBlocked ||
    settlementTransactionBlocked ||
    managedOrderTransactionBlocked;
  const hasSufficientOrderFunding =
    currentFundingEstimate != null &&
    maxWalletFundingLamports != null &&
    currentFundingEstimate.walletBalanceLamports >= maxWalletFundingLamports;
  const orderSubmissionReady =
    tradingEnabled &&
    Boolean(activeMarket) &&
    uiState.canTrade &&
    orderQuote != null &&
    currentFundingEstimate != null &&
    orderFundingError == null &&
    currentFundingEstimate.vaultReady &&
    !currentFundingEstimate.orderAccountCollision &&
    hasSufficientOrderFunding &&
    !transactionSubmissionBlocked;
  const confirmationQuoteIsCurrent = isSolanaOrderConfirmationQuoteCurrent({
    confirmationKey: orderConfirmationKey,
    currentQuoteKey: orderQuoteKey,
    orderSubmissionReady,
    submissionInProgress: isPlacingOrder,
  });
  const handleRequestOrderConfirmation = useCallback(() => {
    if (!orderSubmissionReady || !orderQuoteKey) return;
    orderConfirmationReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLastPlaceOrderError("-");
    setOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
    setSelectedManagedOrder(null);
    setOrderConfirmationRows(orderQuoteRows);
    setOrderConfirmationKey(orderQuoteKey);
  }, [orderQuoteKey, orderQuoteRows, orderSubmissionReady]);
  const handleConfirmPlaceOrder = useCallback(async () => {
    if (
      !orderConfirmationKey ||
      orderConfirmationKey !== orderQuoteKey ||
      !orderSubmissionReady ||
      isPlacingOrder
    ) {
      setLastPlaceOrderError(copy.quoteChanged);
      setStatus(copy.quoteChanged);
      return;
    }
    setIsPlacingOrder(true);
    orderSubmissionInProgressRef.current = true;
    try {
      await handlePlaceOrder(orderConfirmationKey);
      setOrderConfirmationKey(null);
    } finally {
      orderSubmissionInProgressRef.current = false;
      setIsPlacingOrder(false);
    }
  }, [
    copy.quoteChanged,
    handlePlaceOrder,
    isPlacingOrder,
    orderConfirmationKey,
    orderQuoteKey,
    orderSubmissionReady,
  ]);
  const handleReviewLatestQuote = useCallback(async () => {
    setOrderConfirmationKey(null);
    const feedback = orderTransactionFeedback;
    if (!requiresTransactionStatusCheck(feedback)) {
      setOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
      await refreshData();
      return;
    }

    const signature = feedback.signature;
    setOrderTransactionFeedback({
      status: "confirming",
      signature,
      recovery: null,
      warning: null,
    });
    try {
      const inspection = await inspectSignatureViaRpc(connection, signature);
      if (inspection.state === "confirmed") {
        setLastPlaceOrderTx(signature);
        setLastPlaceOrderError("-");
        setOrderTransactionFeedback({
          status: "confirmed",
          signature,
          recovery: null,
          warning: null,
        });
        setStatus(copy.orderPlaced);

        const trackingIntent = orderTrackingIntentRef.current;
        if (trackingIntent) {
          const recorded = await recordSolanaPredictionMarketTrade({
            ...trackingIntent,
            txSignature: signature,
          });
          if (!recorded) {
            setOrderTransactionFeedback({
              status: "confirmed",
              signature,
              recovery: null,
              warning: copy.trackingDelayed,
            });
          }
        } else {
          setOrderTransactionFeedback({
            status: "confirmed",
            signature,
            recovery: null,
            warning: copy.trackingDelayed,
          });
        }
        await refreshData();
        return;
      }
      if (inspection.state === "failed") {
        const recovery = failedTransactionRecovery(
          signature,
          feedback.recovery.stage,
          inspection.error,
        );
        setOrderTransactionFeedback({
          status: "error",
          signature,
          recovery,
          warning: null,
        });
        setLastPlaceOrderError(copy.recoveryCopy.ONCHAIN_FAILED);
        setStatus(copy.orderFailed(copy.recoveryCopy.ONCHAIN_FAILED));
        await refreshData();
        return;
      }
      setOrderTransactionFeedback({
        ...feedback,
        warning:
          inspection.state === "pending"
            ? copy.transactionPendingAfterCheck
            : copy.transactionNotFoundAfterCheck,
      });
    } catch {
      setOrderTransactionFeedback({
        ...feedback,
        warning: copy.transactionStatusCheckFailed,
      });
    }
  }, [connection, copy, orderTransactionFeedback, refreshData]);
  const handleReviewLatestSettlement = useCallback(async () => {
    const feedback = settlementTransactionFeedback;
    if (!requiresTransactionStatusCheck(feedback)) {
      setSettlementTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
      await refreshData();
      return;
    }

    const signature = feedback.signature;
    setSettlementTransactionFeedback({
      status: "confirming",
      signature,
      recovery: null,
      warning: null,
    });
    try {
      const inspection = await inspectSignatureViaRpc(connection, signature);
      if (inspection.state === "confirmed") {
        setLastClaimTx(signature);
        setLastClaimError("-");
        setSettlementTransactionFeedback({
          status: "confirmed",
          signature,
          recovery: null,
          warning: null,
        });
        setStatus(
          settlementFeedbackKind === "cleanup"
            ? copy.positionCleared
            : copy.claimComplete,
        );
        await refreshData();
        window.dispatchEvent(new CustomEvent("hyperbet:market-refresh"));
        return;
      }
      if (inspection.state === "failed") {
        const recovery = failedTransactionRecovery(
          signature,
          feedback.recovery.stage,
          inspection.error,
        );
        setSettlementTransactionFeedback({
          status: "error",
          signature,
          recovery,
          warning: null,
        });
        setLastClaimError(copy.recoveryCopy.ONCHAIN_FAILED);
        setStatus(
          settlementFeedbackKind === "cleanup"
            ? copy.clearPositionFailed(copy.recoveryCopy.ONCHAIN_FAILED)
            : copy.claimFailed(copy.recoveryCopy.ONCHAIN_FAILED),
        );
        await refreshData();
        return;
      }
      setSettlementTransactionFeedback({
        ...feedback,
        warning:
          inspection.state === "pending"
            ? copy.transactionPendingAfterCheck
            : copy.transactionNotFoundAfterCheck,
      });
    } catch {
      setSettlementTransactionFeedback({
        ...feedback,
        warning: copy.transactionStatusCheckFailed,
      });
    }
  }, [
    connection,
    copy,
    refreshData,
    settlementFeedbackKind,
    settlementTransactionFeedback,
  ]);
  const handleRequestManagedOrder = useCallback(
    (plan: SolanaManagedOrderPlan) => {
      managedOrderReturnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOrderConfirmationKey(null);
      setManagedOrderErrorMessage(null);
      setManagedOrderFeedbackAction(plan.action);
      setManagedOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
      setSelectedManagedOrder(plan);
    },
    [],
  );
  const handleHistoricalOrderManagement = useCallback(
    async (request: SolanaHistoricalOrderRequest) => {
      if (!wallet.publicKey || preparingHistoryOrderBetId !== null) {
        setStatus(copy.connectWalletToTrade);
        return;
      }
      const normalizedDuelKey = normalizePredictionMarketDuelKeyHex(
        request.duelKey,
      );
      const requestedMarketState = parsePublicKeyOrNull(request.marketPda);
      if (
        !normalizedDuelKey ||
        !requestedMarketState ||
        !/^(0|[1-9]\d*)$/.test(request.orderId)
      ) {
        setStatus(copy.managedOrderChanged);
        return;
      }

      setPreparingHistoryOrderBetId(request.betId);
      setManagedOrderErrorMessage(null);
      setManagedOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
      try {
        const clobProgram: any = readonlyPrograms.duelMarket;
        const oracleProgram: any = readonlyPrograms.fightOracle;
        const requestedDuelState = findDuelStatePda(
          oracleProgram.programId,
          duelKeyHexToBytes(normalizedDuelKey),
        );
        const canonicalMarketState = findMarketStatePda(
          clobProgram.programId,
          requestedDuelState,
          DUEL_WINNER_MARKET_KIND,
        );
        if (!requestedMarketState.equals(canonicalMarketState)) {
          throw new ManagedOrderStateChangedError(
            "History no longer identifies the canonical duel market",
          );
        }

        const orderId = BigInt(request.orderId);
        const orderPda = findOrderPda(
          clobProgram.programId,
          canonicalMarketState,
          orderId,
        );
        const [marketAccount, duelAccount, orderAccount, orderAccountInfo] =
          await Promise.all([
            clobProgram.account.marketState.fetch(canonicalMarketState),
            oracleProgram.account.duelState.fetch(requestedDuelState),
            clobProgram.account.order.fetchNullable(orderPda),
            connection.getAccountInfo(orderPda, "confirmed"),
          ]);
        if (
          !(marketAccount.duelState as PublicKey).equals(requestedDuelState) ||
          Number(marketAccount.marketKind) !== DUEL_WINNER_MARKET_KIND ||
          !orderAccount ||
          !orderAccountInfo ||
          orderAccountInfo.lamports <= 0 ||
          !orderAccountInfo.owner.equals(clobProgram.programId)
        ) {
          throw new ManagedOrderStateChangedError(
            "The historical order is no longer manageable",
          );
        }
        const orderSnapshot = managedOrderSnapshot({
          publicKey: orderPda,
          account: orderAccount,
        });
        if (orderSnapshot.id !== orderId) {
          throw new ManagedOrderStateChangedError(
            "The historical order identity changed",
          );
        }
        const plan = buildSolanaManagedOrderPlan({
          marketStatus: effectiveMarketStatusFromDuel(
            enumName(duelAccount.status),
            enumName(marketAccount.status),
          ),
          marketState: canonicalMarketState.toBase58(),
          wallet: wallet.publicKey.toBase58(),
          order: orderSnapshot,
          orderAccountLamports: BigInt(orderAccountInfo.lamports),
        });
        if (
          (request.orderState === "FILLED") !==
          (plan.action === "CLOSE_FILLED")
        ) {
          throw new ManagedOrderStateChangedError(
            "The historical order state changed",
          );
        }
        handleRequestManagedOrder(plan);
      } catch {
        setManagedOrderErrorMessage(copy.managedOrderChanged);
        setStatus(copy.managedOrderChanged);
        await refreshData();
      } finally {
        setPreparingHistoryOrderBetId(null);
      }
    },
    [
      connection,
      copy.connectWalletToTrade,
      copy.managedOrderChanged,
      handleRequestManagedOrder,
      preparingHistoryOrderBetId,
      readonlyPrograms.duelMarket,
      readonlyPrograms.fightOracle,
      refreshData,
      wallet.publicKey,
    ],
  );
  const handleReviewLatestManagedOrder = useCallback(async () => {
    setSelectedManagedOrder(null);
    const feedback = managedOrderTransactionFeedback;
    if (!requiresTransactionStatusCheck(feedback)) {
      setManagedOrderErrorMessage(null);
      setManagedOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
      await refreshData();
      return;
    }

    const signature = feedback.signature;
    setManagedOrderTransactionFeedback({
      status: "confirming",
      signature,
      recovery: null,
      warning: null,
    });
    try {
      const inspection = await inspectSignatureViaRpc(connection, signature);
      if (inspection.state === "confirmed") {
        setManagedOrderErrorMessage(null);
        setManagedOrderTransactionFeedback({
          status: "confirmed",
          signature,
          recovery: null,
          warning: null,
        });
        setStatus(copy.managedOrderConfirmed[managedOrderFeedbackAction]);
        await refreshData();
        return;
      }
      if (inspection.state === "failed") {
        const recovery = failedTransactionRecovery(
          signature,
          feedback.recovery.stage,
          inspection.error,
        );
        setManagedOrderErrorMessage(copy.recoveryCopy.ONCHAIN_FAILED);
        setManagedOrderTransactionFeedback({
          status: "error",
          signature,
          recovery,
          warning: null,
        });
        setStatus(copy.recoveryCopy.ONCHAIN_FAILED);
        await refreshData();
        return;
      }
      setManagedOrderTransactionFeedback({
        ...feedback,
        warning:
          inspection.state === "pending"
            ? copy.transactionPendingAfterCheck
            : copy.transactionNotFoundAfterCheck,
      });
    } catch {
      setManagedOrderTransactionFeedback({
        ...feedback,
        warning: copy.transactionStatusCheckFailed,
      });
    }
  }, [
    connection,
    copy,
    managedOrderFeedbackAction,
    managedOrderTransactionFeedback,
    refreshData,
  ]);

  const transactionMarketAddress = activeMarket?.marketState.toBase58() ?? null;
  const transactionWalletAddress = wallet.publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (!transactionMarketAddress || !transactionWalletAddress) {
      return;
    }
    const transactionContext = `${transactionWalletAddress}:${transactionMarketAddress}`;
    if (transactionContextRef.current === null) {
      transactionContextRef.current = transactionContext;
      return;
    }
    if (transactionContextRef.current === transactionContext) {
      return;
    }
    transactionContextRef.current = transactionContext;
    setOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
    setSettlementTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
    setManagedOrderTransactionFeedback(IDLE_SOLANA_TRANSACTION_FEEDBACK);
    setManagedOrderErrorMessage(null);
    setSelectedManagedOrder(null);
  }, [transactionMarketAddress, transactionWalletAddress]);

  useEffect(() => {
    if (orderConfirmationKey == null) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!orderSubmissionInProgressRef.current) {
          setOrderConfirmationKey(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        orderConfirmationDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleDialogKeyboard);
      orderConfirmationReturnFocusRef.current?.focus();
      orderConfirmationReturnFocusRef.current = null;
    };
  }, [orderConfirmationKey]);

  useEffect(() => {
    if (selectedManagedOrder == null) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!managedOrderSubmissionInProgressRef.current) {
          setSelectedManagedOrder(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        managedOrderDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", handleDialogKeyboard);
      managedOrderReturnFocusRef.current?.focus();
      managedOrderReturnFocusRef.current = null;
    };
  }, [selectedManagedOrder]);
  const yesPercent = deriveTwoSidedClobProbabilityPercent(
    activeMarket?.bestBid,
    activeMarket?.bestAsk,
  );
  const noPercent = yesPercent === null ? null : 100 - yesPercent;
  const canClaim = uiState.canClaim;
  const claimUi = derivePredictionMarketClaimUi(
    copy,
    uiState.claimKind,
    canClaim,
  );
  const claimValueText =
    canClaim && uiState.claimableAmount > 0n
      ? `${fmtAmount(uiState.claimableAmount).toFixed(3)} SOL`
      : null;
  const marketStateText = activeMarket?.marketState.toBase58() ?? "-";
  const lifecycleDebugText = [
    `duelKey=${activeLifecycleMarket?.duelKey ?? activeLifecycleDuel?.duelKey ?? duelKeyHex ?? "-"}`,
    `marketRef=${lifecycleMarketRef ?? activeMarket?.marketState.toBase58() ?? "-"}`,
    `pinned=${pinnedE2eDuelKey ?? "-"}`,
    `lifecycleStatus=${uiState.lifecycleStatus}`,
    `winner=${uiState.winner}`,
    `marketStatus=${activeMarket?.marketStatus ?? "-"}`,
    `marketWinner=${activeMarket?.winner ?? "-"}`,
    `claimKind=${uiState.claimKind}`,
    `claimableAmount=${uiState.claimableAmount.toString()}`,
    `canClaim=${uiState.canClaim ? "true" : "false"}`,
  ].join("\n");
  const walletDebugText = [
    `wallet=${walletAddress ?? "-"}`,
    `aShares=${position.aShares.toString()}`,
    `bShares=${position.bShares.toString()}`,
    `aLockedLamports=${position.aLockedLamports.toString()}`,
    `bLockedLamports=${position.bLockedLamports.toString()}`,
    `tradeTreasuryFeeLamports=${position.tradeTreasuryFeeLamports.toString()}`,
    `tradeMarketMakerFeeLamports=${position.tradeMarketMakerFeeLamports.toString()}`,
    `refundableAmount=${walletSnapshot.refundableAmount.toString()}`,
  ].join("\n");
  const adminPanelText = [
    `${copy.adminStatus} ${status}`,
    `${copy.match} ${marketStateText}`,
    `${copy.adminDuel} ${duelLabel}`,
    `${copy.adminPosition} YES ${fmtAmount(position.aShares).toFixed(6)} | NO ${fmtAmount(position.bShares).toFixed(6)}`,
    `${copy.adminPools} YES ${fmtAmount(yesPool).toFixed(6)} | NO ${fmtAmount(noPool).toFixed(6)}`,
    `${copy.adminLastOrder} ${lastOrderId?.toString() ?? "-"}`,
  ].join("\n");
  const orderQuoteIssue = orderQuoteResult.error
    ? copy.quoteUnavailable(orderQuoteResult.error)
    : orderFundingError
      ? copy.quoteUnavailable(orderFundingError)
      : orderQuote && walletAddress && orderQuoteKey && !currentFundingEstimate
        ? copy.quoteLoading
        : currentFundingEstimate?.orderAccountCollision
          ? copy.quoteUnavailable("next order account already exists")
          : currentFundingEstimate && !currentFundingEstimate.vaultReady
            ? copy.vaultNotReady
            : currentFundingEstimate && !hasSufficientOrderFunding
              ? copy.insufficientBalance
              : null;
  const orderTransactionMessage =
    orderTransactionFeedback.status === "idle"
      ? null
      : orderTransactionFeedback.status === "error"
        ? copy.recoveryCopy[orderTransactionFeedback.recovery.kind]
        : copy.transactionProgress[orderTransactionFeedback.status];
  const settlementTransactionMessage =
    settlementTransactionFeedback.status === "idle"
      ? null
      : settlementTransactionFeedback.status === "error"
        ? copy.recoveryCopy[settlementTransactionFeedback.recovery.kind]
        : settlementTransactionFeedback.status === "confirmed"
          ? copy.settlementConfirmed[settlementFeedbackKind]
          : copy.settlementProgress[settlementTransactionFeedback.status];
  const managedOrderTransactionMessage =
    managedOrderTransactionFeedback.status === "idle"
      ? null
      : managedOrderTransactionFeedback.status === "error"
        ? (managedOrderErrorMessage ??
          copy.recoveryCopy[managedOrderTransactionFeedback.recovery.kind])
        : managedOrderTransactionFeedback.status === "confirmed"
          ? copy.managedOrderConfirmed[managedOrderFeedbackAction]
          : copy.managedOrderProgress[managedOrderTransactionFeedback.status];
  return (
    <div data-testid={isE2eMode ? "solana-clob-panel" : undefined}>
      <PredictionMarketPanel
        yesPercent={yesPercent}
        noPercent={noPercent}
        yesPool={`${fmtAmount(yesPool).toFixed(3)} SOL`}
        noPool={`${fmtAmount(noPool).toFixed(3)} SOL`}
        side={side}
        setSide={setSide}
        amountInput={amountInput}
        setAmountInput={setAmountInput}
        onPlaceBet={handleRequestOrderConfirmation}
        isWalletReady={walletReady(wallet)}
        programsReady={orderSubmissionReady && !isPlacingOrder}
        agent1Name={effectiveAgent1}
        agent2Name={effectiveAgent2}
        supportsSell
        chartData={chartData}
        bids={bids}
        asks={asks}
        recentTrades={recentTrades}
        currencySymbol="SOL"
        amountLabel={copy.payoutAmountLabel}
        compact={compact}
        pointsDisplay={
          readOnly ? undefined : (
            <SolanaPointsDisplay
              walletAddress={walletAddress}
              compact={compact}
              locale={resolvedLocale}
            />
          )
        }
        locale={resolvedLocale}
        readOnly={readOnly}
      >
        {!readOnly ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              padding: compact ? "0 16px 14px" : "12px 0 0",
              color: "#d4d4d8",
              fontFamily: "var(--hm-font-body)",
              fontSize: 12,
            }}
          >
            {activeMarket ? (
              <div
                data-testid={isE2eMode ? "solana-order-quote" : undefined}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "12px",
                  borderRadius: "var(--hm-radius)",
                  border: `1px solid ${orderQuoteIssue ? "rgba(248,113,113,0.28)" : "rgba(96,165,250,0.24)"}`,
                  background: orderQuoteIssue
                    ? "rgba(127,29,29,0.09)"
                    : "rgba(30,64,175,0.08)",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    color: "var(--hm-text, #f8fafc)",
                  }}
                >
                  {copy.orderReviewTitle}
                </span>
                {orderQuoteRows.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 12,
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.52)" }}>
                      {row.label}
                    </span>
                    <span
                      style={{
                        color: "var(--hm-text, #f8fafc)",
                        fontFamily: "var(--hm-font-mono)",
                        textAlign: "right",
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
                {orderQuoteIssue ? (
                  <span style={{ color: "#fca5a5", lineHeight: 1.45 }}>
                    {orderQuoteIssue}
                  </span>
                ) : null}
                {orderQuote?.selfTradePrevented ? (
                  <span style={{ color: "#fbbf24", lineHeight: 1.45 }}>
                    {copy.selfTradeDisclosure}
                  </span>
                ) : null}
                {orderQuote?.continuationRequired ? (
                  <span style={{ color: "#fbbf24", lineHeight: 1.45 }}>
                    {copy.continuationDisclosure}
                  </span>
                ) : null}
                <span
                  style={{ color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}
                >
                  {copy.refundDisclosure}
                </span>
                <span
                  style={{ color: "rgba(255,255,255,0.42)", lineHeight: 1.45 }}
                >
                  {copy.quoteFreshness}
                </span>
              </div>
            ) : null}
            <SolanaTransactionFeedbackCard
              feedback={orderTransactionFeedback}
              message={orderTransactionMessage}
              cluster={SOLANA_CLUSTER}
              testId="solana-order-transaction-feedback"
              signatureTestId="solana-order-transaction-signature"
              signatureLabel={copy.transactionSignature}
              receiptLabel={copy.transactionReceipt}
              reviewLabel={copy.reviewLatestQuote}
              checkStatusLabel={copy.checkTransactionStatus}
              onReview={() => void handleReviewLatestQuote()}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>{status}</span>
            </div>

            <SolanaManagedOrders
              orders={managedOrders}
              submittingOrderId={submittingManagedOrderId}
              disabled={
                !walletReady(wallet) ||
                isPlacingOrder ||
                isSubmittingSettlement ||
                transactionSubmissionBlocked
              }
              locale={resolvedLocale}
              onRequestAction={handleRequestManagedOrder}
            />

            <SolanaTransactionFeedbackCard
              feedback={managedOrderTransactionFeedback}
              message={managedOrderTransactionMessage}
              cluster={SOLANA_CLUSTER}
              testId="solana-managed-order-transaction-feedback"
              signatureTestId="solana-managed-order-transaction-signature"
              signatureLabel={copy.transactionSignature}
              receiptLabel={copy.transactionReceipt}
              reviewLabel={copy.reviewLatestManagedOrder}
              checkStatusLabel={copy.checkTransactionStatus}
              onReview={() => void handleReviewLatestManagedOrder()}
            />

            {canClaim ? (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "12px",
                  borderRadius: "var(--hm-radius)",
                  border: "1px solid rgba(52,211,153,0.26)",
                  background:
                    "linear-gradient(180deg, rgba(16,92,53,0.14) 0%, rgba(12,67,39,0.08) 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 22px rgba(0,0,0,0.14)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: "rgba(167,243,208,0.82)",
                      fontFamily: "var(--hm-font-display)",
                    }}
                  >
                    {copy.adminStatus}
                  </span>
                  <span
                    style={{
                      fontSize: compact ? 12 : 13,
                      fontWeight: 700,
                      color: "var(--hm-text, #f8fafc)",
                      lineHeight: 1.4,
                      minWidth: 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {claimUi.title}
                  </span>
                  {claimValueText ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "rgba(167,243,208,0.88)",
                        fontFamily: "var(--hm-font-mono)",
                      }}
                    >
                      {claimValueText}
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: 11,
                      color:
                        "var(--hm-panel-subtle-text, rgba(255,255,255,0.48))",
                      lineHeight: 1.45,
                      minWidth: 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {claimUi.helpText}
                  </span>
                </div>

                <button
                  data-testid={
                    isE2eMode ? "solana-clob-claim-payout" : undefined
                  }
                  type="button"
                  disabled={
                    isSubmittingSettlement || transactionSubmissionBlocked
                  }
                  onClick={() => void handleClaim()}
                  style={buttonStyle(
                    "#0f3f2b",
                    "rgba(34,197,94,0.35)",
                    isSubmittingSettlement,
                  )}
                >
                  {isSubmittingSettlement
                    ? copy.processingSettlement
                    : claimUi.buttonLabel}
                </button>
              </div>
            ) : null}

            <SolanaTransactionFeedbackCard
              feedback={settlementTransactionFeedback}
              message={settlementTransactionMessage}
              cluster={SOLANA_CLUSTER}
              testId="solana-settlement-transaction-feedback"
              signatureTestId="solana-settlement-transaction-signature"
              signatureLabel={copy.transactionSignature}
              receiptLabel={copy.transactionReceipt}
              reviewLabel={copy.reviewLatestSettlement}
              checkStatusLabel={copy.checkTransactionStatus}
              onReview={() => void handleReviewLatestSettlement()}
            />

            <SolanaSettlementHistory
              walletAddress={walletAddress}
              agent1Name={effectiveAgent1}
              agent2Name={effectiveAgent2}
              onRequestSettlement={handleHistoricalSettlement}
              onRequestOrderManagement={handleHistoricalOrderManagement}
              settlingBetId={settlingHistoryBetId}
              preparingOrderBetId={preparingHistoryOrderBetId}
              transactionsBlocked={transactionSubmissionBlocked}
              compact={compact}
              locale={resolvedLocale}
            />
          </div>
        ) : null}
      </PredictionMarketPanel>
      {!readOnly ? (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#d4d4d8",
            fontFamily: "var(--hm-font-body)",
            fontSize: 12,
          }}
        >
          <span>{copy.limitPrice}</span>
          <input
            data-testid="solana-clob-price-input"
            value={priceInput}
            onChange={(event) => setPriceInput(event.target.value)}
            inputMode="numeric"
            style={{
              width: 88,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(17,24,39,0.65)",
              color: "#f4f4f5",
            }}
          />
        </div>
      ) : null}
      {orderConfirmationKey != null ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(2,6,23,0.78)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            ref={orderConfirmationDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="solana-order-confirmation-title"
            aria-describedby="solana-order-confirmation-help"
            data-testid={isE2eMode ? "solana-order-confirmation" : undefined}
            style={{
              width: "min(100%, 460px)",
              maxHeight: "min(90vh, 760px)",
              overflowY: "auto",
              display: "grid",
              gap: 14,
              padding: compact ? 16 : 20,
              borderRadius: 14,
              border: "1px solid rgba(96,165,250,0.34)",
              background:
                "linear-gradient(180deg, rgba(15,23,42,0.99), rgba(3,7,18,0.99))",
              boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
              color: "var(--hm-text, #f8fafc)",
              fontFamily: "var(--hm-font-body)",
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <h2
                id="solana-order-confirmation-title"
                style={{ margin: 0, fontSize: 18, lineHeight: 1.25 }}
              >
                {copy.confirmOrderTitle}
              </h2>
              <p
                id="solana-order-confirmation-help"
                style={{
                  margin: 0,
                  color: "rgba(255,255,255,0.62)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {copy.confirmOrderHelp}
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${confirmationQuoteIsCurrent ? "rgba(96,165,250,0.22)" : "rgba(248,113,113,0.32)"}`,
                background: confirmationQuoteIsCurrent
                  ? "rgba(30,64,175,0.08)"
                  : "rgba(127,29,29,0.12)",
              }}
            >
              {orderConfirmationRows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 14,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "rgba(255,255,255,0.54)" }}>
                    {row.label}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--hm-font-mono)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
              {!confirmationQuoteIsCurrent ? (
                <span
                  role="alert"
                  style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.45 }}
                >
                  {copy.quoteChanged}
                </span>
              ) : null}
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                color: "rgba(255,255,255,0.58)",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              <span>{copy.refundDisclosure}</span>
              <span>{copy.expirationDisclosure}</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)",
                gap: 10,
              }}
            >
              <button
                type="button"
                disabled={isPlacingOrder}
                onClick={() => setOrderConfirmationKey(null)}
                style={buttonStyle(
                  "rgba(30,41,59,0.78)",
                  "rgba(148,163,184,0.26)",
                  isPlacingOrder,
                )}
              >
                {copy.cancelConfirmation}
              </button>
              <button
                type="button"
                autoFocus
                disabled={!confirmationQuoteIsCurrent || isPlacingOrder}
                onClick={() => void handleConfirmPlaceOrder()}
                style={buttonStyle(
                  "rgba(30,64,175,0.82)",
                  "rgba(96,165,250,0.48)",
                  !confirmationQuoteIsCurrent || isPlacingOrder,
                )}
              >
                {isPlacingOrder ? copy.confirmingOrder : copy.confirmAndSign}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {selectedManagedOrder != null ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(2,6,23,0.78)",
            backdropFilter: "blur(8px)",
          }}
        >
          <SolanaManagedOrderConfirmationDialog
            ref={managedOrderDialogRef}
            order={selectedManagedOrder}
            submitting={submittingManagedOrderId !== null}
            compact={compact}
            locale={resolvedLocale}
            onBack={() => setSelectedManagedOrder(null)}
            onConfirm={() => void handleConfirmManagedOrder()}
          />
        </div>
      ) : null}
      {isE2eMode && (
        <div
          style={{
            marginTop: 16,
            borderTop: "1px solid rgba(255,191,0,0.1)",
            paddingTop: 16,
          }}
        >
          <button
            type="button"
            onClick={() => setShowDebug((prev) => !prev)}
            style={{
              width: "100%",
              padding: "10px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,191,0,0.15)",
              borderRadius: 2,
              color: "rgba(255,191,0,0.8)",
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "var(--hm-font-header)", // Assuming Orbitron or similar is tied to this
              textTransform: "uppercase",
              letterSpacing: 2,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {showDebug ? "Close Terminal" : "Initialize Debug"}
          </button>

          {showDebug && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "rgba(0,0,0,0.25)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(255,191,0,0.08)",
                borderRadius: 4,
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  data-testid="solana-clob-admin-toggle"
                  aria-expanded={showAdminPanel ? "true" : "false"}
                  onClick={() => setShowAdminPanel((open) => !open)}
                  style={premiumButtonStyle(
                    "rgba(17, 24, 39, 0.6)",
                    "rgba(255,191,0,0.3)",
                  )}
                >
                  {showAdminPanel
                    ? "Hide Admin Interface"
                    : "Access Admin Panel"}
                </button>
                <button
                  type="button"
                  data-testid="solana-clob-create-match"
                  onClick={() => void refreshData()}
                  style={premiumButtonStyle(
                    "rgba(30, 58, 95, 0.4)",
                    "rgba(59,130,246,0.3)",
                  )}
                >
                  Synchronize Data
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div
                  data-testid="solana-clob-match"
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.5)",
                    fontFamily: "var(--hm-font-mono)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  <span style={{ color: "rgba(255,191,0,0.6)" }}>
                    {copy.match.toUpperCase()}:
                  </span>{" "}
                  {marketStateText}
                </div>
                <div
                  data-testid="solana-clob-status"
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.5)",
                    fontFamily: "var(--hm-font-mono)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  <span style={{ color: "rgba(255,191,0,0.6)" }}>STATUS:</span>{" "}
                  {status}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <pre
                  data-testid="solana-clob-lifecycle-debug"
                  style={debugPreStyle()}
                >
                  {lifecycleDebugText}
                </pre>
                <pre
                  data-testid="solana-clob-wallet-debug"
                  style={debugPreStyle()}
                >
                  {walletDebugText}
                </pre>
              </div>

              <div
                data-testid="solana-clob-place-order-tx"
                style={{
                  fontSize: 8,
                  opacity: 0.4,
                  wordBreak: "break-all",
                  fontFamily: "var(--hm-font-mono)",
                }}
              >
                LAST_TX: {lastPlaceOrderTx}
              </div>
              <div
                data-testid="solana-clob-place-order-error"
                style={{
                  fontSize: 8,
                  opacity: 0.4,
                  wordBreak: "break-all",
                  fontFamily: "var(--hm-font-mono)",
                }}
              >
                LAST_ERROR: {lastPlaceOrderError}
              </div>
              <div
                data-testid="solana-clob-place-order-debug"
                style={{
                  fontSize: 8,
                  opacity: 0.4,
                  wordBreak: "break-all",
                  fontFamily: "var(--hm-font-mono)",
                }}
              >
                LAST_DEBUG: {lastPlaceOrderDebug}
              </div>
              <div
                data-testid="solana-clob-claim-tx"
                style={{
                  fontSize: 8,
                  opacity: 0.4,
                  wordBreak: "break-all",
                  fontFamily: "var(--hm-font-mono)",
                }}
              >
                CLAIM_TX: {lastClaimTx}
              </div>
              <div
                data-testid="solana-clob-claim-error"
                style={{
                  fontSize: 8,
                  opacity: 0.4,
                  wordBreak: "break-all",
                  fontFamily: "var(--hm-font-mono)",
                }}
              >
                CLAIM_ERROR: {lastClaimError}
              </div>

              {showAdminPanel && (
                <pre
                  data-testid="solana-clob-admin-panel"
                  style={{
                    ...debugPreStyle(),
                    borderColor: "rgba(239,68,68,0.2)",
                    background: "rgba(127,29,29,0.1)",
                  }}
                >
                  {adminPanelText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buttonStyle(
  background: string,
  border: string,
  disabled = false,
): CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: `1px solid ${border}`,
    background,
    color: disabled ? "rgba(255,255,255,0.45)" : "#f4f4f5",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  };
}

function premiumButtonStyle(
  background: string,
  border: string,
  disabled = false,
): CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 2,
    border: `1px solid ${border}`,
    background,
    color: disabled ? "rgba(255,255,255,0.3)" : "rgba(255,191,0,0.85)",
    fontSize: 9,
    fontWeight: 700,
    fontFamily: "var(--hm-font-header)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "all 0.2s ease",
  };
}

function debugPreStyle(): CSSProperties {
  return {
    margin: 0,
    padding: 10,
    borderRadius: 2,
    border: "1px solid rgba(255,191,0,0.12)",
    background: "rgba(10,10,10,0.6)",
    color: "rgba(148,163,184,0.85)",
    whiteSpace: "pre-wrap",
    fontSize: 9,
    fontFamily: "var(--hm-font-mono)",
    lineHeight: 1.5,
    maxHeight: 160,
    overflowY: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: "rgba(255,191,0,0.2) transparent",
  };
}
