import type {
  BettingChainKey,
  PredictionMarketLifecycleRecord,
  PredictionMarketLifecycleStatus,
  PredictionMarketWinner,
} from "@hyperbet/chain-registry";
import { isPredictionMarketQuotableStatus } from "@hyperbet/chain-registry";

export interface MarketMakerConfig {
  targetSpreadBps: number;
  toxicSpreadMultiplier: number;
  toxicityThresholdBps: number;
  toxicUnitReductionBps: number;
  minQuotePrice: number;
  maxQuotePrice: number;
  minQuoteUnits: number;
  maxQuoteUnits: number;
  maxInventoryPerSide: number;
  maxNetExposure: number;
  maxGrossExposure: number;
  maxSideImbalanceBps: number;
  maxDrawdownBps: number;
  staleStreamAfterMs: number;
  staleOracleAfterMs: number;
  staleRpcAfterMs: number;
  minRefreshIntervalMs: number;
  maxQuoteAgeMs: number;
  betCloseGuardMs: number;
  inventorySkewBps: number;
}

export interface MarketHealthSnapshot {
  chainKey: BettingChainKey;
  duelKey: string | null;
  marketRef: string | null;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  inventoryYes: number;
  inventoryNo: number;
  openOrderCount: number;
  quoteAgeMs: number | null;
  drawdownBps: number;
  lastStreamAtMs: number | null;
  lastOracleAtMs: number | null;
  lastRpcAtMs: number | null;
  circuitBreaker: CircuitBreakerState;
}

export interface QuotePlacementResult {
  orderId: string;
  txRef: string | null;
  placedAtMs: number;
}

export interface MarketAdapter {
  discoverOpenMarket(): Promise<MarketSnapshot | null>;
  getMarketSnapshot(duelKey: string, marketRef: string): Promise<MarketSnapshot>;
  placeQuote(
    duelKey: string,
    side: "BID" | "ASK",
    price: number,
    units: number,
  ): Promise<QuotePlacementResult>;
  cancelQuote(duelKey: string, orderId: string): Promise<void>;
  syncMarket(duelKey: string): Promise<void>;
  claim(duelKey: string): Promise<void>;
  getOpenOrders(duelKey: string): Promise<readonly string[]>;
  getPosition(duelKey: string): Promise<MarketExposure>;
  health(): Promise<MarketHealthSnapshot>;
}

export interface MarketExposure {
  yes: number;
  no: number;
  openYes: number;
  openNo: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  drawdownBps?: number;
}

export interface MarketSnapshot {
  chainKey: BettingChainKey;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  duelKey: string | null;
  marketRef: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  betCloseTimeMs?: number | null;
  lastStreamAtMs?: number | null;
  lastOracleAtMs?: number | null;
  lastRpcAtMs?: number | null;
  quoteAgeMs?: number | null;
  exposure: MarketExposure;
}

