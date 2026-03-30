import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateBoundedLossBreaches } from "./bounded-loss.js";
import { CHAIN_PROFILES, SCENARIOS } from "./config.js";
import { evaluateChaosBreaches } from "./chaos.js";
import { evaluateAdaptiveBreaches } from "./adaptive.js";
import { DEFAULT_INVARIANT_LIMITS, evaluateInvariantBreaches } from "./invariants.js";
import { evaluateMatrixBreaches } from "./matrix.js";
import { evaluatePolicyBreaches } from "./policy.js";
import { evaluateSettlementBreaches } from "./settlement.js";
import { runAdversarialSuite } from "./suite.js";
import { evaluateSybilBreaches } from "./sybil.js";
import type { ChainId } from "./types.js";

type SeedCorpusFile = {
  all?: number[];
  solana?: number[];
  bsc?: number[];
  avax?: number[];
};

export type RegressionSeedBreach = {
  seed: number;
  chainScope: ChainId | "all";
  message: string;
};

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

export const DEFAULT_REGRESSION_SEEDS_PATH = join(
  currentDir,
  "regression-seeds.json",
);

function defaultThreshold(chainFilter?: ChainId): number {
  const chainCount = chainFilter ? 1 : CHAIN_PROFILES.length;
  return chainCount * SCENARIOS.length;
}

export function readRegressionSeeds(
  path = DEFAULT_REGRESSION_SEEDS_PATH,
  chainFilter?: ChainId,
): number[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SeedCorpusFile;

  const key = chainFilter ?? "all";
  const selected = parsed[key];
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new Error(`regression seed corpus is empty: ${path}`);
  }
  return selected.map((entry) => Number(entry));
}

export function evaluateRegressionSeeds(
  seeds: number[],
  chainFilter?: ChainId,
): RegressionSeedBreach[] {
  const threshold = defaultThreshold(chainFilter);
  const chainScope = chainFilter ?? "all";
  const failures: RegressionSeedBreach[] = [];

  for (const seed of seeds) {
    const report = runAdversarialSuite(seed, chainFilter);
    if (report.summary.mitigationPasses < threshold) {
      failures.push({
        seed,
        chainScope,
        message: `mitigation threshold failed (${report.summary.mitigationPasses}/${report.summary.totalScenarios})`,
      });
      continue;
    }

    const invariantBreaches = evaluateInvariantBreaches(report, DEFAULT_INVARIANT_LIMITS);
    if (invariantBreaches.length > 0) {
      const first = invariantBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `invariant breach ${first.chain}/${first.scenario} ${first.invariant}`,
      });
      continue;
    }

    const policyBreaches = evaluatePolicyBreaches(report);
    if (policyBreaches.length > 0) {
      const first = policyBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `policy breach ${first.chain} ${first.control}`,
      });
      continue;
    }

    const boundedLossBreaches = evaluateBoundedLossBreaches(report);
    if (boundedLossBreaches.length > 0) {
      const first = boundedLossBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `bounded-loss breach ${first.chain} ${first.scope}`,
      });
      continue;
    }

    const settlementBreaches = evaluateSettlementBreaches(report);
    if (settlementBreaches.length > 0) {
      const first = settlementBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `settlement breach ${first.chain} ${first.control}`,
      });
      continue;
    }

    const sybilBreaches = evaluateSybilBreaches(report);
    if (sybilBreaches.length > 0) {
      const first = sybilBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `sybil breach ${first.chain} ${first.control}`,
      });
      continue;
    }

    const chaosBreaches = evaluateChaosBreaches(report);
    if (chaosBreaches.length > 0) {
      const first = chaosBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `chaos breach ${first.chain} ${first.control}`,
      });
      continue;
    }

    const adaptiveBreaches = evaluateAdaptiveBreaches(report);
    if (adaptiveBreaches.length > 0) {
      const first = adaptiveBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `adaptive breach ${first.chain} ${first.control}`,
      });
      continue;
    }

    const matrixBreaches = evaluateMatrixBreaches(report);
    if (matrixBreaches.length > 0) {
      const first = matrixBreaches[0]!;
      failures.push({
        seed,
        chainScope,
        message: `matrix breach ${first.chain}/${first.scenario} ${first.control}`,
      });
    }
  }

  return failures;
}
