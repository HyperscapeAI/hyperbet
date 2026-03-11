import { describe, expect, it } from "vitest";

import {
  assertMitigationThreshold,
  runAdversarialSuite,
  SCENARIOS,
  toMarkdownSummary,
} from "./simulate-adversarial.js";

describe("adversarial market-maker suite", () => {
  it("covers all configured scenarios on solana, bsc, and avax", () => {
    const report = runAdversarialSuite(20260311);

    expect(report.chains).toHaveLength(3);
    for (const chain of report.chains) {
      expect(chain.scenarios).toHaveLength(SCENARIOS.length);
    }
    expect(report.summary.totalScenarios).toBe(3 * SCENARIOS.length);
  });

  it("fully mitigates modeled scam vectors", () => {
    const report = runAdversarialSuite(20260311);

    expect(report.summary.improvedScenarios).toBe(3 * SCENARIOS.length);
    expect(report.summary.mitigationPasses).toBe(3 * SCENARIOS.length);
  });

  it("passes strict gate threshold", () => {
    const report = runAdversarialSuite(20260311);
    const verdict = assertMitigationThreshold(report, 3 * SCENARIOS.length);

    expect(verdict.ok).toBe(true);
  });

  it("renders markdown summary", () => {
    const report = runAdversarialSuite(20260311);
    const summary = toMarkdownSummary(report);

    expect(summary).toContain("# Market-Maker Adversarial Suite Summary");
    expect(summary).toContain("## SOLANA");
    expect(summary).toContain("## BSC");
    expect(summary).toContain("## AVAX");
  });

  it("supports single-chain suite runs for CI matrix jobs", () => {
    const report = runAdversarialSuite(20260311, "solana");

    expect(report.chains).toHaveLength(1);
    expect(report.chains[0]?.chain).toBe("solana");
    expect(report.summary.totalScenarios).toBe(SCENARIOS.length);
  });
});
