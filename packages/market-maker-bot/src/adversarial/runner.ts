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

  const thresholdVerdict = assertMitigationThreshold(report, threshold);
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

  writeSuiteOutputs(seed, outputDir, chainFilter);
}
