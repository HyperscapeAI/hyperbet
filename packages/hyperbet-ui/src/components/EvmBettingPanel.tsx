import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PredictionMarketLifecycleRecord } from "@hyperbet/chain-registry";
import { resolveUiLocale, type UiLocale } from "@hyperbet/ui/i18n";
import { useAccount, useWalletClient } from "wagmi";
import {
  createWalletClient,
  formatUnits,
  hexToBytes,
  http,
  parseUnits,
  toHex,
  type Address,
} from "viem";
import {
  publicKeyToAddress,
  sign,
  signAuthorization,
  signMessage,
  signTransaction,
  signTypedData,
  toAccount,
} from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";

import { useChain } from "../lib/ChainContext";
import { getEvmChainConfig } from "../lib/chainConfig";
import {
  claimWinnings,
  createEvmPublicClient,
  createUnlockedRpcWalletClient,
  getFeeBps,
  getMarketMeta,
  getNativeBalance,
  getOrderBook,
  getPosition,
  getRecentTrades,
  ORDER_FLAG_GTC,
  placeOrder,
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
import {
  derivePredictionMarketUiState,
  EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
  type PredictionMarketWalletSnapshot,
} from "../lib/predictionMarketUiState";
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

function createStrictPrivateKeyAccount(privateKey: `0x${string}`) {
  const privateKeyBytes = hexToBytes(privateKey, { size: 32 });
  const publicKey = toHex(secp256k1.getPublicKey(privateKeyBytes, false));
  const address = publicKeyToAddress(publicKey);
  const account = toAccount({
    address,
    async sign({ hash }) {
      return sign({ hash, privateKey, to: "hex" });
    },
    async signAuthorization(authorization) {
      return signAuthorization({ ...authorization, privateKey });
    },
    async signMessage({ message }) {
      return signMessage({ message, privateKey });
    },
    async signTransaction(transaction, { serializer } = {}) {
      return signTransaction({ privateKey, transaction, serializer });
    },
    async signTypedData(typedData) {
      return signTypedData({ ...typedData, privateKey });
    },
  });

  return {
    ...account,
    publicKey,
    source: "privateKey" as const,
  };
}

function normalizePrivateKey(value: string): `0x${string}` | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  return withPrefix as `0x${string}`;
}

