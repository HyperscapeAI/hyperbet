import { ethers } from "ethers";
import { Connection } from "@solana/web3.js";

import {
  runAdversarialSuite,
  SCENARIO_RISK_BUDGETS,
  type ChainId,
  type ScenarioId,
  type ScenarioRun,
} from "./adversarial/index.js";

type ForkTargets = {
  bscForkRpc?: string;
  avaxForkRpc?: string;
  solanaForkRpc?: string;
};

type EnvMap = Record<string, string | undefined>;

export type ForkAttackSummary = {
  chain: ChainId;
  seeds: number[];
  scenariosChecked: number;
  breaches: string[];
};

const DEFAULT_FORK_ATTACK_SEEDS = [20260311] as const;

export const FORK_ATTACK_SCENARIOS: ScenarioId[] = [
  "stale_signal_arbitrage",
  "gas_auction_backrun",
  "layering_spoof_ladder",
  "quote_stuffing_burst",
  "cancel_storm_griefing",
  "sybil_wash_trading",
  "sybil_identity_churn",
];

function parseBoolean(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseForkAttackSeeds(raw: string | undefined): number[] {
  if (!raw || raw.trim().length === 0) {
    return [...DEFAULT_FORK_ATTACK_SEEDS];
  }

  const parsed = raw
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  if (parsed.length === 0) {
    throw new Error(
      "invalid MM_FORK_ATTACK_SEEDS; expected comma-separated positive integers",
    );
  }

  return [...new Set(parsed.map((entry) => Math.trunc(entry)))];
}

function evaluateScenarioBreaches(chain: ChainId, seed: number, run: ScenarioRun): string[] {
  const budget = SCENARIO_RISK_BUDGETS[run.scenario];
  const breaches: string[] = [];

  if (!run.budgetPass) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} budgetPass=false (${run.budgetBreaches.map((entry) => entry.control).join(",")})`,
    );
  }
  if (run.mitigated.attackerPnl > budget.maxMitigatedAttackerPnl) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} mitigated attacker pnl ${run.mitigated.attackerPnl.toFixed(4)} > ${budget.maxMitigatedAttackerPnl}`,
    );
  }
  if (run.mitigated.exploitEvents > budget.maxExploitEvents) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} exploit events ${run.mitigated.exploitEvents} > ${budget.maxExploitEvents}`,
    );
  }
  if (run.mitigated.toxicFillRate > budget.maxToxicFillRate) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} toxic fill rate ${run.mitigated.toxicFillRate.toFixed(4)} > ${budget.maxToxicFillRate}`,
    );
  }
  if (run.mitigated.avgAdverseSlippageBps > budget.maxAdverseSlippageBps) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} adverse slippage ${run.mitigated.avgAdverseSlippageBps.toFixed(2)} > ${budget.maxAdverseSlippageBps}`,
    );
  }
  if (run.mitigated.staleQuoteUptimeRatio > budget.maxStaleQuoteUptimeRatio) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} stale quote uptime ${run.mitigated.staleQuoteUptimeRatio.toFixed(4)} > ${budget.maxStaleQuoteUptimeRatio}`,
    );
  }
  if (run.mitigated.orphanOrderCount > budget.maxOrphanOrderCount) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} orphan orders ${run.mitigated.orphanOrderCount} > ${budget.maxOrphanOrderCount}`,
    );
  }
  if (run.mitigated.reconciliationLagMs > budget.maxReconciliationLagMs) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} reconciliation lag ${run.mitigated.reconciliationLagMs} > ${budget.maxReconciliationLagMs}`,
    );
  }
  if (run.mitigated.unresolvedClaimBacklog > budget.maxUnresolvedClaimBacklog) {
    breaches.push(
      `[seed=${seed}] ${chain}/${run.scenario} unresolved claim backlog ${run.mitigated.unresolvedClaimBacklog} > ${budget.maxUnresolvedClaimBacklog}`,
    );
  }

  return breaches;
}

export function runForkAttackSuite(chain: ChainId, seeds: number[]): ForkAttackSummary {
  const breaches: string[] = [];

  for (const seed of seeds) {
    const report = runAdversarialSuite(seed, chain);
    const chainReport = report.chains[0];
    if (!chainReport || chainReport.chain !== chain) {
      breaches.push(`[seed=${seed}] missing chain report for ${chain}`);
      continue;
    }

    for (const scenarioId of FORK_ATTACK_SCENARIOS) {
      const scenarioRun = chainReport.scenarios.find((entry) => entry.scenario === scenarioId);
      if (!scenarioRun) {
        breaches.push(`[seed=${seed}] missing scenario ${chain}/${scenarioId}`);
        continue;
      }
      breaches.push(...evaluateScenarioBreaches(chain, seed, scenarioRun));
    }
  }

  return {
    chain,
    seeds,
    scenariosChecked: seeds.length * FORK_ATTACK_SCENARIOS.length,
    breaches,
  };
}

