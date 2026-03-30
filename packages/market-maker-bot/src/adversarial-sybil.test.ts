import { describe, expect, it } from "vitest";

import { runAdversarialSuite } from "./simulate-adversarial.js";
import { evaluateSybilBreaches } from "./adversarial/sybil.js";

describe("adversarial sybil/collusion gates", () => {
  it("passes sybil controls on hardened suite", () => {
    const report = runAdversarialSuite(20260311);
    const breaches = evaluateSybilBreaches(report);

    expect(breaches).toEqual([]);
  });

  it("flags wallet-cluster concentration regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[0]?.scenarios.find(
      (entry) => entry.scenario === "sybil_wash_trading",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.exploitEvents += 45;

    const breaches = evaluateSybilBreaches(candidate);
    expect(
      breaches.some(
        (entry) => entry.control === "sybil.max_cluster_concentration_pct",
      ),
    ).toBe(true);
  });

  it("flags circular-flow rebate farming regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[1]?.scenarios.find(
      (entry) => entry.scenario === "rebate_farming_ring",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.toxicFillRate += 0.5;

    const breaches = evaluateSybilBreaches(candidate);
    expect(
      breaches.some((entry) => entry.control === "sybil.max_circular_flow_ratio"),
    ).toBe(true);
  });

  it("flags identity churn regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "sybil_identity_churn",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.toxicFillRate += 0.52;
    scenario!.mitigated.exploitEvents += 18;

    const breaches = evaluateSybilBreaches(candidate);
    expect(
      breaches.some((entry) => entry.control === "sybil.max_identity_churn_rate"),
    ).toBe(true);
  });

  it("flags coordinated resolution push regression", () => {
    const report = runAdversarialSuite(20260311);
    const candidate = structuredClone(report);
    const scenario = candidate.chains[2]?.scenarios.find(
      (entry) => entry.scenario === "coordinated_resolution_push",
    );
    expect(scenario).toBeDefined();
    scenario!.mitigated.exploitEvents += 35;
    scenario!.mitigated.avgAdverseSlippageBps += 110;

    const breaches = evaluateSybilBreaches(candidate);
    expect(
      breaches.some(
        (entry) =>
          entry.control === "resolution.max_coordinated_push_score" ||
          entry.control === "resolution.min_independent_participants",
      ),
    ).toBe(true);
  });
});

