import { describe, expect, it } from "vitest";

import {
  evaluateHistoricalReplayCorpus,
  readReplayCorpus,
  runHistoricalReplay,
} from "./adversarial/replay.js";

describe("historical replay harness", () => {
  it("loads replay traces for each chain", () => {
    expect(readReplayCorpus(undefined, "solana").length).toBeGreaterThan(0);
    expect(readReplayCorpus(undefined, "bsc").length).toBeGreaterThan(0);
    expect(readReplayCorpus(undefined, "avax").length).toBeGreaterThan(0);
  });

  it("keeps mitigated profiles stronger on replay corpus", () => {
    const traces = readReplayCorpus(undefined, "solana");
    const first = traces[0];
    expect(first).toBeDefined();
    const run = runHistoricalReplay("solana", first!);
    expect(run.mitigated.attackerPnl).toBeLessThanOrEqual(run.baseline.attackerPnl);
  });

  it("passes replay corpus safety budgets", () => {
    const breaches = evaluateHistoricalReplayCorpus();
    expect(breaches).toEqual([]);
  });
});
