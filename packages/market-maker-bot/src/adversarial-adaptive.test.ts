import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluateAdaptiveBreaches } from "./adversarial/adaptive.js";

describe("adversarial adaptive attacker-policy gates", () => {
  it("passes adaptive controls on hardened suite", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateAdaptiveBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags escalation-score regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const quoteStuffing = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "quote_stuffing_burst",
    );
    const staleSignal = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "stale_signal_arbitrage",
    );
    const coordinated = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "coordinated_resolution_push",
    );
    expect(quoteStuffing).toBeDefined();
    expect(staleSignal).toBeDefined();
    expect(coordinated).toBeDefined();

    quoteStuffing!.mitigated.exploitEvents += 30;
    staleSignal!.mitigated.toxicFillRate += 0.35;
    coordinated!.mitigated.avgAdverseSlippageBps += 80;

    const breaches = evaluateAdaptiveBreaches(candidate);
    expect(
      breaches.some((entry) => entry.control === "adaptive.max_escalation_score"),
    ).toBe(true);
  });

  it("flags poor defense-recovery regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const staleSignal = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "stale_signal_arbitrage",
    );
    const gasBackrun = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "gas_auction_backrun",
    );
    const sybilChurn = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "sybil_identity_churn",
    );
    const coordinated = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "coordinated_resolution_push",
    );
    expect(staleSignal).toBeDefined();
    expect(gasBackrun).toBeDefined();
    expect(sybilChurn).toBeDefined();
    expect(coordinated).toBeDefined();

    staleSignal!.mitigated.attackerPnl = staleSignal!.baseline.attackerPnl * 0.92;
    gasBackrun!.mitigated.attackerPnl = gasBackrun!.baseline.attackerPnl * 0.91;
    sybilChurn!.mitigated.attackerPnl = sybilChurn!.baseline.attackerPnl * 0.95;
    coordinated!.mitigated.attackerPnl = coordinated!.baseline.attackerPnl * 0.93;

    const breaches = evaluateAdaptiveBreaches(candidate);
    expect(
      breaches.some((entry) => entry.control === "adaptive.min_defense_recovery"),
    ).toBe(true);
  });
});
