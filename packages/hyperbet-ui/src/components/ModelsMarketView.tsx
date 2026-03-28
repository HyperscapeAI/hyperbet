import React from "react";
import * as anchor from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type Connection,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Toaster, toast } from "sonner";

import goldPerpsIdl from "../idl/gold_perps_market.json";
import { useChain } from "../lib/ChainContext";
import { CONFIG, GAME_API_URL } from "../lib/config";
import {
  modelMarketIdFromCharacterId,
  sanitizePerpsOracleHistoryResponse,
  sanitizePerpsMarketsResponse,
  toWinRatePercent,
  type PerpsMarketDirectoryEntry,
  type PerpsOracleHistorySnapshot,
  type PerpsMarketsResponse,
} from "../lib/modelMarkets";
import { findProgramAddressSync } from "../lib/programAddress";
import {
  confirmSignatureViaRpc,
  getLatestBlockhashViaRpc,
  sendRawTransactionViaRpc,
} from "../lib/solanaRpc";
import {
  formatLocaleNumber,
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";

const PROGRAM_ID = new PublicKey(
  CONFIG.goldPerpsMarketProgramId || goldPerpsIdl.address,
);
const POLL_INTERVAL_MS = 5_000;
const CHAIN_POLL_INTERVAL_MS = 6_000;
const DEFAULT_SKEW_SCALE_SOL = 100;
const DEFAULT_MAX_MODEL_LEVERAGE = 5;
const DEFAULT_MAX_ORACLE_STALENESS_MS = 120_000;
const DEFAULT_MIN_MODEL_MARGIN_LAMPORTS = 100_000_000;
const MAX_BATCH_SIZE = 99;
const ORACLE_HISTORY_POLL_INTERVAL_MS = 15_000;
const ORACLE_HISTORY_LIMIT = 120;
const TOTAL_TRADE_FEE_RATE = 50 / 10_000;
const IS_E2E_MODE = import.meta.env.MODE === "e2e";

function readE2eString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readE2eNumber(value: unknown, fallback: number): number {
  const raw = readE2eString(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type TradeDirection = "LONG" | "SHORT";

interface ModelsMarketViewProps {
  activeMatchup: string;
  connectionOverride?: Connection;
  walletOverride?: ModelsWalletLike;
  walletModalOverride?: ModelsWalletModalLike;
}

type ModelsWalletLike = {
  connected: boolean;
  publicKey: PublicKey | null;
  signAllTransactions?: <T extends Array<Transaction | VersionedTransaction>>(
    txs: T,
  ) => Promise<T>;
  signTransaction?: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
};

type ModelsWalletModalLike = {
  setVisible: (visible: boolean) => void;
};

interface ConfigAccountState {
  authority: PublicKey;
  keeperAuthority: PublicKey;
  defaultSkewScale: anchor.BN;
  defaultFundingVelocity: anchor.BN;
  maxOracleStalenessSeconds: anchor.BN;
  maxLeverage: anchor.BN;
  minMarginLamports: anchor.BN;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
}

interface MarketAccountState {
  initialized: boolean;
  marketId: number;
  insuranceFund: anchor.BN;
  skewScale: anchor.BN;
  fundingVelocity: anchor.BN;
  spotIndex: anchor.BN;
  mu: anchor.BN;
  sigma: anchor.BN;
  oracleLastUpdated: anchor.BN;
  lastFundingTime: anchor.BN;
  totalLongOi: anchor.BN;
  totalShortOi: anchor.BN;
  currentFundingRate: anchor.BN;
}

interface PositionAccountState {
  initialized: boolean;
  owner: PublicKey;
  marketId: number;
  margin: anchor.BN;
  size: anchor.BN;
  entryPrice: anchor.BN;
  lastFundingRate: anchor.BN;
}

interface MarketSnapshot {
  marketId: number;
  spotIndex: number | null;
  longOi: number;
  shortOi: number;
  fundingRate: number;
  conservativeSkill: number | null;
  uncertainty: number | null;
  lastUpdated: number | null;
  insuranceFund: number;
  skewScale: number;
  skewScaleSol: number;
}

interface PositionSnapshot {
  marketId: number;
  direction: TradeDirection;
  margin: number;
  size: number;
  signedSize: number;
  entryPrice: number;
  markPrice: number | null;
  pnl: number;
  liquidationPrice: number | null;
}

interface OracleHistoryPoint extends PerpsOracleHistorySnapshot {
  label: string;
}

function toLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

function fromLamports(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function bnToNumber(value: anchor.BN | number): number {
  if (typeof value === "number") return value;
  return value.toNumber();
}

function formatCompactNumber(
  value: number,
  locale: UiLocale,
  digits = 2,
): string {
  if (locale === "zh") {
    if (value >= 100_000_000) {
      return `${(value / 100_000_000).toFixed(digits)}亿`;
    }
    if (value >= 10_000) {
      return `${(value / 10_000).toFixed(digits)}万`;
    }
  } else {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(digits)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(digits)}K`;
    }
  }
  return formatLocaleNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatUpdatedAt(timestamp: number | null, locale: UiLocale): string {
  if (!timestamp) return locale === "zh" ? "待定" : "pending";
  return new Date(timestamp).toLocaleTimeString(getLocaleTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUsd(value: number, locale: UiLocale, digits = 2): string {
  return new Intl.NumberFormat(getLocaleTag(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSolAmount(value: number, locale: UiLocale, digits = 3): string {
  return `${formatLocaleNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} SOL`;
}

function getModelsMarketCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      pending: "待定",
      emDash: "—",
      loadingModelsMarket: "正在加载模型市场…",
      noModelsMatched: "当前筛选条件下没有匹配的模型。",
      unnamedModel: "未命名模型",
      unknown: "未知",
      unknownProvider: "未知提供方",
      active: "活跃",
      closeOnly: "仅平仓",
      archived: "已归档",
      oracleStale: "预言机过期",
      modelPerps: "模型永续",
      trackedModels: "追踪模型",
      aggregateOi: "总未平仓",
      oracleBasis: "预言机基准",
      solanaOnly: "仅限 Solana",
      switchToSolana: "切换到 Solana",
      models: "模型",
      searchModels: "搜索模型",
      updated: (value: string) => `更新于 ${value}`,
      rank: "排名",
      model: "模型",
      provider: "提供方",
      winLoss: "胜/负",
      index: "指数",
      longOi: "多头 OI",
      shortOi: "空头 OI",
      funding: "资金费率",
      status: "状态",
      yourPosition: "你的仓位",
      openInterest: "未平仓",
      insurance: "保险池",
      oracleHistory: "预言机历史",
      currentOracle: (value: string, stale: boolean) =>
        `当前预言机 ${value}${stale ? " · 已过期" : ""}`,
      oracleHistoryError: (message: string) => `加载预言机历史失败：${message}`,
      loadingOracleHistory: "正在加载标准预言机历史…",
      waitingForSnapshots: "等待该模型的 keeper 快照。",
      skill: "技能",
      rankLabel: (value: number) => `排名 #${value}`,
      positionEntry: (value: string) => `开仓 ${value}`,
      positionMargin: (value: string) => `保证金 ${value}`,
      pnl: "盈亏",
      closePosition: "平仓",
      trade: (name: string) => `交易 ${name}`,
      marketId: (value: number) => `市场 #${value}`,
      pendingOracle: "等待预言机",
      collateral: "抵押（SOL）",
      leverage: "杠杆",
      positionSize: "仓位规模",
      estLongEntry: "预计多头开仓价",
      estShortEntry: "预计空头开仓价",
      longAction: (name: string) => `做多 ${name}`,
      shortAction: (name: string) => `做空 ${name}`,
      awaitingOracle: "等待新的预言机更新。",
      closeOnlyMarket: "当前市场仅允许平仓。",
      archivedMarket: "当前市场已归档。",
      selectModel: "选择一个模型进行查看和交易。",
      failedToLoadModelsMarketData: "加载模型市场数据失败",
      failedToLoadOracleHistory: "加载预言机历史失败",
      switchDemoToSolana: "请切换到 Solana 以交易模型永续。",
      connectWalletToTrade: "连接 Solana 钱包后即可交易模型永续。",
      walletCannotSign: "钱包无法签名交易。",
      minimumOpenCollateral: (value: string) =>
        `提高抵押至至少 ${value} 以覆盖费用后的最低保证金。`,
      marketNotAccepting: "该模型市场当前不接受新仓位。",
      waitingOnOracle: "该模型市场正在等待新的预言机更新。",
      marketArchived: "该模型市场已归档。",
      submitting: (direction: string, name: string) => `正在提交 ${direction} ${name}`,
      opening: (leverage: number, direction: string, name: string) =>
        `正在以 ${leverage}x ${direction} ${name}`,
      opened: (direction: string, name: string) => `已开 ${direction} ${name}`,
      openedToast: (direction: string, name: string) => `已对 ${name} 建立${direction}仓位`,
      closingPosition: (name: string) => `正在平掉 ${name} 仓位`,
      closedPosition: (name: string) => `已平掉 ${name} 仓位`,
      transactionFailed: "交易失败",
      stageBuilding: "构建交易",
      stageBlockhash: "获取区块哈希",
      stageSigning: "签名交易",
      stageSending: "发送交易",
      stageConfirming: "确认交易",
      directionLong: "多头",
      directionShort: "空头",
    };
  }

  return {
    pending: "pending",
    emDash: "—",
    loadingModelsMarket: "Loading models market…",
    noModelsMatched: "No models matched the current filter.",
    unnamedModel: "Unnamed model",
    unknown: "Unknown",
    unknownProvider: "Unknown provider",
    active: "ACTIVE",
    closeOnly: "CLOSE ONLY",
    archived: "ARCHIVED",
    oracleStale: "Oracle Stale",
    modelPerps: "Model Perps",
    trackedModels: "Tracked Models",
    aggregateOi: "Aggregate OI",
    oracleBasis: "Oracle Basis",
    solanaOnly: "Solana-only",
    switchToSolana: "Switch To Solana",
    models: "Models",
    searchModels: "Search models",
    updated: (value: string) => `Updated ${value}`,
    rank: "Rank",
    model: "Model",
    provider: "Provider",
    winLoss: "W/L",
    index: "Index",
    longOi: "Long OI",
    shortOi: "Short OI",
    funding: "Funding",
    status: "Status",
    yourPosition: "Your Position",
    openInterest: "Open Interest",
    insurance: "Insurance",
    oracleHistory: "Oracle History",
    currentOracle: (value: string, stale: boolean) =>
      `Current oracle ${value}${stale ? " · stale" : ""}`,
    oracleHistoryError: (message: string) =>
      `Failed to load oracle history: ${message}`,
    loadingOracleHistory: "Loading canonical oracle history…",
    waitingForSnapshots: "Waiting for keeper snapshots for this model.",
    skill: "Skill",
    rankLabel: (value: number) => `Rank #${value}`,
    positionEntry: (value: string) => `Entry ${value}`,
    positionMargin: (value: string) => `Margin ${value}`,
    pnl: "PnL",
    closePosition: "Close Position",
    trade: (name: string) => `Trade ${name}`,
    marketId: (value: number) => `Market #${value}`,
    pendingOracle: "Pending oracle",
    collateral: "Collateral (SOL)",
    leverage: "Leverage",
    positionSize: "Position Size",
    estLongEntry: "Est. Long Entry",
    estShortEntry: "Est. Short Entry",
    longAction: (name: string) => `Long ${name}`,
    shortAction: (name: string) => `Short ${name}`,
    awaitingOracle: "Awaiting fresh oracle update.",
    closeOnlyMarket: "Close-only market.",
    archivedMarket: "Archived market.",
    selectModel: "Select a model to inspect and trade.",
    failedToLoadModelsMarketData: "Failed to load models market data",
    failedToLoadOracleHistory: "Failed to load oracle history",
    switchDemoToSolana: "Switch the demo to Solana to trade model perps.",
    connectWalletToTrade: "Connect a Solana wallet to trade model perps.",
    walletCannotSign: "Wallet cannot sign transactions.",
    minimumOpenCollateral: (value: string) =>
      `Increase collateral to at least ${value} to satisfy min margin after fees.`,
    marketNotAccepting: "This model market is not accepting new positions.",
    waitingOnOracle: "This model market is waiting on a fresh oracle update.",
    marketArchived: "This model market has been archived.",
    submitting: (direction: string, name: string) =>
      `Submitting ${direction} ${name}`,
    opening: (leverage: number, direction: string, name: string) =>
      `Opening ${leverage}x ${direction} on ${name}`,
    opened: (direction: string, name: string) => `Opened ${direction} ${name}`,
    openedToast: (direction: string, name: string) =>
      `Opened ${direction} on ${name}`,
    closingPosition: (name: string) => `Closing ${name} position`,
    closedPosition: (name: string) => `Closed ${name} position`,
    transactionFailed: "Transaction failed",
    stageBuilding: "building transaction",
    stageBlockhash: "fetching blockhash",
    stageSigning: "signing transaction",
    stageSending: "sending transaction",
    stageConfirming: "confirming transaction",
    directionLong: "long",
    directionShort: "short",
  };
}

function isOracleFresh(timestamp: number | null, maxAgeMs: number): boolean {
  if (!timestamp) return false;
  return Date.now() - timestamp <= maxAgeMs;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function decodeAccount<T>(
  coder: anchor.BorshAccountsCoder,
  accountName: "ConfigState" | "MarketState" | "PositionState",
  data: Buffer,
): T | null {
  try {
    return coder.decode(accountName, data) as unknown as T;
  } catch {
    return null;
  }
}

function deriveConfigPda(): PublicKey {
  return findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

function deriveMarketPda(marketId: number): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("market"), encodeMarketId(marketId)],
    PROGRAM_ID,
  )[0];
}

function derivePositionPda(owner: PublicKey, marketId: number): PublicKey {
  return findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    PROGRAM_ID,
  )[0];
}

