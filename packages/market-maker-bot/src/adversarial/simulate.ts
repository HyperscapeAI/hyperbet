import type {
  ChainProfile,
  GuardProfile,
  MarketState,
  Metrics,
  ScenarioId,
  VulnerabilityVector,
} from "./types.js";
import { clamp, Prng } from "./math.js";
import {
  applyFill,
  createInitialState,
  scenarioIntensity,
  shouldExploit,
  vulnerabilityFor,
} from "./engine.js";

function defenseStrength(input: {
  guards: GuardProfile;
  chain: ChainProfile;
  vuln: VulnerabilityVector;
  scenario: ScenarioId;
  divergence: number;
  staleTicks: number;
  state: MarketState;
}): number {
  const { guards, chain, vuln, scenario, divergence, staleTicks, state } = input;

  const guardQuality =
    ((1 - vuln.latency) +
      (1 - vuln.toxic) +
      (1 - vuln.spoof) +
      (1 - vuln.stale) +
      (1 - vuln.inventory) +
      (1 - vuln.cancel)) /
    6;
  const chainHeadwind =
    chain.mevRisk * 0.45 + chain.mempoolFriction * 0.35 + chain.oracleLagAmplifier * 0.2;
  const stress =
    divergence * 7 +
    Math.abs(state.inventory) / Math.max(1, guards.inventoryCap) +
    staleTicks / Math.max(1, guards.staleSignalMaxTicks);

  let scenarioBias = 0;
  if (scenario === "gas_auction_backrun") {
    scenarioBias = chain.mevRisk * 0.3;
  } else if (scenario === "stale_signal_arbitrage") {
    scenarioBias = chain.oracleLagAmplifier * 0.3;
  } else if (scenario === "spoof_pressure") {
    scenarioBias = chain.mempoolFriction * 0.22;
  }

  return clamp(0.18 + guardQuality * 0.72 - chainHeadwind * 0.22 - stress * 0.08 - scenarioBias, 0.02, 0.96);
}

function tryExploitFill(input: {
  rng: Prng;
  guards: GuardProfile;
  chain: ChainProfile;
  vuln: VulnerabilityVector;
  scenario: ScenarioId;
  state: MarketState;
  divergence: number;
  staleTicks: number;
  quotePrice: number;
  truePrice: number;
  side: "buy" | "sell";
  qty: number;
  feeBps: number;
  bid: number;
  ask: number;
}) {
  const {
    rng,
    guards,
    chain,
    vuln,
    scenario,
    state,
    divergence,
    staleTicks,
    quotePrice,
    truePrice,
    side,
    qty,
    feeBps,
    bid,
    ask,
  } = input;

  const defense = defenseStrength({
    guards,
    chain,
    vuln,
    scenario,
    divergence,
    staleTicks,
    state,
  });

  if (rng.next() < defense) {
    // Defensive post-only refresh can add benign fills and reduce toxic fill concentration.
    if (rng.next() < 0.3) {
      const rebalanceSide: "buy" | "sell" = state.inventory >= 0 ? "sell" : "buy";
      applyFill({
        state,
        quotePrice: rebalanceSide === "buy" ? bid : ask,
        truePrice,
        side: rebalanceSide,
        qty: 1,
        feeBps,
        toxic: false,
        exploited: false,
      });
    }
    return false;
  }

  applyFill({
    state,
    quotePrice,
    truePrice,
    side,
    qty,
    feeBps,
    toxic: true,
    exploited: true,
  });
  return true;
}

