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

  const mitigationPass = improved;

  return {
    scenario,
    baseline,
    mitigated,
    improved,
    mitigationPass,
    notes: [
      `loss_reduction=${(lossReduction * 100).toFixed(1)}%`,
      `toxic_fill_rate baseline=${baseline.toxicFillRate} mitigated=${mitigated.toxicFillRate}`,
      `drawdown baseline=${baseline.maxDrawdown} mitigated=${mitigated.maxDrawdown}`,
      `exploit_events baseline=${baseline.exploitEvents} mitigated=${mitigated.exploitEvents}`,
      `adverse_slippage_bps baseline=${baseline.avgAdverseSlippageBps} mitigated=${mitigated.avgAdverseSlippageBps}`,
      `aux_checks toxicityReduced=${toxicityReduced} drawdownImproved=${drawdownImproved} exploitEventsReduced=${exploitEventsReduced}`,
    ],
  };
}

function buildChainReport(chain: ChainProfile, seed: number): ChainReport {
  const scenarios = SCENARIOS.map((scenario, index) =>
    evaluateScenario(scenario, chain, seed + index),
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
  const chains = selectedChains.map((chain, chainIndex) =>
    buildChainReport(chain, seed + chainIndex * 1000),
  );

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
        `| ${scenario.scenario} | ${scenario.mitigationPass ? "yes" : "no"} | ${scenario.baseline.attackerPnl.toFixed(4)} | ${scenario.mitigated.attackerPnl.toFixed(4)} | ${scenario.notes.join("; ")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