function computePnl(
  entryPrice: number,
  signedSize: number,
  markPrice: number | null,
): number {
  const size = Math.abs(signedSize);
  if (!markPrice || entryPrice <= 0 || size <= 0 || signedSize === 0) return 0;
  if (signedSize > 0) {
    return (markPrice - entryPrice) * (size / entryPrice);
  }
  return (entryPrice - markPrice) * (size / entryPrice);
}

function computeLiquidationPrice(
  entryPrice: number,
  signedSize: number,
  margin: number,
  maintenanceMarginBps: number,
): number | null {
  const size = Math.abs(signedSize);
  if (
    entryPrice <= 0 ||
    size <= 0 ||
    margin <= 0 ||
    maintenanceMarginBps <= 0
  ) {
    return null;
  }
  const maintenanceMargin = size * (maintenanceMarginBps / 10_000);
  const availableLoss = Math.max(0, margin - maintenanceMargin);
  if (signedSize > 0) {
    return entryPrice * (1 - availableLoss / size);
  }
  return entryPrice * (1 + availableLoss / size);
}

function estimateExecutionPrice(
  market: MarketSnapshot | undefined,
  signedSizeDeltaSol: number,
  skewScaleSol: number,
): number | null {
  if (!market?.spotIndex || skewScaleSol <= 0 || signedSizeDeltaSol === 0) {
    return null;
  }
  const skew = market.longOi - market.shortOi;
  const y1 = skewScaleSol + skew;
  const y2 = y1 + signedSizeDeltaSol;
  if (y1 <= 0 || y2 <= 0) {
    return null;
  }
  return market.spotIndex * (y1 / skewScaleSol) * (y2 / skewScaleSol);
}

function conservativeSkill(mu: number, sigma: number): number {
  return mu - sigma * 3;
}

function getTradeErrorMessage(error: unknown, locale: UiLocale): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return getModelsMarketCopy(locale).transactionFailed;
}

async function fetchMultipleAccounts(
  connection: anchor.web3.Connection,
  addresses: readonly PublicKey[],
): Promise<(anchor.web3.AccountInfo<Buffer> | null)[]> {
  const chunks = chunkArray(addresses, MAX_BATCH_SIZE);
  const resolved = await Promise.all(
    chunks.map((chunk) =>
      connection.getMultipleAccountsInfo(chunk, "confirmed"),
    ),
  );
  return resolved.flat();
}

