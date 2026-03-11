import type {
  ChainProfile,
  GuardProfile,
  Metrics,
  ScenarioId,
} from "./types.js";
import { clamp, Prng } from "./math.js";
import {
  applyFill,
  createInitialState,
  scenarioIntensity,
  shouldExploit,
  vulnerabilityFor,
} from "./engine.js";

export function simulateScenario(input: {
  scenario: ScenarioId;
  chain: ChainProfile;
  guards: GuardProfile;
  seed: number;
}): Metrics {
  const { scenario, chain, guards, seed } = input;
  const rng = new Prng(seed);
  const vuln = vulnerabilityFor(guards);

  const ticks = 160;
  let truePrice = 0.5;
  let signalPrice = truePrice;
  let quotePrice = truePrice;
  let staleTicks = 0;
  let previousPrice = truePrice;

  const state = createInitialState(truePrice);

  for (let tick = 0; tick < ticks; tick += 1) {
    previousPrice = truePrice;
    const shockBps = rng.nextSigned() * chain.volatilityBps;
    truePrice = clamp(truePrice * (1 + shockBps / 10_000), 0.03, 0.97);

    if (tick % (chain.settlementLagTicks + 1) === 0) {
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

    if (scenario === "latency_sniping") {
      if (
        shouldExploit(
          intensity * 0.45,
          divergence,
          guards.maxAdverseSelectionRate,
          rng.next(),
        )
      ) {
        const buySide = truePrice > quotePrice;
        const qty = Math.round(2 + 6 * intensity);
        applyFill({
          state,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
        });
      }
    }

    if (scenario === "spoof_pressure") {
      const spoofDirection = rng.next() > 0.5 ? 1 : -1;
      const spoofMagnitude = 0.008 + 0.015 * intensity;
      if (vuln.spoof > 0.5) {
        quotePrice = clamp(quotePrice + spoofDirection * spoofMagnitude, 0.03, 0.97);
      }
      if (rng.next() < intensity * 0.8) {
        const side: "buy" | "sell" = spoofDirection > 0 ? "buy" : "sell";
        const qty = Math.round(2 + 5 * intensity);
        applyFill({
          state,
          quotePrice: side === "buy" ? bid : ask,
          truePrice,
          side,
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
        });
      }
    }

    if (scenario === "toxic_flow_poisoning") {
      const trend = truePrice - previousPrice;
      const informed: "buy" | "sell" = trend >= 0 ? "sell" : "buy";
      if (rng.next() < intensity * 0.95) {
        const qty = Math.round(2 + 4 * intensity);
        applyFill({
          state,
          quotePrice: informed === "buy" ? bid : ask,
          truePrice,
          side: informed,
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
        });
      }
    }

    if (scenario === "stale_signal_arbitrage") {
      const staleFactor = clamp((staleTicks - guards.staleSignalMaxTicks) / 5, 0, 1);
      if (rng.next() < intensity * staleFactor) {
        const buySide = truePrice > signalPrice;
        const qty = Math.round(2 + 5 * intensity + staleFactor * 3);
        applyFill({
          state,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
        });
      }
    }

    if (scenario === "liquidation_cascade") {
      const overInventory = Math.abs(state.inventory) / guards.inventoryCap;
      const cascadeChance = clamp(intensity * overInventory * 0.9, 0, 0.9);
      if (rng.next() < cascadeChance) {
        const side: "buy" | "sell" = state.inventory > 0 ? "sell" : "buy";
        const qty = Math.round(3 + 7 * intensity);
        applyFill({
          state,
          quotePrice: side === "buy" ? bid : ask,
          truePrice,
          side,
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
        });
      }
    }

    if (scenario === "gas_auction_backrun") {
      const gasLatency = clamp((guards.cancelCooldownTicks - 1) / 6, 0, 1);
      const backrunChance = clamp(intensity * (0.5 + gasLatency), 0, 0.95);
      if (rng.next() < backrunChance) {
        const buySide = rng.next() > 0.5;
        const qty = Math.round(2 + 4 * intensity + gasLatency * 4);
        applyFill({
          state,
          quotePrice: buySide ? ask : bid,
          truePrice,
          side: buySide ? "sell" : "buy",
          qty,
          feeBps: chain.feeBps,
          toxic: true,
          exploited: true,
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
