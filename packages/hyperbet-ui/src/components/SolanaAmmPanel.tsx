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
import { BN } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
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
import {
  DUEL_WINNER_MARKET_KIND,
  findDuelStatePda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
} from "../lib/pdas";
import {
  createPrograms,
  createReadonlyPrograms,
  findMintYesPda,
  findMintNoPda,
  findBetPda,
  type SigningWalletLike,
} from "../lib/programs";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  confirmSignatureViaRpc,
  fetchPriorityFeeEstimate,
  getLatestBlockhashViaRpc,
  HELIUS_SENDER_MIN_TIP_LAMPORTS,
  randomJitoTipAccount,
  sendRawTransactionViaRpc,
  sendViaHeliusSender,
  startHeliusSenderWarmup,
} from "../lib/solanaRpc";
import { CONFIG } from "../lib/config";
import {
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

type UserPosition = {
  aShares: bigint;
  bShares: bigint;
  aLockedLamports: bigint;
  bLockedLamports: bigint;
};

type MarketSnapshot = {
  duelId: string;
  duelKeyHex: string;
  betId: BN;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  marketMaker: PublicKey;
  marketStatus: string;
  winner: string | null;
  nextOrderId: bigint;
  bestBid: number;
  bestAsk: number;
  betCloseTime: number | null;
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
  };
};

const SIDE_BID = 1;
const SIDE_ASK = 2;
const MAX_MATCH_ACCOUNTS = 100;

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

function toBaseUnits(amountInput: string): bigint {
  const value = Number(amountInput.trim());
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value * LAMPORTS_PER_SOL));
}

