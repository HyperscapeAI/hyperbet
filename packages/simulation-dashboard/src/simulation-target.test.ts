import { describe, expect, test } from "bun:test";

import {
  resolveSimulationRuntimeTarget,
  simulationRuntimeUsesEvm,
} from "./simulation-target";

describe("simulation runtime target", () => {
  test("preserves the mixed developer runtime by default", () => {
    expect(resolveSimulationRuntimeTarget(undefined)).toBe("mixed");
    expect(simulationRuntimeUsesEvm("mixed")).toBe(true);
  });

  test("keeps Solana-only gates independent from EVM bootstrap", () => {
    expect(resolveSimulationRuntimeTarget(" SOLANA ")).toBe("solana");
    expect(simulationRuntimeUsesEvm("solana")).toBe(false);
  });

  test("rejects unknown runtime targets", () => {
    expect(() => resolveSimulationRuntimeTarget("avax")).toThrow(
      "Unsupported simulation runtime target",
    );
  });
});
