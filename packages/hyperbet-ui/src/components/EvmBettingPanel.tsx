import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PredictionMarketLifecycleRecord } from "@hyperbet/chain-registry";
import { resolveUiLocale, type UiLocale } from "@hyperbet/ui/i18n";
import { useAccount, useWalletClient } from "wagmi";
import {
  formatUnits,
  hexToBytes,
  keccak256,
  parseUnits,
  serializeTransaction,
  toHex,
  type Address,
  type Hex,
  type Signature,
} from "viem";
import {
  publicKeyToAddress,
  serializeSignature,
  toAccount,
  type LocalAccount,
} from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";

import { useChain } from "../lib/ChainContext";
import { getEvmChainConfig } from "../lib/chainConfig";
import {
  claimWinnings,
  type ContractWriteAccount,
  createEvmPublicClient,
  createSignedRpcWalletClient,
  createUnlockedRpcWalletClient,
  getMarketMeta,
  getMarketReadSnapshot,
  getNativeBalance,
  getRecentTrades,
  ORDER_FLAG_GTC,
  placeOrder,
  RateLimitError,
  toDuelKeyHex,
  type MarketMeta,
  type MarketStatus,
  type Position,
  type Side,
  SIDE_ENUM,
} from "../lib/evmClient";
import {
  type PredictionMarketsDuelSnapshot,
  normalizePredictionMarketDuelKeyHex,
  usePredictionMarketLifecycle,
} from "../lib/predictionMarkets";
import { selectConfiguredEvmPrivateKey } from "../lib/evmPrivateKey";
import {
  derivePredictionMarketUiState,
  EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
  type PredictionMarketWalletSnapshot,
} from "../lib/predictionMarketUiState";
import { derivePredictionMarketClaimUi } from "../lib/predictionMarketClaimUi";
import { recordPredictionMarketTrade } from "../lib/predictionMarketTracking";
import { useStreamingState } from "../spectator/useStreamingState";
import {
  PredictionMarketPanel,
  type ChartDataPoint,
} from "./PredictionMarketPanel";
import { type OrderLevel } from "./OrderBook";
import { PointsDisplay } from "./PointsDisplay";
import { type Trade } from "./RecentTrades";

type BetSide = "YES" | "NO";

const MARKET_KIND_DUEL_WINNER = 0;
const MIN_RPC_BACKOFF_MS = 15_000;

function createStrictPrivateKeyAccount(
  address: Address,
  privateKey: `0x${string}`,
): LocalAccount & { publicKey: Hex; source: "privateKey" } {
  const publicKey = toHex(secp256k1.getPublicKey(hexToBytes(privateKey), false));
  const derivedAddress = publicKeyToAddress(publicKey);
  if (derivedAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error("configured e2e address/private key mismatch");
  }
  const signDigestObject = (hash: Hex): Signature => {
    const recoveredSignature = secp256k1.sign(
      hexToBytes(hash),
      hexToBytes(privateKey),
      { lowS: true, prehash: false, format: "recovered" },
    );
    if (recoveredSignature.length !== 65) {
      throw new Error("unexpected recovered signature size");
    }
    const recovery = recoveredSignature[0] ?? 0;
    const signature = {
      r: toHex(recoveredSignature.subarray(1, 33)),
      s: toHex(recoveredSignature.subarray(33, 65)),
      v: recovery ? 28n : 27n,
      yParity: (recovery ? 1 : 0) as 0 | 1,
    };
    return signature;
  };
  const signDigestHex = (hash: Hex): Hex =>
    serializeSignature({ ...signDigestObject(hash), to: "hex" });
  const account = toAccount({
    address: derivedAddress,
    async sign({ hash }) {
      return signDigestHex(hash);
    },
    async signMessage() {
      throw new Error("signMessage is not implemented for the e2e signer");
    },
    async signTransaction(transaction, { serializer } = {}) {
      const serialize = serializer ?? serializeTransaction;
      const signableTransaction =
        transaction.type === "eip4844"
          ? {
              ...transaction,
              sidecars: false,
            }
          : transaction;
      return serialize(
        transaction,
        signDigestObject(keccak256(await serialize(signableTransaction))),
      );
    },
    async signTypedData() {
      throw new Error("signTypedData is not implemented for the e2e signer");
    },
  }) as LocalAccount;
  return {
    ...account,
    publicKey,
    source: "privateKey" as const,
  };
}

function normalizeAddress(value: string): Address | null {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed as Address;
}

