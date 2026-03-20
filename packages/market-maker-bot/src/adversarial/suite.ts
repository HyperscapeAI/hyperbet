import type {
  ChainId,
  ChainProfile,
  ChainReport,
  ScenarioId,
  ScenarioRun,
  SuiteReport,
} from "./types.js";
import {
  BASELINE_GUARDS,
  CHAIN_PROFILES,
  DEFAULT_SEED,
  MITIGATED_GUARDS,
  SCENARIOS,
} from "./config.js";
import { evaluateScenarioBudget } from "./budget.js";
import { SCENARIO_RISK_BUDGETS } from "./spec.js";
import { simulateScenario } from "./simulate.js";

function evaluateScenario(
  scenario: ScenarioId,
  chain: ChainProfile,
  seed: number,
): ScenarioRun {
  const baseline = simulateScenario({
    scenario,
    chain,
    guards: BASELINE_GUARDS,
    seed,
  });
  const mitigated = simulateScenario({
    scenario,
    chain,
    guards: MITIGATED_GUARDS,
    seed,
  });

  const improved = mitigated.attackerPnl <= baseline.attackerPnl;
  const lossReduction =
    baseline.attackerPnl <= 0 ? 1 : 1 - mitigated.attackerPnl / baseline.attackerPnl;
  const toxicityReduced = mitigated.toxicFillRate <= baseline.toxicFillRate;
  const drawdownImproved = mitigated.maxDrawdown >= baseline.maxDrawdown;
  const exploitEventsReduced = mitigated.exploitEvents <= baseline.exploitEvents;
  const budgetBreaches = evaluateScenarioBudget({
    scenario,
    baseline,
    mitigated,
    improved,
    budgetPass: false,
    mitigationPass: false,
    requiredControls: [],
    budgetBreaches: [],
    notes: [],
  });
  const budgetPass = budgetBreaches.length === 0;
  const requiredControls = SCENARIO_RISK_BUDGETS[scenario].requiredControls;

  return {
    scenario,
    baseline,
    mitigated,
    improved,
    budgetPass,
    mitigationPass: budgetPass,
    requiredControls,
    budgetBreaches,
    notes: [
      `loss_reduction=${(lossReduction * 100).toFixed(1)}%`,
      `toxic_fill_rate baseline=${baseline.toxicFillRate} mitigated=${mitigated.toxicFillRate}`,
      `drawdown baseline=${baseline.maxDrawdown} mitigated=${mitigated.maxDrawdown}`,
      `exploit_events baseline=${baseline.exploitEvents} mitigated=${mitigated.exploitEvents}`,
      `adverse_slippage_bps baseline=${baseline.avgAdverseSlippageBps} mitigated=${mitigated.avgAdverseSlippageBps}`,
      `stale_quote_uptime_ratio=${mitigated.staleQuoteUptimeRatio}`,
      `orphan_orders=${mitigated.orphanOrderCount}`,
      `reconciliation_lag_ms=${mitigated.reconciliationLagMs}`,
      `unresolved_claim_backlog=${mitigated.unresolvedClaimBacklog}`,
      `controls=${requiredControls.join(",")}`,
      `aux_checks toxicityReduced=${toxicityReduced} drawdownImproved=${drawdownImproved} exploitEventsReduced=${exploitEventsReduced}`,
      budgetPass
        ? "budget=pass"
        : `budget=fail ${budgetBreaches.map((entry) => `${entry.control}:${entry.actual}`).join(",")}`,
    ],
  };
}

const LEGACY_SCENARIO_SEED_OFFSETS: Record<ScenarioId, number> = {
  latency_sniping: 0,
  spoof_pressure: 1,
  toxic_flow_poisoning: 2,
  stale_signal_arbitrage: 3,
  liquidation_cascade: 4,
  gas_auction_backrun: 5,
  restart_mid_fill: 6,
  orphan_sweep_failure: 7,
  rpc_split_brain: 8,
  nonce_collision_replay: 9,
  reorg_finality_lag: 10,
  rounding_abuse: 11,
  fee_token_depletion: 12,
  cross_market_inventory_bleed: 13,
  sybil_wash_trading: 14,
  rebate_farming_ring: 15,
  coordinated_resolution_push: 16,
  layering_spoof_ladder: 17,
  quote_stuffing_burst: 18,
  cancel_storm_griefing: 19,
  sybil_identity_churn: 20,
  amm_sandwich_attack: 21,
  amm_reserve_manipulation: 22,
  amm_stale_price_arb: 23,
  amm_slippage_griefing: 24,
  amm_token_drain: 25,
  amm_expiry_race: 26,
};

function scenarioSeedOffset(scenario: ScenarioId): number {
  return LEGACY_SCENARIO_SEED_OFFSETS[scenario];
}

function buildChainReport(chain: ChainProfile, seed: number): ChainReport {
  const scenarios = SCENARIOS.map((scenario) =>
    evaluateScenario(scenario, chain, seed + scenarioSeedOffset(scenario)),
  );

  return {
    chain: chain.chain,
    scenarios,
    summary: {
      scenarioCount: scenarios.length,
      improvedCount: scenarios.filter((entry) => entry.improved).length,
      passCount: scenarios.filter((entry) => entry.mitigationPass).length,
    },
  };
}

function selectChainProfiles(chainFilter?: ChainId): ChainProfile[] {
  if (!chainFilter) {
    return CHAIN_PROFILES;
  }

  const chain = CHAIN_PROFILES.find((entry) => entry.chain === chainFilter);
  if (!chain) {
    throw new Error(`unknown adversarial chain filter: ${chainFilter}`);
  }
  return [chain];
}

export function runAdversarialSuite(
  seed = DEFAULT_SEED,
  chainFilter?: ChainId,
): SuiteReport {
  const selectedChains = selectChainProfiles(chainFilter);
  const chains = selectedChains.map((chain) => {
    const canonicalIndex = CHAIN_PROFILES.findIndex(
      (entry) => entry.chain === chain.chain,
    );
    return buildChainReport(chain, seed + canonicalIndex * 1000);
  });

  const flat = chains.flatMap((chain) => chain.scenarios);
  return {
    generatedAt: new Date().toISOString(),
    seed,
    chains,
    summary: {
      totalScenarios: flat.length,
      improvedScenarios: flat.filter((entry) => entry.improved).length,
      mitigationPasses: flat.filter((entry) => entry.mitigationPass).length,
    },
  };
}

export function toMarkdownSummary(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push("# Market-Maker Adversarial Suite Summary");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Seed: ${report.seed}`);
  lines.push(
    `Overall: ${report.summary.mitigationPasses}/${report.summary.totalScenarios} scenarios passed`,
  );
  lines.push("");
  for (const chain of report.chains) {
    lines.push(`## ${chain.chain.toUpperCase()}`);
    lines.push(
      `Passes: ${chain.summary.passCount}/${chain.summary.scenarioCount} | Improved: ${chain.summary.improvedCount}/${chain.summary.scenarioCount}`,
    );
    lines.push("");
    lines.push("| Scenario | Pass | Baseline Attacker PnL | Mitigated Attacker PnL | Notes |\n|---|---:|---:|---:|---|");
    for (const scenario of chain.scenarios) {
      lines.push(
        `| ${scenario.scenario} | ${scenario.budgetPass ? "yes" : "no"} | ${scenario.baseline.attackerPnl.toFixed(4)} | ${scenario.mitigated.attackerPnl.toFixed(4)} | ${scenario.notes.join("; ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
