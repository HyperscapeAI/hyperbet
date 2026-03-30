import { CHAIN_RISK_BUDGETS, SCENARIO_RISK_BUDGETS } from "./spec.js";
import type { BudgetBreach, ChainReport, ChainId, ScenarioRun } from "./types.js";

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function evaluateScenarioBudget(run: ScenarioRun): BudgetBreach[] {
  const budget = SCENARIO_RISK_BUDGETS[run.scenario];
  const breaches: BudgetBreach[] = [];

  if (run.mitigated.attackerPnl > budget.maxMitigatedAttackerPnl) {
    breaches.push({
      control: "matrix.scenario.max_mitigated_attacker_pnl",
      expected: `<= ${budget.maxMitigatedAttackerPnl}`,
      actual: round(run.mitigated.attackerPnl),
    });
  }
  if (run.mitigated.maxDrawdown < budget.minMitigatedMaxDrawdown) {
    breaches.push({
      control: "matrix.scenario.min_mitigated_max_drawdown",
      expected: `>= ${budget.minMitigatedMaxDrawdown}`,
      actual: round(run.mitigated.maxDrawdown),
    });
  }
  if (run.mitigated.exploitEvents > budget.maxExploitEvents) {
    breaches.push({
      control: "matrix.scenario.max_exploit_events",
      expected: `<= ${budget.maxExploitEvents}`,
      actual: round(run.mitigated.exploitEvents),
    });
  }
  if (run.mitigated.toxicFillRate > budget.maxToxicFillRate) {
    breaches.push({
      control: "matrix.scenario.max_toxic_fill_rate",
      expected: `<= ${budget.maxToxicFillRate}`,
      actual: round(run.mitigated.toxicFillRate),
    });
  }
  if (run.mitigated.avgAdverseSlippageBps > budget.maxAdverseSlippageBps) {
    breaches.push({
      control: "matrix.scenario.max_adverse_slippage_bps",
      expected: `<= ${budget.maxAdverseSlippageBps}`,
      actual: round(run.mitigated.avgAdverseSlippageBps),
    });
  }
  if (run.mitigated.staleQuoteUptimeRatio > budget.maxStaleQuoteUptimeRatio) {
    breaches.push({
      control: "matrix.scenario.max_stale_quote_uptime_ratio",
      expected: `<= ${budget.maxStaleQuoteUptimeRatio}`,
      actual: round(run.mitigated.staleQuoteUptimeRatio),
    });
  }
  if (run.mitigated.orphanOrderCount > budget.maxOrphanOrderCount) {
    breaches.push({
      control: "matrix.scenario.max_orphan_order_count",
      expected: `<= ${budget.maxOrphanOrderCount}`,
      actual: round(run.mitigated.orphanOrderCount),
    });
  }
  if (run.mitigated.reconciliationLagMs > budget.maxReconciliationLagMs) {
    breaches.push({
      control: "matrix.scenario.max_reconciliation_lag_ms",
      expected: `<= ${budget.maxReconciliationLagMs}`,
      actual: round(run.mitigated.reconciliationLagMs),
    });
  }
  if (run.mitigated.unresolvedClaimBacklog > budget.maxUnresolvedClaimBacklog) {
    breaches.push({
      control: "matrix.scenario.max_unresolved_claim_backlog",
      expected: `<= ${budget.maxUnresolvedClaimBacklog}`,
      actual: round(run.mitigated.unresolvedClaimBacklog),
    });
  }

  return breaches;
}

export type ChainBudgetBreach = BudgetBreach & {
  chain: ChainId;
  scenario: ScenarioRun["scenario"] | "aggregate";
};

export function evaluateChainBudget(chainReport: ChainReport): ChainBudgetBreach[] {
  const budget = CHAIN_RISK_BUDGETS[chainReport.chain];
  const breaches: ChainBudgetBreach[] = [];
  const aggregateAttackerPnl = chainReport.scenarios.reduce(
    (sum, entry) => sum + entry.mitigated.attackerPnl,
    0,
  );
  const aggregateExploitEvents = chainReport.scenarios.reduce(
    (sum, entry) => sum + entry.mitigated.exploitEvents,
    0,
  );
  const aggregateInventoryPeak = chainReport.scenarios.reduce(
    (sum, entry) => sum + entry.mitigated.inventoryPeak,
    0,
  );
  const aggregateReconciliationLagMs = chainReport.scenarios.reduce(
    (sum, entry) => sum + entry.mitigated.reconciliationLagMs,
    0,
  );
  const aggregateUnresolvedClaimBacklog = chainReport.scenarios.reduce(
    (sum, entry) => sum + entry.mitigated.unresolvedClaimBacklog,
    0,
  );

  if (aggregateAttackerPnl > budget.maxAggregateMitigatedAttackerPnl) {
    breaches.push({
      chain: chainReport.chain,
      scenario: "aggregate",
      control: "matrix.chain.max_aggregate_mitigated_attacker_pnl",
      expected: `<= ${budget.maxAggregateMitigatedAttackerPnl}`,
      actual: round(aggregateAttackerPnl),
    });
  }
  if (aggregateExploitEvents > budget.maxAggregateExploitEvents) {
    breaches.push({
      chain: chainReport.chain,
      scenario: "aggregate",
      control: "matrix.chain.max_aggregate_exploit_events",
      expected: `<= ${budget.maxAggregateExploitEvents}`,
      actual: round(aggregateExploitEvents),
    });
  }
  if (aggregateInventoryPeak > budget.maxAggregateInventoryPeak) {
    breaches.push({
      chain: chainReport.chain,
      scenario: "aggregate",
      control: "matrix.chain.max_aggregate_inventory_peak",
      expected: `<= ${budget.maxAggregateInventoryPeak}`,
      actual: round(aggregateInventoryPeak),
    });
  }
  if (aggregateReconciliationLagMs > budget.maxAggregateReconciliationLagMs) {
    breaches.push({
      chain: chainReport.chain,
      scenario: "aggregate",
      control: "matrix.chain.max_aggregate_reconciliation_lag_ms",
      expected: `<= ${budget.maxAggregateReconciliationLagMs}`,
      actual: round(aggregateReconciliationLagMs),
    });
  }
  if (
    aggregateUnresolvedClaimBacklog > budget.maxAggregateUnresolvedClaimBacklog
  ) {
    breaches.push({
      chain: chainReport.chain,
      scenario: "aggregate",
      control: "matrix.chain.max_aggregate_unresolved_claim_backlog",
      expected: `<= ${budget.maxAggregateUnresolvedClaimBacklog}`,
      actual: round(aggregateUnresolvedClaimBacklog),
    });
  }

  return breaches;
}