function readE2eRuntimeOverride(): {
  duelKey: string | null;
  duelId: string | null;
} {
  if (typeof window === "undefined") {
    return { duelKey: null, duelId: null };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const duelKey = normalizePredictionMarketDuelKeyHex(
    searchParams.get("e2eEvmDuelKey") ??
      searchParams.get("e2eDuelKey") ??
      window.localStorage.getItem("hyperbet.e2e.evmDuelKey") ??
      "",
  );
  const duelId =
    searchParams.get("e2eEvmDuelId") ??
    searchParams.get("e2eDuelId") ??
    window.localStorage.getItem("hyperbet.e2e.evmDuelId") ??
    null;

  return { duelKey, duelId: duelId?.trim() || null };
}

interface EvmBettingPanelProps {
  agent1Name: string;
  agent2Name: string;
  compact?: boolean;
  locale?: UiLocale;
  lifecycleDuelOverride?: PredictionMarketsDuelSnapshot | null;
  lifecycleMarketOverride?: PredictionMarketLifecycleRecord | null;
  onLifecycleRefreshRequested?: (() => void | Promise<void>) | null;
}

function getEvmPanelCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      waitingForLiveDuel: "等待实时 Hyperscape 对决",
      waitingForMarketOperator: "等待市场运营方开启",
      resolvedFor: (name: string) => `${name} 已结算获胜`,
      resolved: "已结算",
      marketCancelled: "市场已取消",
      bettingLocked: "下注已锁定",
      resolutionProposed: "结果已提交，等待挑战期结束",
      resolutionChallenged: "结果已被挑战，结算已暂停",
      marketOpen: "市场开放中",
      refreshFailed: (message: string) => `刷新失败：${message}`,
      streamDriftDetected: "即将开放下注",
      walletNotConnected: "钱包未连接",
      amountTooLow: "数量必须大于 0",
      placingOrder: "正在下单...",
      orderPlaced: "订单已提交",
      orderFailed: (message: string) => `下单失败：${message}`,
      claimingSettlement: "正在领取结算...",
      claimComplete: "领取完成",
      claimFailed: (message: string) => `领取失败：${message}`,
      duel: "对局",
      pending: "待定",
      wallet: "钱包",
      disconnected: "未连接",
      price: "价格",
      limitPrice: "限价",
      balance: "余额",
      marketStatus: "市场状态",
      totalPool: "总资金池",
      selectedSide: "当前方向",
      youHold: "持仓",
      estCost: "预计成交",
      estFee: "手续费",
      estMaxPayout: "胜出返还",
      claimWinningsTitle: "领取收益",
      claimRefundTitle: "领取退款",
      claimLocked: "暂无可领取结算",
      claimHelp: "对局结算后，可在这里领取获胜份额。",
      claimRefundHelp: "若本局取消，可在这里领取退回资金。",
      claimCleanupTitle: "清理已结算仓位",
      claimCleanupHelp: "若本局已判定负方，可在这里清理残留仓位状态。",
      sideYes: "买入 A",
      sideNo: "买入 B",
      walletReady: "钱包已连接",
      walletMissing: "连接钱包以继续",
      priceHint: "使用 1–999 输入价格，500 = 50.0%",
      positionHint: "买入份额后，结算时按获胜方领取。",
      quickOrderMode: "快捷下注",
      limitOrderMode: "限价订单",
      showAdvancedPricing: "展开限价",
      hideAdvancedPricing: "收起限价",
      quickOrderHelp: "默认把这张票作为快捷下注使用；只有想自己卡价时才需要展开限价。",
      yourShares: "你的 A / B 份额",
      claim: "领取",
      clearPosition: "清理仓位",
    };
  }

  return {
    waitingForLiveDuel: "Waiting for live Hyperscape duel",
    waitingForMarketOperator: "Waiting for market operator",
    resolvedFor: (name: string) => `Resolved for ${name}`,
    resolved: "Resolved",
    marketCancelled: "Market cancelled",
    bettingLocked: "Betting locked",
    resolutionProposed: "Result proposed; challenge window active",
    resolutionChallenged: "Result challenged; settlement paused",
    marketOpen: "Market open",
    refreshFailed: (message: string) => `Refresh failed: ${message}`,
    streamDriftDetected: "Betting starts soon",
    walletNotConnected: "Wallet not connected",
    amountTooLow: "Amount must be greater than zero",
    placingOrder: "Placing order...",
    orderPlaced: "Order placed",
    orderFailed: (message: string) => `Order failed: ${message}`,
    claimingSettlement: "Claiming settlement...",
    claimComplete: "Claim complete",
    claimFailed: (message: string) => `Claim failed: ${message}`,
    duel: "Duel",
    pending: "pending",
    wallet: "Wallet",
    disconnected: "disconnected",
    price: "Price",
    limitPrice: "Limit price",
    balance: "Balance",
    marketStatus: "Market status",
    totalPool: "Total pool",
    selectedSide: "Selected side",
    youHold: "Your position",
    estCost: "Estimated fill",
    estFee: "Fee",
    estMaxPayout: "Max payout",
    claimWinningsTitle: "Claim winnings",
    claimRefundTitle: "Claim refund",
    claimLocked: "Nothing claimable yet",
    claimHelp: "Once the duel resolves, claim your winning shares here.",
    claimRefundHelp: "If the duel is cancelled, claim your refund here.",
    claimCleanupTitle: "Clear resolved position",
    claimCleanupHelp:
      "If this market resolved against you, clear the stale position state here.",
    sideYes: "Buy A",
    sideNo: "Buy B",
    walletReady: "Wallet connected",
    walletMissing: "Connect wallet to continue",
    priceHint: "Use 1-999 pricing, where 500 = 50.0%",
    positionHint: "Shares you buy settle against the winning side.",
    quickOrderMode: "Quick order",
    limitOrderMode: "Limit order",
    showAdvancedPricing: "Show limit price",
    hideAdvancedPricing: "Hide limit price",
    quickOrderHelp:
      "Treat this as a quick ticket by default; only open limit price when you want exact control.",
    yourShares: "Your A / B",
    claim: "Claim",
    clearPosition: "Clear position",
  };
}

function formatCompactTokenAmount(value: bigint, decimals: number): string {
  return Number(formatUnits(value, decimals)).toFixed(3);
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function addPositionDelta(
  base: Position | null,
  delta: Position,
): Position {
  return {
    aShares: (base?.aShares ?? 0n) + delta.aShares,
    bShares: (base?.bShares ?? 0n) + delta.bShares,
    aStake: (base?.aStake ?? 0n) + delta.aStake,
    bStake: (base?.bStake ?? 0n) + delta.bStake,
  };
}

function mergePositionSnapshots(
  primary: Position | null,
  fallback: Position | null,
): Position | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    aShares: maxBigInt(primary.aShares, fallback.aShares),
    bShares: maxBigInt(primary.bShares, fallback.bShares),
    aStake: maxBigInt(primary.aStake, fallback.aStake),
    bStake: maxBigInt(primary.bStake, fallback.bStake),
  };
}