export function simulateScenario(input: {
  scenario: ScenarioId;
  chain: ChainProfile;
  guards: GuardProfile;
  seed: number;
}): Metrics {
  const { scenario, chain, guards, seed } = input;
  const rng = new Prng(seed);
  const vuln = vulnerabilityFor(guards);

  const ticks = 180;
  let truePrice = 0.5;
  let signalPrice = truePrice;
  let quotePrice = truePrice;
  let staleTicks = 0;
  let previousPrice = truePrice;

  const state = createInitialState(truePrice);
  const signalUpdateInterval =
    scenario === "stale_signal_arbitrage"
      ? 5 + chain.settlementLagTicks * 2 + Math.round(chain.oracleLagAmplifier * 7)
      : chain.settlementLagTicks + 1;

  for (let tick = 0; tick < ticks; tick += 1) {
    previousPrice = truePrice;
    const shockBps = rng.nextSigned() * chain.volatilityBps;
    truePrice = clamp(truePrice * (1 + shockBps / 10_000), 0.03, 0.97);

    if (tick % signalUpdateInterval === 0) {
      signalPrice = truePrice;
      staleTicks = 0;
    } else {
      staleTicks += 1;
    }

    if (tick % (guards.repriceDelayTicks + 1) === 0) {
      const invSkew = clamp(state.inventory / guards.inventoryCap, -1, 1);
      const skewBps = invSkew * guards.maxSkewBps;
      quotePrice = clamp(signalPrice - skewBps / 10_000, 0.03, 0.97);
    }

    const spread = chain.baseSpreadBps / 10_000;
    const bid = quotePrice - spread / 2;
    const ask = quotePrice + spread / 2;

    const divergence = Math.abs(truePrice - quotePrice);
    const intensity = scenarioIntensity(scenario, vuln, chain);

    // Ambient benign flow to emulate normal MM traffic and make toxic rate measurable.
    const passiveFillChance = clamp(0.04 + (1 - vuln.toxic) * 0.18, 0.04, 0.28);
    if (rng.next() < passiveFillChance) {
      const passiveSide: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
      applyFill({
        state,
        quotePrice: passiveSide === "buy" ? bid : ask,
        truePrice,
        side: passiveSide,
        qty: 1,
        feeBps: chain.feeBps,
        toxic: false,
        exploited: false,
      });
    }

    if (scenario === "latency_sniping") {
      if (
        shouldExploit(
          intensity * 0.5,
          divergence,
          guards.maxAdverseSelectionRate,
          rng.next(),
        )
      ) {
        const buySide = truePrice > quotePrice;
        const qty = Math.round(2 + 6 * intensity + chain.mempoolFriction * 2);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "spoof_pressure") {
      const spoofDirection = rng.next() > 0.5 ? 1 : -1;
      const spoofMagnitude = 0.008 + 0.015 * intensity;
      if (vuln.spoof > 0.5) {
        quotePrice = clamp(quotePrice + spoofDirection * spoofMagnitude, 0.03, 0.97);
      }
      if (rng.next() < intensity * (0.75 + chain.mempoolFriction * 0.2)) {
        const side: "buy" | "sell" = spoofDirection > 0 ? "buy" : "sell";
        const qty = Math.round(2 + 5 * intensity + chain.mempoolFriction * 2);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: side === "buy" ? bid : ask,
          truePrice,
          side,
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "toxic_flow_poisoning") {
      const trend = truePrice - previousPrice;
      const informed: "buy" | "sell" = trend >= 0 ? "sell" : "buy";
      if (rng.next() < intensity * 0.9) {
        const qty = Math.round(2 + 4 * intensity);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: informed === "buy" ? bid : ask,
          truePrice,
          side: informed,
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "stale_signal_arbitrage") {
      const staleFactor = clamp((staleTicks - guards.staleSignalMaxTicks) / 4, 0, 1);
      if (rng.next() < intensity * (0.25 + staleFactor * 0.9)) {
        const buySide = truePrice > signalPrice;
        const qty = Math.round(2 + 5 * intensity + staleFactor * 4 + chain.oracleLagAmplifier * 3);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "liquidation_cascade") {
      if (rng.next() < intensity * 0.5) {
        const buildupSide: "buy" | "sell" = state.inventory >= 0 ? "buy" : "sell";
        const buildupQty = Math.round(1 + intensity * 4);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: buildupSide === "buy" ? bid : ask,
          truePrice,
          side: buildupSide,
          qty: buildupQty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }

      const overInventory = Math.abs(state.inventory) / guards.inventoryCap;
      const cascadeChance = clamp(
        intensity * (0.2 + overInventory * 1.1) * (1 + chain.mevRisk * 0.15),
        0,
        0.95,
      );
      if (rng.next() < cascadeChance) {
        const side: "buy" | "sell" = state.inventory > 0 ? "sell" : "buy";
        const qty = Math.round(3 + 8 * intensity + overInventory * 3);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: side === "buy" ? bid : ask,
          truePrice,
          side,
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "gas_auction_backrun") {
      const gasLatency = clamp((guards.cancelCooldownTicks - 1) / 6, 0, 1);
      const backrunChance = clamp(
        intensity * (0.45 + gasLatency + chain.mevRisk * 0.35),
        0,
        0.98,
      );
      if (rng.next() < backrunChance) {
        const buySide = rng.next() > 0.5;
        const qty = Math.round(2 + 4 * intensity + gasLatency * 4 + chain.mevRisk * 3);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    const emergencyStop = staleTicks > guards.staleQuoteHardStopTicks;
    if (emergencyStop || Math.abs(state.inventory) > guards.inventoryCap) {
      const unwindSide: "buy" | "sell" = state.inventory > 0 ? "sell" : "buy";
      const unwindQty = Math.min(
        Math.abs(state.inventory),
        4 + Math.round((1 - vuln.inventory) * 10),
      );
      if (unwindQty > 0) {
        applyFill({
          state,
          quotePrice: unwindSide === "buy" ? bid : ask,
          truePrice,
          side: unwindSide,
          qty: unwindQty,
          feeBps: chain.feeBps,
          toxic: false,
          exploited: false,
        });
      }
    }

    state.markPrice = truePrice;
    const equity = state.cash + state.inventory * state.markPrice;
    state.drawdown = Math.min(state.drawdown, equity);
  }

  const rawEquity = state.cash + state.inventory * state.markPrice;
  const exploitPenalty =
    state.exploitEvents * (0.18 + 0.28 * chain.riskMultiplier) * (1 + vuln.latency + vuln.stale);
  const inventoryPenalty = state.inventoryPeak * (0.09 + 0.22 * vuln.inventory);
  const adversePenalty =
    state.toxicFills *
    (0.2 + 0.2 * vuln.toxic + 0.2 * vuln.spoof + 0.2 * vuln.cancel + 0.2 * vuln.latency);
  const finalEquity = rawEquity - exploitPenalty - inventoryPenalty - adversePenalty;

  return {
    mmPnl: Number(finalEquity.toFixed(6)),
    attackerPnl: Number((-finalEquity).toFixed(6)),
    maxDrawdown: Number(state.drawdown.toFixed(6)),
    toxicFillRate:
      state.totalFills > 0 ? Number((state.toxicFills / state.totalFills).toFixed(4)) : 0,
    inventoryPeak: state.inventoryPeak,
    exploitEvents: state.exploitEvents,
    avgAdverseSlippageBps:
      state.toxicFills > 0
        ? Number((state.adverseSlippageBpsTotal / state.toxicFills).toFixed(2))
        : 0,
  };
}
