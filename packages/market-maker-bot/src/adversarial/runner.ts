import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CHAIN_PROFILES, DEFAULT_SEED, SCENARIOS } from "./config.js";
import {
  compareAgainstBaseline,
  DEFAULT_BASELINE_PATH,
  DEFAULT_BASELINE_TOLERANCES,
  readBaselineSnapshot,
  writeBaselineSnapshot,
} from "./baseline.js";
import { DEFAULT_INVARIANT_LIMITS, evaluateInvariantBreaches } from "./invariants.js";
import { evaluateBoundedLossBreaches } from "./bounded-loss.js";
import { evaluatePolicyBreaches } from "./policy.js";
import { evaluateSettlementBreaches } from "./settlement.js";
import { evaluateSybilBreaches } from "./sybil.js";
import { evaluateChaosBreaches } from "./chaos.js";
import { evaluateAdaptiveBreaches } from "./adaptive.js";
import { evaluateMatrixBreaches } from "./matrix.js";
import {
  DEFAULT_REPLAY_CORPUS_PATH,
  evaluateHistoricalReplayCorpus,
} from "./replay.js";
import {
  DEFAULT_REGRESSION_SEEDS_PATH,
  evaluateRegressionSeeds,
  readRegressionSeeds,
} from "./regression-seeds.js";
import { runAdversarialSuite, toMarkdownSummary } from "./suite.js";
import type { ChainId, SuiteReport } from "./types.js";

export type GateVerdict = {
  ok: boolean;
  message: string;
};

function parseChainFilter(value?: string): ChainId | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "solana" || normalized === "bsc" || normalized === "avax") {
    return normalized;
  }
  throw new Error(`invalid MM_ADVERSARIAL_CHAIN value: ${value}`);
}

function defaultThreshold(chainFilter?: ChainId): number {
  const chainCount = chainFilter ? 1 : CHAIN_PROFILES.length;
  return chainCount * SCENARIOS.length;
}

function baselineCheckEnabled(): boolean {
  const raw = process.env.MM_ADVERSARIAL_ENFORCE_BASELINE;
  if (!raw) {
    return true;
  }
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function assertMitigationThreshold(
  report: SuiteReport,
  threshold: number,
): GateVerdict {
  const firstFailure = report.chains
    .flatMap((chain) =>
      chain.scenarios.map((scenario) => ({
        chain: chain.chain,
        scenario,
      })),
    )
    .find((entry) => !entry.scenario.budgetPass);
  if (firstFailure) {
    return {
      ok: false,
      message: `scenario budget failed ${firstFailure.chain}/${firstFailure.scenario.scenario}: ${firstFailure.scenario.budgetBreaches.map((breach) => breach.control).join(",")}`,
    };
  }
  if (report.summary.mitigationPasses >= threshold) {
    return {
      ok: true,
      message: `mitigation threshold satisfied (${report.summary.mitigationPasses}/${report.summary.totalScenarios})`,
    };
  }
  return {
    ok: false,
    message: `mitigation threshold failed (${report.summary.mitigationPasses}/${report.summary.totalScenarios}); threshold=${threshold}`,
  };
}

export function writeSuiteOutputs(
  seed: number,
  outputDir: string,
  chainFilter?: ChainId,
): SuiteReport {
  const report = runAdversarialSuite(seed, chainFilter);
  const suffix = chainFilter ? `-${chainFilter}` : "";
  const jsonPath = join(outputDir, `market-maker-adversarial-report${suffix}.json`);
  const mdPath = join(outputDir, `market-maker-adversarial-summary${suffix}.md`);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, toMarkdownSummary(report), "utf8");

  console.log(
    `[simulate-adversarial-mm] chain=${chainFilter ?? "all"} scenarios=${report.summary.totalScenarios} improved=${report.summary.improvedScenarios} pass=${report.summary.mitigationPasses} output=${jsonPath}`,
  );
  console.log(`[simulate-adversarial-mm] summary=${mdPath}`);

  return report;
}

