export type SimulationRuntimeTarget = "mixed" | "evm" | "solana";

export function resolveSimulationRuntimeTarget(
  value: string | undefined,
): SimulationRuntimeTarget {
  const normalized = value?.trim().toLowerCase() || "mixed";
  if (
    normalized !== "mixed" &&
    normalized !== "evm" &&
    normalized !== "solana"
  ) {
    throw new Error(`Unsupported simulation runtime target: ${normalized}`);
  }
  return normalized;
}

export function simulationRuntimeUsesEvm(
  target: SimulationRuntimeTarget,
): boolean {
  return target !== "solana";
}