function clampPrice(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(999, Math.max(1, Math.floor(parsed)));
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
): string {
  if (locale === "zh") {
    if (!duelKeyHex) {
      return "等待实时 Hyperscape 对决";
    }
    if (phase === "ANNOUNCEMENT") {
      return "下注开放中";
    }
    if (phase === "COUNTDOWN" || phase === "FIGHTING") {
      return "下注已锁定";
    }
    if (phase === "RESOLUTION") {
      return "等待结果结算";
    }
    return "正在准备对决市场";
  }
  if (!duelKeyHex) {
    return "Waiting for live Hyperscape duel";
  }
  if (phase === "ANNOUNCEMENT") {
    return "Betting open";
  }
  if (phase === "COUNTDOWN" || phase === "FIGHTING") {
    return "Betting locked";
  }
  if (phase === "RESOLUTION") {
    return "Awaiting result settlement";
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

interface SolanaAmmPanelProps {
  agent1Name: string;
  agent2Name: string;
  compact?: boolean;
  onMarketSnapshot?: (snapshot: SolanaClobMarketSnapshot) => void;
  locale?: UiLocale;
  connectionOverride?: Connection;
  walletOverride?: SigningWalletLike;
}

export interface SolanaClobMarketSnapshot {
  matchLabel: string;
  marketStatus: string;
  yesPool: bigint;
  noPool: bigint;
  bids: OrderLevel[];
  asks: OrderLevel[];
  recentTrades: Trade[];
  chartData: ChartDataPoint[];
}

export function SolanaAmmPanel({
  agent1Name,
  agent2Name,
  compact = false,
  onMarketSnapshot,
  locale,
  connectionOverride,
  walletOverride,
}: SolanaAmmPanelProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const isE2eMode = import.meta.env.MODE === "e2e";
  const { connection: adapterConnection } = useConnection();
  const adapterWallet = useWallet();
  const connection = connectionOverride ?? adapterConnection;
  const wallet = walletOverride ?? adapterWallet;
  const { state: streamingState } = useStreamingState();

  const [status, setStatus] = useState(
    getCycleDuelStatusLabel(undefined, null, resolvedLocale),
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
  });
  const [yesPool, setYesPool] = useState<bigint>(0n);
  const [noPool, setNoPool] = useState<bigint>(0n);
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<bigint | null>(null);
  const [lastPlaceOrderTx, setLastPlaceOrderTx] = useState("-");
  const [lastPlaceOrderError, setLastPlaceOrderError] = useState("-");
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const lastSnapshotRef = useRef<{ yes: bigint; no: bigint }>({
    yes: 0n,
    no: 0n,
  });
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const useHeliusSender = CONFIG.cluster === "mainnet-beta";

  // Warm Helius Sender on mount to avoid first-transaction cold-start latency.
  useEffect(() => {
    if (!useHeliusSender) return undefined;
    return startHeliusSenderWarmup();
  }, [useHeliusSender]);

  const writablePrograms = useMemo(
    () => (walletReady(wallet) ? createPrograms(connection, wallet) : null),
    [connection, wallet],
  );
  const readonlyPrograms = useMemo(
    () => createReadonlyPrograms(connection),
    [connection],
  );

  const cycle = streamingState?.cycle ?? null;
  const streamedDuelKeyHex =
    typeof cycle?.duelKeyHex === "string" ? cycle.duelKeyHex : null;
  const streamedDuelId = typeof cycle?.duelId === "string" ? cycle.duelId : null;
  const { duel: lifecycleDuel, market: lifecycleMarket } =
    usePredictionMarketLifecycle("solana");
  const duelKeyHex = useMemo(
    () =>
      normalizePredictionMarketDuelKeyHex(
        lifecycleMarket?.duelKey ?? lifecycleDuel?.duelKey ?? streamedDuelKeyHex,
      ),
    [lifecycleDuel?.duelKey, lifecycleMarket?.duelKey, streamedDuelKeyHex],
  );
  const cycleDuelId =
    lifecycleMarket?.duelId ?? lifecycleDuel?.duelId ?? streamedDuelId;
  const duelLabel = cycleDuelId ?? shortDuelKey(duelKeyHex);
  const effectiveAgent1 = cycle?.agent1?.name ?? agent1Name;
  const effectiveAgent2 = cycle?.agent2?.name ?? agent2Name;
  const copy =
    resolvedLocale === "zh"
      ? {
        unknown: "未知",
        connectWalletFirst: "请先连接钱包",
        fundingVaultRent: "补充对局金库租金",
        marketConfigNotDeployed: "市场配置尚未部署",
        waitingOracleReporter: "对局已公布，等待预言机上报",
        waitingMarketOperator: "预言机已上线，等待市场运营方开启",
        resolvedFor: (name: string) => `${name} 已结算获胜`,
        resolved: "已结算",
        marketCancelled: "市场已取消",
        bettingLocked: "下注已锁定",
        marketOpen: "市场开放中",
        refreshFailed: (message: string) => `刷新失败：${message}`,
        connectWalletToTrade: "连接钱包后即可交易",
        amountTooLow: "数量必须大于 0",
        orderPlaced: "订单已提交",
        orderFailed: (message: string) => `下单失败：${message}`,
        connectWalletToClaim: "连接钱包后即可领取",
        claimComplete: "领取完成",
        claimFailed: (message: string) => `领取失败：${message}`,
        claimReady: "可领取结算",
        claimLocked: "暂无可领取结算",
        claimHelp: "对局结算后，可在这里领取胜出份额或取消退款。",
        limitPrice: "限价",
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
        fundingVaultRent: "funding duel vault rent",
        marketConfigNotDeployed: "Market config not deployed",
        waitingOracleReporter: "Game announced duel; waiting for oracle reporter",
        waitingMarketOperator: "Oracle is live; waiting for market operator",
        resolvedFor: (name: string) => `Resolved for ${name}`,
        resolved: "Resolved",
        marketCancelled: "Market cancelled",
        bettingLocked: "Betting locked",
        marketOpen: "Market open",
        refreshFailed: (message: string) => `Refresh failed: ${message}`,
        connectWalletToTrade: "Connect wallet to trade",
        amountTooLow: "Amount must be greater than zero",
        orderPlaced: "Order placed",
        orderFailed: (message: string) => `Order failed: ${message}`,
        connectWalletToClaim: "Connect wallet to claim",
        claimComplete: "Claim complete",
        claimFailed: (message: string) => `Claim failed: ${message}`,
        claimReady: "Claim available",
        claimLocked: "Nothing claimable yet",
        claimHelp:
          "Once the duel resolves, claim winning shares or cancelled refunds here.",
        limitPrice: "Limit price",
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
      };
  const walletSnapshot = useMemo<PredictionMarketWalletSnapshot>(
    () => ({
      aShares: position.aShares,
      bShares: position.bShares,
      aStake: position.aLockedLamports,
      bStake: position.bLockedLamports,
      refundableAmount: position.aLockedLamports + position.bLockedLamports,
    }),
    [position],
  );
  const uiState = useMemo(
    () =>
      derivePredictionMarketUiState(
        lifecycleMarket,
        walletSnapshot,
        activeMarket
          ? {
              lifecycleStatus: getFallbackLifecycleStatus(activeMarket.marketStatus),
              winner: getFallbackWinner(activeMarket.winner),
            }
          : null,
      ),
    [activeMarket, lifecycleMarket, walletSnapshot],
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

  const updateChartAndTrades = useCallback(
    (nextYes: bigint, nextNo: bigint) => {
      const now = Date.now();
      const prev = lastSnapshotRef.current;
      const yesDelta = nextYes - prev.yes;
      const noDelta = nextNo - prev.no;

      const total = nextYes + nextNo;
      const pct = total > 0n ? Number((nextYes * 100n) / total) : 50;

      setChartData((prevChart) => {
        if (prevChart.length === 0) {
          return [{ time: now, pct }];
        }
        if (yesDelta === 0n && noDelta === 0n) {
          return prevChart;
        }
        const next = [...prevChart, { time: now, pct }];
        return next.length > 100 ? next.slice(next.length - 100) : next;
      });

      if (yesDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `sol-a-${now}`,
              side: "YES" as const,
              amount: fmtAmount(yesDelta),
              price: pct / 100,
              time: now,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }
      if (noDelta > 0n) {
        setRecentTrades((prevTrades) =>
          [
            {
              id: `sol-b-${now}`,
              side: "NO" as const,
              amount: fmtAmount(noDelta),
              price: 1 - pct / 100,
              time: now + 1,
            },
            ...prevTrades,
          ].slice(0, 50),
        );
      }

      lastSnapshotRef.current = { yes: nextYes, no: nextNo };
    },
    [],
  );

  const submitTransaction = useCallback(
    async (transaction: Transaction, context: string): Promise<string> => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error(copy.connectWalletFirst);
      }

      let stage = copy.stageBlockhash;
      try {
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

        stage = copy.stageSigning;
        const signed = await wallet.signTransaction(transaction);

        stage = copy.stageSending;
        const signature = useHeliusSender
          ? await sendViaHeliusSender(
              Buffer.from(signed.serialize()).toString("base64"),
            )
          : await sendRawTransactionViaRpc(connection, signed);

        stage = copy.stageConfirming;
        await confirmSignatureViaRpc(connection, signature);
        return signature;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${context}: ${stage}: ${message}`, { cause: error });
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

  const ensureVaultRentExempt = useCallback(
    async (vault: PublicKey): Promise<void> => {
      if (!wallet.publicKey) {
        throw new Error(copy.connectWalletFirst);
      }

      const minimumLamports =
        await connection.getMinimumBalanceForRentExemption(0, "confirmed");
      const currentLamports = await connection.getBalance(vault, "confirmed");
      if (currentLamports >= minimumLamports) {
        return;
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: vault,
          lamports: minimumLamports - currentLamports,
        }),
      );
      await submitTransaction(transaction, copy.fundingVaultRent);
    },
    [
      connection,
      copy.connectWalletFirst,
      copy.fundingVaultRent,
      submitTransaction,
      wallet.publicKey,
    ],
  );

  const runRefreshData = useCallback(async () => {
    const clobProgram: any = readonlyPrograms.lvrMarket;
    const oracleProgram: any = readonlyPrograms.fightOracle;
    const runtimeConfigPda = findClobConfigPda(clobProgram.programId);

    const config =
      await clobProgram.account.admin.fetchNullable(runtimeConfigPda);
    if (!config) {
      setStatus(copy.marketConfigNotDeployed);
      setActiveMarket(null);
      return;
    }

    if (!duelKeyHex) {
      setActiveMarket(null);
      setBids([]);
      setAsks([]);
      setYesPool(0n);
      setNoPool(0n);
      setPosition({
        aShares: 0n,
        bShares: 0n,
        aLockedLamports: 0n,
        bLockedLamports: 0n,
      });
      setStatus(
        lifecycleStatusLabel ??
          getCycleDuelStatusLabel(cycle?.phase, duelKeyHex, resolvedLocale),
      );
      return;
    }

    const duelKeyBytes = duelKeyHexToBytes(duelKeyHex);
    const duelState = findDuelStatePda(oracleProgram.programId, duelKeyBytes);
    const creator = new PublicKey(CONFIG.binaryTradeMarketMakerWallet || "11111111111111111111111111111111");
    const duelKeyBuf = Buffer.from(duelKeyHex, "hex");
    const betIdNumStr = duelKeyBuf.slice(0, 8).reverse().toString("hex");
    const betId = new BN(BigInt(`0x${betIdNumStr}`).toString());

    const marketState =
      parsePublicKeyOrNull(lifecycleMarket?.marketRef) ??
      findBetPda(
        clobProgram.programId,
        betId,
        creator
      );
    const vault = findClobVaultPda(clobProgram.programId, marketState);

    const [duelAccount, marketAccount] =
      await Promise.all([
        oracleProgram.account.duelState.fetchNullable(duelState),
        clobProgram.account.bet.fetchNullable(marketState),
      ]);

    if (!duelAccount) {
      setStatus(lifecycleStatusLabel ?? copy.waitingOracleReporter);
      setActiveMarket(null);
      return;
    }

    if (!marketAccount) {
      setStatus(lifecycleStatusLabel ?? copy.waitingMarketOperator);
      setActiveMarket(null);
      return;
    }

    let nextYesPool = asBigInt(marketAccount.reserves[0]);
    let nextNoPool = asBigInt(marketAccount.reserves[1]);
    let userPosition: UserPosition = {
      aShares: 0n,
      bShares: 0n,
      aLockedLamports: 0n,
      bLockedLamports: 0n,
    };

    if (wallet.publicKey) {
      const creator = marketAccount.creator as PublicKey;
      const betId = marketAccount.betId as BN;
      
      const mintYes = findMintYesPda(clobProgram.programId, betId, creator);
      const mintNo = findMintNoPda(clobProgram.programId, betId, creator);
      const ataYes = getAssociatedTokenAddressSync(mintYes, wallet.publicKey, true);
      const ataNo = getAssociatedTokenAddressSync(mintNo, wallet.publicKey, true);
      
      const ataYesBal = await connection.getTokenAccountBalance(ataYes, "confirmed").catch(() => ({ value: { amount: "0" } }));
      const ataNoBal = await connection.getTokenAccountBalance(ataNo, "confirmed").catch(() => ({ value: { amount: "0" } }));
      
      userPosition.aShares = BigInt(ataYesBal.value.amount);
      userPosition.bShares = BigInt(ataNoBal.value.amount);
    }

    const marketStatus: string = marketAccount.isInitialized ? "OPEN" : "LOCKED";
    const winner: string = marketAccount.sideWon != null ? (marketAccount.sideWon === 0 ? "A" : "B") : "NONE";

    setActiveMarket({
      duelId: cycleDuelId ?? shortDuelKey(duelKeyHex),
      duelKeyHex,
      betId: marketAccount.betId,
      duelState,
      marketState,
      vault,
      marketMaker: marketAccount.creator as PublicKey,
      marketStatus,
      winner,
      nextOrderId: 0n,
      bestBid: 0,
      bestAsk: 1000,
      betCloseTime:
        lifecycleDuel?.betCloseTime ??
        (typeof cycle?.betCloseTime === "number" ? cycle.betCloseTime : null),
    });
    setPosition(userPosition);
    setYesPool(nextYesPool);
    setNoPool(nextNoPool);
    setBids([]);
    setAsks([]);
    setLastOrderId(null);
    updateChartAndTrades(nextYesPool, nextNoPool);
    const nextUiState = derivePredictionMarketUiState(
      lifecycleMarket,
      {
        aShares: userPosition.aShares,
        bShares: userPosition.bShares,
        aStake: userPosition.aLockedLamports,
        bStake: userPosition.bLockedLamports,
        refundableAmount:
          userPosition.aLockedLamports + userPosition.bLockedLamports,
      },
      {
        lifecycleStatus: getFallbackLifecycleStatus(marketStatus),
        winner: getFallbackWinner(winner),
      },
    );
    const nextStatusLabel = (() => {
      switch (nextUiState.lifecycleStatus) {
        case "RESOLVED":
          if (nextUiState.winner === "A") return copy.resolvedFor(effectiveAgent1);
          if (nextUiState.winner === "B") return copy.resolvedFor(effectiveAgent2);
          return copy.resolved;
        case "CANCELLED":
          return copy.marketCancelled;
        case "LOCKED":
          return copy.bettingLocked;
        case "OPEN":
          return copy.marketOpen;
        case "PENDING":
        case "UNKNOWN":
          return copy.waitingMarketOperator;
        default:
          return null;
      }
    })();
    if (nextStatusLabel) {
      setStatus(nextStatusLabel);
    } else if (marketStatus === "resolved") {
      setStatus(
        winner === "a"
          ? copy.resolvedFor(effectiveAgent1)
          : winner === "b"
            ? copy.resolvedFor(effectiveAgent2)
            : copy.resolved,
      );
    } else if (marketStatus === "cancelled") {
      setStatus(copy.marketCancelled);
    } else if (marketStatus === "locked") {
      setStatus(copy.bettingLocked);
    } else if (marketStatus === "open") {
      setStatus(copy.marketOpen);
    } else {
      setStatus(lifecycleStatusLabel ?? formatStatus(marketStatus, resolvedLocale));
    }
  }, [
    cycle?.betCloseTime,
    cycle?.phase,
    cycleDuelId,
    copy,
    duelKeyHex,
    effectiveAgent1,
    effectiveAgent2,
    lifecycleDuel?.betCloseTime,
    lifecycleMarket?.marketRef,
    lifecycleStatusLabel,
    readonlyPrograms.fightOracle,
    readonlyPrograms.lvrMarket,
    resolvedLocale,
    updateChartAndTrades,
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
      } catch (error) {
        setStatus(copy.refreshFailed((error as Error).message));
      } finally {
        setIsRefreshing(false);
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, [copy, runRefreshData]);

  useEffect(() => {
    void refreshData();
    const id = window.setInterval(() => void refreshData(), 5000);
    return () => window.clearInterval(id);
  }, [refreshData]);





  const handlePlaceOrder = useCallback(async () => {
    const clobProgram: any = writablePrograms?.lvrMarket;
    if (!clobProgram || !wallet.publicKey || !activeMarket) {
      setLastPlaceOrderError(copy.connectWalletToTrade);
      setStatus(copy.connectWalletToTrade);
      return;
    }

    let debugTelemetry = "uninitialized";
    try {
      setLastPlaceOrderError("-");
      const amount = toBaseUnits(amountInput);
      if (amount <= 0n) {
        setLastPlaceOrderError(copy.amountTooLow);
        setStatus(copy.amountTooLow);
        return;
      }

      const sideValue = side === "YES" ? 0 : 1;
      const creator = activeMarket.marketMaker;
      const betId = activeMarket.betId;
      
      const mintYes = findMintYesPda(clobProgram.programId, betId, creator);
      const mintNo = findMintNoPda(clobProgram.programId, betId, creator);
      const destinationYes = getAssociatedTokenAddressSync(mintYes, wallet.publicKey, true);
      const destinationNo = getAssociatedTokenAddressSync(mintNo, wallet.publicKey, true);

      const preInstructions = [];
      const { connection } = clobProgram.provider;
      for (const [mint, dest] of [[mintYes, destinationYes], [mintNo, destinationNo]]) {
        const info = await connection.getAccountInfo(dest);
        const mintInfo = await connection.getAccountInfo(mint);
        console.log('--[DEBUG] checking ATA-->', dest.toBase58(), 'mint=', mint.toBase58(), 'info=', !!info, 'mintInfo=', !!mintInfo);
        
        // ONLY append ATA creation if the MINT ITSELF exists on the curve/blockchain! 
        // If the mint hasn't been instantiated, creating its ATA throws IncorrectProgramId or InvalidSeeds.
        if (!info && mintInfo && mintInfo.owner.toBase58() === TOKEN_PROGRAM_ID.toBase58()) {
           preInstructions.push(
               createAssociatedTokenAccountInstruction(
                  wallet.publicKey, dest, wallet.publicKey, mint
               )
           );
        }
      }

      const tx = await clobProgram.methods
        .buy(
          betId,
          sideValue,
          new BN(amount.toString())
        )
        .accountsPartial({
          signer: wallet.publicKey,
          bet: activeMarket.marketState,
          mintYes,
          mintNo,
          destinationYes,
          destinationNo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .transaction();

      debugTelemetry = `TX_LEN=${tx.instructions.length} PRE_LEN=${preInstructions.length}`;
      console.log('--[DEBUG] instruction count-->', tx.instructions.length);
      const signature = await submitTransaction(tx, copy.placingOrderContext);
      setLastPlaceOrderTx(signature);
      setLastPlaceOrderError("-");
      await recordPredictionMarketTrade({
        chainKey: "solana",
        bettorWallet: wallet.publicKey.toBase58(),
        sourceAsset: "SOL",
        sourceAmount: 0,
        goldAmount: 0,
        feeBps: 0,
        txSignature: signature,
        marketRef: activeMarket.marketState.toBase58(),
        duelKey: activeMarket.duelKeyHex,
        duelId: activeMarket.duelId,
      });
      setStatus(copy.orderPlaced);
      await refreshData();
    } catch (error) {
      const message = (error as Error).message + " | TELEMETRY: " + debugTelemetry;
      setLastPlaceOrderError(message);
      setStatus(copy.orderFailed(message));
    }
  }, [
    activeMarket,
    amountInput,
    copy,
    priceInput,
    refreshData,
    side,
    submitTransaction,
    wallet.publicKey,
    writablePrograms,
  ]);



  const handleClaim = useCallback(async () => {
    const clobProgram: any = writablePrograms?.lvrMarket;
    if (!clobProgram || !wallet.publicKey || !activeMarket) {
      setStatus(copy.connectWalletToClaim);
      return;
    }

    try {
      const creator = activeMarket.marketMaker;
      const betId = activeMarket.betId;
      
      const mintYes = findMintYesPda(clobProgram.programId, betId, creator);
      const mintNo = findMintNoPda(clobProgram.programId, betId, creator);
      const srcYes = getAssociatedTokenAddressSync(mintYes, wallet.publicKey, true);
      const srcNo = getAssociatedTokenAddressSync(mintNo, wallet.publicKey, true);

      const preInstructions = [];
      const { connection } = clobProgram.provider;
      for (const [mint, dest] of [[mintYes, srcYes], [mintNo, srcNo]]) {
        const info = await connection.getAccountInfo(dest);
        if (!info) {
           preInstructions.push(
               createAssociatedTokenAccountInstruction(
                  wallet.publicKey, dest, wallet.publicKey, mint
               )
           );
        }
      }

      const tx = await clobProgram.methods
        .withdrawPostSettle(betId)
        .accountsPartial({
          signer: wallet.publicKey,
          bet: activeMarket.marketState,
          mintYes,
          mintNo,
          srcYes,
          srcNo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .transaction();

      await submitTransaction(tx, copy.claimingWinningsContext);
      setStatus(copy.claimComplete);
      await refreshData();
    } catch (error) {
      setStatus(copy.claimFailed((error as Error).message));
    }
  }, [
    activeMarket,
    copy,
    refreshData,
    submitTransaction,
    wallet.publicKey,
    writablePrograms,
  ]);

  useEffect(() => {
    if (!onMarketSnapshot) {
      return;
    }

    onMarketSnapshot({
      matchLabel: duelLabel,
      marketStatus: activeMarket?.marketStatus ?? "unavailable",
      yesPool,
      noPool,
      bids,
      asks,
      recentTrades,
      chartData,
    });
  }, [
    activeMarket?.marketStatus,
    asks,
    bids,
    chartData,
    duelLabel,
    noPool,
    onMarketSnapshot,
    recentTrades,
    yesPool,
  ]);

  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const yesPercent =
    yesPool + noPool > 0n ? Number((yesPool * 100n) / (yesPool + noPool)) : 50;
  const noPercent = 100 - yesPercent;
  const canClaim = uiState.canClaim;
  const marketStateText = activeMarket?.marketState.toBase58() ?? "-";
  const lifecycleDebugText = [
    `duelKey=${lifecycleMarket?.duelKey ?? lifecycleDuel?.duelKey ?? duelKeyHex ?? "-"}`,
    `marketRef=${lifecycleMarket?.marketRef ?? activeMarket?.marketState.toBase58() ?? "-"}`,
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
        onPlaceBet={() => void handlePlaceOrder()}
        isWalletReady={walletReady(wallet)}
        programsReady={Boolean(activeMarket) && uiState.canTrade}
        agent1Name={effectiveAgent1}
        agent2Name={effectiveAgent2}
        isEvm={false}
        supportsSell
        chartData={chartData}
        bids={bids}
        asks={asks}
        recentTrades={recentTrades}
        currencySymbol="SOL"
        compact={compact}
        pointsDisplay={
          <PointsDisplay
            walletAddress={walletAddress}
            compact={compact}
            locale={resolvedLocale}
          />
        }
        locale={resolvedLocale}
      >
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>{status}</span>
            <span>{duelLabel}</span>
          </div>

          <button
            data-testid={isE2eMode ? "solana-clob-claim-payout" : undefined}
            type="button"
            onClick={() => void handleClaim()}
            disabled={!canClaim}
            style={buttonStyle(
              canClaim
                ? "#0f3f2b"
                : "var(--hm-panel-claim-idle-bg, linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%))",
              canClaim
                ? "rgba(34,197,94,0.35)"
                : "var(--hm-panel-claim-idle-border, rgba(255,255,255,0.08))",
              !canClaim,
            )}
          >
            {canClaim ? copy.claimReady : copy.claimLocked}
          </button>
          <div
            style={{
              fontSize: 11,
              color: "var(--hm-panel-subtle-text, rgba(255,255,255,0.48))",
              lineHeight: 1.45,
            }}
          >
            {copy.claimHelp}
          </div>
        </div>
      </PredictionMarketPanel>
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
          data-testid="solana-amm-price-input"
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
      {isE2eMode ? (
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="solana-clob-admin-toggle"
            aria-expanded={showAdminPanel ? "true" : "false"}
            onClick={() => setShowAdminPanel((open) => !open)}
            style={buttonStyle("#111827", "rgba(148,163,184,0.28)")}
          >
            {showAdminPanel ? copy.hideAdminPanel : copy.showAdminPanel}
          </button>
          <button
            type="button"
            data-testid="solana-clob-create-match"
            onClick={() => void refreshData()}
            style={buttonStyle("#1e3a5f", "rgba(59,130,246,0.35)")}
          >
            Create Match
          </button>
          <div data-testid="solana-clob-match">
            {copy.match}: {marketStateText}
          </div>
          <div data-testid="solana-clob-status">{status}</div>
          <pre
            data-testid="solana-clob-lifecycle-debug"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(10,10,10,0.45)",
              color: "#d4d4d8",
              whiteSpace: "pre-wrap",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {lifecycleDebugText}
          </pre>
          <pre
            data-testid="solana-clob-wallet-debug"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(10,10,10,0.45)",
              color: "#d4d4d8",
              whiteSpace: "pre-wrap",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {walletDebugText}
          </pre>
          <div data-testid="solana-clob-place-order-tx">{lastPlaceOrderTx}</div>
          <div data-testid="solana-clob-place-order-error">{lastPlaceOrderError}</div>
          <div data-testid="solana-clob-init-config-tx">-</div>
          <div data-testid="solana-clob-create-match-tx">-</div>
          <div data-testid="solana-clob-init-orderbook-tx">-</div>
          {showAdminPanel ? (
            <pre
              data-testid="solana-clob-admin-panel"
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "rgba(10,10,10,0.45)",
                color: "#d4d4d8",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {adminPanelText}
            </pre>
          ) : null}
        </div>
      ) : null}
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
