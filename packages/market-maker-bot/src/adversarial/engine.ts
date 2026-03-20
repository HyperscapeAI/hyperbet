import type {
  ChainProfile,
  GuardProfile,
  MarketState,
  ScenarioId,
  VulnerabilityVector,
} from "./types.js";
import { clamp } from "./math.js";

export function vulnerabilityFor(guards: GuardProfile): VulnerabilityVector {
  return {
    latency: guards.repriceDelayTicks / 5,
    spoof: guards.maxSkewBps / 230,
    toxic: guards.toxicFlowThreshold / 0.92,
    stale: guards.staleSignalMaxTicks / 9,
    inventory: guards.inventoryCap / 190,
    cancel: guards.cancelCooldownTicks / 7,
  };
}

export function createInitialState(price: number): MarketState {
  return {
    inventory: 0,
    cash: 0,
    markPrice: price,
    drawdown: 0,
    toxicFills: 0,
    totalFills: 0,
    inventoryPeak: 0,
    exploitEvents: 0,
    adverseSlippageBpsTotal: 0,
  };
}

export function applyFill(input: {
  state: MarketState;
  quotePrice: number;
  truePrice: number;
  side: "buy" | "sell";
  qty: number;
  feeBps: number;
  toxic: boolean;
  exploited?: boolean;
}) {
  const { state, quotePrice, truePrice, side, qty, feeBps, toxic, exploited } = input;
  const gross = side === "buy" ? quotePrice - truePrice : truePrice - quotePrice;
  const fee = (quotePrice * qty * feeBps) / 10_000;
  const pnl = gross * qty + fee;

  if (side === "buy") {
    state.inventory += qty;
    state.cash -= quotePrice * qty;
  } else {
    state.inventory -= qty;
    state.cash += quotePrice * qty;
  }

  state.cash += pnl;
  state.totalFills += 1;
  state.inventoryPeak = Math.max(state.inventoryPeak, Math.abs(state.inventory));
  if (toxic) {
    state.toxicFills += 1;
    const slippageBps =
      quotePrice > 0 ? (Math.abs(truePrice - quotePrice) / quotePrice) * 10_000 : 0;
    state.adverseSlippageBpsTotal += slippageBps;
  }
  if (exploited) {
    state.exploitEvents += 1;
  }
}

export function scenarioIntensity(
  scenario: ScenarioId,
  vuln: VulnerabilityVector,
  chain: ChainProfile,
): number {
  const chainRisk = chain.riskMultiplier;
  if (scenario === "latency_sniping") {
    return 0.55 * vuln.latency * chainRisk * (1 + chain.mempoolFriction * 0.4);
  }
  if (scenario === "spoof_pressure") {
    return 0.5 * vuln.spoof * chainRisk * (1 + chain.mempoolFriction * 0.35);
  }
  if (scenario === "toxic_flow_poisoning") {
    return 0.7 * vuln.toxic * chainRisk;
  }
  if (scenario === "stale_signal_arbitrage") {
    return 0.6 * vuln.stale * chainRisk * (1 + chain.oracleLagAmplifier * 0.45);
  }
  if (scenario === "liquidation_cascade") {
    return 0.75 * ((vuln.inventory + vuln.cancel) / 2) * chainRisk;
  }
  if (scenario === "layering_spoof_ladder") {
    return (
      0.45 *
      ((vuln.spoof + vuln.cancel) / 2) *
      chainRisk *
      (1 + chain.mempoolFriction * 0.22)
    );
  }
  if (scenario === "quote_stuffing_burst") {
    return (
      0.52 *
      ((vuln.latency + vuln.cancel) / 2) *
      chainRisk *
      (1 + chain.mempoolFriction * 0.24)
    );
  }
  if (scenario === "cancel_storm_griefing") {
    return (
      0.5 *
      ((vuln.cancel + vuln.toxic) / 2) *
      chainRisk *
      (1 + chain.mevRisk * 0.2)
    );
  }
  if (scenario === "sybil_wash_trading") {
    return 0.7 * ((vuln.toxic + vuln.cancel) / 2) * chainRisk;
  }
  if (scenario === "rebate_farming_ring") {
    return 0.66 * ((vuln.toxic + vuln.spoof) / 2) * chainRisk;
  }
  if (scenario === "coordinated_resolution_push") {
    return (
      0.74 *
      ((vuln.stale + vuln.inventory + vuln.cancel) / 3) *
      chainRisk *
      (1 + chain.mempoolFriction * 0.2)
    );
  }
  if (scenario === "amm_sandwich_attack") {
    return 0.5 * ((vuln.latency + vuln.toxic) / 2) * chainRisk * (1 + chain.mevRisk * 0.35);
  }
  if (scenario === "amm_reserve_manipulation") {
    return 0.6 * ((vuln.inventory + vuln.toxic) / 2) * chainRisk;
  }
  if (scenario === "amm_stale_price_arb") {
    return 0.62 * vuln.stale * chainRisk * (1 + chain.oracleLagAmplifier * 0.4);
  }
  if (scenario === "amm_slippage_griefing") {
    return 0.58 * ((vuln.toxic + vuln.inventory) / 2) * chainRisk * (1 + chain.mevRisk * 0.3);
  }
  if (scenario === "amm_token_drain") {
    return 0.3 * vuln.inventory * chainRisk;
  }
  if (scenario === "amm_expiry_race") {
    return 0.48 * ((vuln.stale + vuln.latency + vuln.cancel) / 3) * chainRisk * (1 + chain.mevRisk * 0.2);
  }
  return (
    0.6 *
    ((vuln.latency + vuln.cancel) / 2) *
    chainRisk *
    (1 + chain.mevRisk * 0.55)
  );
}

export function shouldExploit(
  baseProbability: number,
  divergence: number,
  adverseSelectionRate: number,
  random: number,
): boolean {
  const p = clamp(baseProbability + divergence * adverseSelectionRate, 0, 0.98);
  return random < p;
}