export function resolveForkTargets(env: EnvMap): ForkTargets {
  return {
    bscForkRpc: env.BSC_FORK_RPC_URL?.trim() || undefined,
    avaxForkRpc: env.AVAX_FORK_RPC_URL?.trim() || undefined,
    solanaForkRpc: env.SOLANA_FORK_RPC_URL?.trim() || undefined,
  };
}

function configuredChains(targets: ForkTargets): ChainId[] {
  const chains: ChainId[] = [];
  if (targets.bscForkRpc) {
    chains.push("bsc");
  }
  if (targets.avaxForkRpc) {
    chains.push("avax");
  }
  if (targets.solanaForkRpc) {
    chains.push("solana");
  }
  return chains;
}

function missingRequiredChainTargets(targets: ForkTargets): string[] {
  const missing: string[] = [];
  if (!targets.bscForkRpc) {
    missing.push("BSC_FORK_RPC_URL");
  }
  if (!targets.avaxForkRpc) {
    missing.push("AVAX_FORK_RPC_URL");
  }
  if (!targets.solanaForkRpc) {
    missing.push("SOLANA_FORK_RPC_URL");
  }
  return missing;
}

async function checkEvmFork(label: "bsc" | "avax", rpcUrl: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const [network, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);
  return `${label} chainId=${network.chainId.toString()} block=${blockNumber}`;
}

async function checkSolanaFork(rpcUrl: string): Promise<string> {
  const connection = new Connection(rpcUrl, "confirmed");
  const [version, blockHeight] = await Promise.all([
    connection.getVersion(),
    connection.getBlockHeight("confirmed"),
  ]);
  return `solana core=${version["solana-core"] ?? "unknown"} block=${blockHeight}`;
}

export async function runForkHarness(env: EnvMap): Promise<{
  executed: boolean;
  lines: string[];
}> {
  const targets = resolveForkTargets(env);
  const lines: string[] = [];
  const checks: Array<Promise<string>> = [];

  const requireAllChains = parseBoolean(env.MM_FORK_REQUIRE_ALL_CHAINS);
  const attackSeeds = parseForkAttackSeeds(env.MM_FORK_ATTACK_SEEDS);

  if (requireAllChains) {
    const missing = missingRequiredChainTargets(targets);
    if (missing.length > 0) {
      throw new Error(
        `MM_FORK_REQUIRE_ALL_CHAINS is enabled but missing: ${missing.join(", ")}`,
      );
    }
  }

  if (targets.bscForkRpc) {
    checks.push(checkEvmFork("bsc", targets.bscForkRpc));
  }
  if (targets.avaxForkRpc) {
    checks.push(checkEvmFork("avax", targets.avaxForkRpc));
  }
  if (targets.solanaForkRpc) {
    checks.push(checkSolanaFork(targets.solanaForkRpc));
  }

  if (checks.length === 0) {
    lines.push(
      "[fork-harness] skipped (set BSC_FORK_RPC_URL and/or AVAX_FORK_RPC_URL and/or SOLANA_FORK_RPC_URL)",
    );
    return { executed: false, lines };
  }

  const results = await Promise.all(checks);
  for (const line of results) {
    lines.push(`[fork-harness] ok ${line}`);
  }

  const chainRuns = configuredChains(targets).map((chain) =>
    runForkAttackSuite(chain, attackSeeds),
  );

  let hasBreaches = false;
  for (const run of chainRuns) {
    if (run.breaches.length === 0) {
      lines.push(
        `[fork-harness] attack-suite pass chain=${run.chain} seeds=${run.seeds.join("|")} scenarios=${run.scenariosChecked}`,
      );
      continue;
    }

    hasBreaches = true;
    lines.push(
      `[fork-harness] attack-suite fail chain=${run.chain} seeds=${run.seeds.join("|")} breaches=${run.breaches.length}`,
    );
    for (const breach of run.breaches) {
      lines.push(`[fork-harness] breach ${breach}`);
    }
  }

  if (hasBreaches) {
    throw new Error("fork attack suite detected mitigation regressions");
  }

  return { executed: true, lines };
}

if (process.argv[1]?.includes("fork-harness")) {
  runForkHarness(process.env)
    .then((result) => {
      for (const line of result.lines) {
        console.log(line);
      }
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fork-harness] fail ${message}`);
      process.exit(1);
    });
}
