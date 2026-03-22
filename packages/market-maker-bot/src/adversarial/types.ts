export type ChainId = "solana" | "bsc" | "avax";

export type MarketType = "clob" | "amm";

export type ScenarioId =
  | "latency_sniping"
  | "spoof_pressure"
  | "toxic_flow_poisoning"
  | "stale_signal_arbitrage"
  | "liquidation_cascade"
  | "gas_auction_backrun"
  | "restart_mid_fill"
  | "orphan_sweep_failure"
  | "rpc_split_brain"
  | "nonce_collision_replay"
  | "reorg_finality_lag"
  | "rounding_abuse"
  | "fee_token_depletion"
  | "cross_market_inventory_bleed"
  | "layering_spoof_ladder"
  | "quote_stuffing_burst"
  | "cancel_storm_griefing"
  | "sybil_wash_trading"
  | "sybil_identity_churn"
  | "rebate_farming_ring"
  | "coordinated_resolution_push"
  | "amm_sandwich_attack"
  | "amm_reserve_manipulation"
  | "amm_stale_price_arb"
  | "amm_slippage_griefing"
  | "amm_token_drain"
  | "amm_expiry_race";

export type BudgetBreach = {
  control: string;
  expected: string;
  actual: number;
};

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
  mevRisk: number;
  mempoolFriction: number;
  oracleLagAmplifier: number;
};

export type Metrics = {
  mmPnl: number;
  attackerPnl: number;
  maxDrawdown: number;
  toxicFillRate: number;
  inventoryPeak: number;
  exploitEvents: number;
  avgAdverseSlippageBps: number;
  staleQuoteUptimeRatio: number;
  orphanOrderCount: number;
  reconciliationLagMs: number;
  unresolvedClaimBacklog: number;
};

export type ScenarioRun = {
  scenario: ScenarioId;
  baseline: Metrics;
  mitigated: Metrics;
  improved: boolean;
  budgetPass: boolean;
  mitigationPass: boolean;
  requiredControls: string[];
  budgetBreaches: BudgetBreach[];
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

export type AmmMarketState = {
  reserveYes: number;
  reserveNo: number;
  liquidity: number;
  yesBalance: number;
  noBalance: number;
  cash: number;
  drawdown: number;
  toxicFills: number;
  totalFills: number;
  exploitEvents: number;
  adverseSlippageBpsTotal: number;
};