export function runGate(
  outputDir: string,
  threshold: number,
  chainFilter?: ChainId,
): GateVerdict {
  const suffix = chainFilter ? `-${chainFilter}` : "";
  const reportPath = join(outputDir, `market-maker-adversarial-report${suffix}.json`);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as SuiteReport;

  const thresholdVerdict = assertMitigationThreshold(
    report,
    report.summary.totalScenarios,
  );
  if (!thresholdVerdict.ok) {
    return thresholdVerdict;
  }

  const invariantBreaches = evaluateInvariantBreaches(report, DEFAULT_INVARIANT_LIMITS);
  if (invariantBreaches.length > 0) {
    const first = invariantBreaches[0]!;
    return {
      ok: false,
      message: `invariant breach ${first.chain}/${first.scenario} ${first.invariant}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  if (baselineCheckEnabled()) {
    const baselineReport = readBaselineSnapshot(DEFAULT_BASELINE_PATH);
    const comparison = compareAgainstBaseline(
      baselineReport,
      report,
      DEFAULT_BASELINE_TOLERANCES,
    );
    if (comparison.regressions.length > 0) {
      const first = comparison.regressions[0]!;
      return {
        ok: false,
        message: `baseline regression ${first.chain}/${first.scenario} ${first.metric}: baseline=${first.baseline} candidate=${first.candidate} threshold=${first.threshold}`,
      };
    }
  }

  const policyBreaches = evaluatePolicyBreaches(report);
  if (policyBreaches.length > 0) {
    const first = policyBreaches[0]!;
    return {
      ok: false,
      message: `policy breach ${first.chain} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const boundedLossBreaches = evaluateBoundedLossBreaches(report);
  if (boundedLossBreaches.length > 0) {
    const first = boundedLossBreaches[0]!;
    return {
      ok: false,
      message: `bounded-loss breach ${first.chain} ${first.scope}${first.scenario ? `/${first.scenario}` : ""}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const settlementBreaches = evaluateSettlementBreaches(report);
  if (settlementBreaches.length > 0) {
    const first = settlementBreaches[0]!;
    return {
      ok: false,
      message: `settlement breach ${first.chain} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const sybilBreaches = evaluateSybilBreaches(report);
  if (sybilBreaches.length > 0) {
    const first = sybilBreaches[0]!;
    return {
      ok: false,
      message: `sybil breach ${first.chain} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const chaosBreaches = evaluateChaosBreaches(report);
  if (chaosBreaches.length > 0) {
    const first = chaosBreaches[0]!;
    return {
      ok: false,
      message: `chaos breach ${first.chain} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const adaptiveBreaches = evaluateAdaptiveBreaches(report);
  if (adaptiveBreaches.length > 0) {
    const first = adaptiveBreaches[0]!;
    return {
      ok: false,
      message: `adaptive breach ${first.chain} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const matrixBreaches = evaluateMatrixBreaches(report);
  if (matrixBreaches.length > 0) {
    const first = matrixBreaches[0]!;
    return {
      ok: false,
      message: `matrix breach ${first.chain}/${first.scenario} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  const replayCorpusPath =
    process.env.MM_ADVERSARIAL_REPLAY_CORPUS || DEFAULT_REPLAY_CORPUS_PATH;
  const replayBreaches = evaluateHistoricalReplayCorpus(
    replayCorpusPath,
    chainFilter,
  );
  if (replayBreaches.length > 0) {
    const first = replayBreaches[0]!;
    return {
      ok: false,
      message: `replay breach ${first.chain}/${first.traceId} ${first.control}: expected ${first.expected}, actual=${first.actual}`,
    };
  }

  return {
    ok: true,
    message: `all gates satisfied (${report.summary.mitigationPasses}/${report.summary.totalScenarios})`,
  };
}

export function runCli() {
  const outputDir =
    process.env.MM_ADVERSARIAL_OUTPUT_DIR || join(process.cwd(), "simulations");
  const seed = Number(process.env.MM_ADVERSARIAL_SEED || DEFAULT_SEED);
  const chainFilter = parseChainFilter(process.env.MM_ADVERSARIAL_CHAIN);
  const threshold = Number(
    process.env.MM_ADVERSARIAL_MIN_PASSES || defaultThreshold(chainFilter),
  );

  if (process.argv.includes("--update-baseline")) {
    const report = runAdversarialSuite(seed);
    writeBaselineSnapshot(report, DEFAULT_BASELINE_PATH);
    console.log(`[simulate-adversarial-mm:baseline] wrote ${DEFAULT_BASELINE_PATH}`);
    return;
  }

  if (process.argv.includes("--gate")) {
    const verdict = runGate(outputDir, threshold, chainFilter);
    if (!verdict.ok) {
      throw new Error(verdict.message);
    }
    console.log(`[simulate-adversarial-mm:gate] ${verdict.message}`);
    return;
  }

  if (process.argv.includes("--seed-corpus")) {
    const seedsPath =
      process.env.MM_ADVERSARIAL_SEED_CORPUS || DEFAULT_REGRESSION_SEEDS_PATH;
    const seeds = readRegressionSeeds(seedsPath, chainFilter);
    const failures = evaluateRegressionSeeds(seeds, chainFilter);
    if (failures.length > 0) {
      const first = failures[0]!;
      throw new Error(
        `[simulate-adversarial-mm:seed-corpus] seed=${first.seed} chain=${first.chainScope} ${first.message}`,
      );
    }
    console.log(
      `[simulate-adversarial-mm:seed-corpus] seeds=${seeds.length} chain=${chainFilter ?? "all"} passed`,
    );
    return;
  }

  if (process.argv.includes("--replay-corpus")) {
    const replayCorpusPath =
      process.env.MM_ADVERSARIAL_REPLAY_CORPUS || DEFAULT_REPLAY_CORPUS_PATH;
    const replayBreaches = evaluateHistoricalReplayCorpus(
      replayCorpusPath,
      chainFilter,
    );
    if (replayBreaches.length > 0) {
      const first = replayBreaches[0]!;
      throw new Error(
        `[simulate-adversarial-mm:replay-corpus] chain=${first.chain} trace=${first.traceId} ${first.control} expected ${first.expected} actual ${first.actual}`,
      );
    }
    console.log(
      `[simulate-adversarial-mm:replay-corpus] chain=${chainFilter ?? "all"} passed`,
    );
    return;
  }

  writeSuiteOutputs(seed, outputDir, chainFilter);
}
