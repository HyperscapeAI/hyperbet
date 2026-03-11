export type ChainId = "solana" | "bsc" | "avax";

export type ScenarioId =
  | "latency_sniping"
  | "spoof_pressure"
  | "toxic_flow_poisoning"
  | "stale_signal_arbitrage"
  | "liquidation_cascade"
  | "gas_auction_backrun";

export type GuardProfile = {
  name: "baseline" | "mitigated";
  repriceDelayTicks: number;
  maxSkewBps: number;
  toxicFlowThreshold: number;
  inventoryCap: number;
  staleSignalMaxTicks: number;
  cancelCooldownTicks: number;
  staleQuoteHardStopTicks: number;
  maxAdverseSelectionRate: number;
};

export type ChainProfile = {
  chain: ChainId;
  volatilityBps: number;
  baseSpreadBps: number;
  feeBps: number;
  settlementLagTicks: number;
  riskMultiplier: number;
};

export type Metrics = {
  mmPnl: number;
  attackerPnl: number;
  maxDrawdown: number;
  toxicFillRate: number;
  inventoryPeak: number;
  exploitEvents: number;
  avgAdverseSlippageBps: number;
};

export type ScenarioRun = {
  scenario: ScenarioId;
  baseline: Metrics;
  mitigated: Metrics;
  improved: boolean;
  mitigationPass: boolean;
  notes: string[];
};

export type ChainReport = {
  chain: ChainId;
  scenarios: ScenarioRun[];
  summary: {
    scenarioCount: number;
    improvedCount: number;
    passCount: number;
  };
};

export type SuiteReport = {
  generatedAt: string;
  seed: number;
  chains: ChainReport[];
  summary: {
    totalScenarios: number;
    improvedScenarios: number;
    mitigationPasses: number;
  };
};

export type MarketState = {
  inventory: number;
  cash: number;
  markPrice: number;
  drawdown: number;
  toxicFills: number;
  totalFills: number;
  inventoryPeak: number;
  exploitEvents: number;
  adverseSlippageBpsTotal: number;
};

export type VulnerabilityVector = {
  latency: number;
  spoof: number;
  toxic: number;
  stale: number;
  inventory: number;
  cancel: number;
};
