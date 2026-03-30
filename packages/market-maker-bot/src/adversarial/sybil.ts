import { CHAIN_PROFILES } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

export type SybilBreach = {
  chain: ChainId;
  control:
    | "sybil.max_cluster_concentration_pct"
    | "sybil.max_identity_churn_rate"
    | "sybil.max_circular_flow_ratio"
    | "resolution.max_coordinated_push_score"
    | "resolution.min_independent_participants";
  expected: string;
  actual: number;
};

type SybilControls = {
  maxClusterConcentrationPct: number;
  maxIdentityChurnRate: number;
  maxCircularFlowRatio: number;
  maxCoordinatedPushScore: number;
  minIndependentParticipants: number;
};

const DEFAULT_CONTROLS: SybilControls = {
  maxClusterConcentrationPct: 55,
  maxIdentityChurnRate: 0.58,
  maxCircularFlowRatio: 0.63,
  maxCoordinatedPushScore: 48,
  minIndependentParticipants: 10,
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

export function evaluateSybilBreaches(
  report: SuiteReport,
  controls: SybilControls = DEFAULT_CONTROLS,
): SybilBreach[] {
  const breaches: SybilBreach[] = [];

  for (const chainReport of report.chains) {
    const profile = chainProfile(chainReport.chain);
    const sybil = scenarioById(chainReport.scenarios, "sybil_wash_trading");
    const churn = scenarioById(chainReport.scenarios, "sybil_identity_churn");
    const rebate = scenarioById(chainReport.scenarios, "rebate_farming_ring");
    const resolution = scenarioById(
      chainReport.scenarios,
      "coordinated_resolution_push",
    );

    const clusterConcentrationPct =
      16 +
      sybil.mitigated.exploitEvents * 1.7 +
      sybil.mitigated.toxicFillRate * 12 +
      profile.mempoolFriction * 7;
    if (clusterConcentrationPct > controls.maxClusterConcentrationPct) {
      breaches.push({
        chain: chainReport.chain,
        control: "sybil.max_cluster_concentration_pct",
        expected: `<= ${controls.maxClusterConcentrationPct}`,
        actual: Number(clusterConcentrationPct.toFixed(2)),
      });
    }

    const identityChurnRate =
      churn.mitigated.toxicFillRate * 0.75 +
      churn.mitigated.exploitEvents / 65 +
      profile.mempoolFriction * 0.16;
    if (identityChurnRate > controls.maxIdentityChurnRate) {
      breaches.push({
        chain: chainReport.chain,
        control: "sybil.max_identity_churn_rate",
        expected: `<= ${controls.maxIdentityChurnRate}`,
        actual: Number(identityChurnRate.toFixed(4)),
      });
    }

    const circularFlowRatio =
      rebate.mitigated.toxicFillRate * 0.9 + rebate.mitigated.exploitEvents / 55;
    if (circularFlowRatio > controls.maxCircularFlowRatio) {
      breaches.push({
        chain: chainReport.chain,
        control: "sybil.max_circular_flow_ratio",
        expected: `<= ${controls.maxCircularFlowRatio}`,
        actual: Number(circularFlowRatio.toFixed(4)),
      });
    }

    const coordinatedPushScore =
      resolution.mitigated.exploitEvents * 1.6 +
      resolution.mitigated.avgAdverseSlippageBps * 0.11 +
      profile.oracleLagAmplifier * 6;
    if (coordinatedPushScore > controls.maxCoordinatedPushScore) {
      breaches.push({
        chain: chainReport.chain,
        control: "resolution.max_coordinated_push_score",
        expected: `<= ${controls.maxCoordinatedPushScore}`,
        actual: Number(coordinatedPushScore.toFixed(2)),
      });
    }

    const independentParticipants = Math.round(
      28 - coordinatedPushScore / 3 - profile.mevRisk * 3,
    );
    if (independentParticipants < controls.minIndependentParticipants) {
      breaches.push({
        chain: chainReport.chain,
        control: "resolution.min_independent_participants",
        expected: `>= ${controls.minIndependentParticipants}`,
        actual: independentParticipants,
      });
    }
  }

  return breaches;
}
