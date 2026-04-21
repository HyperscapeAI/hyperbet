import { describe, expect, it } from "bun:test";

import {
  resolveAlignedCountdownDisplay,
  type ViewerClock,
} from "../../src/lib/viewerAlignment";

const BASE_CLOCK: ViewerClock = {
  wallNowMs: 2_000_000,
  serverNowMs: 2_000_000,
  sourceNowMs: 2_000_000,
  latencyMs: 4_000,
  latencySource: "player-live-edge",
  telemetryAgeMs: 100,
  estimatedServerOffsetMs: 0,
  frozen: false,
  confidence: "high",
};

describe("resolveAlignedCountdownDisplay", () => {
  it("does not enter a hold state before the aligned countdown boundary", () => {
    const display = resolveAlignedCountdownDisplay({
      phase: "COUNTDOWN",
      viewerClock: BASE_CLOCK,
      fightStartTime: BASE_CLOCK.sourceNowMs + 999,
    });

    expect(display.kind).toBe("timer");
    expect(display.holdState).toBeNull();
  });

  it("uses aligned fightStartTime instead of stale raw timeRemaining to avoid a premature hold state", () => {
    const display = resolveAlignedCountdownDisplay({
      phase: "COUNTDOWN",
      viewerClock: BASE_CLOCK,
      fightStartTime: BASE_CLOCK.sourceNowMs + 5_000,
      fallbackTimeRemaining: 0,
    });

    expect(display.kind).toBe("timer");
    expect(display.holdState).toBeNull();
  });

  it("shows Preparing arena once announcement time crosses zero", () => {
    const display = resolveAlignedCountdownDisplay({
      phase: "ANNOUNCEMENT",
      viewerClock: BASE_CLOCK,
      betCloseTime: BASE_CLOCK.sourceNowMs,
      fallbackTimeRemaining: 0,
    });

    expect(display.kind).toBe("hold");
    expect(display.holdState).toBe("preparing_arena");
    expect(display.text).toBe("Preparing arena");
  });

  it("shows Starting... once countdown crosses zero", () => {
    const display = resolveAlignedCountdownDisplay({
      phase: "COUNTDOWN",
      viewerClock: BASE_CLOCK,
      fightStartTime: BASE_CLOCK.sourceNowMs,
      fallbackTimeRemaining: 0,
    });

    expect(display.kind).toBe("hold");
    expect(display.holdState).toBe("starting");
    expect(display.text).toBe("Starting...");
  });
});
