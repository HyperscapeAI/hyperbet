import { DEFAULT_MARKET_MAKER_CONFIG } from "@hyperbet/mm-core";

import type { ScenarioRuntimeProfile } from "./scenario-catalog.js";

export const SIM_TICK_MS = 500;

export function isScenarioCloseGuardWindow(
  runtimeProfile: ScenarioRuntimeProfile | null | undefined,
  tick: number,
): boolean {
  const betCloseTick = runtimeProfile?.betCloseTick;
  if (betCloseTick == null) {
    return false;
  }

  const guardMs = Math.max(
    0,
    runtimeProfile?.marketMakerBetCloseGuardMs ??
      DEFAULT_MARKET_MAKER_CONFIG.betCloseGuardMs,
  );
  const closeTimeMs = betCloseTick * SIM_TICK_MS;
  const nowMs = tick * SIM_TICK_MS;
  return closeTimeMs - nowMs <= guardMs;
}