const E2E_MODEL_CHARACTER_ID = readE2eString(
  import.meta.env.VITE_E2E_MODEL_CHARACTER_ID,
);
const E2E_MODEL_MARKET_ID = E2E_MODEL_CHARACTER_ID
  ? readE2eNumber(
      import.meta.env.VITE_E2E_MODEL_MARKET_ID,
      modelMarketIdFromCharacterId(E2E_MODEL_CHARACTER_ID),
    )
  : 0;
const E2E_MODEL_ENTRY: PerpsMarketDirectoryEntry | null =
  IS_E2E_MODE && E2E_MODEL_CHARACTER_ID
    ? {
      rank: 1,
      characterId: E2E_MODEL_CHARACTER_ID,
      marketId: E2E_MODEL_MARKET_ID,
      name: readE2eString(import.meta.env.VITE_E2E_MODEL_NAME) || "E2E Model",
      provider:
        readE2eString(import.meta.env.VITE_E2E_MODEL_PROVIDER) ||
        "Hyperscape",
      model:
        readE2eString(import.meta.env.VITE_E2E_MODEL_SLUG) || "e2e-model",
      wins: readE2eNumber(import.meta.env.VITE_E2E_MODEL_WINS, 10),
      losses: readE2eNumber(import.meta.env.VITE_E2E_MODEL_LOSSES, 2),
      winRate: 0,
      combatLevel: readE2eNumber(
        import.meta.env.VITE_E2E_MODEL_COMBAT_LEVEL,
        80,
      ),
      currentStreak: readE2eNumber(import.meta.env.VITE_E2E_MODEL_STREAK, 3),
      status: "ACTIVE",
      lastSeenAt: Date.now(),
      deprecatedAt: null,
      updatedAt: Date.now(),
    }
    : null;

if (E2E_MODEL_ENTRY) {
  E2E_MODEL_ENTRY.winRate = toWinRatePercent(
    E2E_MODEL_ENTRY.wins,
    E2E_MODEL_ENTRY.losses,
  );
}

const E2E_ORACLE_RECORDED_AT = readE2eNumber(
  import.meta.env.VITE_E2E_MODEL_ORACLE_RECORDED_AT,
  Date.now(),
);
function getE2eOracleHistory(locale: UiLocale): OracleHistoryPoint[] {
  if (!E2E_MODEL_ENTRY || !IS_E2E_MODE) {
    return [];
  }
  return [
    {
      agentId: E2E_MODEL_ENTRY.characterId,
      marketId: E2E_MODEL_MARKET_ID,
      spotIndex: readE2eNumber(import.meta.env.VITE_E2E_MODEL_SPOT_INDEX, 0),
      conservativeSkill:
        readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0) -
        readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0) * 3,
      mu: readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0),
      sigma: readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0),
      recordedAt: E2E_ORACLE_RECORDED_AT,
      label: new Date(E2E_ORACLE_RECORDED_AT).toLocaleTimeString(
        getLocaleTag(locale),
        {
          hour: "2-digit",
          minute: "2-digit",
        },
      ),
    },
  ];
}

function buildE2eMarketSnapshot(): MarketSnapshot | null {
  if (!E2E_MODEL_ENTRY || !IS_E2E_MODE) {
    return null;
  }
  return {
    marketId: E2E_MODEL_MARKET_ID,
    spotIndex:
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_SPOT_INDEX, 0) || null,
    longOi: 0,
    shortOi: 0,
    fundingRate: 0,
    conservativeSkill:
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_MU, 0) -
      readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0) * 3,
    uncertainty: readE2eNumber(import.meta.env.VITE_E2E_MODEL_SIGMA, 0),
    lastUpdated: Math.max(Date.now(), E2E_ORACLE_RECORDED_AT),
    insuranceFund: readE2eNumber(import.meta.env.VITE_E2E_MODEL_INSURANCE, 12),
    skewScale: DEFAULT_SKEW_SCALE_SOL * LAMPORTS_PER_SOL,
    skewScaleSol: DEFAULT_SKEW_SCALE_SOL,
  };
}

function getE2eFallbackMarketSnapshots(): Record<string, MarketSnapshot> {
  const snapshot = buildE2eMarketSnapshot();
  if (!E2E_MODEL_ENTRY || !snapshot) {
    return {};
  }
  return {
    [E2E_MODEL_ENTRY.characterId]: snapshot,
  };
}

function applySignedOi(
  snapshot: MarketSnapshot | undefined,
  signedSize: number,
): MarketSnapshot | undefined {
  if (!snapshot || !Number.isFinite(signedSize) || signedSize === 0) {
    return snapshot;
  }

  const nextLongOi =
    signedSize > 0 ? snapshot.longOi + signedSize : snapshot.longOi;
  const nextShortOi =
    signedSize < 0 ? snapshot.shortOi + Math.abs(signedSize) : snapshot.shortOi;

  return {
    ...snapshot,
    longOi: Math.max(0, nextLongOi),
    shortOi: Math.max(0, nextShortOi),
  };
}

