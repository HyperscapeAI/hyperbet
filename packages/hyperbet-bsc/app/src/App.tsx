import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

import {
  formatLocaleAmount,
  getLocaleTag,
  resolveUiLocale,
  setStoredUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { LocaleSelector } from "@hyperbet/ui/components/LocaleSelector";

import {
  DEFAULT_REFRESH_INTERVAL_MS,
  GAME_API_URL,
  getFixedMatchId,
  STREAM_URLS,
} from "./lib/config";
import {
  captureInviteCodeFromLocation,
  getStoredInviteCode,
} from "@hyperbet/ui/lib/invite";
import { usePredictionMarketLifecycle } from "@hyperbet/ui/lib/predictionMarkets";
import { StreamPlayer } from "@hyperbet/ui/components/StreamPlayer";
import { PointsDisplay } from "@hyperbet/ui/components/PointsDisplay";
import { useChain } from "./lib/ChainContext";
import { useStreamingState } from "@hyperbet/ui/spectator/useStreamingState";
import { useDuelContext } from "@hyperbet/ui/spectator/useDuelContext";
import { useResizePanel, useIsMobile } from "@hyperbet/ui/lib/useResizePanel";
import { ResizeHandle } from "@hyperbet/ui/components/ResizeHandle";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ── Shared UI utilities ──────────────────────────────────────────────────────
function formatGold(v: number, locale: UiLocale): string {
  if (locale === "zh") {
    if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}亿`;
    if (v >= 10_000) return `${(v / 10_000).toFixed(1)}万`;
  } else {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  }
  return formatLocaleAmount(v, locale);
}

function formatTimeAgo(ts: number, locale: UiLocale): string {
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 0) return locale === "zh" ? "刚刚" : "just now";
  const mins = Math.floor(ago / 60);
  if (locale === "zh") {
    if (mins > 0) return `${mins}分前`;
    return `${ago}秒前`;
  }
  if (mins > 0) return `${mins}m`;
  return `${ago}s`;
}

function truncateAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type BetSide = "YES" | "NO";

type DiscoveredMatch = {
  matchId: number;
  status: "open" | "resolved" | "unknown";
  openTs: number;
  closeTs: number;
  resolvedTs: number | null;
  winner: BetSide | null;
  agent1Name: string;
  agent2Name: string;
};

function normalizeTimestamp(value: number): number {
  if (value > 1_000_000_000_000) return Math.floor(value / 1000);
  return Math.floor(value);
}

function normalizeRemainingSeconds(value: number | null | undefined): number {
  if (!Number.isFinite(value as number)) return 0;
  const raw = Math.max(0, Number(value));
  // Streaming API reports ms, while mock mode reports whole seconds.
  return raw > 10_000 ? Math.floor(raw / 1000) : Math.floor(raw);
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function normalizeEvmAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function getAppCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      points: "积分",
      leaderboard: "排行榜",
      history: "历史",
      referral: "推荐",
      loadingLeaderboard: "正在加载排行榜",
      loadingHistory: "正在加载历史",
      loadingReferral: "正在加载推荐",
      loadingAgentStats: "正在加载代理数据",
      loadingModelMarkets: "正在加载模型市场",
      loadingEvmMarket: "正在加载 EVM 市场",
      debugTitle: "极简对战下注",
      chain: "链",
      currentMatch: "当前对局",
      market: "市场",
      yesPool: "YES 池",
      noPool: "NO 池",
      refresh: "刷新",
      connectEvm: "连接 EVM",
      wrongNet: "网络错误",
      duels: "对决",
      models: "模型",
      modelMarkets: "模型市场",
      leaderboardAndStats: "排行榜与统计",
      addEvmWallet: "添加 EVM 钱包",
      switchNetwork: "切换网络",
      unmuteStream: "开启声音",
      muteStream: "静音",
      source: "信源",
      waitingForStream: "等待直播流…",
      trades: "成交",
      orderBook: "订单簿",
      matchLog: "对局日志",
      agents: "智能体",
      positions: "仓位",
      pool: "资金池",
      side: "方向",
      agent: "智能体",
      price: "价格",
      amount: "数量",
      age: "时间",
      trader: "交易者",
      buy: "买入",
      sell: "卖出",
      bids: (name: string) => `买盘（${name}）`,
      asks: (name: string) => `卖盘（${name}）`,
      spread: (value: number) => `价差：${value}%`,
      rank: "排名",
      provider: "提供方",
      wins: "胜场",
      losses: "负场",
      winRate: "胜率",
      streak: "连胜",
      hp: "生命",
      wl: "胜负",
      dmg: "伤害",
      action: "动",
      thought: "思",
      result: "结果",
      winner: (name: string, reason: string | null | undefined) =>
        `${name} 获胜${reason ? `！${reason}` : "！"}`,
      noOpenPositions: "暂无未平仓仓位",
      tradingControls: "交易控件",
      closeTradingPanel: "关闭交易面板",
      openTradingPanel: "打开交易面板",
      placeBet: "下注",
      legalLead: "交易即表示你同意",
      terms: "条款",
      privacy: "隐私",
      round: (value: string) => `第 ${value} 回合`,
      modelsStatus: (count: number) => `模型市场 · ${count} 个已排名模型`,
      live: "直播",
      stable: "稳定",
      synthetic: "合成",
      phaseLive: "直播",
      phaseStarting: (value: string | number | null) => `即将开始 ${value ?? ""}`,
      phaseResolved: "已结算",
      phaseNextMatch: "下一场",
      phaseIdle: "空闲",
      bettingUnavailable: (cluster: string) =>
        `${cluster} 上的下注暂时不可用。请稍后重试或切换链。`,
      record: (wins: number, losses: number) => `${wins}胜-${losses}负`,
      streakValue: (value: number) => `${value}连胜`,
      level: (value: number) => ` · 等级 ${value}`,
      statusOpen: "开放",
      statusResolved: "已结算",
      statusPending: "待定",
    };
  }

  if (locale === "ko") {
    return {
      points: "포인트",
      leaderboard: "리더보드",
      history: "기록",
      referral: "추천",
      loadingLeaderboard: "리더보드 로딩 중",
      loadingHistory: "기록 로딩 중",
      loadingReferral: "추천 로딩 중",
      loadingAgentStats: "에이전트 통계 로딩 중",
      loadingModelMarkets: "모델 마켓 로딩 중",
      loadingEvmMarket: "EVM 마켓 로딩 중",
      debugTitle: "초간단 대전 베팅",
      chain: "체인",
      currentMatch: "현재 경기",
      market: "마켓",
      yesPool: "YES 풀",
      noPool: "NO 풀",
      refresh: "새로고침",
      connectEvm: "EVM 연결",
      wrongNet: "네트워크 오류",
      duels: "듀얼",
      models: "모델",
      modelMarkets: "모델 마켓",
      leaderboardAndStats: "리더보드 & 통계",
      addEvmWallet: "EVM 지갑 추가",
      switchNetwork: "네트워크 전환",
      unmuteStream: "소리 켜기",
      muteStream: "음소거",
      source: "소스",
      waitingForStream: "스트림 대기 중…",
      trades: "거래",
      orderBook: "호가창",
      matchLog: "경기 로그",
      agents: "에이전트",
      positions: "포지션",
      pool: "풀",
      side: "방향",
      agent: "에이전트",
      price: "가격",
      amount: "수량",
      age: "시간",
      trader: "트레이더",
      buy: "매수",
      sell: "매도",
      bids: (name: string) => `매수호가 (${name})`,
      asks: (name: string) => `매도호가 (${name})`,
      spread: (value: number) => `스프레드: ${value}%`,
      rank: "순위",
      provider: "제공자",
      wins: "승",
      losses: "패",
      winRate: "승률",
      streak: "연승",
      hp: "HP",
      wl: "승/패",
      dmg: "피해",
      action: "행동",
      thought: "생각",
      result: "결과",
      winner: (name: string, reason: string | null | undefined) =>
        `${name} 승리!${reason ? ` ${reason}` : ""}`,
      noOpenPositions: "미결 포지션 없음",
      tradingControls: "거래 컨트롤",
      closeTradingPanel: "거래 패널 닫기",
      openTradingPanel: "거래 패널 열기",
      placeBet: "베팅하기",
      legalLead: "거래 시 동의한 것으로 간주됩니다:",
      terms: "이용약관",
      privacy: "개인정보",
      round: (value: string) => `${value}라운드`,
      modelsStatus: (count: number) => `모델 마켓 · ${count}개 랭크 모델`,
      live: "라이브",
      stable: "안정",
      synthetic: "합성",
      phaseLive: "라이브",
      phaseStarting: (value: string | number | null) => `시작 중 ${value ?? ""}`,
      phaseResolved: "정산 완료",
      phaseNextMatch: "다음 경기",
      phaseIdle: "대기",
      bettingUnavailable: (cluster: string) =>
        `${cluster}에서 베팅이 일시적으로 불가능합니다. 나중에 다시 시도하거나 체인을 변경하세요.`,
      record: (wins: number, losses: number) => `${wins}승-${losses}패`,
      streakValue: (value: number) => `${value}연승`,
      level: (value: number) => ` · Lv.${value}`,
      statusOpen: "진행 중",
      statusResolved: "정산 완료",
      statusPending: "대기 중",
    };
  }

  if (locale === "pt") {
    return {
      points: "Pontos",
      leaderboard: "Ranking",
      history: "Histórico",
      referral: "Indicação",
      loadingLeaderboard: "Carregando ranking",
      loadingHistory: "Carregando histórico",
      loadingReferral: "Carregando indicação",
      loadingAgentStats: "Carregando estatísticas do agente",
      loadingModelMarkets: "Carregando mercados de modelos",
      loadingEvmMarket: "Carregando mercado EVM",
      debugTitle: "Aposta Simples de Luta",
      chain: "Cadeia",
      currentMatch: "Partida atual",
      market: "Mercado",
      yesPool: "Pool SIM",
      noPool: "Pool NÃO",
      refresh: "Atualizar",
      connectEvm: "Conectar EVM",
      wrongNet: "Rede errada",
      duels: "Duelos",
      models: "Modelos",
      modelMarkets: "Mercado de Modelos",
      leaderboardAndStats: "Ranking & Estatísticas",
      addEvmWallet: "Adicionar Carteira EVM",
      switchNetwork: "Trocar Rede",
      unmuteStream: "Ativar som",
      muteStream: "Silenciar",
      source: "Fonte",
      waitingForStream: "Aguardando transmissão…",
      trades: "Negociações",
      orderBook: "Livro de Ordens",
      matchLog: "Log da Luta",
      agents: "Agentes",
      positions: "Posições",
      pool: "Pool",
      side: "Lado",
      agent: "Agente",
      price: "Preço",
      amount: "Quantidade",
      age: "Tempo",
      trader: "Trader",
      buy: "COMPRAR",
      sell: "VENDER",
      bids: (name: string) => `COMPRAS (${name})`,
      asks: (name: string) => `VENDAS (${name})`,
      spread: (value: number) => `Spread: ${value}%`,
      rank: "Posição",
      provider: "Provedor",
      wins: "Vitórias",
      losses: "Derrotas",
      winRate: "Taxa de Vitória",
      streak: "Sequência",
      hp: "HP",
      wl: "V/D",
      dmg: "Dano",
      action: "AÇÃO",
      thought: "PEN",
      result: "RESULTADO",
      winner: (name: string, reason: string | null | undefined) =>
        `${name} vence!${reason ? ` ${reason}` : ""}`,
      noOpenPositions: "Sem posições abertas",
      tradingControls: "Controles de negociação",
      closeTradingPanel: "Fechar painel de negociação",
      openTradingPanel: "Abrir painel de negociação",
      placeBet: "Apostar",
      legalLead: "Ao negociar, você concorda com nossos",
      terms: "Termos",
      privacy: "Privacidade",
      round: (value: string) => `Rodada #${value}`,
      modelsStatus: (count: number) => `MERCADO DE MODELOS · ${count} modelos classificados`,
      live: "AO VIVO",
      stable: "ESTÁVEL",
      synthetic: "SINTÉTICO",
      phaseLive: "AO VIVO",
      phaseStarting: (value: string | number | null) => `Iniciando ${value ?? ""}`,
      phaseResolved: "RESOLVIDO",
      phaseNextMatch: "PRÓXIMA PARTIDA",
      phaseIdle: "INATIVO",
      bettingUnavailable: (cluster: string) =>
        `Apostas temporariamente indisponíveis em ${cluster}. Tente novamente mais tarde ou troque de cadeia.`,
      record: (wins: number, losses: number) => `${wins}V-${losses}D`,
      streakValue: (value: number) => `${value}V`,
      level: (value: number) => ` · Nv.${value}`,
      statusOpen: "ABERTO",
      statusResolved: "RESOLVIDO",
      statusPending: "PENDENTE",
    };
  }

  if (locale === "es") {
    return {
      points: "Puntos",
      leaderboard: "Ranking",
      history: "Historial",
      referral: "Referido",
      loadingLeaderboard: "Cargando clasificación",
      loadingHistory: "Cargando historial",
      loadingReferral: "Cargando referidos",
      loadingAgentStats: "Cargando estadísticas del agente",
      loadingModelMarkets: "Cargando mercados de modelos",
      loadingEvmMarket: "Cargando mercado EVM",
      debugTitle: "Apuesta Simple de Pelea",
      chain: "Cadena",
      currentMatch: "Partida actual",
      market: "Mercado",
      yesPool: "Pool SÍ",
      noPool: "Pool NO",
      refresh: "Actualizar",
      connectEvm: "Conectar EVM",
      wrongNet: "Red incorrecta",
      duels: "Duelos",
      models: "Modelos",
      modelMarkets: "Mercado de Modelos",
      leaderboardAndStats: "Ranking y Stats",
      addEvmWallet: "Agregar Billetera EVM",
      switchNetwork: "Cambiar Red",
      unmuteStream: "Activar sonido",
      muteStream: "Silenciar",
      source: "Fuente",
      waitingForStream: "Esperando transmisión…",
      trades: "Trades",
      orderBook: "Libro de Órdenes",
      matchLog: "Registro de Pelea",
      agents: "Agentes",
      positions: "Posiciones",
      pool: "Pool",
      side: "Lado",
      agent: "Agente",
      price: "Precio",
      amount: "Cantidad",
      age: "Tiempo",
      trader: "Trader",
      buy: "COMPRAR",
      sell: "VENDER",
      bids: (name: string) => `COMPRAS (${name})`,
      asks: (name: string) => `VENTAS (${name})`,
      spread: (value: number) => `Spread: ${value}%`,
      rank: "Rango",
      provider: "Proveedor",
      wins: "Victorias",
      losses: "Derrotas",
      winRate: "Tasa de Victoria",
      streak: "Racha",
      hp: "HP",
      wl: "V/D",
      dmg: "Daño",
      action: "ACC",
      thought: "PEN",
      result: "RESULTADO",
      winner: (name: string, reason: string | null | undefined) =>
        `¡${name} gana!${reason ? ` ${reason}` : ""}`,
      noOpenPositions: "Sin posiciones abiertas",
      tradingControls: "Controles de operación",
      closeTradingPanel: "Cerrar panel de operaciones",
      openTradingPanel: "Abrir panel de operaciones",
      placeBet: "Apostar",
      legalLead: "Al operar, aceptas nuestros",
      terms: "Términos",
      privacy: "Privacidad",
      round: (value: string) => `Ronda #${value}`,
      modelsStatus: (count: number) => `MERCADO DE MODELOS · ${count} modelos clasificados`,
      live: "EN VIVO",
      stable: "ESTABLE",
      synthetic: "SINTÉTICO",
      phaseLive: "EN VIVO",
      phaseStarting: (value: string | number | null) => `Iniciando ${value ?? ""}`,
      phaseResolved: "RESUELTO",
      phaseNextMatch: "SIGUIENTE PARTIDA",
      phaseIdle: "INACTIVO",
      bettingUnavailable: (cluster: string) =>
        `Las apuestas no están disponibles temporalmente en ${cluster}. Intenta de nuevo más tarde o cambia de cadena.`,
      record: (wins: number, losses: number) => `${wins}V-${losses}D`,
      streakValue: (value: number) => `${value}V`,
      level: (value: number) => ` · Nv.${value}`,
      statusOpen: "ABIERTO",
      statusResolved: "RESUELTO",
      statusPending: "PENDIENTE",
    };
  }

  return {
    points: "Points",
    leaderboard: "Leaderboard",
    history: "History",
    referral: "Referral",
    loadingLeaderboard: "Loading leaderboard",
    loadingHistory: "Loading history",
    loadingReferral: "Loading referral",
    loadingAgentStats: "Loading agent stats",
    loadingModelMarkets: "Loading model markets",
    loadingEvmMarket: "Loading EVM market",
    debugTitle: "Ultra Simple Fight Bet",
    chain: "Chain",
    currentMatch: "Current match",
    market: "Market",
    yesPool: "YES pool",
    noPool: "NO pool",
    refresh: "Refresh",
    connectEvm: "Connect EVM",
    wrongNet: "Wrong Net",
    duels: "Duels",
    models: "Models",
    modelMarkets: "Model Markets",
    leaderboardAndStats: "Leaderboard & Stats",
    addEvmWallet: "Add EVM Wallet",
    switchNetwork: "Switch Network",
    unmuteStream: "Unmute stream",
    muteStream: "Mute stream",
    source: "Source",
    waitingForStream: "Waiting for stream…",
    trades: "Trades",
    orderBook: "Order Book",
    matchLog: "Match Log",
    agents: "Agents",
    positions: "Positions",
    pool: "Pool",
    side: "Side",
    agent: "Agent",
    price: "Price",
    amount: "Amount",
    age: "Age",
    trader: "Trader",
    buy: "BUY",
    sell: "SELL",
    bids: (name: string) => `BIDS (${name})`,
    asks: (name: string) => `ASKS (${name})`,
    spread: (value: number) => `Spread: ${value}%`,
    rank: "Rank",
    provider: "Provider",
    wins: "Wins",
    losses: "Losses",
    winRate: "Win Rate",
    streak: "Streak",
    hp: "HP",
    wl: "W/L",
    dmg: "Dmg",
    action: "ACT",
    thought: "THK",
    result: "RESULT",
    winner: (name: string, reason: string | null | undefined) =>
      `${name} wins!${reason ? ` ${reason}` : ""}`,
    noOpenPositions: "No open positions",
    tradingControls: "Trading controls",
    closeTradingPanel: "Close trading panel",
    openTradingPanel: "Open trading panel",
    placeBet: "Place Bet",
    legalLead: "By trading, you agree to our",
    terms: "Terms",
    privacy: "Privacy",
    round: (value: string) => `Round #${value}`,
    modelsStatus: (count: number) => `MODELS MARKET · ${count} ranked models`,
    live: "LIVE",
    stable: "STABLE",
    synthetic: "SYNTHETIC",
    phaseLive: "LIVE",
    phaseStarting: (value: string | number | null) => `Starting ${value ?? ""}`,
    phaseResolved: "RESOLVED",
    phaseNextMatch: "NEXT MATCH",
    phaseIdle: "IDLE",
    bettingUnavailable: (cluster: string) =>
      `Betting is temporarily unavailable on ${cluster}. Please try again later or switch chain.`,
    record: (wins: number, losses: number) => `${wins}W-${losses}L`,
    streakValue: (value: number) => `${value}W`,
    level: (value: number) => ` · Lv.${value}`,
    statusOpen: "OPEN",
    statusResolved: "RESOLVED",
    statusPending: "PENDING",
  };
}