function normalizeAddress(value: string): Address | null {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed as Address;
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
      claimReady: "可领取结算",
      claimLocked: "暂无可领取结算",
      claimHelp: "对局结算后，可在这里领取胜出份额或取消退款。",
      claimCleanupReady: "清理已结算仓位",
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
    claimReady: "Claim available",
    claimLocked: "Nothing claimable yet",
    claimHelp:
      "Once the duel resolves, claim winning shares or cancelled refunds here.",
    claimCleanupReady: "Clear resolved position",
    claimCleanupHelp:
      "If this market resolved against you, use this once to clear the stale position state.",
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

  const configuredHeadlessPrivateKey = normalizePrivateKey(
    (import.meta.env.VITE_EVM_PRIVATE_KEY as string | undefined) ??
    (import.meta.env.VITE_HEADLESS_EVM_PRIVATE_KEY as string | undefined) ??
    (import.meta.env.VITE_E2E_EVM_PRIVATE_KEY as string | undefined) ??
    "",
  );
  const configuredHeadlessAddress = normalizeAddress(
    (import.meta.env.VITE_E2E_EVM_ADDRESS as string | undefined) ??
    (import.meta.env.VITE_HEADLESS_EVM_ADDRESS as string | undefined) ??
    "",
  );
  const configuredE2eDuelKey = normalizePredictionMarketDuelKeyHex(
    (import.meta.env.VITE_E2E_EVM_DUEL_KEY as string | undefined) ?? "",
  );
  const configuredE2eDuelId = (
    (import.meta.env.VITE_E2E_EVM_DUEL_ID as string | undefined) ?? ""
  ).trim() || null;

  const e2eAccountResult = useMemo(() => {
    if (isE2eMode && configuredHeadlessAddress) {
      return { account: configuredHeadlessAddress, error: null };
    }

    if (configuredHeadlessPrivateKey) {
      try {
        return {
          account: createStrictPrivateKeyAccount(configuredHeadlessPrivateKey),
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

    return { account: null, error: "missing private key" };
  }, [configuredHeadlessAddress, configuredHeadlessPrivateKey, isE2eMode]);

  const e2eAccount = e2eAccountResult.account;
  const e2eWalletClient = useMemo(() => {
    if (!chainConfig || !e2eAccount) return null;
    if (typeof e2eAccount === "string") {
      return createUnlockedRpcWalletClient(chainConfig, e2eAccount);
    }
    return createWalletClient({
      account: e2eAccount,
      chain: chainConfig.wagmiChain,
      transport: http(chainConfig.rpcUrl),
    });
  }, [chainConfig, e2eAccount]);

  const headlessAccountAddress =
    typeof e2eAccount === "string" ? e2eAccount : e2eAccount?.address;
  const effectiveWalletClient = isE2eMode
    ? (e2eWalletClient ?? walletClient)
    : (walletClient ?? e2eWalletClient);
  const effectiveAddress = (address ?? headlessAccountAddress) as
    | Address
    | undefined;
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
  const [tradeFeeBps, setTradeFeeBps] = useState(200);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [lastOrderTx, setLastOrderTx] = useState("-");
  const [lastClaimTx, setLastClaimTx] = useState("-");
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);

  const lastSnapshotRef = useRef<{ a: bigint; b: bigint }>({ a: 0n, b: 0n });

  const cycle = streamingState?.cycle ?? null;
  const streamedDuelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const streamedDuelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const cycleAgent1 = cycle?.agent1?.name ?? agent1Name;
  const cycleAgent2 = cycle?.agent2?.name ?? agent2Name;
  const nativeDecimals = chainConfig?.nativeCurrency.decimals ?? 18;
  const chainNativeSymbol: Record<string, string> = { bsc: "BNB", base: "ETH", avax: "AVAX" };
  const nativeSymbol = chainConfig?.nativeCurrency.symbol ?? chainNativeSymbol[activeChain] ?? "ETH";
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
      disabled:
        !chainConfig ||
        lifecycleDuelOverride != null ||
        lifecycleMarketOverride != null,
    });
  const effectiveLifecycleDuel = lifecycleDuelOverride ?? lifecycleDuel;
  const effectiveLifecycleMarket = lifecycleMarketOverride ?? lifecycleMarket;
  const duelKeyHex = useMemo(
    () =>
      normalizePredictionMarketDuelKeyHex(
        effectiveLifecycleMarket?.duelKey ??
          effectiveLifecycleDuel?.duelKey ??
          streamedDuelKeyHex ??
          (isE2eMode ? configuredE2eDuelKey : null),
      ),
    [
      configuredE2eDuelKey,
      effectiveLifecycleDuel?.duelKey,
      effectiveLifecycleMarket?.duelKey,
      isE2eMode,
      streamedDuelKeyHex,
    ],
  );
  const duelId =
    effectiveLifecycleMarket?.duelId ??
    effectiveLifecycleDuel?.duelId ??
    streamedDuelId ??
    (isE2eMode ? configuredE2eDuelId : null);
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
        effectiveLifecycleMarket,
        walletSnapshot,
        marketMeta
          ? {
              lifecycleStatus: getFallbackLifecycleStatus(marketMeta.status),
              winner: getFallbackWinner(marketMeta.winner),
            }
          : null,
      ),
    [effectiveLifecycleMarket, marketMeta, walletSnapshot],
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
      const feeBpsPromise = getFeeBps(publicClient, contractAddr);
      const orderBookPromise = getOrderBook(
        publicClient,
        contractAddr,
        duelKey,
        MARKET_KIND_DUEL_WINNER,
        market,
      );
      const tradesPromise = getRecentTrades(
        publicClient,
        contractAddr,
        market.marketKey,
      );

      if (effectiveAddress) {
        const [userPosition, balance] = await Promise.all([
          getPosition(
            publicClient,
            contractAddr,
            market.marketKey,
            effectiveAddress,
          ),
          getNativeBalance(publicClient, effectiveAddress),
        ]);
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
        setNativeBalance(balance);
        const nextUiState = derivePredictionMarketUiState(
          effectiveLifecycleMarket,
          {
            aShares: userPosition.aShares,
            bShares: userPosition.bShares,
            aStake: userPosition.aStake,
            bStake: userPosition.bStake,
            refundableAmount: userPosition.aStake + userPosition.bStake,
          },
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
      } else {
        setPosition(null);
        setNativeBalance(0n);
        const nextUiState = derivePredictionMarketUiState(
          effectiveLifecycleMarket,
          EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT,
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
      }

      const [feeBpsResult, orderBookResult, tradesResult] =
        await Promise.allSettled([
          feeBpsPromise,
          orderBookPromise,
          tradesPromise,
        ]);

      if (feeBpsResult.status === "fulfilled") {
        setTradeFeeBps(feeBpsResult.value);
      }

      if (orderBookResult.status === "fulfilled") {
        setBids(
          orderBookResult.value.bids.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
        setAsks(
          orderBookResult.value.asks.map((entry) => ({
            price: entry.price,
            amount: Number(formatUnits(entry.amount, nativeDecimals)),
            total: Number(formatUnits(entry.total, nativeDecimals)),
          })),
        );
      } else {
        setBids([]);
        setAsks([]);
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
      } else {
        setRecentTrades([]);
      }
    } catch (error) {
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
    effectiveLifecycleMarket,
    nativeDecimals,
    publicClient,
    updateChartAndTrades,
  ]);

  useEffect(() => {
    void refreshData();
    const id = setInterval(() => void refreshData(), 5000);
    return () => clearInterval(id);
  }, [refreshData]);

  useEffect(() => {
    const handleMarketRefresh = () => {
      const refreshLifecycleSource =
        onLifecycleRefreshRequested ?? refreshLifecycle;
      void refreshLifecycleSource();
      void refreshData();
    };
    window.addEventListener("hyperbet:market-refresh", handleMarketRefresh);
    return () => {
      window.removeEventListener("hyperbet:market-refresh", handleMarketRefresh);
    };
  }, [onLifecycleRefreshRequested, refreshData, refreshLifecycle]);

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
      lifecycleStatus: effectiveLifecycleMarket?.lifecycleStatus ?? null,
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
    effectiveLifecycleMarket?.lifecycleStatus,
    effectiveWalletClient,
    marketMeta?.status,
    walletClient,
    walletConnected,
  ]);



  const handlePlaceOrder = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !duelKeyHex
    ) {
      setStatus(copy.walletNotConnected);
      return;
    }

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
        effectiveAddress,
        totalValue,
      );
      setLastOrderTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      await recordPredictionMarketTrade({
        chainKey: chainConfig.chainId,
        bettorWallet: effectiveAddress,
        sourceAsset: nativeSymbol,
        sourceAmount: Number(formatUnits(totalValue, nativeDecimals)),
        goldAmount: Number(formatUnits(totalValue, nativeDecimals)),
        feeBps: tradeFeeBps,
        txSignature: tx,
        marketRef:
          effectiveLifecycleMarket?.marketRef ?? marketMeta?.marketKey ?? duelKey,
        duelKey: duelKeyHex,
        duelId,
      });
      setOptimisticPosition((current) =>
        addPositionDelta(
          mergePositionSnapshots(position, current),
          optimisticDelta,
        ),
      );
      setStatus(copy.orderPlaced);
      await refreshData();
    } catch (error) {
      setStatus(copy.orderFailed((error as Error).message));
    }
  }, [
    amountInput,
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    nativeDecimals,
    nativeSymbol,
    priceInput,
    publicClient,
    refreshData,
    side,
    tradeFeeBps,
    effectiveLifecycleMarket?.marketRef,
    marketMeta?.marketKey,
    duelId,
  ]);



  const handleClaim = useCallback(async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
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
        effectiveAddress,
      );
      setLastClaimTx(tx);
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      setOptimisticPosition(null);
      setStatus(copy.claimComplete);
      await refreshData();
    } catch (error) {
      setStatus(copy.claimFailed((error as Error).message));
    }
  }, [
    chainConfig,
    copy,
    duelKeyHex,
    effectiveAddress,
    effectiveWalletClient,
    publicClient,
    refreshData,
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
  const totalPool =
    (marketMeta?.totalAShares ?? 0n) + (marketMeta?.totalBShares ?? 0n);
  const selectedStake = side === "YES"
    ? (effectivePosition?.aStake ?? 0n)
    : (effectivePosition?.bStake ?? 0n);
  const selectedShares = side === "YES"
    ? (effectivePosition?.aShares ?? 0n)
    : (effectivePosition?.bShares ?? 0n);
  const canClaim = uiState.canClaim;
  const claimActionLabel =
    uiState.claimKind === "LOSER_CLEANUP" && canClaim
      ? copy.claimCleanupReady
      : canClaim
        ? copy.claimReady
        : copy.claimLocked;
  const claimHelpText =
    uiState.claimKind === "LOSER_CLEANUP" && canClaim
      ? copy.claimCleanupHelp
      : copy.claimHelp;
  const programsReady = Boolean(
    chainConfig && duelKeyHex && uiState.canTrade,
  );
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
      `life=${effectiveLifecycleMarket?.lifecycleStatus ?? "-"}`,
      `winner=${effectiveLifecycleMarket?.winner ?? "-"}`,
      `ref=${effectiveLifecycleMarket?.marketRef ?? "-"}`,
      `meta=${marketMeta ? "yes" : "no"}`,
      `metaStatus=${marketMeta?.status ?? "-"}`,
      `metaWinner=${marketMeta?.winner ?? "-"}`,
      `metaKey=${marketMeta?.marketKey ?? "-"}`,
      `aShares=${effectivePosition?.aShares?.toString() ?? "0"}`,
      `bShares=${effectivePosition?.bShares?.toString() ?? "0"}`,
      `aStake=${effectivePosition?.aStake?.toString() ?? "0"}`,
      `bStake=${effectivePosition?.bStake?.toString() ?? "0"}`,
      `claim=${uiState.canClaim ? "yes" : "no"}`,
      `claimKind=${uiState.claimKind}`,
      `balance=${nativeBalance.toString()}`,
      `refreshErr=${lastRefreshError ?? "-"}`,
    ].join(" ")
    : "";

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
        compactHeader={
          compact ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                marginBottom: 2,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <CompactMetricCard
                  label={copy.totalPool}
                  value={`${formatCompactTokenAmount(totalPool, nativeDecimals)} ${nativeSymbol}`}
                />
                <CompactMetricCard
                  label={copy.balance}
                  value={`${formatCompactTokenAmount(nativeBalance, nativeDecimals)} ${nativeSymbol}`}
                />
              </div>
            </div>
          ) : null
        }
        compact={compact}
      >
        <div
          style={{
            display: "grid",
            gap: compact ? 10 : 10,
            padding: compact ? "4px 0 0" : "12px 0 0",
            color: "var(--hm-text, #d4d4d8)",
            fontFamily: "var(--hm-font-body)",
            fontSize: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: compact ? 6 : 8,
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

          <div
            style={{
              display: "grid",
              gap: compact ? 6 : 8,
              padding: compact ? "9px" : "12px",
              borderRadius: compact ? 12 : 14,
              border:
                "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
              background:
                "var(--hm-panel-card-bg-elevated, linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%))",
              boxShadow:
                "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08)), 0 10px 22px var(--hm-panel-card-shadow, rgba(0,0,0,0.18))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: compact ? 8 : 12,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: compact ? 2 : 4,
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
                style={{
                  display: "grid",
                  justifyItems: "end",
                  gap: compact ? 3 : 5,
                  maxWidth: compact ? 118 : "none",
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowAdvancedPricing((value) => !value)}
                  style={{
                    padding: compact ? "6px 9px" : "7px 10px",
                    borderRadius: 999,
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
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 8 : 10,
                  }}
                >
                  <input
                    data-testid={isE2eMode ? "evm-price-input" : undefined}
                    value={priceInput}
                    onChange={(event) => setPriceInput(event.target.value)}
                    inputMode="numeric"
                    style={{
                      ...inputStyle,
                      width: "100%",
                      marginLeft: 0,
                      padding: compact ? "9px 11px" : "10px 12px",
                      borderRadius: compact ? 10 : 12,
                    }}
                  />
                  <div
                    style={{
                      padding: compact ? "9px 11px" : "10px 12px",
                      borderRadius: compact ? 10 : 12,
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
                    }}
                  >
                    {nativeSymbol}
                  </div>
                </div>

                <div
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
              padding: compact ? "10px" : "12px",
              borderRadius: compact ? 12 : 14,
              border:
                "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
              background:
                "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%))",
              boxShadow:
                "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08)), 0 10px 22px var(--hm-panel-card-shadow, rgba(0,0,0,0.14))",
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
              }}
            >
              {copy.positionHint}
            </div>
          </div>

          <button
            data-testid={isE2eMode ? "evm-claim-payout" : undefined}
            type="button"
            onClick={() => void handleClaim()}
            disabled={!canClaim}
            style={buttonStyle(
              canClaim
                ? "linear-gradient(180deg, rgba(16,92,53,0.95) 0%, rgba(12,67,39,0.98) 100%)"
                : "var(--hm-panel-claim-idle-bg, linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%))",
              canClaim
                ? "rgba(52,211,153,0.4)"
                : "var(--hm-panel-claim-idle-border, rgba(255,255,255,0.08))",
              !canClaim,
            )}
          >
            {claimActionLabel}
          </button>
          <div
            style={{
              fontSize: 11,
              color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.48))",
              lineHeight: 1.45,
            }}
          >
            {claimHelpText}
          </div>
          {isE2eMode ? (
            <div data-testid="evm-wallet-debug">{e2eWalletDebug}</div>
          ) : null}
          {isE2eMode ? (
            <div data-testid="evm-lifecycle-debug">{e2eLifecycleDebug}</div>
          ) : null}
        </div>
      </PredictionMarketPanel>
      {isE2eMode ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 4,
          }}
        >
          <div data-testid="evm-last-order-tx">{lastOrderTx}</div>
          <div data-testid="evm-last-claim-tx">{lastClaimTx}</div>
        </div>
      ) : null}
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
        borderRadius: 12,
        border:
          "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.08))",
        background:
          "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%))",
        boxShadow:
          "inset 0 1px 0 var(--hm-panel-card-highlight, rgba(255,255,255,0.08))",
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
        }}
      >
        {value}
      </span>
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

function buttonStyle(
  background: string,
  border: string,
  disabled = false,
): CSSProperties {
  return {
    padding: "9px 11px",
    borderRadius: 10,
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
  };
}

const inputStyle: CSSProperties = {
  width: 78,
  marginLeft: 8,
  padding: "6px 9px",
  borderRadius: 8,
  border: "1px solid var(--hm-panel-card-border, rgba(255,255,255,0.14))",
  background: "var(--hm-panel-card-bg, rgba(17,24,39,0.65))",
  color: "var(--hm-text, #f4f4f5)",
};
