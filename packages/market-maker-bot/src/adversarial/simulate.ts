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
  } else if (scenario === "sybil_wash_trading") {
    scenarioBias = chain.mempoolFriction * 0.18;
  } else if (scenario === "sybil_identity_churn") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.17;
  } else if (scenario === "rebate_farming_ring") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.11;
  } else if (scenario === "layering_spoof_ladder") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.16;
  } else if (scenario === "quote_stuffing_burst") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.2;
  } else if (scenario === "cancel_storm_griefing") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.18;
  } else if (scenario === "coordinated_resolution_push") {
    scenarioBias = (chain.oracleLagAmplifier + chain.mevRisk) * 0.14;
  } else if (scenario === "amm_sandwich_attack") {
    scenarioBias = chain.mevRisk * 0.22;
  } else if (scenario === "amm_reserve_manipulation") {
    scenarioBias = (chain.mempoolFriction + chain.mevRisk) * 0.1;
  } else if (scenario === "amm_stale_price_arb") {
    scenarioBias = chain.oracleLagAmplifier * 0.18;
  } else if (scenario === "amm_slippage_griefing") {
    scenarioBias = (chain.mevRisk + chain.mempoolFriction) * 0.12;
  } else if (scenario === "amm_token_drain") {
    scenarioBias = chain.mempoolFriction * 0.1;
  } else if (scenario === "amm_expiry_race") {
    scenarioBias = (chain.mevRisk + chain.oracleLagAmplifier) * 0.12;
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

function scenarioOperationalStress(input: {
  scenario: ScenarioId;
  chain: ChainProfile;
  guards: GuardProfile;
  vuln: VulnerabilityVector;
  staleQuoteRatio: number;
  inventoryPeak: number;
}): {
  staleMultiplier: number;
  orphanBase: number;
  lagBaseMs: number;
  backlogBase: number;
} {
  const { scenario, chain, guards, vuln, staleQuoteRatio, inventoryPeak } = input;
  const baseLag =
    240 +
    chain.settlementLagTicks * 120 +
    guards.repriceDelayTicks * 90 +
    chain.oracleLagAmplifier * 160;
  const generic = {
    staleMultiplier: 0.4 + vuln.stale * 0.45 + staleQuoteRatio,
    orphanBase:
      Math.max(0, inventoryPeak - guards.inventoryCap * 0.35) / Math.max(1, guards.inventoryCap) +
      vuln.cancel * 0.5,
    lagBaseMs: baseLag,
    backlogBase: vuln.inventory * 0.4 + vuln.cancel * 0.25,
  };

  switch (scenario) {
    case "restart_mid_fill":
      return {
        staleMultiplier: generic.staleMultiplier + 0.08,
        orphanBase: generic.orphanBase + 0.55,
        lagBaseMs: generic.lagBaseMs + 220,
        backlogBase: generic.backlogBase + 0.45,
      };
    case "orphan_sweep_failure":
      return {
        staleMultiplier: generic.staleMultiplier + 0.04,
        orphanBase: generic.orphanBase + 0.8,
        lagBaseMs: generic.lagBaseMs + 180,
        backlogBase: generic.backlogBase + 0.3,
      };
    case "rpc_split_brain":
      return {
        staleMultiplier: generic.staleMultiplier + 0.12,
        orphanBase: generic.orphanBase + 0.25,
        lagBaseMs: generic.lagBaseMs + 260,
        backlogBase: generic.backlogBase + 0.35,
      };
    case "nonce_collision_replay":
      return {
        staleMultiplier: generic.staleMultiplier,
        orphanBase: generic.orphanBase + 0.4,
        lagBaseMs: generic.lagBaseMs + 160,
        backlogBase: generic.backlogBase + 0.12,
      };
    case "reorg_finality_lag":
      return {
        staleMultiplier: generic.staleMultiplier + 0.1,
        orphanBase: generic.orphanBase + 0.22,
        lagBaseMs: generic.lagBaseMs + 300,
        backlogBase: generic.backlogBase + 0.38,
      };
    case "rounding_abuse":
      return {
        staleMultiplier: generic.staleMultiplier - 0.08,
        orphanBase: generic.orphanBase + 0.08,
        lagBaseMs: generic.lagBaseMs + 90,
        backlogBase: generic.backlogBase + 0.1,
      };
    case "fee_token_depletion":
      return {
        staleMultiplier: generic.staleMultiplier + 0.05,
        orphanBase: generic.orphanBase + 0.12,
        lagBaseMs: generic.lagBaseMs + 140,
        backlogBase: generic.backlogBase + 0.65,
      };
    case "cross_market_inventory_bleed":
      return {
        staleMultiplier: generic.staleMultiplier + 0.02,
        orphanBase: generic.orphanBase + 0.2,
        lagBaseMs: generic.lagBaseMs + 150,
        backlogBase: generic.backlogBase + 0.18,
      };
    default:
      return generic;
  }
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
  let staleQuoteTicks = 0;

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

    if (scenario === "layering_spoof_ladder") {
      const ladderPressure = clamp(
        intensity *
          (0.07 + vuln.spoof * 0.45 + vuln.cancel * 0.22 + chain.mempoolFriction * 0.1),
        0,
        0.6,
      );
      if (rng.next() < ladderPressure) {
        const rounds = 1 + Math.round(1 + intensity * 1.3 + vuln.cancel * 1.2);
        for (let round = 0; round < rounds; round += 1) {
          const directionalBias = round % 2 === 0;
          const side: "buy" | "sell" = directionalBias ? "buy" : "sell";
          const qty = Math.max(1, Math.round(1 + intensity * 1.1 + vuln.spoof * 0.7));
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
    }

    if (scenario === "quote_stuffing_burst") {
      const stuffingBurstChance = clamp(
        intensity *
          (0.1 + vuln.latency * 0.42 + vuln.cancel * 0.32 + chain.mempoolFriction * 0.12),
        0,
        0.72,
      );
      if (rng.next() < stuffingBurstChance) {
        const burst = 1 + Math.round(1 + intensity * 2 + vuln.cancel * 1.2);
        for (let burstTick = 0; burstTick < burst; burstTick += 1) {
          const side: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
          const qty = Math.max(1, Math.round(1 + intensity * 1.2 + vuln.cancel * 0.9));
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
    }

    if (scenario === "cancel_storm_griefing") {
      const cancelStormChance = clamp(
        intensity * (0.05 + vuln.cancel * 0.4 + vuln.toxic * 0.18 + chain.mevRisk * 0.08),
        0,
        0.55,
      );
      if (rng.next() < cancelStormChance) {
        const chopRounds = 1 + Math.round(0.8 + intensity * 1.2 + vuln.cancel * 1.1);
        for (let round = 0; round < chopRounds; round += 1) {
          const side: "buy" | "sell" = round % 2 === 0 ? "sell" : "buy";
          const qty = Math.max(1, Math.round(1 + intensity * 0.9 + vuln.cancel * 0.7));
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
    }

    if (scenario === "sybil_wash_trading") {
      const sybilSusceptibility = clamp((vuln.cancel + vuln.toxic) / 2, 0.05, 1);
      const sybilBurstChance = clamp(
        intensity * sybilSusceptibility * (0.38 + chain.mempoolFriction * 0.18),
        0,
        0.9,
      );
      if (rng.next() < sybilBurstChance) {
        const burstRounds = 1 + Math.round(intensity * 2 + sybilSusceptibility);
        for (let round = 0; round < burstRounds; round += 1) {
          const side: "buy" | "sell" = round % 2 === 0 ? "buy" : "sell";
          const qty = Math.max(
            1,
            Math.round(1 + intensity * 1.6 + sybilSusceptibility + chain.mempoolFriction),
          );
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
    }

    if (scenario === "sybil_identity_churn") {
      const churnSusceptibility = clamp(
        (vuln.cancel * 0.45 + vuln.toxic * 0.35 + vuln.latency * 0.2) * (1 + chain.mevRisk * 0.12),
        0.08,
        1,
      );
      const churnWaveChance = clamp(
        intensity * churnSusceptibility * (0.11 + chain.mempoolFriction * 0.12),
        0,
        0.58,
      );
      if (rng.next() < churnWaveChance) {
        const walletsPerWave = 1 + Math.round(intensity * 1.4 + churnSusceptibility * 0.8);
        for (let wallet = 0; wallet < walletsPerWave; wallet += 1) {
          const side: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
          const qty = Math.max(
            1,
            Math.round(1 + intensity * 0.8 + churnSusceptibility * 0.5 + chain.mempoolFriction * 0.3),
          );
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
    }

    if (scenario === "rebate_farming_ring") {
      const rebatePressure = clamp(
        intensity *
          clamp(vuln.toxic, 0.08, 1) *
          (0.24 + chain.feeBps / 55 + chain.mempoolFriction * 0.12),
        0,
        0.8,
      );
      if (rng.next() < rebatePressure) {
        const side: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
        const tinyQty = Math.max(1, Math.round(1 + intensity));
        const nearMidPrice =
          side === "buy"
            ? quotePrice - spread * (0.1 + rng.next() * 0.2)
            : quotePrice + spread * (0.1 + rng.next() * 0.2);
        tryExploitFill({
          rng,
          guards,
          chain,
          vuln,
          scenario,
          state,
          divergence,
          staleTicks,
          quotePrice: clamp(nearMidPrice, 0.03, 0.97),
          truePrice,
          side,
          qty: tinyQty,
          feeBps: chain.feeBps,
          bid,
          ask,
        });
      }
    }

    if (scenario === "coordinated_resolution_push") {
      const inResolutionWindow = tick > ticks - 45;
      if (inResolutionWindow) {
        const resolutionChance = clamp(
          intensity * (0.5 + chain.oracleLagAmplifier * 0.25 + chain.mevRisk * 0.2),
          0,
          0.99,
        );
        if (rng.next() < resolutionChance) {
          const pushSide: "buy" | "sell" = truePrice > signalPrice ? "buy" : "sell";
          const qty = Math.round(3 + intensity * 5 + chain.mempoolFriction * 3);
          tryExploitFill({
            rng,
            guards,
            chain,
            vuln,
            scenario,
            state,
            divergence,
            staleTicks,
            quotePrice: pushSide === "buy" ? ask : bid,
            truePrice,
            side: pushSide,
            qty,
            feeBps: chain.feeBps,
            bid,
            ask,
          });
        }
      }
    }

    // --- AMM scenarios ---

    if (scenario === "amm_sandwich_attack") {
      // Front-run + back-run: adversary trades before and after MM's intended trade
      const sandwichChance = clamp(
        intensity * (0.3 + chain.mevRisk * 0.25 + vuln.latency * 0.15),
        0,
        0.7,
      );
      if (rng.next() < sandwichChance) {
        const frontSide: "buy" | "sell" = truePrice > quotePrice ? "sell" : "buy";
        const frontQty = Math.round(1 + 3 * intensity + chain.mevRisk * 1.5);
        tryExploitFill({
          rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
          quotePrice: frontSide === "buy" ? bid : ask,
          truePrice, side: frontSide, qty: frontQty,
          feeBps: chain.feeBps, bid, ask,
        });
        if (rng.next() < 0.5) {
          const backSide: "buy" | "sell" = frontSide === "buy" ? "sell" : "buy";
          const backQty = Math.round(1 + 2 * intensity);
          tryExploitFill({
            rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
            quotePrice: backSide === "buy" ? bid : ask,
            truePrice, side: backSide, qty: backQty,
            feeBps: chain.feeBps, bid, ask,
          });
        }
      }
    }

    if (scenario === "amm_reserve_manipulation") {
      // Adversary trades to skew reserves before MM acts
      const manipChance = clamp(
        intensity * (0.35 + vuln.inventory * 0.35 + vuln.toxic * 0.2),
        0,
        0.85,
      );
      if (rng.next() < manipChance) {
        const skewSide: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
        const qty = Math.round(3 + 6 * intensity + vuln.inventory * 3);
        tryExploitFill({
          rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
          quotePrice: skewSide === "buy" ? bid : ask,
          truePrice, side: skewSide, qty,
          feeBps: chain.feeBps, bid, ask,
        });
      }
    }

    if (scenario === "amm_stale_price_arb") {
      // Exploit stale AMM price vs true fair value (similar to stale_signal but AMM-specific)
      const staleFactor = clamp((staleTicks - guards.staleSignalMaxTicks) / 3, 0, 1);
      const arbChance = clamp(
        intensity * (0.3 + staleFactor * 0.8 + chain.oracleLagAmplifier * 0.2),
        0,
        0.92,
      );
      if (rng.next() < arbChance) {
        const buySide = truePrice > signalPrice;
        const qty = Math.round(2 + 4 * intensity + staleFactor * 5);
        tryExploitFill({
          rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
          quotePrice: buySide ? ask : bid,
          truePrice, side: buySide ? "sell" : "buy", qty,
          feeBps: chain.feeBps, bid, ask,
        });
      }
    }

    if (scenario === "amm_slippage_griefing") {
      const griefChance = clamp(
        intensity * (0.25 + vuln.toxic * 0.2 + chain.mevRisk * 0.15),
        0,
        0.65,
      );
      if (rng.next() < griefChance) {
        const pushSide: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
        const largeQty = Math.round(2 + 4 * intensity + vuln.inventory * 2);
        tryExploitFill({
          rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
          quotePrice: pushSide === "buy" ? bid : ask,
          truePrice, side: pushSide, qty: largeQty,
          feeBps: chain.feeBps, bid, ask,
        });
      }
    }

    if (scenario === "amm_token_drain") {
      const drainSide: "buy" | "sell" = state.inventory >= 0 ? "buy" : "sell";
      const drainChance = clamp(
        intensity * (0.12 + vuln.inventory * 0.15),
        0,
        0.35,
      );
      if (rng.next() < drainChance) {
        const qty = Math.max(1, Math.round(1 + intensity + vuln.inventory * 0.5));
        tryExploitFill({
          rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
          quotePrice: drainSide === "buy" ? bid : ask,
          truePrice, side: drainSide, qty,
          feeBps: chain.feeBps, bid, ask,
        });
      }
    }

    if (scenario === "amm_expiry_race") {
      const expiryWindow = tick > ticks - 30;
      const timeRemaining = Math.max(0, ticks - tick);
      const liquidityDecay = 1 - timeRemaining / ticks;
      if (expiryWindow) {
        const raceChance = clamp(
          intensity * (0.3 + liquidityDecay * 0.35 + chain.mevRisk * 0.15),
          0,
          0.75,
        );
        if (rng.next() < raceChance) {
          const raceSide: "buy" | "sell" = truePrice > signalPrice ? "sell" : "buy";
          const qty = Math.round(2 + 3 * intensity + liquidityDecay * 3);
          tryExploitFill({
            rng, guards, chain, vuln, scenario, state, divergence, staleTicks,
            quotePrice: raceSide === "buy" ? bid : ask,
            truePrice, side: raceSide, qty,
            feeBps: chain.feeBps, bid, ask,
          });
        }
      }
    }

    const emergencyStop = staleTicks > guards.staleQuoteHardStopTicks;
    if (
      emergencyStop ||
      scenario === "rpc_split_brain" ||
      scenario === "reorg_finality_lag"
    ) {
      staleQuoteTicks += 1;
    }
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
  const operational = scenarioOperationalStress({
    scenario,
    chain,
    guards,
    vuln,
    staleQuoteRatio: staleQuoteTicks / ticks,
    inventoryPeak: state.inventoryPeak,
  });
  const staleQuoteUptimeRatio = Number(
    clamp(
      (staleQuoteTicks / ticks) * operational.staleMultiplier,
      0,
      1,
    ).toFixed(4),
  );
  const orphanOrderCount = Math.max(
    0,
    Math.round(
      operational.orphanBase * 2 +
        vuln.cancel * 0.9 +
        (guards.cancelCooldownTicks - 1) * 0.15,
    ),
  );
  const reconciliationLagMs = Math.round(
    operational.lagBaseMs + staleQuoteTicks * (20 + chain.mempoolFriction * 12),
  );
  const unresolvedClaimBacklog = Math.max(
    0,
    Math.round(
      operational.backlogBase * 1.5 +
        staleQuoteUptimeRatio * 2 +
        Math.max(0, state.inventoryPeak - guards.inventoryCap * 0.5) /
          Math.max(1, guards.inventoryCap),
    ),
  );

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
    staleQuoteUptimeRatio,
    orphanOrderCount,
    reconciliationLagMs,
    unresolvedClaimBacklog,
  };
}
