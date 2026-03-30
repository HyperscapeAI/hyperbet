import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASELINE_GUARDS, CHAIN_PROFILES, MITIGATED_GUARDS } from "./config.js";
import { applyFill, createInitialState, vulnerabilityFor } from "./engine.js";
import { clamp, Prng } from "./math.js";
import type { ChainId, ChainProfile, GuardProfile, Metrics } from "./types.js";

type ReplayEvent = {
  truePrice: number;
  signalPrice: number;
  attackerSide: "buy" | "sell" | null;
  qty: number;
};

type ReplayTrace = {
  id: string;
  events: ReplayEvent[];
};

type ReplayCorpusFile = {
  solana?: ReplayTrace[];
  bsc?: ReplayTrace[];
  avax?: ReplayTrace[];
};

export type ReplayRun = {
  chain: ChainId;
  traceId: string;
  baseline: Metrics;
  mitigated: Metrics;
  improved: boolean;
};

export type ReplayBreach = {
  chain: ChainId;
  traceId: string;
  control:
    | "replay.trace.mitigated_attacker_pnl"
    | "replay.trace.mitigated_toxic_fill_rate"
    | "replay.trace.mitigated_exploit_events"
    | "replay.trace.min_attacker_pnl_reduction_ratio";
  expected: string;
  actual: number;
};

type ReplayBudget = {
  maxMitigatedAttackerPnl: number;
  maxMitigatedToxicFillRate: number;
  maxMitigatedExploitEvents: number;
  minAttackerPnlReductionRatio: number;
};

const REPLAY_BUDGETS: Record<ChainId, ReplayBudget> = {
  solana: {
    maxMitigatedAttackerPnl: 24,
    maxMitigatedToxicFillRate: 0.62,
    maxMitigatedExploitEvents: 18,
    minAttackerPnlReductionRatio: 0.2,
  },
  bsc: {
    maxMitigatedAttackerPnl: 34,
    maxMitigatedToxicFillRate: 0.66,
    maxMitigatedExploitEvents: 24,
    minAttackerPnlReductionRatio: 0.2,
  },
  avax: {
    maxMitigatedAttackerPnl: 38,
    maxMitigatedToxicFillRate: 0.68,
    maxMitigatedExploitEvents: 26,
    minAttackerPnlReductionRatio: 0.2,
  },
};

const currentDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPLAY_CORPUS_PATH = join(currentDir, "replay-corpus.json");

function chainProfile(chain: ChainId): ChainProfile {
  const profile = CHAIN_PROFILES.find((entry) => entry.chain === chain);
  if (!profile) {
    throw new Error(`missing replay chain profile for ${chain}`);
  }
  return profile;
}

function reductionRatio(run: ReplayRun): number {
  if (run.baseline.attackerPnl <= 0) {
    return 1;
  }
  return 1 - run.mitigated.attackerPnl / run.baseline.attackerPnl;
}

