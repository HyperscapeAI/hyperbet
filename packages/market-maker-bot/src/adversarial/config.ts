import type { ChainProfile, GuardProfile, ScenarioId } from "./types.js";

export const DEFAULT_SEED = 20260311;

export const SCENARIOS: ScenarioId[] = [
  "latency_sniping",
  "spoof_pressure",
  "toxic_flow_poisoning",
  "stale_signal_arbitrage",
  "liquidation_cascade",
  "gas_auction_backrun",
];

export const CHAIN_PROFILES: ChainProfile[] = [
  {
    chain: "solana",
    volatilityBps: 85,
    baseSpreadBps: 90,
    feeBps: 12,
    settlementLagTicks: 1,
    riskMultiplier: 0.95,
    mevRisk: 0.45,
    mempoolFriction: 0.35,
    oracleLagAmplifier: 0.55,
  },
  {
    chain: "bsc",
    volatilityBps: 110,
    baseSpreadBps: 105,
    feeBps: 14,
    settlementLagTicks: 2,
    riskMultiplier: 1,
    mevRisk: 0.75,
    mempoolFriction: 0.7,
    oracleLagAmplifier: 0.8,
  },
  {
    chain: "avax",
    volatilityBps: 120,
    baseSpreadBps: 110,
    feeBps: 15,
    settlementLagTicks: 2,
    riskMultiplier: 1.05,
    mevRisk: 0.82,
    mempoolFriction: 0.76,
    oracleLagAmplifier: 0.9,
  },
];

export const BASELINE_GUARDS: GuardProfile = {
  name: "baseline",
  repriceDelayTicks: 5,
  maxSkewBps: 230,
  toxicFlowThreshold: 0.92,
  inventoryCap: 190,
  staleSignalMaxTicks: 9,
  cancelCooldownTicks: 7,
  staleQuoteHardStopTicks: 10,
  maxAdverseSelectionRate: 0.9,
};

export const MITIGATED_GUARDS: GuardProfile = {
  name: "mitigated",
  repriceDelayTicks: 1,
  maxSkewBps: 80,
  toxicFlowThreshold: 0.4,
  inventoryCap: 80,
  staleSignalMaxTicks: 2,
  cancelCooldownTicks: 1,
  staleQuoteHardStopTicks: 3,
  maxAdverseSelectionRate: 0.35,
};