function getPhaseLabel(
  phase: string,
  countdown: string | number | null,
  copy: ReturnType<typeof getAppCopy>,
): string {
  if (phase === "FIGHTING") return copy.phaseLive;
  if (phase === "COUNTDOWN") return copy.phaseStarting(countdown);
  if (phase === "RESOLUTION") return copy.phaseResolved;
  if (phase === "ANNOUNCEMENT") return copy.phaseNextMatch;
  return copy.phaseIdle;
}

function getMarketStatusLabel(
  rawStatus: string | null | undefined,
  copy: ReturnType<typeof getAppCopy>,
): string {
  const normalized = rawStatus?.trim().toLowerCase();
  if (!normalized) return copy.statusPending;
  if (normalized === "open") return copy.statusOpen;
  if (normalized === "resolved") return copy.statusResolved;
  if (normalized === "pending" || normalized === "unavailable") {
    return copy.statusPending;
  }
  return rawStatus ?? copy.statusPending;
}

const EvmBettingPanel = lazy(() =>
  import("@hyperbet/ui/components/EvmBettingPanel").then((module) => ({
    default: module.EvmBettingPanel,
  })),
);
const EvmModelsMarketView = lazy(() =>
  import("@hyperbet/ui/components/EvmModelsMarketView").then((module) => ({
    default: module.EvmModelsMarketView,
  })),
);
const PointsLeaderboard = lazy(() =>
  import("@hyperbet/ui/components/PointsLeaderboard").then((module) => ({
    default: module.PointsLeaderboard,
  })),
);
const PointsHistory = lazy(() =>
  import("@hyperbet/ui/components/PointsHistory").then((module) => ({
    default: module.PointsHistory,
  })),
);
const ReferralPanel = lazy(() =>
  import("@hyperbet/ui/components/ReferralPanel").then((module) => ({
    default: module.ReferralPanel,
  })),
);
const AgentStats = lazy(() =>
  import("@hyperbet/ui/components/AgentStats").then((module) => ({
    default: module.AgentStats,
  })),
);

