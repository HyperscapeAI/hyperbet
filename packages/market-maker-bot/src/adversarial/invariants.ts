import type { ScenarioRun, SuiteReport } from "./types.js";

export type InvariantLimits = {
  maxMitigatedAttackerPnl: number;
  maxMitigatedExploitEvents: number;
  maxMitigatedInventoryPeak: number;
  maxMitigatedToxicFillRate: number;
  maxMitigatedAdverseSlippageBps: number;
  minLossReductionPct: number;
  minBaselineExploitEvents: number;
};

export type InvariantBreach = {
  chain: string;
  scenario: string;
  invariant: string;
  expected: string;
  actual: number;
};

export const DEFAULT_INVARIANT_LIMITS: InvariantLimits = {
  maxMitigatedAttackerPnl: 55,
  maxMitigatedExploitEvents: 45,
  maxMitigatedInventoryPeak: 60,
  maxMitigatedToxicFillRate: 0.9,
  maxMitigatedAdverseSlippageBps: 170,
  minLossReductionPct: 0.7,
  minBaselineExploitEvents: 3,
};

function lossReductionPct(run: ScenarioRun): number {
  if (run.baseline.attackerPnl <= 0) {
    return 1;
  }
  return 1 - run.mitigated.attackerPnl / run.baseline.attackerPnl;
}

export function evaluateInvariantBreaches(
  report: SuiteReport,
  limits: InvariantLimits = DEFAULT_INVARIANT_LIMITS,
): InvariantBreach[] {
  const breaches: InvariantBreach[] = [];

  for (const chain of report.chains) {
    for (const run of chain.scenarios) {
      const reduction = lossReductionPct(run);

      if (run.baseline.exploitEvents < limits.minBaselineExploitEvents) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "baseline.exploitEvents",
          expected: `>= ${limits.minBaselineExploitEvents}`,
          actual: run.baseline.exploitEvents,
        });
      }

      if (run.mitigated.attackerPnl > limits.maxMitigatedAttackerPnl) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "mitigated.attackerPnl",
          expected: `<= ${limits.maxMitigatedAttackerPnl}`,
          actual: run.mitigated.attackerPnl,
        });
      }

      if (run.mitigated.exploitEvents > limits.maxMitigatedExploitEvents) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "mitigated.exploitEvents",
          expected: `<= ${limits.maxMitigatedExploitEvents}`,
          actual: run.mitigated.exploitEvents,
        });
      }

      if (run.mitigated.inventoryPeak > limits.maxMitigatedInventoryPeak) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "mitigated.inventoryPeak",
          expected: `<= ${limits.maxMitigatedInventoryPeak}`,
          actual: run.mitigated.inventoryPeak,
        });
      }

      if (run.mitigated.toxicFillRate > limits.maxMitigatedToxicFillRate) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "mitigated.toxicFillRate",
          expected: `<= ${limits.maxMitigatedToxicFillRate}`,
          actual: run.mitigated.toxicFillRate,
        });
      }

      if (
        run.mitigated.avgAdverseSlippageBps > limits.maxMitigatedAdverseSlippageBps
      ) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "mitigated.avgAdverseSlippageBps",
          expected: `<= ${limits.maxMitigatedAdverseSlippageBps}`,
          actual: run.mitigated.avgAdverseSlippageBps,
        });
      }

      if (reduction < limits.minLossReductionPct) {
        breaches.push({
          chain: chain.chain,
          scenario: run.scenario,
          invariant: "lossReductionPct",
          expected: `>= ${limits.minLossReductionPct}`,
          actual: Number(reduction.toFixed(6)),
        });
      }
    }
  }

  return breaches;
}
