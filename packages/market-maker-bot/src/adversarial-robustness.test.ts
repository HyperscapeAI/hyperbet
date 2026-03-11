import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import {
  compareAgainstBaseline,
  DEFAULT_BASELINE_TOLERANCES,
} from "./adversarial/baseline.js";
import {
  DEFAULT_INVARIANT_LIMITS,
  evaluateInvariantBreaches,
} from "./adversarial/invariants.js";

describe("adversarial robustness gates", () => {
  it("enforces hard mitigated invariants across all chains", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateInvariantBreaches(report, DEFAULT_INVARIANT_LIMITS);

    expect(breaches).toEqual([]);
  });

  it("is chain-realistic: AVAX gas backrun pressure exceeds Solana in baseline", () => {
    const report = runAdversarialSuite(20260311);
    const solana = report.chains.find((chain) => chain.chain === "solana");
    const avax = report.chains.find((chain) => chain.chain === "avax");
    const solanaGas = solana?.scenarios.find(
      (scenario) => scenario.scenario === "gas_auction_backrun",
    );
    const avaxGas = avax?.scenarios.find(
      (scenario) => scenario.scenario === "gas_auction_backrun",
    );

    expect(solanaGas).toBeDefined();
    expect(avaxGas).toBeDefined();
    expect(avaxGas!.baseline.attackerPnl).toBeGreaterThan(
      solanaGas!.baseline.attackerPnl,
    );
  });

  it("passes baseline regression check against itself", () => {
    const report = runAdversarialSuite(20260311);
    const result = compareAgainstBaseline(
      report,
      report,
      DEFAULT_BASELINE_TOLERANCES,
    );

    expect(result.regressions).toEqual([]);
  });

  it("flags material attacker-pnl regressions vs baseline", () => {
    const baseline = runAdversarialSuite(20260311);
    const candidate = structuredClone(baseline);

    candidate.chains[0]!.scenarios[0]!.mitigated.attackerPnl += 50;
    const result = compareAgainstBaseline(
      baseline,
      candidate,
      DEFAULT_BASELINE_TOLERANCES,
    );

    expect(result.regressions.length).toBeGreaterThan(0);
    expect(result.regressions[0]?.metric).toBe("mitigated.attackerPnl");
  });
});
