import { CHAIN_PROFILES } from "./config.js";
import type { ChainId, ChainProfile, ScenarioRun, SuiteReport } from "./types.js";

export type ChaosBreach = {
  chain: ChainId;
  control:
    | "chaos.oracle_outage.max_damage_score"
    | "chaos.finality_jitter.max_damage_score"
    | "chaos.liquidity_cliff.max_inventory_stress";
  expected: string;
  actual: number;
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

export function evaluateChaosBreaches(report: SuiteReport): ChaosBreach[] {
  const breaches: ChaosBreach[] = [];

  for (const chainReport of report.chains) {
    const profile = chainProfile(chainReport.chain);
    const stale = scenarioById(chainReport.scenarios, "stale_signal_arbitrage");
    const gas = scenarioById(chainReport.scenarios, "gas_auction_backrun");
    const liquidation = scenarioById(chainReport.scenarios, "liquidation_cascade");
    const resolution = scenarioById(
      chainReport.scenarios,
      "coordinated_resolution_push",
    );

    const oracleDamage =
      stale.mitigated.attackerPnl + stale.mitigated.exploitEvents * 1.2;
    const oracleMax = 70 + profile.oracleLagAmplifier * 6;
    if (oracleDamage > oracleMax) {
      breaches.push({
        chain: chainReport.chain,
        control: "chaos.oracle_outage.max_damage_score",
        expected: `<= ${Number(oracleMax.toFixed(2))}`,
        actual: Number(oracleDamage.toFixed(4)),
      });
    }

    const finalityDamage =
      gas.mitigated.attackerPnl + gas.mitigated.avgAdverseSlippageBps * 0.2;
    const finalityMax = 45 + profile.mevRisk * 15;
    if (finalityDamage > finalityMax) {
      breaches.push({
        chain: chainReport.chain,
        control: "chaos.finality_jitter.max_damage_score",
        expected: `<= ${Number(finalityMax.toFixed(2))}`,
        actual: Number(finalityDamage.toFixed(4)),
      });
    }

    const inventoryStress =
      liquidation.mitigated.inventoryPeak + resolution.mitigated.inventoryPeak;
    const inventoryMax = Number(
      (30 + profile.baseSpreadBps / 6 + profile.mevRisk * 21).toFixed(2),
    );
    if (inventoryStress > inventoryMax) {
      breaches.push({
        chain: chainReport.chain,
        control: "chaos.liquidity_cliff.max_inventory_stress",
        expected: `<= ${inventoryMax}`,
        actual: Number(inventoryStress.toFixed(4)),
      });
    }
  }

  return breaches;
}
