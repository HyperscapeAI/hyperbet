import { describe, expect, it } from "bun:test";
import {
  detectDivergence,
  type RailSelection,
  type TradeGate,
  type ViewerClock,
} from "../../src/lib/viewerAlignment";

/**
 * Pure tests for the divergence event builder. Covers PRD decision 3:
 *   Emit when:
 *     - aligned phase differs from current displayed phase
 *     - |skewMs| > 1000
 *     - selected market/context snapshot exceeds its max-age budget
 *     - viewer clock enters/exits frozen state
 *   Plus 1-in-N baseline sampling.
 */

const BASE_NOW = 1_800_000_000_000;

function makeClock(overrides: Partial<ViewerClock> = {}): ViewerClock {
  return {
    wallNowMs: BASE_NOW,
    serverNowMs: BASE_NOW,
    sourceNowMs: BASE_NOW,
    latencyMs: 4_000,
    latencySource: "player-live-edge",
    telemetryAgeMs: 100,
    estimatedServerOffsetMs: 0,
    frozen: false,
    confidence: "high",
    ...overrides,
  };
}

function makeSel<T>(overrides: Partial<RailSelection<T>> = {}): RailSelection<T> {
  return {
    snapshot: null,
    sourceEmittedAtMs: null,
    serverEmittedAtMs: null,
    ageMs: null,
    stale: false,
    ...overrides,
  };
}

const OK_GATE: TradeGate = {
  canDisplayOpen: true,
  canSubmitTrade: true,
  reason: null,
};

describe("detectDivergence — no-op cases", () => {
  it("returns null when nothing diverges and this isn't a baseline tick", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event).toBeNull();
  });

  it("returns null when phases are both unknown (no comparison available)", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: null,
      alignedDisplayPhase: null,
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event).toBeNull();
  });
});

describe("detectDivergence — phase mismatch", () => {
  it("emits phase-mismatch when current and aligned phases disagree", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 4_000 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "RESOLUTION",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("phase-mismatch");
    expect(event?.currentDisplayPhase).toBe("RESOLUTION");
    expect(event?.alignedDisplayPhase).toBe("FIGHTING");
    // Skew proxy = session age when phases differ.
    expect(event?.skewMs).toBe(4_000);
  });
});

describe("detectDivergence — staleness", () => {
  it("emits market-stale when market selection is stale", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 15_000, stale: true }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("market-stale");
    expect(event?.staleRails).toContain("market");
  });

  it("emits duel-context-stale when only duel-context is stale", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 10_000, stale: true }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("duel-context-stale");
    expect(event?.staleRails).toContain("duelContext");
  });
});

describe("detectDivergence — skew threshold", () => {
  it("emits skew-exceeds-budget when session age exceeds 1000ms even with phase match", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      // Pass NULL phases so the phase-mismatch detector doesn't fire;
      // skew proxy falls back to |session.age - market.age| for the
      // no-phase path.
      session: makeSel({ snapshot: {}, ageMs: 5_000 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: null,
      alignedDisplayPhase: null,
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("skew-exceeds-budget");
    expect(event?.skewMs).toBe(4_900);
  });

  it("does not emit skew when it's exactly at threshold", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 1_000 }),
      market: makeSel({ snapshot: {}, ageMs: 0 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 0 }),
      currentDisplayPhase: null,
      alignedDisplayPhase: null,
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event).toBeNull();
  });
});

describe("detectDivergence — freeze transitions", () => {
  it("emits freeze-entered on the tick where clock transitions to frozen", () => {
    const event = detectDivergence({
      clock: makeClock({ frozen: true, confidence: "low" }),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("freeze-entered");
  });

  it("emits freeze-exited on the tick where clock transitions out of frozen", () => {
    const event = detectDivergence({
      clock: makeClock({ frozen: false }),
      previousFrozen: true,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("freeze-exited");
  });

  it("suppresses subsequent ticks inside a frozen run", () => {
    const event = detectDivergence({
      clock: makeClock({ frozen: true, confidence: "low" }),
      previousFrozen: true,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event).toBeNull();
  });
});

describe("detectDivergence — 1-in-N baseline sampling", () => {
  it("emits baseline-sample on the Nth tick when nothing else fires", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 100,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("baseline-sample");
  });

  it("does not emit on non-Nth ticks", () => {
    for (const emitCount of [1, 50, 99, 101, 199]) {
      const event = detectDivergence({
        clock: makeClock(),
        previousFrozen: false,
        session: makeSel({ snapshot: {}, ageMs: 100 }),
        market: makeSel({ snapshot: {}, ageMs: 100 }),
        duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
        currentDisplayPhase: "FIGHTING",
        alignedDisplayPhase: "FIGHTING",
        tradeGate: OK_GATE,
        emitCount,
        baselineSampleRate: 100,
      });
      expect(event).toBeNull();
    }
  });

  it("disables baseline sampling when sampleRate is 0", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 100,
      baselineSampleRate: 0,
    });
    expect(event).toBeNull();
  });
});

describe("detectDivergence — priority ordering", () => {
  it("freeze-entered beats phase-mismatch when both are true", () => {
    const event = detectDivergence({
      clock: makeClock({ frozen: true, confidence: "low" }),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 100 }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "RESOLUTION",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("freeze-entered");
  });

  it("phase-mismatch beats market-stale when both are true", () => {
    const event = detectDivergence({
      clock: makeClock(),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 100 }),
      market: makeSel({ snapshot: {}, ageMs: 15_000, stale: true }),
      duelContext: makeSel({ snapshot: {}, ageMs: 100 }),
      currentDisplayPhase: "RESOLUTION",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: OK_GATE,
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event?.reason).toBe("phase-mismatch");
  });
});

describe("detectDivergence — event envelope", () => {
  it("includes clock, rail ages, stale rails, and trade gate", () => {
    const event = detectDivergence({
      clock: makeClock({ confidence: "medium", frozen: false }),
      previousFrozen: false,
      session: makeSel({ snapshot: {}, ageMs: 250 }),
      market: makeSel({ snapshot: {}, ageMs: 600, stale: true }),
      duelContext: makeSel({ snapshot: {}, ageMs: 1_200 }),
      currentDisplayPhase: "FIGHTING",
      alignedDisplayPhase: "FIGHTING",
      tradeGate: { canDisplayOpen: false, canSubmitTrade: false, reason: "market-stale" },
      emitCount: 1,
      baselineSampleRate: 100,
    });
    expect(event).not.toBeNull();
    expect(event?.viewerClock.confidence).toBe("medium");
    expect(event?.selectedRailAges).toEqual({
      session: 250,
      market: 600,
      duelContext: 1_200,
    });
    expect(event?.staleRails).toEqual(["market"]);
    expect(event?.tradeGate.reason).toBe("market-stale");
  });
});
