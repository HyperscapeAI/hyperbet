import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ScenarioRun, SuiteReport } from "./types.js";

export type BaselineTolerances = {
  mitigatedAttackerPnlRelative: number;
  mitigatedAttackerPnlAbsolute: number;
  mitigatedExploitEventsAbsolute: number;
  mitigatedInventoryPeakAbsolute: number;
  mitigatedToxicFillRateAbsolute: number;
  mitigatedAdverseSlippageBpsAbsolute: number;
  minLossReductionPctDelta: number;
};

export type RegressionFinding = {
  chain: string;
  scenario: string;
  metric:
    | "mitigated.attackerPnl"
    | "mitigated.exploitEvents"
    | "mitigated.inventoryPeak"
    | "mitigated.toxicFillRate"
    | "mitigated.avgAdverseSlippageBps"
    | "lossReductionPct";
  baseline: number;
  candidate: number;
  threshold: number;
};

export type BaselineComparison = {
  regressions: RegressionFinding[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BASELINE_PATH = path.join(__dirname, "baseline.snapshot.json");

export const DEFAULT_BASELINE_TOLERANCES: BaselineTolerances = {
  mitigatedAttackerPnlRelative: 0.12,
  mitigatedAttackerPnlAbsolute: 1.5,
  mitigatedExploitEventsAbsolute: 2,
  mitigatedInventoryPeakAbsolute: 3,
  mitigatedToxicFillRateAbsolute: 0.02,
  mitigatedAdverseSlippageBpsAbsolute: 8,
  minLossReductionPctDelta: 0.03,
};

function keyByScenario(report: SuiteReport): Map<string, ScenarioRun> {
  const map = new Map<string, ScenarioRun>();
  for (const chain of report.chains) {
    for (const scenario of chain.scenarios) {
      map.set(`${chain.chain}:${scenario.scenario}`, scenario);
    }
  }
  return map;
}

function lossReductionPct(run: ScenarioRun): number {
  if (run.baseline.attackerPnl <= 0) {
    return 1;
  }
  return 1 - run.mitigated.attackerPnl / run.baseline.attackerPnl;
}

export function compareAgainstBaseline(
  baseline: SuiteReport,
  candidate: SuiteReport,
  tolerances: BaselineTolerances = DEFAULT_BASELINE_TOLERANCES,
): BaselineComparison {
  const regressions: RegressionFinding[] = [];
  const baselineByScenario = keyByScenario(baseline);
  const candidateByScenario = keyByScenario(candidate);

  for (const [key, baseRun] of baselineByScenario.entries()) {
    const candidateRun = candidateByScenario.get(key);
    if (!candidateRun) {
      continue;
    }

    const [chain, scenario] = key.split(":");

    const attackerThreshold =
      baseRun.mitigated.attackerPnl * (1 + tolerances.mitigatedAttackerPnlRelative) +
      tolerances.mitigatedAttackerPnlAbsolute;
    if (candidateRun.mitigated.attackerPnl > attackerThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "mitigated.attackerPnl",
        baseline: baseRun.mitigated.attackerPnl,
        candidate: candidateRun.mitigated.attackerPnl,
        threshold: attackerThreshold,
      });
    }

    const exploitThreshold =
      baseRun.mitigated.exploitEvents + tolerances.mitigatedExploitEventsAbsolute;
    if (candidateRun.mitigated.exploitEvents > exploitThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "mitigated.exploitEvents",
        baseline: baseRun.mitigated.exploitEvents,
        candidate: candidateRun.mitigated.exploitEvents,
        threshold: exploitThreshold,
      });
    }

    const inventoryThreshold =
      baseRun.mitigated.inventoryPeak + tolerances.mitigatedInventoryPeakAbsolute;
    if (candidateRun.mitigated.inventoryPeak > inventoryThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "mitigated.inventoryPeak",
        baseline: baseRun.mitigated.inventoryPeak,
        candidate: candidateRun.mitigated.inventoryPeak,
        threshold: inventoryThreshold,
      });
    }

    const toxicThreshold =
      baseRun.mitigated.toxicFillRate + tolerances.mitigatedToxicFillRateAbsolute;
    if (candidateRun.mitigated.toxicFillRate > toxicThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "mitigated.toxicFillRate",
        baseline: baseRun.mitigated.toxicFillRate,
        candidate: candidateRun.mitigated.toxicFillRate,
        threshold: toxicThreshold,
      });
    }

    const slippageThreshold =
      baseRun.mitigated.avgAdverseSlippageBps +
      tolerances.mitigatedAdverseSlippageBpsAbsolute;
    if (candidateRun.mitigated.avgAdverseSlippageBps > slippageThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "mitigated.avgAdverseSlippageBps",
        baseline: baseRun.mitigated.avgAdverseSlippageBps,
        candidate: candidateRun.mitigated.avgAdverseSlippageBps,
        threshold: slippageThreshold,
      });
    }

    const baseReduction = lossReductionPct(baseRun);
    const candidateReduction = lossReductionPct(candidateRun);
    const reductionThreshold = baseReduction - tolerances.minLossReductionPctDelta;
    if (candidateReduction < reductionThreshold) {
      regressions.push({
        chain,
        scenario,
        metric: "lossReductionPct",
        baseline: Number(baseReduction.toFixed(6)),
        candidate: Number(candidateReduction.toFixed(6)),
        threshold: Number(reductionThreshold.toFixed(6)),
      });
    }
  }

  return { regressions };
}

export function readBaselineSnapshot(
  baselinePath = DEFAULT_BASELINE_PATH,
): SuiteReport {
  return JSON.parse(readFileSync(baselinePath, "utf8")) as SuiteReport;
}

export function writeBaselineSnapshot(
  report: SuiteReport,
  baselinePath = DEFAULT_BASELINE_PATH,
): void {
  writeFileSync(baselinePath, JSON.stringify(report, null, 2), "utf8");
}