function PanelFallback({
  label,
  minHeight = 220,
}: {
  label: string;
  minHeight?: number;
}) {
  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "rgba(255,255,255,0.58)",
        textTransform: "uppercase",
        letterSpacing: 1,
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
}

export function App() {
  const { address: evmWalletAddress } = useAccount();
  const { activeChain, setActiveChain, availableChains } = useChain();
  const [locale, setLocale] = useState<UiLocale>(() => resolveUiLocale());
  const copy = useMemo(() => getAppCopy(locale), [locale]);
  const isE2eMode = import.meta.env.MODE === "e2e";
  const isE2eDebugMode =
    isE2eMode && new URLSearchParams(window.location.search).has("debug");
  const configuredHeadlessEvmAddress = useMemo(
    () =>
      normalizeEvmAddress(
        import.meta.env.VITE_E2E_EVM_ADDRESS ||
          import.meta.env.VITE_HEADLESS_EVM_ADDRESS ||
          "",
      ),
    [],
  );
  // Only poll chain data when a wallet is connected (saves unnecessary RPC calls for spectators).
  const shouldPollChainData = Boolean(isE2eMode || evmWalletAddress);
  const effectiveEvmWalletAddress =
    evmWalletAddress ?? configuredHeadlessEvmAddress;
  const pointsWalletAddress = effectiveEvmWalletAddress ?? null;
  const invitePlatformQuery = "evm" as const;

  const [surfaceMode, setSurfaceMode] = useState<"DUELS" | "MODELS">("DUELS");
  const [status, _setStatus] = useState<string>("");
  const [currentMatch, setCurrentMatch] = useState<DiscoveredMatch | null>(
    null,
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [_inviteCode, setInviteCode] = useState<string | null>(() =>
    getStoredInviteCode(),
  );
  const [selectedAgentForStats, _setSelectedAgentForStats] = useState<any>(null); // For agent stats modal
  const [isShowingStats, setIsShowingStats] = useState(false);
  const [streamSourceIndex, setStreamSourceIndex] = useState(0);
  const [showPointsDrawer, setShowPointsDrawer] = useState(false);

  // ── Resizable panels ─────────────────────────────────────────────────────
  // Track mobile breakpoint — inline resize styles must NOT apply on mobile
  // because they override CSS media-query layout (sidebar fixed sheet, etc.)
  const isMobile = useIsMobile(768);

  // Sidebar width (right column)
  const { size: sidebarWidthPx, startDrag: startSidebarDrag } = useResizePanel({
    initial: 320,
    min: 200,
    max: 640,
    storageKey: "hs-panel-sidebar",
  });
  // Bottom panel height
  const { size: bottomHeightPx, startDrag: startBottomDrag } = useResizePanel({
    initial: 240,
    min: 80,
    max: 560,
    storageKey: "hs-panel-bottom",
  });
  const [pointsDrawerTab, setPointsDrawerTab] = useState<
    "leaderboard" | "history" | "referral"
  >("leaderboard");
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const bettingDockInnerRef = useRef<HTMLDivElement | null>(null);

  const { state: streamingState } = useStreamingState();
  const { context: duelContext } = useDuelContext();
  const liveCycle = streamingState?.cycle ?? null;
  const lifecycleChainKey =
    activeChain === "bsc" || activeChain === "base" || activeChain === "avax"
      ? activeChain
      : "solana";
  const {
    duel: lifecycleDuel,
    market: lifecycleMarket,
    refresh: refreshLifecycle,
  } = usePredictionMarketLifecycle(
    lifecycleChainKey,
  );
  const streamSources = STREAM_URLS;
  const activeStreamUrl = isE2eMode ? "" : (streamSources[streamSourceIndex] ?? "");

  const handleLocaleChange = useCallback((nextLocale: UiLocale) => {
    setStoredUiLocale(nextLocale);
    setLocale(nextLocale);
  }, []);

  const switchToBackupStream = useCallback(() => {
    setStreamSourceIndex((current) =>
      current + 1 < streamSources.length ? current + 1 : current,
    );
  }, [streamSources.length]);

  const cycleStreamSource = useCallback(() => {
    setStreamSourceIndex((current) =>
      streamSources.length > 1 ? (current + 1) % streamSources.length : current,
    );
  }, [streamSources.length]);

  useEffect(() => {
    if (streamSourceIndex < streamSources.length) return;
    setStreamSourceIndex(0);
  }, [streamSourceIndex, streamSources.length]);

  useEffect(() => {
    captureInviteCodeFromLocation();
  }, []);

  useEffect(() => {
    document.documentElement.lang = getLocaleTag(locale);
  }, [locale]);

  useEffect(() => {
    if (!pointsWalletAddress) {
      setInviteCode(getStoredInviteCode());
      return;
    }

    let cancelled = false;

    const fetchInviteCode = async () => {
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/arena/invite/${pointsWalletAddress}?platform=${invitePlatformQuery}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { inviteCode?: string };
        if (!cancelled && payload.inviteCode?.trim()) {
          setInviteCode(payload.inviteCode.trim().toUpperCase());
        }
      } catch {
        // no-op: keep existing stored invite code fallback
      }
    };

    void fetchInviteCode();
    const id = window.setInterval(() => void fetchInviteCode(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [invitePlatformQuery, pointsWalletAddress]);

  useEffect(() => {
    const appRoot = appRootRef.current;
    if (!appRoot) return;

    if (isE2eDebugMode) {
      appRoot.style.setProperty("--betting-dock-height", "0px");
      return;
    }

    const dockInner = bettingDockInnerRef.current;
    if (!dockInner) return;

    const updateDockHeight = () => {
      const nextHeight = Math.ceil(dockInner.getBoundingClientRect().height);
      appRoot.style.setProperty("--betting-dock-height", `${nextHeight}px`);
    };

    updateDockHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateDockHeight())
        : null;
    resizeObserver?.observe(dockInner);
    window.addEventListener("resize", updateDockHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateDockHeight);
    };
  }, [isE2eDebugMode]);

  const fixedMatchId = getFixedMatchId();

  useEffect(() => {
    if (!shouldPollChainData) return;
    const id = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, DEFAULT_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [shouldPollChainData]);

  useEffect(() => {
    if (!shouldPollChainData) return;

    if (!liveCycle) {
      setCurrentMatch(null);
      return;
    }

    const parsedMatchId = Number.parseInt(liveCycle.duelId ?? "", 10);
    const matchId = Number.isFinite(parsedMatchId) ? parsedMatchId : fixedMatchId;
    if (fixedMatchId && matchId && matchId !== fixedMatchId) {
      setCurrentMatch(null);
      return;
    }

    const openTs = normalizeTimestamp(
      liveCycle.betOpenTime ?? Math.floor(Date.now() / 1000),
    );
    const closeTs = normalizeTimestamp(
      liveCycle.betCloseTime ??
      liveCycle.fightStartTime ??
      liveCycle.duelEndTime ??
      Math.floor(Date.now() / 1000),
    );
    const resolvedTs =
      liveCycle.phase === "RESOLUTION" && liveCycle.duelEndTime
        ? normalizeTimestamp(liveCycle.duelEndTime)
        : null;
    const winner =
      liveCycle.winnerName && liveCycle.agent1?.name === liveCycle.winnerName
        ? "YES"
        : liveCycle.winnerName && liveCycle.agent2?.name === liveCycle.winnerName
          ? "NO"
          : null;

    setCurrentMatch({
      matchId: matchId ?? 0,
      status: liveCycle.phase === "RESOLUTION" ? "resolved" : "open",
      openTs,
      closeTs,
      resolvedTs,
      winner,
      agent1Name: liveCycle.agent1?.name ?? "Agent A",
      agent2Name: liveCycle.agent2?.name ?? "Agent B",
    });
  }, [shouldPollChainData, liveCycle, fixedMatchId, refreshNonce]);

  const handleRefresh = () => {
    setRefreshNonce((value) => value + 1);
    window.dispatchEvent(new CustomEvent("hyperbet:market-refresh"));
  };

  const effYesPot = 0;
  const effNoPot = 0;
  const effYesPercent = 50;
  const effNoPercent = 50;
  const effChartData: { time: number; pct: number }[] = [];
  const effBids: { price: number; amount: number }[] = [];
  const effAsks: { price: number; amount: number }[] = [];
  const effRecentTrades: { id: string; side: "YES" | "NO"; amount: number; price: number; time: number; trader?: string }[] = [];
  const liveAgent1Name =
    liveCycle?.agent1?.name?.trim() && liveCycle.agent1.name.trim().length > 0
      ? liveCycle.agent1.name.trim()
      : null;
  const liveAgent2Name =
    liveCycle?.agent2?.name?.trim() && liveCycle.agent2.name.trim().length > 0
      ? liveCycle.agent2.name.trim()
      : null;
  const effAgent1Name = currentMatch?.agent1Name ?? liveAgent1Name ?? "Agent A";
  const effAgent2Name = currentMatch?.agent2Name ?? liveAgent2Name ?? "Agent B";

  const contextAgent1 = duelContext?.cycle.agent1 ?? null;
  const contextAgent2 = duelContext?.cycle.agent2 ?? null;

  // Agent context from live SSE + duel-context polling
  const effA1 = {
    id: "agent1",
    name: effAgent1Name,
    hp: contextAgent1?.hp ?? liveCycle?.agent1?.hp ?? 100,
    maxHp: contextAgent1?.maxHp ?? liveCycle?.agent1?.maxHp ?? 100,
    wins: contextAgent1?.wins ?? liveCycle?.agent1?.wins ?? 0,
    losses: contextAgent1?.losses ?? liveCycle?.agent1?.losses ?? 0,
    rank: 1,
    combatLevel:
      contextAgent1?.combatLevel ?? liveCycle?.agent1?.combatLevel ?? 1,
    provider: contextAgent1?.provider ?? liveCycle?.agent1?.provider ?? "",
    model: contextAgent1?.model ?? liveCycle?.agent1?.model ?? "",
    damageDealtThisFight:
      contextAgent1?.damageDealtThisFight ??
      liveCycle?.agent1?.damageDealtThisFight ??
      0,
    headToHeadWins: 0,
    headToHeadLosses: 0,
    inventory: contextAgent1?.inventory ?? [],
    monologues: (contextAgent1?.monologues ?? []) as {
      id: string;
      type: string;
      content: string;
      timestamp: number;
    }[],
  };
  const effA2 = {
    id: "agent2",
    name: effAgent2Name,
    hp: contextAgent2?.hp ?? liveCycle?.agent2?.hp ?? 100,
    maxHp: contextAgent2?.maxHp ?? liveCycle?.agent2?.maxHp ?? 100,
    wins: contextAgent2?.wins ?? liveCycle?.agent2?.wins ?? 0,
    losses: contextAgent2?.losses ?? liveCycle?.agent2?.losses ?? 0,
    rank: 2,
    combatLevel:
      contextAgent2?.combatLevel ?? liveCycle?.agent2?.combatLevel ?? 1,
    provider: contextAgent2?.provider ?? liveCycle?.agent2?.provider ?? "",
    model: contextAgent2?.model ?? liveCycle?.agent2?.model ?? "",
    damageDealtThisFight:
      contextAgent2?.damageDealtThisFight ??
      liveCycle?.agent2?.damageDealtThisFight ??
      0,
    headToHeadWins: 0,
    headToHeadLosses: 0,
    inventory: contextAgent2?.inventory ?? [],
    monologues: (contextAgent2?.monologues ?? []) as {
      id: string;
      type: string;
      content: string;
      timestamp: number;
    }[],
  };
  const effCycle = {
    cycleId: liveCycle?.cycleId ?? "cycle-0",
    phase: liveCycle?.phase ?? "IDLE",
    countdown: liveCycle?.countdown ?? null,
    winnerName: liveCycle?.winnerName ?? null,
    winReason: liveCycle?.winReason ?? null,
    timeRemaining: liveCycle?.timeRemaining ?? 0,
  };
  const effLeaderboard = streamingState?.leaderboard ?? [];
  const effTotalPool =
    (typeof effYesPot === "number" ? effYesPot : 0) +
    (typeof effNoPot === "number" ? effNoPot : 0);
  const effPhaseLabel = getPhaseLabel(effCycle.phase, effCycle.countdown, copy);

  const streamPhaseText = liveCycle?.phase ?? null;
  const marketStatusText = getMarketStatusLabel(
    lifecycleMarket?.lifecycleStatus ??
      currentMatch?.status ??
      streamPhaseText ??
      copy.phaseLive,
    copy,
  );
  const countdownText = liveCycle
    ? formatCountdown(normalizeRemainingSeconds(liveCycle.timeRemaining))
    : "";

  // Sidebar bet state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [hmBottomTab, setHmBottomTab] = useState<
    "positions" | "orders" | "trades" | "topTraders" | "holders" | "news"
  >("trades");
  const [hmMuted, setHmMuted] = useState(true);

  useEffect(() => {
    if (surfaceMode === "MODELS") {
      setIsSidebarOpen(false);
    }
  }, [surfaceMode]);

  return (
    <div className="hm-root" ref={appRootRef}>
      {/* Points / Leaderboard / Referral Drawer */}
      {showPointsDrawer && (
        <div
          data-testid="points-drawer-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
          onClick={() => setShowPointsDrawer(false)}
        >
          <div
            data-testid="points-drawer"
            style={{
              background:
                "linear-gradient(180deg, rgba(20,22,30,0.95) 0%, rgba(14,16,24,0.98) 100%)",
              backdropFilter: "blur(32px) saturate(1.4)",
              WebkitBackdropFilter: "blur(32px) saturate(1.4)",
              padding: 24,
              borderRadius: 2,
              border: "1px solid rgba(229,184,74,0.2)",
              width: "min(440px, calc(100vw - 32px))",
              maxHeight: "calc(100vh - 64px)",
              overflowY: "auto",
              boxShadow:
                "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(229,184,74,0.08), 0 0 0 1px rgba(0,0,0,0.5)",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glass highlight */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "30%",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
                pointerEvents: "none",
                borderRadius: "2px 2px 0 0",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 24,
                right: 24,
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, rgba(242,208,138,0.3), transparent)",
                pointerEvents: "none",
              }}
            />

            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
                position: "relative",
                zIndex: 2,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  fontFamily: "'Teko', sans-serif",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "#f2d08a",
                  textShadow: "0 0 8px rgba(242,208,138,0.3)",
                }}
              >
                {copy.points}
              </div>
              <button
                type="button"
                data-testid="points-drawer-close"
                onClick={() => setShowPointsDrawer(false)}
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--hm-stone-mid)",
                  borderRadius: 2,
                  color: "rgba(255,255,255,0.4)",
                  cursor: "pointer",
                  fontSize: 14,
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Tab Buttons */}
            <div
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 16,
                position: "relative",
                zIndex: 2,
              }}
            >
              {(
                [
                  { key: "leaderboard", label: copy.leaderboard },
                  { key: "history", label: copy.history },
                  { key: "referral", label: copy.referral },
                ] as const
              ).map((tab) => {
                const isActive = pointsDrawerTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    data-testid={`points-drawer-tab-${tab.key}`}
                    onClick={() =>
                      startTransition(() => setPointsDrawerTab(tab.key))
                    }
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: isActive
                        ? "1px solid rgba(242,208,138,0.35)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: isActive
                        ? "rgba(242,208,138,0.12)"
                        : "rgba(255,255,255,0.03)",
                      color: isActive ? "#f2d08a" : "rgba(255,255,255,0.5)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Non-compact points summary */}
            <div style={{ marginBottom: 16, position: "relative", zIndex: 2 }}>
              <PointsDisplay walletAddress={pointsWalletAddress} locale={locale} />
            </div>

            {/* Tab Content */}
            <div
              data-testid={`points-drawer-panel-${pointsDrawerTab}`}
              style={{
                position: "relative",
                zIndex: 1,
                maxHeight: "calc(100vh - 320px)",
                overflowY: "auto",
              }}
            >
              {pointsDrawerTab === "leaderboard" && (
                <Suspense
                  fallback={<PanelFallback label={copy.loadingLeaderboard} />}
                >
                  <PointsLeaderboard locale={locale} />
                </Suspense>
              )}
              {pointsDrawerTab === "history" && (
                <Suspense fallback={<PanelFallback label={copy.loadingHistory} />}>
                  <PointsHistory walletAddress={pointsWalletAddress} locale={locale} />
                </Suspense>
              )}
              {pointsDrawerTab === "referral" && (
                <Suspense fallback={<PanelFallback label={copy.loadingReferral} />}>
                  <ReferralPanel
                    activeChain={activeChain}
                    solanaWallet={null}
                    evmWallet={effectiveEvmWalletAddress ?? null}
                    locale={locale}
                    evmWalletPlatform={
                      activeChain === "bsc"
                        ? "BSC"
                        : activeChain === "base"
                          ? "BASE"
                          : activeChain === "avax"
                            ? "AVAX"
                            : null
                    }
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Agent Stats Modal */}
      {isShowingStats && selectedAgentForStats && (
        <div
          className="agent-stats-modal-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
          onClick={() => setIsShowingStats(false)}
        >
          <div
            style={{
              background:
                "linear-gradient(180deg, rgba(20,22,30,0.95) 0%, rgba(14,16,24,0.98) 100%)",
              backdropFilter: "blur(32px) saturate(1.4)",
              WebkitBackdropFilter: "blur(32px) saturate(1.4)",
              padding: 24,
              borderRadius: 2,
              border: "1px solid rgba(229,184,74,0.2)",
              width: 340,
              boxShadow:
                "0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(229,184,74,0.08), 0 0 0 1px rgba(0,0,0,0.5)",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glass highlight */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "40%",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
                pointerEvents: "none",
                borderRadius: "2px 2px 0 0",
              }}
            />
            {/* Top highlight line */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 24,
                right: 24,
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: 8,
                position: "relative",
                zIndex: 1,
              }}
            >
              <button
                onClick={() => setIsShowingStats(false)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  fontSize: 14,
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <Suspense
                fallback={
                  <PanelFallback label={copy.loadingAgentStats} minHeight={320} />
                }
              >
                <AgentStats
                  agent={selectedAgentForStats}
                  side={selectedAgentForStats.id === "YES" ? "left" : "right"}
                  locale={locale}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* We hide the verbose E2E slop by default unless a specific debug param is present. */}
      {isE2eDebugMode ? (
        <div
          style={{
            margin: "12px",
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            position: "relative",
            zIndex: 10,
          }}
        >
          <h1 style={{ margin: 0, fontSize: "18px" }}>
            {copy.debugTitle}
          </h1>
          <div
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
            data-testid="e2e-chain-picker"
          >
            <span>{copy.chain}:</span>
            <select
              data-testid="e2e-chain-select"
              value={activeChain}
              onChange={(event) =>
                setActiveChain(
                  event.target.value as "solana" | "bsc" | "base" | "avax",
                )
              }
            >
              {availableChains.map((chain) => (
                <option key={chain} value={chain}>
                  {chain.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div data-testid="e2e-active-chain">{activeChain}</div>
          <div data-testid="current-match-id">
            {copy.currentMatch}: {currentMatch?.matchId ?? "-"}
          </div>
          <div data-testid="market-status">{copy.market}: {marketStatusText}</div>
          <div data-testid="pool-totals">
            {copy.yesPool}: - GOLD | {copy.noPool}: - GOLD
          </div>
          <div data-testid="countdown">{countdownText}</div>
          <div data-testid="status">{status}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              data-testid="refresh-market"
              type="button"
              onClick={handleRefresh}
            >
              {copy.refresh}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── HM LAYOUT ──────────────────────────────────────────────────── */}

      {/* Header */}
      <header className="hm-header" role="banner">
        {isMobile ? (
          /* ── Mobile header: 2 compact rows ─────────────────────────────── */
          <>
            {/* Row 1: Brand + quick controls */}
            <div className="hm-header-mob-row1">
              <div className="hm-logo">
                <span className="hm-logo-text hm-logo-text--stacked">
                  HYPERSCAPE
                  <br />
                  DUEL ARENA
                </span>
              </div>
              <div className="hm-header-mob-controls">
                <LocaleSelector
                  locale={locale}
                  onChange={handleLocaleChange}
                  compact
                />
                <button
                  type="button"
                  className="hm-header-mob-icon-btn"
                  title={copy.leaderboardAndStats}
                  data-testid="points-drawer-open"
                  onClick={() => setShowPointsDrawer(true)}
                >
                  🏆
                </button>
                <ConnectButton.Custom>
                  {({
                    openConnectModal,
                    openAccountModal,
                    openChainModal,
                    account,
                    chain,
                    mounted,
                  }) => {
                    if (!mounted || !account)
                      return (
                        <button
                          type="button"
                          className="hm-header-mob-wallet-btn"
                          onClick={openConnectModal}
                        >
                          {copy.connectEvm}
                        </button>
                      );
                    if (chain?.unsupported)
                      return (
                        <button
                          type="button"
                          className="hm-header-mob-wallet-btn"
                          onClick={openChainModal}
                        >
                          ⚠ {copy.wrongNet}
                        </button>
                      );
                    return (
                      <button
                        type="button"
                        className="hm-header-mob-wallet-btn hm-header-mob-wallet-btn--linked"
                        onClick={openAccountModal}
                      >
                        ⬡ {account.displayName?.slice(0, 6) ?? "EVM"}
                      </button>
                    );
                  }}
                </ConnectButton.Custom>
              </div>
            </div>
            {/* Row 2: Match strip — name + agent side-select chips */}
            <div className="hm-header-mob-row2">
              <div className="hm-view-tabs hm-view-tabs--mobile">
                <button
                  data-testid="surface-mode-duels"
                  className={`hm-view-tab ${surfaceMode === "DUELS" ? "hm-view-tab--active" : ""}`}
                  onClick={() => startTransition(() => setSurfaceMode("DUELS"))}
                  type="button"
                >
                  {copy.duels}
                </button>
                <button
                  data-testid="surface-mode-models"
                  className={`hm-view-tab ${surfaceMode === "MODELS" ? "hm-view-tab--active" : ""}`}
                  onClick={() =>
                    startTransition(() => setSurfaceMode("MODELS"))
                  }
                  type="button"
                >
                  {copy.models}
                </button>
              </div>
              {surfaceMode === "DUELS" ? (
                <span className="hm-market-name">
                  {effA1.name} vs {effA2.name}
                </span>
              ) : (
                <div className="hm-mode-summary hm-mode-summary--mobile">
                  <span className="hm-market-name">{copy.modelMarkets}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── Desktop header: original layout ───────────────────────────── */
          <>
            <div className="hm-header-left">
              <div className="hm-logo">
                <span className="hm-logo-text">HYPERSCAPE DUEL ARENA</span>
              </div>
              <div className="hm-view-tabs hm-view-tabs--header">
                <button
                  data-testid="surface-mode-duels"
                  className={`hm-view-tab ${surfaceMode === "DUELS" ? "hm-view-tab--active" : ""}`}
                  onClick={() => startTransition(() => setSurfaceMode("DUELS"))}
                  type="button"
                >
                  {copy.duels}
                </button>
                <button
                  data-testid="surface-mode-models"
                  className={`hm-view-tab ${surfaceMode === "MODELS" ? "hm-view-tab--active" : ""}`}
                  onClick={() =>
                    startTransition(() => setSurfaceMode("MODELS"))
                  }
                  type="button"
                >
                  {copy.models}
                </button>
              </div>

              {surfaceMode === "DUELS" ? (
                <div className="hm-market-info">
                  <span className="hm-market-name">
                    {effA1.name} vs {effA2.name}
                  </span>
                </div>
              ) : (
                <div className="hm-mode-summary">
                  <span className="hm-market-name">{copy.modelMarkets}</span>
                </div>
              )}
            </div>

            <div className="hm-header-right">
              <LocaleSelector locale={locale} onChange={handleLocaleChange} />
              <PointsDisplay
                walletAddress={pointsWalletAddress}
                compact
                locale={locale}
              />
              <button
                type="button"
                className="dock-collapse-btn"
                title={copy.leaderboardAndStats}
                data-testid="points-drawer-open"
                onClick={() => setShowPointsDrawer(true)}
                style={{ fontSize: 16 }}
              >
                🏆
              </button>
              <ConnectButton.Custom>
                {({
                  openConnectModal,
                  openAccountModal,
                  openChainModal,
                  account,
                  chain,
                  mounted,
                }) => {
                  if (!mounted || !account)
                    return (
                      <button
                        type="button"
                        className="hm-wallet-btn"
                        onClick={openConnectModal}
                      >
                        {copy.addEvmWallet}
                      </button>
                    );
                  if (chain?.unsupported)
                    return (
                      <button
                        type="button"
                        className="hm-wallet-btn"
                        onClick={openChainModal}
                      >
                        {copy.switchNetwork}
                      </button>
                    );
                  return (
                    <button
                      type="button"
                      className="hm-wallet-btn hm-wallet-btn--linked"
                      onClick={openAccountModal}
                    >
                      EVM {account.displayName}
                    </button>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </>
        )}
      </header>

      {surfaceMode === "MODELS" ? (
        <div className="hm-main hm-main--models">
          <div className="hm-models-main">
            <Suspense
              fallback={
                <PanelFallback label={copy.loadingModelMarkets} minHeight={480} />
              }
            >
              <EvmModelsMarketView
                fightingAgentA={effA1.name}
                fightingAgentB={effA2.name}
                gameApiUrl={GAME_API_URL}
                chainLabel="BSC"
                collateralSymbol="BNB"
              />
            </Suspense>
          </div>
        </div>
      ) : (
        <>
          {/* Main Content */}
          <div className="hm-main">
            <div className="hm-content">
              <div className="hm-viewport-row">
                {/* Phase status strip — only rendered on mobile, sits above the video */}
                {isMobile && (
                  <div className="hm-mob-phase-strip">
                    <span
                      className={`hm-phase-badge hm-phase-badge--${effCycle.phase.toLowerCase()}`}
                    >
                      {effPhaseLabel}
                    </span>
                    <span className="hm-mob-phase-strip-meta">
                      {effA1.name} vs {effA2.name}
                    </span>
                  </div>
                )}

                {/* Game Viewport */}
                <div className="hm-game-viewport">
                  {activeStreamUrl ? (
                    <>
                      <StreamPlayer
                        streamUrl={activeStreamUrl}
                        muted={hmMuted}
                        autoPlay={true}
                        onStreamUnavailable={switchToBackupStream}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                        }}
                      />
                      <div className="hm-stream-controls">
                        <button
                          className="hm-stream-mute-btn"
                          onClick={() => setHmMuted((m) => !m)}
                          type="button"
                          aria-label={hmMuted ? copy.unmuteStream : copy.muteStream}
                        >
                          {hmMuted ? (
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                              <line x1="23" y1="9" x2="17" y2="15" />
                              <line x1="17" y1="9" x2="23" y2="15" />
                            </svg>
                          ) : (
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                          )}
                        </button>
                        {streamSources.length > 1 && (
                          <button
                            className="hm-stream-source-btn"
                            onClick={cycleStreamSource}
                            type="button"
                          >
                            {copy.source} {streamSourceIndex + 1}/
                            {streamSources.length}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="hm-game-placeholder">
                      <div className="hm-game-bg" />
                      <span className="hm-game-waiting">
                        {copy.waitingForStream}
                      </span>
                    </div>
                  )}
                </div>

                {/* Odds Chart */}
                <div className="hm-chart-panel">
                  <div className="hm-chart-toolbar">
                    <button className="hm-chart-tool-btn" type="button">
                      +
                    </button>
                    <button className="hm-chart-tool-btn" type="button">
                      &#9881;
                    </button>
                    <button className="hm-chart-tool-btn" type="button">
                      &#9634;
                    </button>
                  </div>
                  <div className="hm-chart-price-label">
                    <span className="hm-chart-price-current">
                      {(effYesPercent / 100).toFixed(1)}
                    </span>
                  </div>
                  <div className="hm-chart-container">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={effChartData}>
                        <XAxis
                          dataKey="time"
                          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          tickFormatter={(v: number) => {
                            const d = new Date(v);
                            return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
                          }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          width={40}
                          tickFormatter={(v: number) => `${v}%`}
                        />
                        <Tooltip
                          content={({ active, payload }) =>
                            active && payload?.length ? (
                              <div className="hm-chart-tooltip">
                                <span>{payload[0].value}%</span>
                              </div>
                            ) : null
                          }
                        />
                        <ReferenceLine
                          y={50}
                          stroke="rgba(255,255,255,0.06)"
                          strokeDasharray="4 4"
                        />
                        <Line
                          type="monotone"
                          dataKey="pct"
                          stroke="#e5b84a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <ResizeHandle
                direction="v"
                onMouseDown={(e) => startBottomDrag(e, "y", true)}
              />

              {/* Bottom Panel */}
              <div
                className="hm-bottom-panel"
                style={isMobile ? undefined : { height: bottomHeightPx }}
              >
                <nav className="hm-bottom-tabs" role="tablist">
                  {(
                    [
                      ["trades", copy.trades],
                      ["orders", copy.orderBook],
                      ["positions", copy.positions],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      data-testid={`duels-bottom-tab-${key}`}
                      aria-selected={hmBottomTab === key}
                      className={`hm-bottom-tab ${hmBottomTab === key ? "hm-bottom-tab--active" : ""}`}
                      onClick={() => setHmBottomTab(key)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {hmBottomTab === "trades" && (
                  <div
                    className="hm-trades-panel"
                    role="tabpanel"
                    data-testid="duels-bottom-panel-trades"
                  >
                    <div className="hm-trades-summary">
                      <span>
                        {copy.pool} <strong>{formatGold(effTotalPool, locale)}</strong>
                      </span>
                      <span>
                        {effA1.name} <strong>{effYesPercent}%</strong>
                      </span>
                      <span>
                        {effA2.name} <strong>{effNoPercent}%</strong>
                      </span>
                      <span>
                        {copy.trades} <strong>{effRecentTrades.length}</strong>
                      </span>
                    </div>
                    <div className="hm-trades-table-wrap">
                      <table className="hm-trades-table" role="grid">
                        <thead>
                          <tr>
                            <th>{copy.side}</th>
                            <th>{copy.agent}</th>
                            <th>{copy.price}</th>
                            <th>{copy.amount}</th>
                            <th>{copy.age}</th>
                            <th>{copy.trader}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {effRecentTrades.map((trade, i) => (
                            <tr key={trade.id ?? i}>
                              <td>
                                <span
                                  className={`hm-type-label ${trade.side === "YES" ? "hm-type-label--buy" : "hm-type-label--sell"}`}
                                >
                                  {trade.side === "YES" ? copy.buy : copy.sell}
                                </span>
                              </td>
                              <td>
                                <span className="hm-outcome-badge">
                                  {trade.side === "YES"
                                    ? effA1.name
                                    : effA2.name}
                                </span>
                              </td>
                              <td className="hm-td-mono">
                                {(trade.price ?? 0).toFixed(2)}
                              </td>
                              <td className="hm-td-mono">
                                {formatGold(trade.amount ?? 0, locale)}
                              </td>
                              <td className="hm-td-dim">
                                {formatTimeAgo(trade.time ?? Date.now(), locale)}
                              </td>
                              <td className="hm-td-trader">
                                <span className="hm-trader-addr">
                                  {truncateAddr(trade.trader ?? "")}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {hmBottomTab === "orders" && (
                  <div
                    className="hm-trades-panel"
                    role="tabpanel"
                    data-testid="duels-bottom-panel-orders"
                  >
                    <div className="hm-orderbook">
                      <div className="hm-ob-side hm-ob-side--bids">
                        <div className="hm-ob-header">{copy.bids(effA1.name)}</div>
                        {effBids.map((level, i) => (
                          <div
                            key={`bid-${i}`}
                            className="hm-ob-row hm-ob-row--bid"
                          >
                            <span className="hm-ob-price">
                              {level.price.toFixed(2)}
                            </span>
                            <span className="hm-ob-amount">
                              {formatGold(level.amount, locale)}
                            </span>
                            <div
                              className="hm-ob-depth"
                              style={{
                                width: `${Math.min(100, (level.amount / (effTotalPool || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="hm-ob-spread">
                        <span>{copy.spread(Math.abs(effYesPercent - effNoPercent))}</span>
                      </div>
                      <div className="hm-ob-side hm-ob-side--asks">
                        <div className="hm-ob-header">{copy.asks(effA2.name)}</div>
                        {effAsks.map((level, i) => (
                          <div
                            key={`ask-${i}`}
                            className="hm-ob-row hm-ob-row--ask"
                          >
                            <span className="hm-ob-price">
                              {level.price.toFixed(2)}
                            </span>
                            <span className="hm-ob-amount">
                              {formatGold(level.amount, locale)}
                            </span>
                            <div
                              className="hm-ob-depth hm-ob-depth--ask"
                              style={{
                                width: `${Math.min(100, (level.amount / (effTotalPool || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}


                {hmBottomTab === "positions" && (
                  <div
                    className="hm-empty-tab"
                    role="tabpanel"
                    data-testid="duels-bottom-panel-positions"
                  >
                    <p>{copy.noOpenPositions}</p>
                  </div>
                )}
              </div>
            </div>

            <ResizeHandle
              direction="h"
              onMouseDown={(e) => startSidebarDrag(e, "x", true)}
            />

            {/* ── RIGHT SIDEBAR: Real betting or mock controls ──────────────── */}
            <aside
              className={`hm-sidebar${isSidebarOpen ? " hm-sidebar--open" : ""}`}
              aria-label={copy.tradingControls}
              style={
                isMobile
                  ? undefined
                  : { width: sidebarWidthPx, minWidth: sidebarWidthPx }
              }
            >
              {/* Agent matchup header — close button lives here so it never floats over agent names */}
              <div className="hm-matchup-header">
                <span className="hm-matchup-label">{copy.currentMatch}</span>
                <div className="hm-matchup-header-right">
                  <span
                    className={`hm-phase-badge hm-phase-badge--${effCycle.phase.toLowerCase()} hm-phase-badge--sm`}
                  >
                    {effPhaseLabel}
                  </span>
                  <button
                    className="hm-sidebar-close"
                    type="button"
                    aria-label={copy.closeTradingPanel}
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    ×
                  </button>
                </div>
              </div>


              {/* Market type tabs + betting panels */}
              <div className="hm-market-panel-wrap">
                {/* Active market panel */}
                <div className="hm-market-panel-body">
                  <Suspense
                    fallback={
                      <PanelFallback
                        label={copy.loadingEvmMarket}
                        minHeight={360}
                      />
                    }
                  >
                    <EvmBettingPanel
                      agent1Name={effAgent1Name}
                      agent2Name={effAgent2Name}
                      compact
                      locale={locale}
                      lifecycleDuelOverride={lifecycleDuel}
                      lifecycleMarketOverride={lifecycleMarket}
                      onLifecycleRefreshRequested={() => void refreshLifecycle()}
                    />
                  </Suspense>
                </div>
              </div>

              <p className="hm-legal-text">
                {copy.legalLead} <a href="#terms">{copy.terms}</a> &amp;{" "}
                <a href="#privacy">{copy.privacy}</a>
              </p>
            </aside>
          </div>

          {/* Mobile FAB — opens the sidebar sheet */}
          {!isSidebarOpen && (
            <button
              className="hm-bet-fab"
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label={copy.openTradingPanel}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {copy.placeBet}
            </button>
          )}

          {/* Backdrop — close sidebar when tapping outside */}
          {isSidebarOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 48,
                background: "rgba(0,0,0,0.5)",
                backdropFilter: "blur(2px)",
              }}
              onClick={() => setIsSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
        </>
      )}

      {/* Status bar */}
      <footer className="hm-statusbar" role="contentinfo">
        <span className="hm-statusbar-link">
          {surfaceMode === "DUELS"
            ? `${effA1.name} vs ${effA2.name} · ${copy.round(effCycle.cycleId.split("-").pop() ?? "0")}`
            : copy.modelsStatus(effLeaderboard.length)}
        </span>
        <div className="hm-statusbar-right">
          <span className="hm-status-indicator" />
          <span>
            {surfaceMode === "DUELS"
              ? effCycle.phase === "FIGHTING"
                ? copy.live
                : copy.stable
              : copy.synthetic}
          </span>
        </div>
      </footer>
    </div>
  );
}