function baseSeed(traceId: string, chain: ChainId): number {
  let hash = chain.charCodeAt(0);
  for (const char of traceId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash || 1;
}

function runReplayForGuard(
  chain: ChainProfile,
  guards: GuardProfile,
  trace: ReplayTrace,
): Metrics {
  const state = createInitialState(clamp(trace.events[0]?.truePrice ?? 0.5, 0.03, 0.97));
  const vuln = vulnerabilityFor(guards);
  const seed = baseSeed(trace.id, chain.chain);
  const rng = new Prng(seed);

  let signalPrice = state.markPrice;
  let quotePrice = state.markPrice;
  let previousPrice = state.markPrice;

  for (let tick = 0; tick < trace.events.length; tick += 1) {
    const event = trace.events[tick]!;
    const truePrice = clamp(event.truePrice, 0.03, 0.97);
    signalPrice = clamp(event.signalPrice, 0.03, 0.97);

    if (tick % (guards.repriceDelayTicks + 1) === 0) {
      const invSkew = clamp(state.inventory / Math.max(1, guards.inventoryCap), -1, 1);
      const skewBps = invSkew * guards.maxSkewBps;
      quotePrice = clamp(signalPrice - skewBps / 10_000, 0.03, 0.97);
    }

    const spread = chain.baseSpreadBps / 10_000;
    const bid = clamp(quotePrice - spread / 2, 0.01, 0.99);
    const ask = clamp(quotePrice + spread / 2, 0.01, 0.99);

    // Keep replay realistic: inject mild benign flow around attacker flow.
    if (rng.next() < 0.16) {
      const passiveSide: "buy" | "sell" = rng.next() > 0.5 ? "buy" : "sell";
      applyFill({
        state,
        quotePrice: passiveSide === "buy" ? bid : ask,
        truePrice,
        side: passiveSide,
        qty: 1,
        feeBps: chain.feeBps,
        toxic: false,
        exploited: false,
      });
    }

    if (event.attackerSide && event.qty > 0) {
      const divergence = Math.abs(truePrice - quotePrice);
      const momentum = Math.abs(truePrice - previousPrice) * 10;
      const exploitScore =
        divergence * (6 + chain.mevRisk * 2) +
        momentum * (1 + chain.mempoolFriction) +
        vuln.toxic * 0.55 +
        vuln.cancel * 0.25;
      const defenseScore =
        (1 - vuln.latency) * 0.35 +
        (1 - vuln.stale) * 0.25 +
        (1 - vuln.toxic) * 0.25 +
        (1 - vuln.inventory) * 0.15;
      const exploited = exploitScore > defenseScore;
      const side: "buy" | "sell" = event.attackerSide === "buy" ? "sell" : "buy";

      applyFill({
        state,
        quotePrice: side === "buy" ? bid : ask,
        truePrice,
        side,
        qty: Math.max(1, Math.floor(event.qty)),
        feeBps: chain.feeBps,
        toxic: exploited,
        exploited,
      });
    }

    // Emergency inventory unwind mirrors production posture.
    if (Math.abs(state.inventory) > guards.inventoryCap) {
      const unwindSide: "buy" | "sell" = state.inventory > 0 ? "sell" : "buy";
      const unwindQty = Math.min(Math.abs(state.inventory), 2 + Math.round((1 - vuln.inventory) * 6));
      if (unwindQty > 0) {
        applyFill({
          state,
          quotePrice: unwindSide === "buy" ? bid : ask,
          truePrice,
          side: unwindSide,
          qty: unwindQty,
          feeBps: chain.feeBps,
          toxic: false,
          exploited: false,
        });
      }
    }

    state.markPrice = truePrice;
    const equity = state.cash + state.inventory * state.markPrice;
    state.drawdown = Math.min(state.drawdown, equity);
    previousPrice = truePrice;
  }

  const finalEquity = state.cash + state.inventory * state.markPrice;
  return {
    mmPnl: Number(finalEquity.toFixed(6)),
    attackerPnl: Number((-finalEquity).toFixed(6)),
    maxDrawdown: Number(state.drawdown.toFixed(6)),
    toxicFillRate:
      state.totalFills > 0 ? Number((state.toxicFills / state.totalFills).toFixed(4)) : 0,
    inventoryPeak: state.inventoryPeak,
    exploitEvents: state.exploitEvents,
    avgAdverseSlippageBps:
      state.toxicFills > 0
        ? Number((state.adverseSlippageBpsTotal / state.toxicFills).toFixed(2))
        : 0,
    staleQuoteUptimeRatio: 0,
    orphanOrderCount: 0,
    reconciliationLagMs: 0,
    unresolvedClaimBacklog: 0,
  };
}

export function readReplayCorpus(
  path = DEFAULT_REPLAY_CORPUS_PATH,
  chainFilter?: ChainId,
): ReplayTrace[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ReplayCorpusFile;
  if (chainFilter) {
    return parsed[chainFilter] ?? [];
  }
  return [
    ...(parsed.solana ?? []),
    ...(parsed.bsc ?? []),
    ...(parsed.avax ?? []),
  ];
}

export function runHistoricalReplay(
  chain: ChainId,
  trace: ReplayTrace,
): ReplayRun {
  const profile = chainProfile(chain);
  const baseline = runReplayForGuard(profile, BASELINE_GUARDS, trace);
  const mitigated = runReplayForGuard(profile, MITIGATED_GUARDS, trace);
  return {
    chain,
    traceId: trace.id,
    baseline,
    mitigated,
    improved: mitigated.attackerPnl <= baseline.attackerPnl,
  };
}

export function evaluateHistoricalReplayCorpus(
  corpusPath = DEFAULT_REPLAY_CORPUS_PATH,
  chainFilter?: ChainId,
): ReplayBreach[] {
  const traces = readReplayCorpus(corpusPath, chainFilter);
  const breaches: ReplayBreach[] = [];

  if (traces.length === 0) {
    throw new Error(`historical replay corpus is empty: ${corpusPath}`);
  }

  const chains: ChainId[] = chainFilter
    ? [chainFilter]
    : ["solana", "bsc", "avax"];

  for (const chain of chains) {
    const chainTraces =
      chainFilter === chain
        ? traces
        : readReplayCorpus(corpusPath, chain);
    const budget = REPLAY_BUDGETS[chain];

    for (const trace of chainTraces) {
      const run = runHistoricalReplay(chain, trace);
      const reduction = reductionRatio(run);
      if (run.mitigated.attackerPnl > budget.maxMitigatedAttackerPnl) {
        breaches.push({
          chain,
          traceId: trace.id,
          control: "replay.trace.mitigated_attacker_pnl",
          expected: `<= ${budget.maxMitigatedAttackerPnl}`,
          actual: Number(run.mitigated.attackerPnl.toFixed(4)),
        });
      }
      if (run.mitigated.toxicFillRate > budget.maxMitigatedToxicFillRate) {
        breaches.push({
          chain,
          traceId: trace.id,
          control: "replay.trace.mitigated_toxic_fill_rate",
          expected: `<= ${budget.maxMitigatedToxicFillRate}`,
          actual: Number(run.mitigated.toxicFillRate.toFixed(4)),
        });
      }
      if (run.mitigated.exploitEvents > budget.maxMitigatedExploitEvents) {
        breaches.push({
          chain,
          traceId: trace.id,
          control: "replay.trace.mitigated_exploit_events",
          expected: `<= ${budget.maxMitigatedExploitEvents}`,
          actual: run.mitigated.exploitEvents,
        });
      }
      if (reduction < budget.minAttackerPnlReductionRatio) {
        breaches.push({
          chain,
          traceId: trace.id,
          control: "replay.trace.min_attacker_pnl_reduction_ratio",
          expected: `>= ${budget.minAttackerPnlReductionRatio}`,
          actual: Number(reduction.toFixed(4)),
        });
      }
    }
  }

  return breaches;
}