function getFallbackLifecycleStatus(
  status: MarketStatus | null | undefined,
) {
  switch (status) {
    case "OPEN":
      return "OPEN";
    case "LOCKED":
      return "LOCKED";
    case "RESOLVED":
      return "RESOLVED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

function getFallbackWinner(winner: Side | null | undefined) {
  switch (winner) {
    case "A":
      return "A";
    case "B":
      return "B";
    default:
      return "NONE";
  }
}

function getLifecycleStatusLabel(
  lifecycleStatus: string | null | undefined,
  winner: string | null | undefined,
  agent1Name: string,
  agent2Name: string,
  copy: ReturnType<typeof getEvmPanelCopy>,
): string | null {
  switch (lifecycleStatus) {
    case "RESOLVED":
      if (winner === "A") return copy.resolvedFor(agent1Name);
      if (winner === "B") return copy.resolvedFor(agent2Name);
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
      return copy.waitingForMarketOperator;
    default:
      return null;
  }
}

function toRateLimitError(error: unknown): RateLimitError | null {
  return error instanceof RateLimitError ? error : null;
}

function describeRefreshError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EvmBettingPanel({
  agent1Name,
  agent2Name,
  compact = false,
  locale,
  lifecycleDuelOverride = null,
  lifecycleMarketOverride = null,
  onLifecycleRefreshRequested = null,
}: EvmBettingPanelProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getEvmPanelCopy(resolvedLocale);
  const priceInputId = useId();
  const priceHintId = useId();
  const { activeChain } = useChain();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { state: streamingState } = useStreamingState();
  const isE2eMode = import.meta.env.MODE === "e2e";

  const chainConfig = useMemo(
    () =>
      activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
        ? getEvmChainConfig(activeChain)
        : null,
    [activeChain],
  );

  const configuredHeadlessPrivateKey = useMemo(
    () => selectConfiguredEvmPrivateKey(import.meta.env),
    [],
  );
  const configuredHeadlessAddress = useMemo(
    () =>
      normalizeAddress(
        (import.meta.env.VITE_E2E_EVM_ADDRESS as string | undefined) ??
          (import.meta.env.VITE_HEADLESS_EVM_ADDRESS as string | undefined) ??
          "",
      ),
    [],
  );
  const configuredE2eDuelKey = normalizePredictionMarketDuelKeyHex(
    (import.meta.env.VITE_E2E_EVM_DUEL_KEY as string | undefined) ?? "",
  );
  const configuredE2eDuelId = (
    (import.meta.env.VITE_E2E_EVM_DUEL_ID as string | undefined) ?? ""
  ).trim() || null;
  const runtimeE2eOverride = useMemo(
    () => (isE2eMode ? readE2eRuntimeOverride() : { duelKey: null, duelId: null }),
    [isE2eMode],
  );

  const e2eAccountResult = useMemo(() => {
    if (configuredHeadlessPrivateKey) {
      if (!configuredHeadlessAddress) {
        return {
          account: null,
          error: "missing configured e2e address",
        };
      }
      try {
        return {
          account: createStrictPrivateKeyAccount(
            configuredHeadlessAddress,
            configuredHeadlessPrivateKey,
          ),
          error: null,
        };
      } catch (error) {
        return {
          account: null,
          error:
            error instanceof Error
              ? error.message
              : "failed to create e2e account",
        };
      }
    }

    if (isE2eMode && configuredHeadlessAddress) {
      return { account: configuredHeadlessAddress, error: null };
    }

    return { account: null, error: "missing private key" };
  }, [configuredHeadlessAddress, configuredHeadlessPrivateKey, isE2eMode]);

  const e2eAccount = e2eAccountResult.account;
  const e2eWalletClient = useMemo(() => {
    if (!chainConfig || !e2eAccount) return null;
    if (typeof e2eAccount === "string") {
      return createUnlockedRpcWalletClient(chainConfig, e2eAccount);
    }
    return createSignedRpcWalletClient(chainConfig, e2eAccount);
  }, [chainConfig, e2eAccount]);

  const headlessAccountAddress =
    typeof e2eAccount === "string" ? e2eAccount : e2eAccount?.address;
  const effectiveAddress = (address ?? headlessAccountAddress) as
    | Address
    | undefined;
  const effectiveWriteAccount: ContractWriteAccount | undefined =
    isE2eMode && e2eAccount && typeof e2eAccount !== "string"
      ? e2eAccount
      : effectiveAddress;
  const effectiveWalletClient = isE2eMode
    ? (e2eWalletClient ?? walletClient)
    : (walletClient ?? e2eWalletClient);
  const walletConnected = Boolean(effectiveWalletClient && effectiveAddress);

  const [status, setStatus] = useState(copy.waitingForLiveDuel);
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");
  const [priceInput, setPriceInput] = useState("500");
  const [showAdvancedPricing, setShowAdvancedPricing] = useState(isE2eMode);
  const [marketMeta, setMarketMeta] = useState<MarketMeta | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [optimisticPosition, setOptimisticPosition] = useState<Position | null>(
    null,
  );
  const [nativeBalance, setNativeBalance] = useState<bigint>(0n);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tradeFeeBps, setTradeFeeBps] = useState(200);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [lastOrderTx, setLastOrderTx] = useState("-");
  const [lastClaimTx, setLastClaimTx] = useState("-");
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);
  const [lastOrderErrorDetail, setLastOrderErrorDetail] = useState<string | null>(
    null,
  );

  const lastSnapshotRef = useRef<{ a: bigint; b: bigint }>({ a: 0n, b: 0n });
  const refreshDataRef = useRef<() => Promise<void>>(async () => {});
  const refreshDataInFlightRef = useRef<Promise<void> | null>(null);
  const rpcBackoffUntilRef = useRef(0);

  const cycle = streamingState?.cycle ?? null;
  const streamedDuelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const streamedDuelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const cycleAgent1 = cycle?.agent1?.name ?? agent1Name;
  const cycleAgent2 = cycle?.agent2?.name ?? agent2Name;
  const lifecycleChainKey =
    activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
      ? activeChain
      : null;
  const {
    duel: lifecycleDuel,
    market: lifecycleMarket,
    refresh: refreshLifecycle,
  } =
    usePredictionMarketLifecycle(lifecycleChainKey, {
      disabled: !chainConfig,
    });
  const effectiveLifecycleDuel = lifecycleDuel ?? lifecycleDuelOverride;
  const effectiveLifecycleMarket = lifecycleMarket ?? lifecycleMarketOverride;
  const pinnedE2eDuelKey =
    isE2eMode
      ? runtimeE2eOverride.duelKey ?? configuredE2eDuelKey
      : null;
  const lifecycleDuelKey = useMemo(
    () =>
      normalizePredictionMarketDuelKeyHex(
        effectiveLifecycleMarket?.duelKey ?? effectiveLifecycleDuel?.duelKey,
      ),
    [effectiveLifecycleDuel?.duelKey, effectiveLifecycleMarket?.duelKey],
  );
  const liveLifecycleDuelKey = useMemo(
    () => pinnedE2eDuelKey ?? lifecycleDuelKey,
    [lifecycleDuelKey, pinnedE2eDuelKey],
  );
  const streamedDuelKey = useMemo(
    () => normalizePredictionMarketDuelKeyHex(streamedDuelKeyHex),
    [streamedDuelKeyHex],
  );
  const authoritativeLifecycleDuelKey = useMemo(
    () =>
      pinnedE2eDuelKey ??
      normalizePredictionMarketDuelKeyHex(
        lifecycleMarket?.duelKey ?? lifecycleDuel?.duelKey,
      ),
    [
      lifecycleDuel?.duelKey,
      lifecycleMarket?.duelKey,
      pinnedE2eDuelKey,
    ],
  );
  const lifecycleMatchesActiveDuel =
    lifecycleDuelKey == null || lifecycleDuelKey === liveLifecycleDuelKey;
  const activeLifecycleDuel = lifecycleMatchesActiveDuel
    ? effectiveLifecycleDuel
    : null;
  const activeLifecycleMarket = lifecycleMatchesActiveDuel
    ? effectiveLifecycleMarket
    : null;
  const streamDriftDetected =
    Boolean(authoritativeLifecycleDuelKey) &&
    pinnedE2eDuelKey == null &&
    (streamedDuelKey == null || streamedDuelKey !== authoritativeLifecycleDuelKey);
  const nativeDecimals = chainConfig?.nativeCurrency.decimals ?? 18;
  const chainNativeSymbol: Record<string, string> = { bsc: "BNB", base: "ETH", avax: "AVAX" };
  const nativeSymbol = chainConfig?.nativeCurrency.symbol ?? chainNativeSymbol[activeChain] ?? "ETH";
  const duelKeyHex = liveLifecycleDuelKey;
  const duelId =
    activeLifecycleMarket?.duelId ??
    activeLifecycleDuel?.duelId ??
    (isE2eMode
      ? runtimeE2eOverride.duelId ?? configuredE2eDuelId
      : null) ??
    streamedDuelId;
  const effectivePosition = useMemo(
    () => mergePositionSnapshots(position, optimisticPosition),
    [optimisticPosition, position],
  );
  const walletSnapshot = useMemo<PredictionMarketWalletSnapshot>(
    () => ({
      aShares: effectivePosition?.aShares ?? 0n,
      bShares: effectivePosition?.bShares ?? 0n,
      aStake: effectivePosition?.aStake ?? 0n,
      bStake: effectivePosition?.bStake ?? 0n,
      refundableAmount:
        (effectivePosition?.aStake ?? 0n) + (effectivePosition?.bStake ?? 0n),
    }),
    [effectivePosition],
  );
  const uiState = useMemo(
    () =>
      derivePredictionMarketUiState(
        activeLifecycleMarket,
        walletSnapshot,
        marketMeta
          ? {
              lifecycleStatus: getFallbackLifecycleStatus(marketMeta.status),
              winner: getFallbackWinner(marketMeta.winner),
            }
          : null,
      ),
    [activeLifecycleMarket, marketMeta, walletSnapshot],
  );
  const lifecycleStatusLabel = useMemo(
    () =>
      getLifecycleStatusLabel(
        uiState.lifecycleStatus,
        uiState.winner,
        cycleAgent1,
        cycleAgent2,
        copy,
      ),
    [copy, cycleAgent1, cycleAgent2, uiState.lifecycleStatus, uiState.winner],
  );

  const publicClient = useMemo(() => {
    if (!chainConfig) return null;
    return createEvmPublicClient(chainConfig);
  }, [chainConfig]);



  const updateChartAndTrades = useCallback(
    (nextA: bigint, nextB: bigint) => {
      const now = Date.now();
      const prev = lastSnapshotRef.current;
      const aDelta = nextA - prev.a;
      const bDelta = nextB - prev.b;
      const total = nextA + nextB;
      const pct = total > 0n ? Number((nextA * 100n) / total) : 50;

      setChartData((prevChart) => {
        if (prevChart.length === 0) {
          return [{ time: now, pct }];
        }
        if (aDelta === 0n && bDelta === 0n) {
          return prevChart;
        }
        const next = [...prevChart, { time: now, pct }];
        return next.length > 100 ? next.slice(next.length - 100) : next;
      });

      if (aDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `evm-a-${now}`,
              side: "YES" as const,
              amount: Number(formatUnits(aDelta, nativeDecimals)),
              price: pct / 100,
              time: now,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }
      if (bDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `evm-b-${now}`,
              side: "NO" as const,
              amount: Number(formatUnits(bDelta, nativeDecimals)),
              price: 1 - pct / 100,
              time: now + 1,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }

      lastSnapshotRef.current = { a: nextA, b: nextB };
    },
    [nativeDecimals],
  );

  const refreshData = useCallback(async () => {
    if (!publicClient || !chainConfig) return;

    const applyRateLimitBackoff = (error: unknown): boolean => {
      const rateLimitError = toRateLimitError(error);
      if (!rateLimitError) return false;
      rpcBackoffUntilRef.current = Math.max(
        rpcBackoffUntilRef.current,
        Date.now() + Math.max(rateLimitError.retryAfterMs, MIN_RPC_BACKOFF_MS),
      );
      setLastRefreshError(rateLimitError.message);
      return true;
    };

    const updateStatusFromMarket = (market: MarketMeta, nextPosition: Position | null) => {
      const nextUiState = derivePredictionMarketUiState(
        activeLifecycleMarket,
        nextPosition
          ? {
              aShares: nextPosition.aShares,
              bShares: nextPosition.bShares,
              aStake: nextPosition.aStake,
              bStake: nextPosition.bStake,
              refundableAmount: nextPosition.aStake + nextPosition.bStake,
            }
          : EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
        {
          lifecycleStatus: getFallbackLifecycleStatus(market.status),
          winner: getFallbackWinner(market.winner),
        },
      );
      setStatus(
        getLifecycleStatusLabel(
          nextUiState.lifecycleStatus,
          nextUiState.winner,
          cycleAgent1,
          cycleAgent2,
          copy,
        ) ?? copy.waitingForMarketOperator,
      );
    };

    try {
      if (!duelKeyHex) {
        setLastRefreshError("missing-duel-key");
        setMarketMeta(null);
        setPosition(null);
        setBids([]);
        setAsks([]);
        setStatus(lifecycleStatusLabel ?? copy.waitingForLiveDuel);
        return;
      }

      const duelKey = toDuelKeyHex(duelKeyHex);
      const contractAddr = chainConfig.goldClobAddress as Address;

      const market = await getMarketMeta(
        publicClient,
        contractAddr,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
      );

      if (!market.exists) {
        setLastRefreshError("missing-market");
        setMarketMeta(null);
        setPosition(null);
        setBids([]);
        setAsks([]);
        setStatus(lifecycleStatusLabel ?? copy.waitingForMarketOperator);
        return;
      }

      setMarketMeta(market);
      setLastRefreshError(null);
      updateChartAndTrades(market.totalAShares, market.totalBShares);

      if (!effectiveAddress) {
        setPosition(null);
        setNativeBalance(0n);
        updateStatusFromMarket(market, null);
      } else {
        updateStatusFromMarket(market, effectivePosition);
      }

      if (Date.now() < rpcBackoffUntilRef.current) {
        return;
      }

      const marketReadPromise = getMarketReadSnapshot(
        chainConfig,
        contractAddr,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        market,
        effectiveAddress,
      );
      const tradesPromise = getRecentTrades(
        publicClient,
        contractAddr,
        market.marketKey,
      );
      const balancePromise = effectiveAddress
        ? getNativeBalance(publicClient, effectiveAddress)
        : Promise.resolve(0n);

      const [marketReadResult, tradesResult, balanceResult] =
        await Promise.allSettled([
          marketReadPromise,
          tradesPromise,
          balancePromise,
        ]);

      if (marketReadResult.status === "fulfilled") {
        setTradeFeeBps(marketReadResult.value.feeBps);
        setBids(
          marketReadResult.value.orderBook.bids.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
        setAsks(
          marketReadResult.value.orderBook.asks.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
        if (effectiveAddress && marketReadResult.value.position) {
          const userPosition = marketReadResult.value.position;
          setPosition(userPosition);
          setOptimisticPosition((current) => {
            if (!current) return null;
            const hasCaughtUp =
              userPosition.aShares >= current.aShares &&
              userPosition.bShares >= current.bShares &&
              userPosition.aStake >= current.aStake &&
              userPosition.bStake >= current.bStake;
            return hasCaughtUp ? null : current;
          });
          updateStatusFromMarket(market, userPosition);
        }
      } else if (!applyRateLimitBackoff(marketReadResult.reason)) {
        setLastRefreshError(describeRefreshError(marketReadResult.reason));
      }

      if (tradesResult.status === "fulfilled") {
        setRecentTrades(
          tradesResult.value.map((trade) => ({
            id: trade.id,
            side: trade.side,
            amount: Number(formatUnits(trade.amount, nativeDecimals)),
            price: trade.price,
            time: trade.time,
          })),
        );
      } else if (!applyRateLimitBackoff(tradesResult.reason)) {
        setLastRefreshError(describeRefreshError(tradesResult.reason));
      }

      if (balanceResult.status === "fulfilled") {
        setNativeBalance(balanceResult.value);
      } else if (!applyRateLimitBackoff(balanceResult.reason)) {
        setLastRefreshError(describeRefreshError(balanceResult.reason));
      }
    } catch (error) {
      if (applyRateLimitBackoff(error)) {
        return;
      }
      const message = (error as Error).message;
      setLastRefreshError(message);
      setStatus(copy.refreshFailed(message));
    }
  }, [
    chainConfig,
    copy,
    cycleAgent1,
    cycleAgent2,
    duelKeyHex,
    effectiveAddress,
    effectivePosition,
    activeLifecycleMarket,
    lifecycleStatusLabel,
    nativeDecimals,
    publicClient,
    updateChartAndTrades,
  ]);

  useEffect(() => {
    refreshDataRef.current = refreshData;
  }, [refreshData]);

  const requestRefreshData = useCallback(() => {
    if (refreshDataInFlightRef.current) {
      return refreshDataInFlightRef.current;
    }

    const pendingRefresh = refreshDataRef.current().finally(() => {
      if (refreshDataInFlightRef.current === pendingRefresh) {
        refreshDataInFlightRef.current = null;
      }
    });
    refreshDataInFlightRef.current = pendingRefresh;
    return pendingRefresh;
  }, []);

  useEffect(() => {
    void requestRefreshData();
    const id = setInterval(() => void requestRefreshData(), 5000);
    return () => clearInterval(id);
  }, [requestRefreshData]);

  useEffect(() => {
    const handleMarketRefresh = () => {
      const refreshLifecycleSource =
        onLifecycleRefreshRequested ?? refreshLifecycle;
      void refreshLifecycleSource();
      void requestRefreshData();
    };
    window.addEventListener("hyperbet:market-refresh", handleMarketRefresh);
    return () => {
      window.removeEventListener("hyperbet:market-refresh", handleMarketRefresh);
    };
  }, [onLifecycleRefreshRequested, refreshLifecycle, requestRefreshData]);

  useEffect(() => {
    setOptimisticPosition(null);
  }, [activeChain, duelKeyHex, effectiveAddress]);

  useEffect(() => {
    if (typeof window === "undefined" || !import.meta.env.DEV) return;
    (
      window as typeof window & {
        __hyperbetEvmPanelDebug?: Record<string, unknown>;
      }
    ).__hyperbetEvmPanelDebug = {
      activeChain,
      chainConfigReady: Boolean(chainConfig),
      configuredHeadlessPrivateKey: Boolean(configuredHeadlessPrivateKey),
      configuredHeadlessAddress,
      e2eAccountAddress:
        typeof e2eAccount === "string" ? e2eAccount : e2eAccount?.address,
      e2eAccountError: e2eAccountResult.error,
      e2eWalletClientReady: Boolean(e2eWalletClient),
      wagmiAddress: address ?? null,
      wagmiWalletClientReady: Boolean(walletClient),
      effectiveAddress: effectiveAddress ?? null,
      effectiveWalletClientReady: Boolean(effectiveWalletClient),
      walletConnected,
      duelKeyHex,
      lifecycleStatus: activeLifecycleMarket?.lifecycleStatus ?? null,
      marketStatus: marketMeta?.status ?? null,
    };
  }, [
    activeChain,
    address,
    chainConfig,
    configuredHeadlessAddress,
    configuredHeadlessPrivateKey,
    duelKeyHex,
    e2eAccount,
    e2eAccountResult.error,
    e2eWalletClient,
    effectiveAddress,
    activeLifecycleMarket?.lifecycleStatus,
    effectiveWalletClient,
    marketMeta?.status,
    walletClient,
    walletConnected,
  ]);



  const handlePlaceOrder = useCallback(async () => {
    if (isSubmitting) return;
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !effectiveWriteAccount ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }
    setIsSubmitting(true);
    setLastOrderErrorDetail(null);
    try {
      const amount = parseUnits(amountInput, nativeDecimals);
      if (amount <= 0n) {
        setStatus(copy.amountTooLow);
        return;
      }

      const duelKey = toDuelKeyHex(duelKeyHex);
      const price = Math.min(999, Math.max(1, Math.floor(Number(priceInput))));
      const orderSide = side === "YES" ? SIDE_ENUM.BUY : SIDE_ENUM.SELL;
      const priceComponent = BigInt(
        orderSide === SIDE_ENUM.BUY ? price : 1000 - price,
      );
      const cost = (amount * priceComponent) / 1000n;
      const tradeFee = (cost * BigInt(Math.max(0, tradeFeeBps))) / 10_000n;
      const totalValue = cost + tradeFee;
      const optimisticDelta: Position =
        side === "YES"
          ? {
              aShares: amount,
              bShares: 0n,
              aStake: cost,
              bStake: 0n,
            }
          : {
              aShares: 0n,
              bShares: amount,
              aStake: 0n,
              bStake: cost,
            };

      setStatus(copy.placingOrder);
      const tx = await placeOrder(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        orderSide,
        price,
        amount,
        ORDER_FLAG_GTC,
        effectiveWriteAccount,
        totalValue,
      );
      setLastOrderTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      const trackingInput = {
        chainKey: chainConfig.chainId,
        bettorWallet: effectiveAddress,
        sourceAsset: nativeSymbol,
        sourceAmount: Number(formatUnits(totalValue, nativeDecimals)),
        goldAmount: Number(formatUnits(totalValue, nativeDecimals)),
        feeBps: tradeFeeBps,
        txSignature: tx,
        marketRef:
          activeLifecycleMarket?.marketRef ?? marketMeta?.marketKey ?? duelKey,
        duelKey: duelKeyHex,
        duelId,
      } as const;
      setOptimisticPosition((current) =>
        addPositionDelta(
          mergePositionSnapshots(position, current),
          optimisticDelta,
        ),
      );
      setStatus(copy.orderPlaced);
      setIsSubmitting(false);
      void recordPredictionMarketTrade(trackingInput);
      void requestRefreshData();
    } catch (error) {
      setLastOrderErrorDetail(
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
      setStatus(copy.orderFailed((error as Error).message));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    amountInput,
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWriteAccount,
    effectiveWalletClient,
    nativeDecimals,
    nativeSymbol,
    position,
    priceInput,
    publicClient,
    requestRefreshData,
    side,
    tradeFeeBps,
    activeLifecycleMarket?.marketRef,
    marketMeta?.marketKey,
    duelId,
  ]);



  const handleClaim = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !effectiveWriteAccount ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }

    try {
      const duelKey = toDuelKeyHex(duelKeyHex);
      setStatus(copy.claimingSettlement);
      const tx = await claimWinnings(
        effectiveWalletClient,
        chainConfig.goldClobAddress as Address,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        effectiveWriteAccount,
      );
      setLastClaimTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setOptimisticPosition(null);
      setStatus(copy.claimComplete);
      await requestRefreshData();
    } catch (error) {
      setStatus(copy.claimFailed((error as Error).message));
    }
  }, [
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWriteAccount,
    effectiveWalletClient,
    publicClient,
    requestRefreshData,
  ]);

  const yesPercent =
    marketMeta && marketMeta.totalAShares + marketMeta.totalBShares > 0n
      ? Number(
        (marketMeta.totalAShares * 100n) /
        (marketMeta.totalAShares + marketMeta.totalBShares),
      )
      : 50;
  const noPercent = 100 - yesPercent;
  const walletAddress = effectiveAddress ?? null;
  const normalizedPrice = Number.isFinite(Number(priceInput))
    ? Math.min(999, Math.max(1, Math.floor(Number(priceInput))))
    : 500;
  const estimatedAmount = Number.isFinite(Number(amountInput))
    ? Math.max(0, Number(amountInput))
    : 0;
  const estimatedAmountUnits =
    estimatedAmount > 0 ? parseUnits(estimatedAmount.toString(), nativeDecimals) : 0n;
  const estimatedPriceComponent = BigInt(
    side === "YES" ? normalizedPrice : 1000 - normalizedPrice,
  );
  const estimatedCost =
    estimatedAmountUnits > 0n
      ? (estimatedAmountUnits * estimatedPriceComponent) / 1000n
      : 0n;
  const estimatedFee =
    estimatedCost > 0n
      ? (estimatedCost * BigInt(Math.max(0, tradeFeeBps))) / 10_000n
      : 0n;
  const estimatedMaxPayout =
    estimatedAmountUnits > 0n ? estimatedAmountUnits - estimatedFee : 0n;
  const selectedStake = side === "YES"
    ? (effectivePosition?.aStake ?? 0n)
    : (effectivePosition?.bStake ?? 0n);
  const selectedShares = side === "YES"
    ? (effectivePosition?.aShares ?? 0n)
    : (effectivePosition?.bShares ?? 0n);
  const canClaim = uiState.canClaim;
  const claimUi = derivePredictionMarketClaimUi(copy, uiState.claimKind, canClaim);
  const claimValueText =
    canClaim && uiState.claimableAmount > 0n
      ? `${formatCompactTokenAmount(uiState.claimableAmount, nativeDecimals)} ${nativeSymbol}`
      : null;
  const programsReady = Boolean(
    chainConfig && duelKeyHex && uiState.canTrade && !streamDriftDetected,
  );
  const panelStatusNote =
    !streamDriftDetected && lastRefreshError != null
      ? copy.refreshFailed(lastRefreshError ?? "unknown")
      : null;
  const e2eWalletDebug = isE2eMode
    ? [
      `key=${configuredHeadlessPrivateKey ? "yes" : "no"}`,
      `addrEnv=${configuredHeadlessAddress ? "yes" : "no"}`,
      `acct=${e2eAccount ? (typeof e2eAccount === "string" ? "rpc" : "local") : "none"}`,
      `wallet=${effectiveWalletClient ? "yes" : "no"}`,
      `addr=${headlessAccountAddress ?? "-"}`,
      `err=${e2eAccountResult.error ?? "-"}`,
    ].join(" ")
    : "";
  const e2eLifecycleDebug = isE2eMode
    ? [
      `duel=${duelKeyHex ?? "-"}`,
      `duelId=${duelId ?? "-"}`,
      `life=${activeLifecycleMarket?.lifecycleStatus ?? "-"}`,
      `winner=${activeLifecycleMarket?.winner ?? "-"}`,
      `ref=${activeLifecycleMarket?.marketRef ?? "-"}`,
      `meta=${marketMeta ? "yes" : "no"}`,
      `metaStatus=${marketMeta?.status ?? "-"}`,
      `metaWinner=${marketMeta?.winner ?? "-"}`,
      `metaKey=${marketMeta?.marketKey ?? "-"}`,
      `streamAligned=${streamDriftDetected ? "no" : "yes"}`,
      `pinned=${pinnedE2eDuelKey ?? "-"}`,
      `aShares=${effectivePosition?.aShares?.toString() ?? "0"}`,
      `bShares=${effectivePosition?.bShares?.toString() ?? "0"}`,
      `aStake=${effectivePosition?.aStake?.toString() ?? "0"}`,
      `bStake=${effectivePosition?.bStake?.toString() ?? "0"}`,
      `claim=${uiState.canClaim ? "yes" : "no"}`,
      `claimKind=${uiState.claimKind}`,
      `balance=${nativeBalance.toString()}`,
      `orderErr=${lastOrderErrorDetail ?? "-"}`,
      `refreshErr=${lastRefreshError ?? "-"}`,
    ].join(" ")
    : "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    (
      window as typeof window & {
        __HYPERBET_EVM_MARKET_EVIDENCE__?: Record<string, unknown> | null;
      }
    ).__HYPERBET_EVM_MARKET_EVIDENCE__ =
      activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
        ? {
          activeChain,
          duelKey: duelKeyHex ?? null,
          duelId: duelId ?? null,
          lifecycleStatus: activeLifecycleMarket?.lifecycleStatus ?? null,
          winner: activeLifecycleMarket?.winner ?? null,
          marketRef: activeLifecycleMarket?.marketRef ?? null,
          marketStatus: marketMeta?.status ?? null,
          marketWinner: marketMeta?.winner ?? null,
          marketKey: marketMeta?.marketKey ?? null,
          streamAligned: !streamDriftDetected,
          canClaim: uiState.canClaim,
          claimKind: uiState.claimKind,
        }
        : null;
    return () => {
      (
        window as typeof window & {
          __HYPERBET_EVM_MARKET_EVIDENCE__?: Record<string, unknown> | null;
        }
      ).__HYPERBET_EVM_MARKET_EVIDENCE__ = null;
    };
  }, [
    activeChain,
    activeLifecycleMarket?.lifecycleStatus,
    activeLifecycleMarket?.marketRef,
    activeLifecycleMarket?.winner,
    duelId,
    duelKeyHex,
    marketMeta?.marketKey,
    marketMeta?.status,
    marketMeta?.winner,
    streamDriftDetected,
    uiState.canClaim,
    uiState.claimKind,
  ]);

  return (
    <div data-testid={isE2eMode ? "evm-panel" : undefined}>
      <PredictionMarketPanel
        yesPercent={yesPercent}
        noPercent={noPercent}
        yesPool={`${marketMeta ? Number(formatUnits(marketMeta.totalAShares, nativeDecimals)).toFixed(3) : "0.000"} ${nativeSymbol}`}
        noPool={`${marketMeta ? Number(formatUnits(marketMeta.totalBShares, nativeDecimals)).toFixed(3) : "0.000"} ${nativeSymbol}`}
        side={side}
        setSide={setSide}
        amountInput={amountInput}
        setAmountInput={setAmountInput}
        onPlaceBet={() => void handlePlaceOrder()}
        isWalletReady={walletConnected}
        programsReady={programsReady}
        isSubmitting={isSubmitting}
        agent1Name={cycleAgent1}
        agent2Name={cycleAgent2}
        isEvm
        supportsSell
        chartData={chartData}
        bids={bids}
        asks={asks}
        recentTrades={recentTrades}
        currencySymbol={nativeSymbol}
        pointsDisplay={null}
        locale={resolvedLocale}
        compact={compact}
      >
        <div
          style={{
            display: "grid",
            gap: 12,
            padding: "12px 0 0",
            color: "var(--hm-text, #d4d4d8)",
            fontFamily: "var(--hm-font-body)",
            fontSize: 12,
            width: "100%",
            minWidth: 0,
            overflowX: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div
            className="gm-metric-grid"
            style={{
              display: "grid",
              gap: 8,
              width: "100%",
              minWidth: 0,
            }}
          >
            <CompactMetricCard
              label={copy.selectedSide}
              value={side === "YES" ? copy.sideYes : copy.sideNo}
              tone={side === "YES" ? "#86efac" : "#fda4af"}
            />
            <CompactMetricCard
              label={copy.youHold}
              value={`${formatCompactTokenAmount(selectedShares, nativeDecimals)} / ${formatCompactTokenAmount(selectedStake, nativeDecimals)} ${nativeSymbol}`}
            />
        </div>
        {panelStatusNote ? (
          <div
            style={{
              fontSize: 10,
              color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.52))",
              lineHeight: 1.45,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {panelStatusNote}
          </div>
        ) : null}

          <div
            style={{
              display: "grid",
              gap: 8,
              padding: "12px",
              borderRadius: "var(--hm-radius)",
              border:
                "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
              background:
                "var(--hm-panel-card-bg-elevated, linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%))",
              boxShadow:
                "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08)), 0 10px 22px var(--hm-panel-card-shadow, rgba(0,0,0,0.18))",
            }}
          >
            <div
              className="gm-pricing-head"
              style={{
                display: "grid",
                gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) auto",
                alignItems: "start",
                gap: 12,
                width: "100%",
                minWidth: 0,
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
                    fontSize: compact ? 9 : 10,
                    fontWeight: 800,
                    letterSpacing: compact ? 0.85 : 1.05,
                    textTransform: "uppercase",
                    color:
                      "var(--hm-panel-subtle-text, rgba(255,255,255,0.46))",
                    fontFamily: "var(--hm-font-display)",
                  }}
                >
                  {showAdvancedPricing ? copy.limitOrderMode : copy.quickOrderMode}
                </span>
                <span
                  style={{
                    fontSize: compact ? 14 : 16,
                    fontWeight: 800,
                    color: "var(--hm-text, rgba(255,255,255,0.88))",
                    fontFamily: "var(--hm-font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.1,
                  }}
                >
                  {(normalizedPrice / 10).toFixed(1)}%
                </span>
              </div>
              <div
                className="gm-pricing-head-actions"
                style={{
                  display: "grid",
                  justifyItems: compact ? "stretch" : "end",
                  gap: 6,
                  maxWidth: compact ? "100%" : "none",
                  minWidth: 0,
                  width: "100%",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowAdvancedPricing((value) => !value)}
                  aria-expanded={showAdvancedPricing}
                  aria-controls={priceHintId}
                  aria-label={showAdvancedPricing ? copy.hideAdvancedPricing : copy.showAdvancedPricing}
                  className="gm-pricing-toggle"
                  style={{
                    padding: "7px 10px",
                    borderRadius: "var(--hm-radius)",
                    border:
                      "1px solid var(--hm-panel-pill-border, rgba(255,255,255,0.08))",
                    background:
                      "var(--hm-panel-pill-bg, rgba(255,255,255,0.04))",
                    color:
                      "var(--hm-panel-pill-text, rgba(255,255,255,0.78))",
                    fontSize: compact ? 9 : 10,
                    fontWeight: 800,
                    letterSpacing: compact ? 0.8 : 1,
                    textTransform: "uppercase",
                    fontFamily: "var(--hm-font-display)",
                    cursor: "pointer",
                  }}
                >
                  {showAdvancedPricing
                    ? copy.hideAdvancedPricing
                    : copy.showAdvancedPricing}
                </button>
              </div>
            </div>

            {showAdvancedPricing ? (
              <>
                <div
                  className="gm-price-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 8 : 10,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    data-testid={isE2eMode ? "evm-price-input" : undefined}
                    id={priceInputId}
                    value={priceInput}
                    onChange={(event) => setPriceInput(event.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={copy.limitPrice}
                    aria-describedby={priceHintId}
                    autoComplete="off"
                    type="text"
                    style={{
                      ...inputStyle,
                      flex: "1 1 0",
                      minWidth: 0,
                      width: "100%",
                      marginLeft: 0,
                      padding: "10px 12px",
                      borderRadius: "var(--hm-radius)",
                    }}
                  />
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--hm-radius)",
                      border:
                        "1px solid var(--hm-panel-pill-border, rgba(255,255,255,0.08))",
                      background:
                        "var(--hm-panel-pill-bg, rgba(255,255,255,0.04))",
                      color:
                        "var(--hm-panel-pill-text, rgba(255,255,255,0.72))",
                      fontWeight: 800,
                      fontFamily: "var(--hm-font-display)",
                      letterSpacing: compact ? 0.8 : 1,
                      alignSelf: "stretch",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: compact ? 52 : 60,
                      flex: "0 0 auto",
                    }}
                  >
                    {nativeSymbol}
                  </div>
                </div>

                <div
                  id={priceHintId}
                  style={{
                    fontSize: compact ? 9 : 10,
                    color:
                      "var(--hm-panel-subtle-text, rgba(255,255,255,0.5))",
                    lineHeight: 1.35,
                  }}
                >
                  {copy.priceHint}
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gap: compact ? 4 : 6 }}>
                <CompactStatRow
                  label={copy.limitPrice}
                  value={`${(normalizedPrice / 10).toFixed(1)}%`}
                />
                <div
                  style={{
                    fontSize: compact ? 9 : 10,
                    color:
                      "var(--hm-panel-subtle-text, rgba(255,255,255,0.5))",
                    lineHeight: 1.35,
                  }}
                >
                  {copy.quickOrderHelp}
                </div>
              </div>
            )}
          </div>

          <div
              style={{
                display: "grid",
                gap: 6,
                padding: "12px",
              borderRadius: "var(--hm-radius)",
              border:
                "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
              background:
                "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%))",
              boxShadow:
                "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08)), 0 10px 22px var(--hm-panel-card-shadow, rgba(0,0,0,0.14))",
              width: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <CompactStatRow
              label={copy.estCost}
              value={`${formatCompactTokenAmount(estimatedCost, nativeDecimals)} ${nativeSymbol}`}
            />
            <CompactStatRow
              label={copy.estFee}
              value={`${formatCompactTokenAmount(estimatedFee, nativeDecimals)} ${nativeSymbol}`}
            />
            <CompactStatRow
              label={copy.estMaxPayout}
              value={`${formatCompactTokenAmount(estimatedMaxPayout, nativeDecimals)} ${nativeSymbol}`}
              emphasize
            />
            <div
              style={{
                fontSize: 10,
                color:
                  "var(--hm-panel-subtle-text, rgba(255,255,255,0.46))",
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              {copy.positionHint}
            </div>
          </div>

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
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
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
                  {copy.marketStatus}
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
                    color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.52))",
                    lineHeight: 1.45,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  {claimUi.helpText}
                </span>
              </div>

              <button
                data-testid={isE2eMode ? "evm-claim-payout" : undefined}
                type="button"
                onClick={() => void handleClaim()}
                style={buttonStyle(
                  "linear-gradient(180deg, rgba(16,92,53,0.95) 0%, rgba(12,67,39,0.98) 100%)",
                  "rgba(52,211,153,0.4)",
                  false,
                )}
              >
                {claimUi.buttonLabel}
              </button>
            </div>
          ) : null}
          {isE2eMode ? (
            <pre
              data-testid="evm-wallet-debug"
              className="gm-debug-block"
              style={debugPreStyle()}
            >
              {e2eWalletDebug}
            </pre>
          ) : null}
          {isE2eMode ? (
            <pre
              data-testid="evm-lifecycle-debug"
              className="gm-debug-block"
              style={debugPreStyle()}
            >
              {e2eLifecycleDebug}
            </pre>
          ) : null}
        </div>
      </PredictionMarketPanel>
      {isE2eMode ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 4,
            minWidth: 0,
          }}
        >
          <pre
            data-testid="evm-last-order-tx"
            className="gm-debug-block"
            style={debugPreStyle()}
          >
            {lastOrderTx}
          </pre>
          <pre
            data-testid="evm-status"
            className="gm-debug-block"
            style={debugPreStyle()}
          >
            {status}
          </pre>
          <pre
            data-testid="evm-last-claim-tx"
            className="gm-debug-block"
            style={debugPreStyle()}
          >
            {lastClaimTx}
          </pre>
        </div>
      ) : null}
      <style>{`
        .gm-metric-grid {
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .gm-debug-block {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-wrap: anywhere;
          word-break: break-word;
          overflow-x: hidden;
          box-sizing: border-box;
        }
        .gm-btn:focus-visible,
        .gm-btn-sm:focus-visible,
        .gm-tab-btn:focus-visible,
        .gm-btn-submit:focus-visible,
        .gm-pricing-toggle:focus-visible,
        .gm-amount-input:focus-visible {
          outline: 2px solid var(--hm-accent-gold, #e5b84a);
          outline-offset: 2px;
          box-shadow: 0 0 0 2px rgba(229,184,74,0.18) !important;
        }
        .gm-price-row {
          min-width: 0;
        }
        .gm-pricing-head-actions {
          width: 100%;
        }
        @media (max-width: 720px) {
          .gm-metric-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 520px) {
          .gm-pricing-head {
            grid-template-columns: 1fr;
          }
          .gm-pricing-head-actions {
            justify-items: stretch;
            max-width: 100% !important;
          }
          .gm-price-row {
            align-items: stretch !important;
          }
          .gm-price-row > * {
            width: 100%;
          }
          .gm-pricing-toggle {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function CompactStatRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span
        style={{
          color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.5))",
          fontSize: 10,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: emphasize
            ? "var(--hm-text, #f8fafc)"
            : "var(--hm-panel-muted-text, rgba(255,255,255,0.82))",
          fontSize: emphasize ? 11 : 10,
          fontWeight: emphasize ? 800 : 700,
          fontFamily: "var(--hm-font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CompactMetricCard({
  label,
  value,
  tone = "var(--hm-text, #f4f4f5)",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "8px 10px",
        borderRadius: "var(--hm-radius)",
        border:
          "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
        background:
          "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%))",
        boxShadow:
          "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08))",
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 0.85,
          textTransform: "uppercase",
          color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.46))",
          fontFamily: "var(--hm-font-display)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: tone,
          fontFamily: "var(--hm-font-mono)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.3,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function buttonStyle(
  background: string,
  border: string,
  disabled = false,
): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 11px",
    borderRadius: "var(--hm-radius)",
    border: `1px solid ${border}`,
    background,
    color: disabled
      ? "var(--hm-panel-subtle-text, rgba(255,255,255,0.45))"
      : "var(--hm-text, #f4f4f5)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontFamily: "var(--hm-font-display)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    lineHeight: 1.35,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    textAlign: "center",
  };
}

function debugPreStyle(): CSSProperties {
  return {
    display: "block",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    margin: 0,
    padding: 10,
    borderRadius: "var(--hm-radius)",
    border: "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
    background:
      "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%))",
    color: "var(--hm-panel-muted-text, rgba(255,255,255,0.78))",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    fontSize: 9,
    fontFamily: "var(--hm-font-mono)",
    lineHeight: 1.45,
    maxHeight: 160,
    overflowY: "auto",
    overflowX: "hidden",
    boxSizing: "border-box",
  };
}

const inputStyle: CSSProperties = {
  width: 78,
  marginLeft: 8,
  padding: "6px 9px",
  borderRadius: "var(--hm-radius)",
  border: "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.14))",
  background: "var(--hm-panel-card-bg, rgba(17,24,39,0.65))",
  color: "var(--hm-text, #f4f4f5)",
};