export interface FairValueInput {
  bookBid?: number | null;
  bookAsk?: number | null;
  signalPrice?: number | null;
  signalWeight?: number | null;
  fallbackPrice?: number;
  inventorySkew?: number;
  inventorySkewBps?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface CircuitBreakerState {
  active: boolean;
  reason: string | null;
}

export interface RiskState {
  yesExposure: number;
  noExposure: number;
  grossExposure: number;
  netExposure: number;
  sideImbalanceBps: number;
  drawdownBps: number;
  toxicityBps: number;
  staleStream: boolean;
  staleOracle: boolean;
  staleRpc: boolean;
  closingSoon: boolean;
  reduceOnly: boolean;
  canBid: boolean;
  canAsk: boolean;
  circuitBreaker: CircuitBreakerState;
}

export interface QuotePlan {
  fairValue: number;
  bidPrice: number | null;
  askPrice: number | null;
  bidUnits: number;
  askUnits: number;
  replaceQuotes: boolean;
  risk: RiskState;
}

export interface ManagedQuoteState {
  price: number;
  units: number;
  placedAtMs: number;
}

export interface QuoteDecision {
  side: "BID" | "ASK";
  targetPrice: number | null;
  targetUnits: number;
  shouldCancel: boolean;
  shouldPlace: boolean;
  shouldKeep: boolean;
  reason: string | null;
}

export interface AgentActionTrace {
  actor: string;
  action: string;
  chainKey: BettingChainKey;
  duelKey: string | null;
  marketRef: string | null;
  price: number | null;
  units: number | null;
  txRef: string | null;
  ok: boolean;
  message?: string;
}

export interface MitigationGate {
  name: string;
  passed: boolean;
  reason: string | null;
}

export interface KeeperRecoveryState {
  code: string;
  active: boolean;
  sinceMs: number | null;
  untilMs: number | null;
  details: string | null;
}

export interface KeeperMarketHealthRecord {
  chainKey: BettingChainKey;
  duelId: string | null;
  duelKey: string | null;
  marketRef: string | null;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  winner: PredictionMarketWinner;
  fairValue: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  bidUnits: number;
  askUnits: number;
  openOrderCount: number;
  inventoryYes: number;
  inventoryNo: number;
  openYes: number;
  openNo: number;
  netExposure: number;
  grossExposure: number;
  drawdownBps: number;
  quoteAgeMs: number | null;
  lastStreamAtMs: number | null;
  lastOracleAtMs: number | null;
  lastRpcAtMs: number | null;
  circuitBreakerReason: string | null;
  lastResolvedAtMs: number | null;
  lastClaimAtMs: number | null;
  recovery: string[];
}

export type KeeperParityBundleState =
  | "preparing"
  | "awaiting_confirmations"
  | "open"
  | "locked"
  | "resolved"
  | "cancelled"
  | "frozen"
  | "aborted";

export interface KeeperParityChainReceipt {
  chainKey: BettingChainKey;
  preparedAtMs: number | null;
  openedAtMs: number | null;
  lockedAtMs: number | null;
  resolvedAtMs: number | null;
  cancelledAtMs: number | null;
  confirmedAtMs: number | null;
  lifecycleStatus: PredictionMarketLifecycleStatus | null;
  txRef: string | null;
  note: string | null;
}

export interface KeeperMarketParitySnapshot {
  bundleId: string;
  duelKey: string | null;
  duelId: string | null;
  revision: number;
  requiredChains: BettingChainKey[];
  confirmedChains: BettingChainKey[];
  state: KeeperParityBundleState;
  phase: string | null;
  safeToBet: boolean;
  openedAtMs: number | null;
  lockedAtMs: number | null;
  resolvedAtMs: number | null;
  freezeReason: string | null;
  updatedAtMs: number;
  receipts: KeeperParityChainReceipt[];
}

export interface KeeperBotHealthSnapshot {
  chainKey: BettingChainKey;
  updatedAtMs: number;
  bootedAtMs: number;
  running: boolean;
  processId: number | null;
  lastSuccessfulRpcAtMs: number | null;
  recovery: KeeperRecoveryState[];
  markets: KeeperMarketHealthRecord[];
  marketParity?: KeeperMarketParitySnapshot | null;
}

export interface PredictionMarketStatusRecord
  extends PredictionMarketLifecycleRecord {
  health: KeeperMarketHealthRecord | null;
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  family: string;
  seed: string;
  chainKey: BettingChainKey;
  attackerPnl: number;
  marketMakerPnl: number;
  maxDrawdownBps: number;
  peakInventory: number;
  quoteUptimeRatio: number;
  spreadWidthBps: number;
  orderChurn: number;
  lockTransitionLatencyMs: number | null;
  resolvedCorrectly: boolean;
  claimCorrectly: boolean;
  passed: boolean;
  degraded: boolean;
  gates: MitigationGate[];
  traces: AgentActionTrace[];
}

export function mergePredictionMarketsWithHealth(
  records: readonly PredictionMarketLifecycleRecord[],
  botHealth: KeeperBotHealthSnapshot | null,
): PredictionMarketStatusRecord[] {
  return records.map((record) => {
    const health =
      botHealth?.markets.find(
        (candidate) =>
          candidate.chainKey === record.chainKey &&
          ((candidate.marketRef != null &&
            record.marketRef != null &&
            candidate.marketRef === record.marketRef) ||
            (candidate.duelKey != null &&
              record.duelKey != null &&
              candidate.duelKey === record.duelKey)),
      ) ?? null;
    return {
      ...record,
      health,
    };
  });
}

export const DEFAULT_MARKET_MAKER_CONFIG: MarketMakerConfig = {
  targetSpreadBps: 200,
  toxicSpreadMultiplier: 2,
  toxicityThresholdBps: 1000,
  toxicUnitReductionBps: 5_000,
  minQuotePrice: 1,
  maxQuotePrice: 999,
  minQuoteUnits: 25,
  maxQuoteUnits: 100,
  maxInventoryPerSide: 500_000,
  maxNetExposure: 250_000,
  maxGrossExposure: 750_000,
  maxSideImbalanceBps: 6_000,
  maxDrawdownBps: 2_000,
  staleStreamAfterMs: 3_000,
  staleOracleAfterMs: 5_000,
  staleRpcAfterMs: 5_000,
  minRefreshIntervalMs: 1_000,
  maxQuoteAgeMs: 12_000,
  betCloseGuardMs: 5_000,
  inventorySkewBps: 750,
};

export function clampPrice(
  value: number,
  min = DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
  max = DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function computeBookMid(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(bestBid) ||
    !Number.isFinite(bestAsk) ||
    bestBid == null ||
    bestAsk == null ||
    bestBid <= 0 ||
    bestAsk <= 0 ||
    bestAsk < bestBid
  ) {
    return null;
  }
  return (bestBid + bestAsk) / 2;
}

export function computeToxicityBps(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number {
  const mid = computeBookMid(bestBid, bestAsk);
  if (!mid || mid <= 0 || bestBid == null || bestAsk == null) {
    return 10_000;
  }
  return Math.round(((bestAsk - bestBid) * 10_000) / mid);
}

export function computeInventorySkew(exposure: MarketExposure): number {
  const yesExposure = exposure.yes + exposure.openYes;
  const noExposure = exposure.no + exposure.openNo;
  const denominator = Math.max(1, yesExposure + noExposure);
  return (yesExposure - noExposure) / denominator;
}

export function computeFairValue(input: FairValueInput): number {
  const fallbackPrice = clampPrice(input.fallbackPrice ?? 500);
  const bookMid = computeBookMid(input.bookBid ?? null, input.bookAsk ?? null);
  const signalPrice = Number.isFinite(input.signalPrice)
    ? clampPrice(
        Number(input.signalPrice),
        input.minPrice ?? DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
        input.maxPrice ?? DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
      )
    : null;
  const signalWeight = Math.min(
    1,
    Math.max(0, Number.isFinite(input.signalWeight) ? Number(input.signalWeight) : 0),
  );

  let fairValue = fallbackPrice;
  if (bookMid != null && signalPrice != null) {
    fairValue = bookMid * (1 - signalWeight) + signalPrice * signalWeight;
  } else if (bookMid != null) {
    fairValue = bookMid;
  } else if (signalPrice != null) {
    fairValue = signalPrice;
  }

  const skew = Math.max(-1, Math.min(1, input.inventorySkew ?? 0));
  const inventorySkewBps = Math.max(0, input.inventorySkewBps ?? 0);
  const inventoryShift = (fairValue * inventorySkewBps * skew) / 10_000;
  return clampPrice(
    fairValue - inventoryShift,
    input.minPrice ?? DEFAULT_MARKET_MAKER_CONFIG.minQuotePrice,
    input.maxPrice ?? DEFAULT_MARKET_MAKER_CONFIG.maxQuotePrice,
  );
}

export function buildRiskState(
  snapshot: MarketSnapshot,
  config: MarketMakerConfig = DEFAULT_MARKET_MAKER_CONFIG,
  now = Date.now(),
): RiskState {
  const yesExposure = snapshot.exposure.yes + snapshot.exposure.openYes;
  const noExposure = snapshot.exposure.no + snapshot.exposure.openNo;
  const grossExposure = yesExposure + noExposure;
  const netExposure = yesExposure - noExposure;
  const sideImbalanceBps =
    grossExposure > 0
      ? Math.round((Math.abs(netExposure) * 10_000) / Math.max(1, grossExposure))
      : 0;
  const drawdownBps = Math.max(0, snapshot.exposure.drawdownBps ?? 0);
  const staleStream =
    snapshot.lastStreamAtMs == null || now - snapshot.lastStreamAtMs > config.staleStreamAfterMs;
  const staleOracle =
    snapshot.lastOracleAtMs == null || now - snapshot.lastOracleAtMs > config.staleOracleAfterMs;
  const staleRpc =
    snapshot.lastRpcAtMs == null || now - snapshot.lastRpcAtMs > config.staleRpcAfterMs;
  const closingSoon =
    snapshot.betCloseTimeMs != null &&
    snapshot.betCloseTimeMs - now <= config.betCloseGuardMs;
  const toxicityBps = computeToxicityBps(snapshot.bestBid, snapshot.bestAsk);
  const marketNotionalLimited =
    grossExposure >= Math.max(config.maxGrossExposure, config.maxQuoteUnits);
  const bidImbalanceLimited =
    netExposure > 0 && sideImbalanceBps >= config.maxSideImbalanceBps;
  const askImbalanceLimited =
    netExposure < 0 && sideImbalanceBps >= config.maxSideImbalanceBps;

  let reason: string | null = null;
  if (!isPredictionMarketQuotableStatus(snapshot.lifecycleStatus)) {
    reason = `market:${snapshot.lifecycleStatus.toLowerCase()}`;
  } else if (closingSoon) {
    reason = "bet-close-guard";
  } else if (staleStream) {
    reason = "stale-stream";
  } else if (staleOracle) {
    reason = "stale-oracle";
  } else if (staleRpc) {
    reason = "stale-rpc";
  } else if (drawdownBps >= config.maxDrawdownBps) {
    reason = "drawdown-limit";
  } else if (marketNotionalLimited) {
    reason = "market-notional-limit";
  }

  const canBid =
    yesExposure < config.maxInventoryPerSide &&
    netExposure < config.maxNetExposure &&
    !bidImbalanceLimited &&
    reason == null;
  const canAsk =
    noExposure < config.maxInventoryPerSide &&
    -netExposure < config.maxNetExposure &&
    !askImbalanceLimited &&
    reason == null;

  return {
    yesExposure,
    noExposure,
    grossExposure,
    netExposure,
    sideImbalanceBps,
    drawdownBps,
    toxicityBps,
    staleStream,
    staleOracle,
    staleRpc,
    closingSoon,
    reduceOnly:
      reason == null &&
      ((bidImbalanceLimited && canAsk) || (askImbalanceLimited && canBid)),
    canBid,
    canAsk,
    circuitBreaker: {
      active: reason != null,
      reason,
    },
  };
}

function clampQuoteUnits(
  requestedUnits: number,
  minQuoteUnits: number,
  limits: number[],
): number {
  const boundedUnits = Math.floor(
    Math.min(requestedUnits, ...limits.map((value) => Math.max(0, value))),
  );
  return boundedUnits >= minQuoteUnits ? boundedUnits : 0;
}

export function buildQuotePlan(
  snapshot: MarketSnapshot,
  signal: Pick<FairValueInput, "signalPrice" | "signalWeight"> = {},
  config: MarketMakerConfig = DEFAULT_MARKET_MAKER_CONFIG,
  now = Date.now(),
): QuotePlan {
  const risk = buildRiskState(snapshot, config, now);
  const fairValue = computeFairValue({
    bookBid: snapshot.bestBid,
    bookAsk: snapshot.bestAsk,
    signalPrice: signal.signalPrice,
    signalWeight: signal.signalWeight,
    fallbackPrice: 500,
    inventorySkew: computeInventorySkew(snapshot.exposure),
    inventorySkewBps: config.inventorySkewBps,
    minPrice: config.minQuotePrice,
    maxPrice: config.maxQuotePrice,
  });

  if (risk.circuitBreaker.active) {
    return {
      fairValue,
      bidPrice: null,
      askPrice: null,
      bidUnits: 0,
      askUnits: 0,
      replaceQuotes: true,
      risk,
    };
  }

  let quoteWidth = Math.max(
    5,
    Math.ceil((config.targetSpreadBps * fairValue) / 10_000),
  );
  if (risk.toxicityBps >= config.toxicityThresholdBps) {
    quoteWidth *= Math.max(1, config.toxicSpreadMultiplier);
  }

  const inventoryHeadroomRatio = Math.max(
    0,
    1 -
      Math.max(risk.yesExposure, risk.noExposure) /
        Math.max(1, config.maxInventoryPerSide),
  );
  const grossHeadroomRatio = Math.max(
    0,
    1 - risk.grossExposure / Math.max(1, config.maxGrossExposure),
  );
  const drawdownHeadroomRatio = Math.max(
    0.25,
    1 - risk.drawdownBps / Math.max(1, config.maxDrawdownBps),
  );
  const toxicUnitScale =
    risk.toxicityBps >= config.toxicityThresholdBps
      ? Math.max(0, Math.min(1, config.toxicUnitReductionBps / 10_000))
      : 1;
  const baseUnits = Math.min(
    config.maxQuoteUnits,
    Math.max(
      config.minQuoteUnits,
      Math.round(
        config.maxQuoteUnits *
          Math.min(
            inventoryHeadroomRatio,
            grossHeadroomRatio,
            drawdownHeadroomRatio,
          ) *
          toxicUnitScale,
      ),
    ),
  );

  const imbalance = Math.max(-1, Math.min(1, computeInventorySkew(snapshot.exposure)));
  const grossHeadroomUnits = Math.max(0, config.maxGrossExposure - risk.grossExposure);
  const bidNetHeadroomUnits = Math.max(0, config.maxNetExposure - risk.netExposure);
  const askNetHeadroomUnits = Math.max(0, config.maxNetExposure + risk.netExposure);
  const bidInventoryHeadroomUnits = Math.max(
    0,
    config.maxInventoryPerSide - risk.yesExposure,
  );
  const askInventoryHeadroomUnits = Math.max(
    0,
    config.maxInventoryPerSide - risk.noExposure,
  );
  const bidRequestedUnits = Math.round(
    baseUnits * Math.max(0.25, 1 - Math.max(0, imbalance)),
  );
  const askRequestedUnits = Math.round(
    baseUnits * Math.max(0.25, 1 + Math.min(0, imbalance)),
  );
  const bidUnits = risk.canBid
    ? clampQuoteUnits(bidRequestedUnits, config.minQuoteUnits, [
        bidInventoryHeadroomUnits,
        bidNetHeadroomUnits,
        grossHeadroomUnits,
      ])
    : 0;
  const askUnits = risk.canAsk
    ? clampQuoteUnits(askRequestedUnits, config.minQuoteUnits, [
        askInventoryHeadroomUnits,
        askNetHeadroomUnits,
        grossHeadroomUnits,
      ])
    : 0;

  let bidPrice = clampPrice(
    fairValue - quoteWidth / 2,
    config.minQuotePrice,
    config.maxQuotePrice,
  );
  let askPrice = clampPrice(
    fairValue + quoteWidth / 2,
    config.minQuotePrice,
    config.maxQuotePrice,
  );
  if (bidPrice >= askPrice) {
    bidPrice = Math.max(config.minQuotePrice, askPrice - 1);
    askPrice = Math.min(config.maxQuotePrice, bidPrice + 1);
  }

  return {
    fairValue,
    bidPrice: bidUnits > 0 ? bidPrice : null,
    askPrice: askUnits > 0 ? askPrice : null,
    bidUnits,
    askUnits,
    replaceQuotes:
      snapshot.quoteAgeMs == null || snapshot.quoteAgeMs >= config.minRefreshIntervalMs,
    risk,
  };
}

export function evaluateQuoteDecision(
  side: "BID" | "ASK",
  plan: QuotePlan,
  activeQuote: ManagedQuoteState | null,
  config: MarketMakerConfig = DEFAULT_MARKET_MAKER_CONFIG,
  now = Date.now(),
): QuoteDecision {
  const targetPrice = side === "BID" ? plan.bidPrice : plan.askPrice;
  const targetUnits = side === "BID" ? plan.bidUnits : plan.askUnits;
  if (!activeQuote) {
    return {
      side,
      targetPrice,
      targetUnits,
      shouldCancel: false,
      shouldPlace: targetPrice != null && targetUnits > 0,
      shouldKeep: targetPrice == null || targetUnits <= 0,
      reason:
        targetPrice != null && targetUnits > 0
          ? "quote-missing"
          : plan.risk.circuitBreaker.reason,
    };
  }

  if (targetPrice == null || targetUnits <= 0) {
    return {
      side,
      targetPrice,
      targetUnits,
      shouldCancel: true,
      shouldPlace: false,
      shouldKeep: false,
      reason: plan.risk.circuitBreaker.reason ?? "quote-disabled",
    };
  }

  const quoteAgeMs = Math.max(0, now - activeQuote.placedAtMs);
  const expired = quoteAgeMs >= config.maxQuoteAgeMs;
  const needsPriceRefresh = activeQuote.price !== targetPrice;
  const needsSizeRefresh = activeQuote.units !== targetUnits;
  const refreshWindowOpen = plan.replaceQuotes || expired;
  const shouldRefresh =
    expired || (refreshWindowOpen && (needsPriceRefresh || needsSizeRefresh));

  if (shouldRefresh) {
    return {
      side,
      targetPrice,
      targetUnits,
      shouldCancel: true,
      shouldPlace: true,
      shouldKeep: false,
      reason: expired
        ? "quote-expired"
        : needsSizeRefresh
          ? "size-refresh"
          : "price-refresh",
    };
  }

  return {
    side,
    targetPrice,
    targetUnits,
    shouldCancel: false,
    shouldPlace: false,
    shouldKeep: true,
    reason: null,
  };
}

// === AMM Market-Making Logic ===

export interface AmmMarketSnapshot {
  chainKey: BettingChainKey;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  duelKey: string | null;
  marketRef: string | null;
  /** YES price as probability [0, 1] */
  ammPriceYes: number;
  reserveYes: number;
  reserveNo: number;
  liquidity: number;
  betCloseTimeMs?: number | null;
  lastStreamAtMs?: number | null;
  lastOracleAtMs?: number | null;
  lastRpcAtMs?: number | null;
  exposure: MarketExposure;
}

export interface AmmTradeDecision {
  action: "buy_yes" | "buy_no" | "sell_yes" | "sell_no" | "hold";
  /** Collateral amount (buy) or token amount (sell) */
  amount: number;
  /** Fair value probability [0, 1] */
  fairValue: number;
  /** Current AMM price [0, 1] */
  ammPrice: number;
  /** Absolute deviation in basis points */
  deviationBps: number;
  risk: RiskState;
  reason: string | null;
}

export interface AmmMarketMakerConfig {
  /** Min deviation from fair value to trigger trade (bps) */
  deviationThresholdBps: number;
  /** Max collateral per trade */
  maxTradeSize: number;
  /** Min trade size */
  minTradeSize: number;
  /** Max total yes+no token holdings */
  maxPositionSize: number;
  /** Inventory imbalance trigger for rebalancing (bps) */
  rebalanceThresholdBps: number;
  /** Max drawdown before halting (bps) */
  maxDrawdownBps: number;
  /** Stale stream threshold (ms) */
  staleStreamAfterMs: number;
  /** Stale oracle threshold (ms) */
  staleOracleAfterMs: number;
  /** Stale RPC threshold (ms) */
  staleRpcAfterMs: number;
  /** Guard window before bet close (ms) */
  betCloseGuardMs: number;
  /** Max slippage tolerance for AMM trades (bps, default 200 = 2%) */
  maxSlippageBps: number;
}

export const DEFAULT_AMM_MARKET_MAKER_CONFIG: AmmMarketMakerConfig = {
  deviationThresholdBps: 300,
  maxTradeSize: 100_000,
  minTradeSize: 10_000,
  maxPositionSize: 500_000,
  rebalanceThresholdBps: 1_000,
  maxDrawdownBps: 2_000,
  staleStreamAfterMs: 3_000,
  staleOracleAfterMs: 5_000,
  staleRpcAfterMs: 5_000,
  betCloseGuardMs: 5_000,
  maxSlippageBps: 200,
};

export function buildAmmTradeDecision(
  snapshot: AmmMarketSnapshot,
  signal: Pick<FairValueInput, "signalPrice" | "signalWeight"> = {},
  config: AmmMarketMakerConfig = DEFAULT_AMM_MARKET_MAKER_CONFIG,
  now = Date.now(),
): AmmTradeDecision {
  // Build risk state using a synthetic MarketSnapshot for gate reuse
  const syntheticSnapshot: MarketSnapshot = {
    chainKey: snapshot.chainKey,
    lifecycleStatus: snapshot.lifecycleStatus,
    duelKey: snapshot.duelKey,
    marketRef: snapshot.marketRef,
    bestBid: null,
    bestAsk: null,
    betCloseTimeMs: snapshot.betCloseTimeMs,
    lastStreamAtMs: snapshot.lastStreamAtMs,
    lastOracleAtMs: snapshot.lastOracleAtMs,
    lastRpcAtMs: snapshot.lastRpcAtMs,
    exposure: snapshot.exposure,
  };
  const syntheticConfig: MarketMakerConfig = {
    ...DEFAULT_MARKET_MAKER_CONFIG,
    maxDrawdownBps: config.maxDrawdownBps,
    staleStreamAfterMs: config.staleStreamAfterMs,
    staleOracleAfterMs: config.staleOracleAfterMs,
    staleRpcAfterMs: config.staleRpcAfterMs,
    betCloseGuardMs: config.betCloseGuardMs,
  };
  const risk = buildRiskState(syntheticSnapshot, syntheticConfig, now);

  // Compute fair value: signal in [1,999] CLOB ticks → normalize to [0,1]
  const clobFairValue = computeFairValue({
    signalPrice: signal.signalPrice,
    signalWeight: signal.signalWeight,
    fallbackPrice: 500,
    inventorySkew: computeInventorySkew(snapshot.exposure),
    inventorySkewBps: DEFAULT_MARKET_MAKER_CONFIG.inventorySkewBps,
  });
  const fairValue = clobFairValue / 1000; // [0, 1]

  const ammPrice = snapshot.ammPriceYes;
  const deviation = ammPrice - fairValue;
  const deviationBps = Math.round(Math.abs(deviation) * 10_000);

  const hold = (reason: string | null): AmmTradeDecision => ({
    action: "hold",
    amount: 0,
    fairValue,
    ammPrice,
    deviationBps,
    risk,
    reason,
  });

  // Circuit breaker
  if (risk.circuitBreaker.active) {
    return hold(risk.circuitBreaker.reason);
  }

  // Below deviation threshold — hold
  if (deviationBps < config.deviationThresholdBps) {
    return hold("within-threshold");
  }

  // Position limit check
  const totalPosition =
    snapshot.exposure.yes + snapshot.exposure.no +
    snapshot.exposure.openYes + snapshot.exposure.openNo;
  if (totalPosition >= config.maxPositionSize) {
    return hold("position-limit");
  }

  // Size proportional to deviation, clamped
  const deviationRatio = Math.min(1, deviationBps / 10_000);
  const headroom = Math.max(0, config.maxPositionSize - totalPosition);
  const rawSize = Math.round(config.maxTradeSize * deviationRatio);
  const tradeSize = Math.min(rawSize, headroom, config.maxTradeSize);

  if (tradeSize < config.minTradeSize) {
    return hold("below-min-size");
  }

  // AMM price < fair value → YES is underpriced → buy YES
  // AMM price > fair value → YES is overpriced → buy NO
  const action: AmmTradeDecision["action"] =
    deviation < 0 ? "buy_yes" : "buy_no";

  return {
    action,
    amount: tradeSize,
    fairValue,
    ammPrice,
    deviationBps,
    risk,
    reason: `deviation-${deviationBps}bps`,
  };
}

export * from "./rpcProxyPolicy.js";
