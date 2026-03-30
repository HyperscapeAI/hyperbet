import { CHAIN_PROFILES } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

export type AdaptivePolicy = {
  maxEscalationScore: number;
  maxSwitchBurden: number;
  minDefenseRecovery: number;
  maxTerminalPressure: number;
};

export type AdaptiveBreach = {
  chain: ChainId;
  control:
    | "adaptive.max_escalation_score"
    | "adaptive.max_switch_burden"
    | "adaptive.min_defense_recovery"
    | "adaptive.max_terminal_pressure";
  expected: string;
  actual: number;
};

export const DEFAULT_ADAPTIVE_POLICIES: Record<ChainId, AdaptivePolicy> = {
  solana: {
    maxEscalationScore: 72,
    maxSwitchBurden: 24,
    minDefenseRecovery: 0.48,
    maxTerminalPressure: 46,
  },
  bsc: {
    maxEscalationScore: 90,
    maxSwitchBurden: 30,
    minDefenseRecovery: 0.42,
    maxTerminalPressure: 60,
  },
  avax: {
    maxEscalationScore: 96,
    maxSwitchBurden: 32,
    minDefenseRecovery: 0.38,
    maxTerminalPressure: 64,
  },
};

function chainProfile(chain: ChainId): ChainProfile {
  const profile = CHAIN_PROFILES.find((entry) => entry.chain === chain);
  if (!profile) {
    throw new Error(`missing chain profile for ${chain}`);
  }
  return profile;
}

function scenarioById(scenarios: ScenarioRun[], id: ScenarioRun["scenario"]): ScenarioRun {
  const scenario = scenarios.find((entry) => entry.scenario === id);
  if (!scenario) {
    throw new Error(`missing scenario ${id}`);
  }
  return scenario;
}

function reduction(run: ScenarioRun): number {
  if (run.baseline.attackerPnl <= 0) {
    return 1;
  }
  return 1 - run.mitigated.attackerPnl / run.baseline.attackerPnl;
}

export function evaluateAdaptiveBreaches(
  report: SuiteReport,
  policies: Record<ChainId, AdaptivePolicy> = DEFAULT_ADAPTIVE_POLICIES,
): AdaptiveBreach[] {
  const breaches: AdaptiveBreach[] = [];

  for (const chainReport of report.chains) {
    const policy = policies[chainReport.chain];
    const profile = chainProfile(chainReport.chain);
    const quoteStuffing = scenarioById(chainReport.scenarios, "quote_stuffing_burst");
    const cancelStorm = scenarioById(chainReport.scenarios, "cancel_storm_griefing");
    const staleSignal = scenarioById(chainReport.scenarios, "stale_signal_arbitrage");
    const gasBackrun = scenarioById(chainReport.scenarios, "gas_auction_backrun");
    const layering = scenarioById(chainReport.scenarios, "layering_spoof_ladder");
    const sybilChurn = scenarioById(chainReport.scenarios, "sybil_identity_churn");
    const coordinatedPush = scenarioById(
      chainReport.scenarios,
      "coordinated_resolution_push",
    );
    const liquidation = scenarioById(chainReport.scenarios, "liquidation_cascade");

    // Three-stage adaptive attacker: probe (liveness), pivot (price discovery), terminal (resolution push).
    const probePressure =
      quoteStuffing.mitigated.exploitEvents * 0.8 +
      cancelStorm.mitigated.toxicFillRate * 14;
    const pivotPressure =
      staleSignal.mitigated.toxicFillRate * 18 +
      gasBackrun.mitigated.exploitEvents * 0.9 +
      layering.mitigated.avgAdverseSlippageBps * 0.08;
    const terminalPressure =
      sybilChurn.mitigated.toxicFillRate * 22 +
      coordinatedPush.mitigated.avgAdverseSlippageBps * 0.19 +
      liquidation.mitigated.exploitEvents * 0.55 +
      profile.oracleLagAmplifier * 3;

    const escalationScore =
      probePressure * 0.75 +
      pivotPressure * 0.95 +
      terminalPressure +
      profile.mevRisk * 6;
    if (escalationScore > policy.maxEscalationScore) {
      breaches.push({
        chain: chainReport.chain,
        control: "adaptive.max_escalation_score",
        expected: `<= ${policy.maxEscalationScore}`,
        actual: Number(escalationScore.toFixed(2)),
      });
    }

    const switchBurden =
      Math.abs(quoteStuffing.mitigated.toxicFillRate - staleSignal.mitigated.toxicFillRate) * 16 +
      Math.abs(gasBackrun.mitigated.avgAdverseSlippageBps - sybilChurn.mitigated.avgAdverseSlippageBps) * 0.08 +
      (cancelStorm.mitigated.exploitEvents + sybilChurn.mitigated.exploitEvents) * 0.4 +
      profile.mempoolFriction * 5;
    if (switchBurden > policy.maxSwitchBurden) {
      breaches.push({
        chain: chainReport.chain,
        control: "adaptive.max_switch_burden",
        expected: `<= ${policy.maxSwitchBurden}`,
        actual: Number(switchBurden.toFixed(2)),
      });
    }

    const defenseRecovery =
      (reduction(staleSignal) +
        reduction(gasBackrun) +
        reduction(sybilChurn) +
        reduction(coordinatedPush)) /
      4;
    if (defenseRecovery < policy.minDefenseRecovery) {
      breaches.push({
        chain: chainReport.chain,
        control: "adaptive.min_defense_recovery",
        expected: `>= ${policy.minDefenseRecovery}`,
        actual: Number(defenseRecovery.toFixed(4)),
      });
    }

    if (terminalPressure > policy.maxTerminalPressure) {
      breaches.push({
        chain: chainReport.chain,
        control: "adaptive.max_terminal_pressure",
        expected: `<= ${policy.maxTerminalPressure}`,
        actual: Number(terminalPressure.toFixed(2)),
      });
    }
  }

  return breaches;
}
