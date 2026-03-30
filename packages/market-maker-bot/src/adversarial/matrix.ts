import { evaluateChainBudget, evaluateScenarioBudget } from "./budget.js";
import type { ChainId, ScenarioRun, SuiteReport } from "./types.js";

export type MatrixBreach = {
  chain: ChainId;
  scenario: ScenarioRun["scenario"] | "aggregate";
  control: string;
  expected: string;
  actual: number;
};

export function evaluateMatrixBreaches(report: SuiteReport): MatrixBreach[] {
  const breaches: MatrixBreach[] = [];

  for (const chainReport of report.chains) {
    breaches.push(...evaluateChainBudget(chainReport));

    for (const scenario of chainReport.scenarios) {
      for (const breach of evaluateScenarioBudget(scenario)) {
        breaches.push({
          chain: chainReport.chain,
          scenario: scenario.scenario,
          control: breach.control,
          expected: breach.expected,
          actual: breach.actual,
        });
      }
    }
  }

  return breaches;
}