export function ModelsMarketView({
  activeMatchup,
  connectionOverride,
  walletOverride,
  walletModalOverride,
}: ModelsMarketViewProps) {
  const locale = resolveUiLocale();
  const copy = getModelsMarketCopy(locale);
  const adapterConnection = useConnection();
  const adapterWallet = useWallet();
  const adapterWalletModal = useWalletModal();
  const connection = connectionOverride ?? adapterConnection.connection;
  const wallet = walletOverride ?? adapterWallet;
  const setWalletModalVisible =
    walletModalOverride?.setVisible ?? adapterWalletModal.setVisible;
  const { activeChain, setActiveChain } = useChain();

  const [data, setData] = React.useState<PerpsMarketsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [selectedCharacterId, setSelectedCharacterId] = React.useState<
    string | null
  >(null);
  const [marketSnapshots, setMarketSnapshots] = React.useState<
    Record<string, MarketSnapshot>
  >(() => getE2eFallbackMarketSnapshots());
  const [positions, setPositions] = React.useState<
    Record<string, PositionSnapshot>
  >({});
  const [collateralSol, setCollateralSol] = React.useState(0.1);
  const [leverage, setLeverage] = React.useState(2);
  const [submittingTrade, setSubmittingTrade] = React.useState<string | null>(
    null,
  );
  const [lastTradeStatus, setLastTradeStatus] = React.useState("-");
  const [lastTradeTx, setLastTradeTx] = React.useState("-");
  const [lastTradeRequest, setLastTradeRequest] = React.useState("-");
  const [skewScaleSol, setSkewScaleSol] = React.useState(
    DEFAULT_SKEW_SCALE_SOL,
  );
  const [configPresent, setConfigPresent] = React.useState(
    Boolean(E2E_MODEL_ENTRY),
  );
  const [configLoaded, setConfigLoaded] = React.useState(
    Boolean(E2E_MODEL_ENTRY),
  );
  const [configuredMaxLeverage, setConfiguredMaxLeverage] = React.useState(
    DEFAULT_MAX_MODEL_LEVERAGE,
  );
  const [configuredMinMarginLamports, setConfiguredMinMarginLamports] =
    React.useState(DEFAULT_MIN_MODEL_MARGIN_LAMPORTS);
  const [maintenanceMarginBps, setMaintenanceMarginBps] = React.useState(1_000);
  const [oracleStalenessMs, setOracleStalenessMs] = React.useState(
    DEFAULT_MAX_ORACLE_STALENESS_MS,
  );
  const [oracleHistory, setOracleHistory] = React.useState<
    OracleHistoryPoint[]
  >([]);
  const [oracleHistoryLoading, setOracleHistoryLoading] = React.useState(false);
  const [oracleHistoryError, setOracleHistoryError] = React.useState<
    string | null
  >(null);
  const effectiveLeverage = Math.min(
    configuredMaxLeverage,
    Math.max(1, Math.round(leverage)),
  );
  const collateralLamports = toLamports(collateralSol);
  const estimatedOpenTradeFeeLamports = Math.round(
    Math.abs(collateralLamports * effectiveLeverage) * TOTAL_TRADE_FEE_RATE,
  );
  const estimatedOpenPostFeeMarginLamports =
    collateralLamports - estimatedOpenTradeFeeLamports;
  const minimumOpenCollateralLamports = Math.ceil(
    configuredMinMarginLamports /
      Math.max(1e-9, 1 - effectiveLeverage * TOTAL_TRADE_FEE_RATE),
  );
  const openCollateralSatisfiesMinMargin =
    estimatedOpenPostFeeMarginLamports >= configuredMinMarginLamports;

  React.useEffect(() => {
    if (E2E_MODEL_ENTRY) {
      setData({
        markets: [E2E_MODEL_ENTRY],
        updatedAt: Date.now(),
      });
      setError(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    let inFlight: AbortController | null = null;

    const poll = async () => {
      inFlight?.abort();
      inFlight = new AbortController();

      try {
        const response = await fetch(`${GAME_API_URL}/api/perps/markets`, {
          cache: "no-store",
          signal: inFlight.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = sanitizePerpsMarketsResponse(await response.json());
        if (!mounted) return;

        setData(payload);
        setError(null);
        setLoading(false);
      } catch (fetchError) {
        if (!mounted) return;
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : copy.failedToLoadModelsMarketData,
        );
        setLoading(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      inFlight?.abort();
    };
  }, [copy.failedToLoadModelsMarketData]);

  React.useEffect(() => {
    if (!data?.markets.length) return;

    const selectedStillExists =
      selectedCharacterId &&
      data.markets.some((entry) => entry.characterId === selectedCharacterId);

    if (!selectedStillExists) {
      setSelectedCharacterId(data.markets[0].characterId);
    }
  }, [data, selectedCharacterId]);

  React.useEffect(() => {
    if (
      E2E_MODEL_ENTRY &&
      selectedCharacterId === E2E_MODEL_ENTRY.characterId
    ) {
      setOracleHistory(getE2eOracleHistory(locale));
      setOracleHistoryError(null);
      setOracleHistoryLoading(false);
      return;
    }

    if (!selectedCharacterId) {
      setOracleHistory([]);
      setOracleHistoryError(null);
      setOracleHistoryLoading(false);
      return;
    }

    let mounted = true;
    let inFlight: AbortController | null = null;

    setOracleHistory([]);
    setOracleHistoryError(null);
    setOracleHistoryLoading(true);

    const loadOracleHistory = async () => {
      inFlight?.abort();
      inFlight = new AbortController();

      if (mounted) {
        setOracleHistoryLoading(true);
      }

      try {
        const response = await fetch(
          `${GAME_API_URL}/api/perps/oracle-history?characterId=${encodeURIComponent(selectedCharacterId)}&limit=${ORACLE_HISTORY_LIMIT}`,
          {
            cache: "no-store",
            signal: inFlight.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = sanitizePerpsOracleHistoryResponse(
          await response.json(),
          selectedCharacterId,
        );
        if (!mounted) return;

        setOracleHistory(
          [...payload.snapshots]
            .sort((left, right) => left.recordedAt - right.recordedAt)
            .map((snapshot) => ({
              ...snapshot,
              label: new Date(snapshot.recordedAt).toLocaleTimeString(
                getLocaleTag(locale),
                {
                  hour: "2-digit",
                  minute: "2-digit",
                },
              ),
            })),
        );
        setOracleHistoryError(null);
      } catch (historyError) {
        if (!mounted) return;
        if (
          historyError instanceof DOMException &&
          historyError.name === "AbortError"
        ) {
          return;
        }

        setOracleHistory([]);
        setOracleHistoryError(
          historyError instanceof Error
            ? historyError.message
            : copy.failedToLoadOracleHistory,
        );
      } finally {
        if (mounted) {
          setOracleHistoryLoading(false);
        }
      }
    };

    void loadOracleHistory();
    const intervalId = window.setInterval(() => {
      void loadOracleHistory();
    }, ORACLE_HISTORY_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      inFlight?.abort();
    };
  }, [copy.failedToLoadOracleHistory, locale, selectedCharacterId]);

  const leaderboardKey = React.useMemo(
    () => data?.markets.map((entry) => entry.characterId).join("|") ?? "",
    [data],
  );

  React.useEffect(() => {
    let mounted = true;
    const coder = new anchor.BorshAccountsCoder(
      goldPerpsIdl as unknown as anchor.Idl,
    );

    const loadChainState = async () => {
      if (!leaderboardKey || !data?.markets.length) {
        if (mounted) {
          setMarketSnapshots({});
          setPositions({});
          setConfigPresent(false);
          setConfigLoaded(false);
          setSkewScaleSol(DEFAULT_SKEW_SCALE_SOL);
          setConfiguredMaxLeverage(DEFAULT_MAX_MODEL_LEVERAGE);
          setConfiguredMinMarginLamports(DEFAULT_MIN_MODEL_MARGIN_LAMPORTS);
          setMaintenanceMarginBps(1_000);
          setOracleStalenessMs(DEFAULT_MAX_ORACLE_STALENESS_MS);
        }
        return;
      }
      try {
        const entries = data.markets;
        const marketIds = entries.map((entry) => entry.marketId);
        const [configInfo, marketInfos] = await Promise.all([
          connection.getAccountInfo(deriveConfigPda(), "confirmed"),
          fetchMultipleAccounts(connection, marketIds.map(deriveMarketPda)),
        ]);

        const decodedConfig = configInfo?.data
          ? decodeAccount<ConfigAccountState>(
            coder,
            "ConfigState",
            configInfo.data,
          )
          : null;

        const nextMarketSnapshots: Record<string, MarketSnapshot> = {};
        for (let index = 0; index < entries.length; index += 1) {
          const marketInfo = marketInfos[index];
          const decoded = marketInfo?.data
            ? decodeAccount<MarketAccountState>(
              coder,
              "MarketState",
              marketInfo.data,
            )
            : null;
          const marketId = marketIds[index];
          const mu = decoded ? bnToNumber(decoded.mu) / 1_000_000 : null;
          const sigma = decoded ? bnToNumber(decoded.sigma) / 1_000_000 : null;
          const localSkewScaleSol = decoded
            ? fromLamports(bnToNumber(decoded.skewScale))
            : DEFAULT_SKEW_SCALE_SOL;

          const fallbackSnapshot =
            entries[index].characterId === E2E_MODEL_ENTRY?.characterId
              ? buildE2eMarketSnapshot()
              : null;

          nextMarketSnapshots[entries[index].characterId] = decoded
            ? {
              marketId,
              spotIndex: fromLamports(bnToNumber(decoded.spotIndex)),
              longOi: fromLamports(bnToNumber(decoded.totalLongOi)),
              shortOi: fromLamports(bnToNumber(decoded.totalShortOi)),
              fundingRate: fromLamports(
                bnToNumber(decoded.currentFundingRate),
              ),
              conservativeSkill:
                mu !== null && sigma !== null
                  ? conservativeSkill(mu, sigma)
                  : null,
              uncertainty: sigma,
              lastUpdated: bnToNumber(decoded.oracleLastUpdated) * 1_000,
              insuranceFund: fromLamports(bnToNumber(decoded.insuranceFund)),
              skewScale: bnToNumber(decoded.skewScale),
              skewScaleSol: localSkewScaleSol,
            }
            : (fallbackSnapshot ?? {
              marketId,
              spotIndex: null,
              longOi: 0,
              shortOi: 0,
              fundingRate: 0,
              conservativeSkill: null,
              uncertainty: null,
              lastUpdated: null,
              insuranceFund: 0,
              skewScale: 0,
              skewScaleSol: DEFAULT_SKEW_SCALE_SOL,
            });
        }

        const nextPositions: Record<string, PositionSnapshot> = {};
        if (wallet.publicKey) {
          const positionAddresses = marketIds.map((marketId) =>
            derivePositionPda(wallet.publicKey as PublicKey, marketId),
          );
          const positionInfos = await fetchMultipleAccounts(
            connection,
            positionAddresses,
          );

          for (let index = 0; index < entries.length; index += 1) {
            const positionInfo = positionInfos[index];
            const decoded = positionInfo?.data
              ? decodeAccount<PositionAccountState>(
                coder,
                "PositionState",
                positionInfo.data,
              )
              : null;
            if (!decoded) continue;

            const markPrice =
              nextMarketSnapshots[entries[index].characterId]?.spotIndex;
            const signedSize = fromLamports(bnToNumber(decoded.size));
            const direction: TradeDirection =
              signedSize >= 0 ? "LONG" : "SHORT";
            const margin = fromLamports(bnToNumber(decoded.margin));
            const size = Math.abs(signedSize);
            const entryPrice = fromLamports(bnToNumber(decoded.entryPrice));

            nextPositions[entries[index].characterId] = {
              marketId: marketIds[index],
              direction,
              margin,
              size,
              signedSize,
              entryPrice,
              markPrice,
              pnl: computePnl(entryPrice, signedSize, markPrice),
              liquidationPrice: computeLiquidationPrice(
                entryPrice,
                signedSize,
                margin,
                decodedConfig?.maintenanceMarginBps ?? 1_000,
              ),
            };
          }
        }

        if (!mounted) return;

        setMarketSnapshots(nextMarketSnapshots);
        setPositions(nextPositions);
        setConfigPresent(Boolean(configInfo));
        setConfigLoaded(Boolean(decodedConfig));
        setSkewScaleSol(
          decodedConfig
            ? fromLamports(bnToNumber(decodedConfig.defaultSkewScale))
            : DEFAULT_SKEW_SCALE_SOL,
        );
        setConfiguredMaxLeverage(
          decodedConfig?.maxLeverage
            ? Math.max(1, bnToNumber(decodedConfig.maxLeverage))
            : DEFAULT_MAX_MODEL_LEVERAGE,
        );
        setConfiguredMinMarginLamports(
          decodedConfig?.minMarginLamports
            ? Math.max(1, bnToNumber(decodedConfig.minMarginLamports))
            : DEFAULT_MIN_MODEL_MARGIN_LAMPORTS,
        );
        setMaintenanceMarginBps(decodedConfig?.maintenanceMarginBps ?? 1_000);
        setOracleStalenessMs(
          decodedConfig?.maxOracleStalenessSeconds
            ? bnToNumber(decodedConfig.maxOracleStalenessSeconds) * 1_000
            : DEFAULT_MAX_ORACLE_STALENESS_MS,
        );
      } catch (chainError) {
        if (!mounted) return;

        console.warn("[models-market] failed to load chain state", chainError);
        const e2eSnapshot = buildE2eMarketSnapshot();
        if (E2E_MODEL_ENTRY && e2eSnapshot) {
          setMarketSnapshots((current) => {
            const fallback = getE2eFallbackMarketSnapshots();
            return {
              ...current,
              ...fallback,
            };
          });
          setConfigPresent(true);
          setConfigLoaded(true);
          setSkewScaleSol(e2eSnapshot.skewScaleSol);
          setConfiguredMaxLeverage(DEFAULT_MAX_MODEL_LEVERAGE);
          setConfiguredMinMarginLamports(DEFAULT_MIN_MODEL_MARGIN_LAMPORTS);
          setMaintenanceMarginBps(1_000);
          setOracleStalenessMs(DEFAULT_MAX_ORACLE_STALENESS_MS);
        } else {
          setConfigPresent(false);
          setConfigLoaded(false);
        }
      }
    };

    void loadChainState();
    const intervalId = window.setInterval(() => {
      void loadChainState();
    }, CHAIN_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [connection, data, leaderboardKey, wallet.publicKey]);

  const filteredLeaderboard = React.useMemo(() => {
    if (!data?.markets.length) return [];

    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return data.markets;

    return data.markets.filter((entry) => {
      const haystack =
        `${entry.name} ${entry.provider} ${entry.model}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [data, searchTerm]);

  const selectedEntry = React.useMemo(() => {
    if (!data || !selectedCharacterId) return null;
    return (
      data.markets.find((entry) => entry.characterId === selectedCharacterId) ??
      null
    );
  }, [data, selectedCharacterId]);

  const selectedMarket = selectedCharacterId
    ? marketSnapshots[selectedCharacterId]
    : undefined;
  const selectedPosition = selectedCharacterId
    ? positions[selectedCharacterId]
    : undefined;
  const selectedMarketActive = selectedEntry?.status === "ACTIVE";
  const selectedMarketCloseOnly = selectedEntry?.status === "CLOSE_ONLY";
  const selectedOracleFresh =
    IS_E2E_MODE && selectedEntry?.characterId === E2E_MODEL_ENTRY?.characterId
      ? true
      : isOracleFresh(selectedMarket?.lastUpdated ?? null, oracleStalenessMs);
  const selectedCanOpen = Boolean(selectedMarketActive && selectedOracleFresh);
  const selectedCanClose = Boolean(
    selectedPosition &&
    ((selectedMarketActive && selectedOracleFresh) || selectedMarketCloseOnly),
  );

  const aggregateLongOi = React.useMemo(
    () =>
      Object.values(marketSnapshots).reduce(
        (total, snapshot) => total + snapshot.longOi,
        0,
      ),
    [marketSnapshots],
  );
  const aggregateShortOi = React.useMemo(
    () =>
      Object.values(marketSnapshots).reduce(
        (total, snapshot) => total + snapshot.shortOi,
        0,
      ),
    [marketSnapshots],
  );

  const estLongPrice = estimateExecutionPrice(
    selectedMarket,
    collateralSol * effectiveLeverage,
    selectedMarket?.skewScaleSol ?? skewScaleSol,
  );
  const estShortPrice = estimateExecutionPrice(
    selectedMarket,
    -collateralSol * effectiveLeverage,
    selectedMarket?.skewScaleSol ?? skewScaleSol,
  );

  const ensureTradable = (intent: "open" | "close"): boolean => {
    if (activeChain !== "solana") {
      setLastTradeStatus(copy.switchDemoToSolana);
      toast.error(copy.switchDemoToSolana);
      return false;
    }

    if (!wallet.publicKey || !wallet.connected) {
      setLastTradeStatus(copy.connectWalletToTrade);
      setWalletModalVisible(true);
      return false;
    }

    if (!wallet.signTransaction || !wallet.signAllTransactions) {
      setLastTradeStatus(copy.walletCannotSign);
      toast.error(copy.walletCannotSign);
      return false;
    }

    if (intent === "open" && !selectedMarketActive) {
      setLastTradeStatus(copy.marketNotAccepting);
      toast.error(copy.marketNotAccepting);
      return false;
    }

    if (intent === "open" && !selectedOracleFresh) {
      setLastTradeStatus(copy.waitingOnOracle);
      toast.error(copy.waitingOnOracle);
      return false;
    }

    if (intent === "open" && !openCollateralSatisfiesMinMargin) {
      const minimumCollateral = formatSolAmount(
        fromLamports(minimumOpenCollateralLamports),
        locale,
      );
      setLastTradeStatus(copy.minimumOpenCollateral(minimumCollateral));
      toast.error(copy.minimumOpenCollateral(minimumCollateral));
      return false;
    }

    if (intent === "close" && selectedEntry?.status === "ARCHIVED") {
      setLastTradeStatus(copy.marketArchived);
      toast.error(copy.marketArchived);
      return false;
    }

    return true;
  };

  const refreshChainState = React.useCallback(async () => {
    if (!data?.markets.length) return;
    const freshResponse = sanitizePerpsMarketsResponse({
      markets: data.markets,
      updatedAt: Date.now(),
    });
    setData(freshResponse);
  }, [data]);

  const getProgram = React.useCallback(() => {
    const provider = new anchor.AnchorProvider(
      connection,
      wallet as unknown as anchor.Wallet,
      {
        commitment: "confirmed",
      },
    );
    return new anchor.Program(goldPerpsIdl as anchor.Idl, provider);
  }, [connection, wallet]);

  const fetchLiveMarketSnapshot = React.useCallback(
    async (marketId: number): Promise<MarketSnapshot | null> => {
      const coder = new anchor.BorshAccountsCoder(
        goldPerpsIdl as unknown as anchor.Idl,
      );
      const marketInfo = await connection.getAccountInfo(
        deriveMarketPda(marketId),
        "confirmed",
      );
      if (!marketInfo?.data) {
        return null;
      }
      const decoded = decodeAccount<MarketAccountState>(
        coder,
        "MarketState",
        marketInfo.data,
      );
      if (!decoded) {
        return null;
      }
      return {
        marketId,
        spotIndex: fromLamports(bnToNumber(decoded.spotIndex)),
        longOi: fromLamports(bnToNumber(decoded.totalLongOi)),
        shortOi: fromLamports(bnToNumber(decoded.totalShortOi)),
        fundingRate: fromLamports(bnToNumber(decoded.currentFundingRate)),
        conservativeSkill: null,
        uncertainty: null,
        lastUpdated: bnToNumber(decoded.oracleLastUpdated) * 1_000,
        insuranceFund: fromLamports(bnToNumber(decoded.insuranceFund)),
        skewScale: bnToNumber(decoded.skewScale),
        skewScaleSol: fromLamports(bnToNumber(decoded.skewScale)),
      };
    },
    [connection],
  );

  const handleOpenPosition = async (direction: TradeDirection) => {
    if (!selectedEntry || !selectedMarket) return;
    if (!ensureTradable("open")) return;

    const marketId = selectedEntry.marketId;
    const txId = `model-market-${selectedEntry.characterId}-${direction.toLowerCase()}`;
    const directionLabel =
      direction === "LONG" ? copy.directionLong : copy.directionShort;
    setSubmittingTrade(txId);
    setLastTradeStatus(copy.submitting(directionLabel, selectedEntry.name));
    setLastTradeTx("-");
    setLastTradeRequest("-");
    toast.loading(copy.opening(effectiveLeverage, directionLabel, selectedEntry.name), {
      id: txId,
    });

    let tradeStage = copy.stageBuilding;
    try {
      const program = getProgram();
      const positionAddress = derivePositionPda(
        wallet.publicKey as PublicKey,
        marketId,
      );
      const liveSelectedMarket =
        (await fetchLiveMarketSnapshot(marketId)) ?? selectedMarket;
      const marginDeltaLamports = toLamports(collateralSol);
      const signedSizeLamports =
        toLamports(collateralSol * effectiveLeverage) *
        (direction === "LONG" ? 1 : -1);
      const quotedEntryPrice =
        estimateExecutionPrice(
          liveSelectedMarket,
          collateralSol * effectiveLeverage * (direction === "LONG" ? 1 : -1),
          liveSelectedMarket?.skewScaleSol ?? skewScaleSol,
        ) ??
        liveSelectedMarket?.spotIndex ??
        selectedMarket.spotIndex ??
        0;
      const acceptablePriceLamports =
        quotedEntryPrice <= 0
          ? 0
          : toLamports(
            direction === "LONG"
              ? quotedEntryPrice * 1.02
              : quotedEntryPrice * 0.98,
          );
      const estimatedTradeFeeLamports = Math.round(
        Math.abs(signedSizeLamports) * TOTAL_TRADE_FEE_RATE,
      );
      setLastTradeRequest(
        JSON.stringify({
          action: `open-${direction.toLowerCase()}`,
          marketId,
          collateralSol,
          effectiveLeverage,
          configuredMaxLeverage,
          configuredMinMarginLamports,
          marginDeltaLamports,
          signedSizeLamports,
          estimatedTradeFeeLamports,
          estimatedPostFeeMarginLamports:
            marginDeltaLamports - estimatedTradeFeeLamports,
          selectedSpotIndex: selectedMarket?.spotIndex ?? null,
          liveSpotIndex: liveSelectedMarket?.spotIndex ?? null,
          quotedEntryPrice,
          acceptablePriceLamports,
        }),
      );
      const marketIdArg = new anchor.BN(String(marketId));

      const transaction = await program.methods
        .modifyPosition(
          marketIdArg,
          new anchor.BN(String(marginDeltaLamports)),
          new anchor.BN(String(signedSizeLamports)),
          new anchor.BN(String(acceptablePriceLamports)),
        )
        .accountsPartial({
          config: deriveConfigPda(),
          market: deriveMarketPda(marketId),
          position: positionAddress,
          trader: wallet.publicKey as PublicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      transaction.feePayer = wallet.publicKey as PublicKey;
      tradeStage = copy.stageBlockhash;
      const latest = await getLatestBlockhashViaRpc(connection);
      transaction.recentBlockhash = latest.blockhash;
      const signTransaction = wallet.signTransaction;
      if (!signTransaction) {
        throw new Error(copy.walletCannotSign);
      }
      tradeStage = copy.stageSigning;
      const signed = await signTransaction(transaction);
      tradeStage = copy.stageSending;
      const signature = await sendRawTransactionViaRpc(connection, signed);
      tradeStage = copy.stageConfirming;
      await confirmSignatureViaRpc(connection, signature);

      const signedSize =
        collateralSol * effectiveLeverage * (direction === "LONG" ? 1 : -1);
      const entryPrice = quotedEntryPrice;
      const markPrice = selectedMarket.spotIndex ?? entryPrice;
      setPositions((current) => ({
        ...current,
        [selectedEntry.characterId]: {
          marketId,
          direction,
          margin: collateralSol,
          size: Math.abs(signedSize),
          signedSize,
          entryPrice,
          markPrice,
          pnl: 0,
          liquidationPrice: computeLiquidationPrice(
            entryPrice,
            signedSize,
            collateralSol,
            maintenanceMarginBps,
          ),
        },
      }));
      setMarketSnapshots((current) => ({
        ...current,
        [selectedEntry.characterId]:
          applySignedOi(current[selectedEntry.characterId], signedSize) ??
          current[selectedEntry.characterId],
      }));
      setLastTradeStatus(copy.opened(directionLabel, selectedEntry.name));
      setLastTradeTx(signature);
      toast.success(copy.openedToast(directionLabel, selectedEntry.name), {
        id: txId,
      });
      await refreshChainState();
    } catch (tradeError) {
      const message = `${tradeStage}: ${getTradeErrorMessage(tradeError, locale)}`;
      setLastTradeStatus(message);
      toast.error(message, { id: txId });
    } finally {
      setSubmittingTrade(null);
    }
  };

  const handleClosePosition = async () => {
    if (!selectedEntry || !selectedPosition) return;
    if (!ensureTradable("close")) return;

    const txId = `close-model-${selectedEntry.characterId}`;
    setSubmittingTrade(txId);
    setLastTradeStatus(copy.closingPosition(selectedEntry.name));
    setLastTradeTx("-");
    setLastTradeRequest("-");
    toast.loading(copy.closingPosition(selectedEntry.name), { id: txId });

    let tradeStage = copy.stageBuilding;
    try {
      const program = getProgram();
      const marketId = selectedEntry.marketId;
      const liveSelectedMarket =
        (await fetchLiveMarketSnapshot(marketId)) ?? selectedMarket;
      const closeSizeLamports = -toLamports(selectedPosition.signedSize);
      const quotedClosePrice =
        estimateExecutionPrice(
          liveSelectedMarket,
          -selectedPosition.signedSize,
          liveSelectedMarket?.skewScaleSol ?? skewScaleSol,
        ) ??
        liveSelectedMarket?.spotIndex ??
        selectedMarket?.spotIndex ??
        selectedPosition.entryPrice;
      const acceptablePriceLamports =
        quotedClosePrice <= 0
          ? 0
          : toLamports(
            selectedPosition.direction === "LONG"
              ? quotedClosePrice * 0.98
              : quotedClosePrice * 1.02,
          );
      const estimatedTradeFeeLamports = Math.round(
        Math.abs(closeSizeLamports) * TOTAL_TRADE_FEE_RATE,
      );
      setLastTradeRequest(
        JSON.stringify({
          action: "close-position",
          marketId,
          positionDirection: selectedPosition.direction,
          positionSignedSize: selectedPosition.signedSize,
          closeSizeLamports,
          estimatedTradeFeeLamports,
          selectedSpotIndex: selectedMarket?.spotIndex ?? null,
          liveSpotIndex: liveSelectedMarket?.spotIndex ?? null,
          quotedClosePrice,
          acceptablePriceLamports,
        }),
      );
      const marketIdArg = new anchor.BN(String(marketId));

      const transaction = await program.methods
        .modifyPosition(
          marketIdArg,
          new anchor.BN(0),
          new anchor.BN(String(closeSizeLamports)),
          new anchor.BN(String(acceptablePriceLamports)),
        )
        .accountsPartial({
          config: deriveConfigPda(),
          market: deriveMarketPda(marketId),
          position: derivePositionPda(wallet.publicKey as PublicKey, marketId),
          trader: wallet.publicKey as PublicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      transaction.feePayer = wallet.publicKey as PublicKey;
      tradeStage = copy.stageBlockhash;
      const latest = await getLatestBlockhashViaRpc(connection);
      transaction.recentBlockhash = latest.blockhash;
      const signTransaction = wallet.signTransaction;
      if (!signTransaction) {
        throw new Error(copy.walletCannotSign);
      }
      tradeStage = copy.stageSigning;
      const signed = await signTransaction(transaction);
      tradeStage = copy.stageSending;
      const signature = await sendRawTransactionViaRpc(connection, signed);
      tradeStage = copy.stageConfirming;
      await confirmSignatureViaRpc(connection, signature);

      setPositions((current) => {
        const next = { ...current };
        delete next[selectedEntry.characterId];
        return next;
      });
      setLastTradeStatus(copy.closedPosition(selectedEntry.name));
      setLastTradeTx(signature);
      toast.success(copy.closedPosition(selectedEntry.name), { id: txId });
      await refreshChainState();
    } catch (tradeError) {
      const message = `${tradeStage}: ${getTradeErrorMessage(tradeError, locale)}`;
      setLastTradeStatus(message);
      toast.error(message, { id: txId });
    } finally {
      setSubmittingTrade(null);
    }
  };

  return (
    <div className="models-market-view" data-testid="models-market-view">
      <Toaster theme="dark" position="bottom-right" />

      <section className="models-market-hero">
        <div>
          <h2>{copy.modelPerps}</h2>
        </div>

        <div className="models-market-metrics">
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">{copy.trackedModels}</span>
            <strong>{data?.markets.length ?? 0}</strong>
            <small>{activeMatchup}</small>
          </article>
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">{copy.aggregateOi}</span>
            <strong>
              {formatCompactNumber(aggregateLongOi, locale)} /{" "}
              {formatCompactNumber(aggregateShortOi, locale)} SOL
            </strong>
          </article>
          <article className="models-market-metric-card">
            <span className="models-market-metric-label">{copy.oracleBasis}</span>
            <strong>{formatCompactNumber(skewScaleSol, locale, 0)} SOL</strong>
          </article>
        </div>
      </section>

      {activeChain !== "solana" && (
        <div className="models-market-banner">
          <strong>{copy.solanaOnly}</strong>
          <button type="button" onClick={() => setActiveChain("solana")}>
            {copy.switchToSolana}
          </button>
        </div>
      )}

      <section className="models-market-grid">
        <article className="models-market-card models-market-card--table">
          <div className="models-market-card-header">
            <h3>{copy.models}</h3>
            <div className="models-market-toolbar">
              <input
                className="models-market-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={copy.searchModels}
              />
              <span className="models-market-updated">
                {copy.updated(formatUpdatedAt(data?.updatedAt ?? null, locale))}
              </span>
            </div>
          </div>

          {error && <div className="models-market-error">{error}</div>}

          <div className="models-market-grid-container">
            {loading && filteredLeaderboard.length === 0 && (
              <div className="models-market-empty">
                {copy.loadingModelsMarket}
              </div>
            )}

            {!loading && filteredLeaderboard.length === 0 && (
              <div className="models-market-empty">
                {copy.noModelsMatched}
              </div>
            )}

            {filteredLeaderboard.map((entry) => {
              const market = marketSnapshots[entry.characterId];
              const position = positions[entry.characterId];
              const isSelected = selectedCharacterId === entry.characterId;

              return (
                <div
                  key={entry.characterId}
                  data-testid={`models-market-card-${entry.characterId}`}
                  className={`model-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedCharacterId(entry.characterId)}
                >
                  <div className="model-card-header">
                    <span className="model-card-rank">{entry.rank ? `#${entry.rank}` : copy.emDash}</span>
                    <span className={`model-card-status status-${entry.status.toLowerCase()}`}>
                      {entry.status === "ACTIVE"
                        ? copy.active
                        : entry.status === "CLOSE_ONLY"
                          ? copy.closeOnly
                          : copy.archived}
                    </span>
                  </div>
                  <div className="model-card-body">
                    <h4 className="model-card-name">{entry.name}</h4>
                    <span className="model-card-provider">{entry.provider || copy.unknown} &middot; {entry.model || copy.unnamedModel}</span>

                    <div className="model-card-stats">
                      <div className="model-card-stat">
                        <span className="stat-label">{copy.winLoss}</span>
                        <span className="stat-value">{entry.wins}-{entry.losses} ({toWinRatePercent(entry.wins, entry.losses).toFixed(1)}%)</span>
                      </div>
                      <div className="model-card-stat">
                        <span className="stat-label">{copy.funding}</span>
                        <span className={`stat-value ${market && market.fundingRate > 0 ? "is-funding-positive" : "is-funding-negative"}`}>
                          {market ? (market.fundingRate * 100).toFixed(4) + '%' : copy.emDash}
                        </span>
                      </div>
                    </div>
                  </div>
                  {position && (
                    <div className="model-card-footer">
                      <span className={`models-market-position-chip is-${position.direction.toLowerCase()}`}>
                        {position.direction === "LONG" ? copy.directionLong : copy.directionShort}{" "}
                        {formatLocaleNumber(position.size, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </article>

        <aside className="models-market-card models-market-card--detail">
          {selectedEntry ? (
            <>
              <div className="models-market-card-header">
                <div>
                  <h3>{selectedEntry.name}</h3>
                  <p>
                    {selectedEntry.provider || copy.unknownProvider} ·{" "}
                    {selectedEntry.model || copy.unnamedModel}
                  </p>
                </div>
                <div
                  className={`models-market-rank-chip ${selectedOracleFresh || selectedEntry.status !== "ACTIVE"
                      ? ""
                      : "is-stale"
                    }`}
                >
                  {selectedEntry.status === "ACTIVE"
                    ? selectedOracleFresh
                      ? selectedEntry.rank
                        ? copy.rankLabel(selectedEntry.rank)
                        : copy.active
                      : copy.oracleStale
                    : selectedEntry.status === "CLOSE_ONLY"
                      ? copy.closeOnly
                      : copy.archived}
                </div>
              </div>

              <div className="models-market-detail-grid">
                <div>
                  <span>{copy.index}</span>
                  <strong>
                    {selectedMarket?.spotIndex
                      ? formatUsd(selectedMarket.spotIndex, locale)
                      : copy.pending}
                  </strong>
                </div>
                <div>
                  <span>{copy.openInterest}</span>
                  <strong>
                    {selectedMarket
                      ? `${formatLocaleNumber(selectedMarket.longOi, locale, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} / ${formatLocaleNumber(selectedMarket.shortOi, locale, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                      : copy.emDash}
                  </strong>
                </div>
                <div>
                  <span>{copy.funding}</span>
                  <strong>
                    {selectedMarket
                      ? formatLocaleNumber(selectedMarket.fundingRate, locale, {
                        minimumFractionDigits: 6,
                        maximumFractionDigits: 6,
                      })
                      : copy.emDash}
                  </strong>
                </div>
                <div>
                  <span>{copy.insurance}</span>
                  <strong>
                    {selectedMarket
                      ? formatSolAmount(selectedMarket.insuranceFund, locale)
                      : copy.emDash}
                  </strong>
                </div>
              </div>

              <div
                className="models-market-history-card"
                data-testid="models-market-oracle-history"
              >
                <div className="models-market-history-header">
                  <h4>{copy.oracleHistory}</h4>
                  <span>
                    {copy.currentOracle(
                      formatUpdatedAt(selectedMarket?.lastUpdated ?? null, locale),
                      !selectedOracleFresh,
                    )}
                  </span>
                </div>

                <div className="models-market-history-chart">
                  {oracleHistoryError ? (
                    <div className="models-market-empty">
                      {copy.oracleHistoryError(oracleHistoryError)}
                    </div>
                  ) : oracleHistoryLoading && oracleHistory.length === 0 ? (
                    <div className="models-market-empty">
                      {copy.loadingOracleHistory}
                    </div>
                  ) : oracleHistory.length === 0 ? (
                    <div className="models-market-empty">
                      {copy.waitingForSnapshots}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oracleHistory}>
                        <XAxis
                          dataKey="label"
                          tick={{
                            fill: "rgba(255,255,255,0.45)",
                            fontSize: 11,
                          }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                        />
                        <YAxis
                          tick={{
                            fill: "rgba(255,255,255,0.45)",
                            fontSize: 11,
                          }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          width={48}
                          tickFormatter={(value: number) =>
                            formatUsd(value, locale, 0)
                          }
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const point = payload[0]
                              ?.payload as OracleHistoryPoint;
                            return (
                              <div className="models-market-tooltip">
                                <strong>{formatUsd(point.spotIndex, locale)}</strong>
                                <span>
                                  {copy.skill}{" "}
                                  {formatLocaleNumber(
                                    point.conservativeSkill,
                                    locale,
                                    {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    },
                                  )}{" "}
                                  · μ{" "}
                                  {formatLocaleNumber(point.mu, locale, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  · σ{" "}
                                  {formatLocaleNumber(point.sigma, locale, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </div>
                            );
                          }}
                        />
                        {selectedMarket?.spotIndex && (
                          <ReferenceLine
                            y={selectedMarket.spotIndex}
                            stroke="rgba(229,184,74,0.2)"
                            strokeDasharray="4 4"
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="spotIndex"
                          stroke="#e5b84a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {selectedPosition && (
                <div
                  className="models-market-active-position"
                  data-testid="models-market-active-position"
                >
                  <div>
                    <span className="models-market-section-label">
                      {copy.yourPosition}
                    </span>
                    <strong
                      data-testid="models-market-position-direction"
                      className={
                        selectedPosition.direction === "LONG"
                          ? "is-long"
                          : "is-short"
                      }
                    >
                      {selectedPosition.direction === "LONG"
                        ? copy.directionLong
                        : copy.directionShort}{" "}
                      {formatSolAmount(selectedPosition.size, locale)}
                    </strong>
                  </div>
                  <div>
                    <span>
                      {copy.positionEntry(
                        formatUsd(selectedPosition.entryPrice, locale),
                      )}
                    </span>
                    <span>
                      {copy.positionMargin(
                        formatSolAmount(selectedPosition.margin, locale, 4),
                      )}
                    </span>
                    <span>
                      {copy.pnl}{" "}
                      <strong
                        className={
                          selectedPosition.pnl >= 0 ? "is-long" : "is-short"
                        }
                      >
                        {selectedPosition.pnl >= 0 ? "+" : ""}
                        {formatSolAmount(selectedPosition.pnl, locale, 4)}
                      </strong>
                    </span>
                    <button
                      type="button"
                      data-testid="models-market-close-position"
                      onClick={() => void handleClosePosition()}
                      disabled={Boolean(submittingTrade) || !selectedCanClose}
                    >
                      {copy.closePosition}
                    </button>
                  </div>
                </div>
              )}

              <div className="models-market-trade-card">
                <div className="models-market-trade-header">
                  <h4>{copy.trade(selectedEntry.name)}</h4>
                  <span data-testid="models-market-market-id">
                    {selectedMarket
                      ? copy.marketId(selectedMarket.marketId)
                      : copy.pendingOracle}
                  </span>
                </div>

                <label className="models-market-field">
                  <span>{copy.collateral}</span>
                  <input
                    data-testid="models-market-collateral-input"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={collateralSol}
                    onChange={(event) =>
                      setCollateralSol(Number(event.target.value))
                    }
                  />
                </label>

                <div className="models-market-field">
                  <div className="models-market-field-row">
                    <span>{copy.leverage}</span>
                    <strong>{effectiveLeverage}x</strong>
                  </div>
                  <div className="models-market-leverage-row">
                    {[1, 2, 3, 5]
                      .filter((value) => value <= configuredMaxLeverage)
                      .map((value) => (
                        <button
                          key={value}
                          data-testid={`models-market-leverage-${value}x`}
                          type="button"
                          className={
                            effectiveLeverage === value
                              ? "is-active"
                              : undefined
                          }
                          onClick={() => setLeverage(value)}
                        >
                          {value}x
                        </button>
                      ))}
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={configuredMaxLeverage}
                    step={1}
                    value={effectiveLeverage}
                    onChange={(event) =>
                      setLeverage(Number(event.target.value))
                    }
                  />
                </div>

                <div className="models-market-summary">
                  <div>
                    <span>{copy.positionSize}</span>
                    <strong>
                      {formatSolAmount(collateralSol * effectiveLeverage, locale)}
                    </strong>
                  </div>
                  <div>
                    <span>{copy.estLongEntry}</span>
                    <strong>
                      {estLongPrice ? formatUsd(estLongPrice, locale) : copy.emDash}
                    </strong>
                  </div>
                  <div>
                    <span>{copy.estShortEntry}</span>
                    <strong>
                      {estShortPrice ? formatUsd(estShortPrice, locale) : copy.emDash}
                    </strong>
                  </div>
                </div>

                <div className="models-market-actions">
                  {IS_E2E_MODE && (
                    <div
                      className="models-market-empty"
                      style={{ marginBottom: 12 }}
                    >
                      <div data-testid="models-market-rpc-endpoint">
                        {connection.rpcEndpoint}
                      </div>
                      <div data-testid="models-market-config-pda">
                        {deriveConfigPda().toBase58()}
                      </div>
                      <div data-testid="models-market-config-present">
                        {configPresent ? "true" : "false"}
                      </div>
                      <div data-testid="models-market-config-loaded">
                        {configLoaded ? "true" : "false"}
                      </div>
                      <div data-testid="models-market-last-trade-status">
                        {lastTradeStatus}
                      </div>
                      <div data-testid="models-market-last-trade-tx">
                        {lastTradeTx}
                      </div>
                      <div data-testid="models-market-last-trade-request">
                        {lastTradeRequest}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="models-market-open-long"
                    className="is-long"
                    disabled={
                      Boolean(submittingTrade) ||
                      collateralSol <= 0 ||
                      !selectedCanOpen ||
                      !openCollateralSatisfiesMinMargin
                    }
                    onClick={() => void handleOpenPosition("LONG")}
                  >
                    {copy.longAction(selectedEntry.name)}
                  </button>
                  <button
                    type="button"
                    data-testid="models-market-open-short"
                    className="is-short"
                    disabled={
                      Boolean(submittingTrade) ||
                      collateralSol <= 0 ||
                      !selectedCanOpen ||
                      !openCollateralSatisfiesMinMargin
                    }
                    onClick={() => void handleOpenPosition("SHORT")}
                  >
                    {copy.shortAction(selectedEntry.name)}
                  </button>
                </div>
                {!selectedCanOpen && (
                  <div className="models-market-empty">
                    {selectedEntry.status === "ACTIVE"
                      ? copy.awaitingOracle
                      : selectedEntry.status === "CLOSE_ONLY"
                        ? copy.closeOnlyMarket
                        : copy.archivedMarket}
                  </div>
                )}
                {selectedCanOpen && !openCollateralSatisfiesMinMargin && (
                  <div className="models-market-empty">
                    {copy.minimumOpenCollateral(
                      formatSolAmount(
                        fromLamports(minimumOpenCollateralLamports),
                        locale,
                      ),
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="models-market-empty-detail">
              {copy.selectModel}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
