import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SEED } from "./config.js";
import { runAdversarialSuite, toMarkdownSummary } from "./suite.js";
import type { SuiteReport } from "./types.js";

export type GateVerdict = {
  ok: boolean;
  message: string;
};

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

export function writeSuiteOutputs(seed: number, outputDir: string): SuiteReport {
  const report = runAdversarialSuite(seed);
  const jsonPath = join(outputDir, "market-maker-adversarial-report.json");
  const mdPath = join(outputDir, "market-maker-adversarial-summary.md");

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, toMarkdownSummary(report), "utf8");

  console.log(
    `[simulate-adversarial-mm] scenarios=${report.summary.totalScenarios} improved=${report.summary.improvedScenarios} pass=${report.summary.mitigationPasses} output=${jsonPath}`,
  );
  console.log(`[simulate-adversarial-mm] summary=${mdPath}`);

  return report;
}

export function runGate(outputDir: string, threshold: number): GateVerdict {
  const reportPath = join(outputDir, "market-maker-adversarial-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as SuiteReport;
  return assertMitigationThreshold(report, threshold);
}

export function runCli() {
  const outputDir = process.env.MM_ADVERSARIAL_OUTPUT_DIR || join(process.cwd(), "simulations");
  const seed = Number(process.env.MM_ADVERSARIAL_SEED || DEFAULT_SEED);
  const threshold = Number(process.env.MM_ADVERSARIAL_MIN_PASSES || 18);

  if (process.argv.includes("--gate")) {
    const verdict = runGate(outputDir, threshold);
    if (!verdict.ok) {
      throw new Error(verdict.message);
    }
    console.log(`[simulate-adversarial-mm:gate] ${verdict.message}`);
    return;
  }

  writeSuiteOutputs(seed, outputDir);
}
