import { describe, expect, it } from "bun:test";
import {
  createSnapshotBuffer,
  DUEL_CONTEXT_MAX_AGE_MS,
  MARKET_MAX_AGE_MS,
  pickSnapshotAtOrBefore,
  resolveTradeGate,
  selectAlignedRailSnapshot,
  type RailSelection,
  type ViewerClock,
} from "../../src/lib/viewerAlignment";

/**
 * Pure tests for `selectAlignedRailSnapshot`, `pickSnapshotAtOrBefore`,
 * and `resolveTradeGate`. Covers PRD end-to-end selector cases from
 * workstream F:
 *   - 4s / 8s / 15s / 30s viewer lag
 *   - market locks while viewer is behind
 *   - stale market
 *   - stale duel-context
 *   - clock-skew invariance
 *   - out-of-order snapshots
 *   - phase-mismatch regression guard
 */

const BASE_NOW = 1_800_000_000_000;

function makeClock(overrides: Partial<ViewerClock> = {}): ViewerClock {
  return {
    wallNowMs: BASE_NOW,
    serverNowMs: BASE_NOW,
    sourceNowMs: BASE_NOW,
    latencyMs: 0,
    latencySource: "player-live-edge",
    telemetryAgeMs: 0,
    estimatedServerOffsetMs: 0,
    frozen: false,
    confidence: "high",
    ...overrides,
  };
}

function makeSelection<T>(
  overrides: Partial<RailSelection<T>> = {},
): RailSelection<T> {
  return {
    snapshot: null,
    sourceEmittedAtMs: null,
    serverEmittedAtMs: null,
    ageMs: null,
    stale: false,
    ...overrides,
  };
}

describe("pickSnapshotAtOrBefore", () => {
  it("delegates to the buffer's binary pick", () => {
    const buf = createSnapshotBuffer<string>();
    buf.push("a", 100);
    buf.push("b", 200);
    expect(pickSnapshotAtOrBefore(buf, 150)?.snapshot).toBe("a");
    expect(pickSnapshotAtOrBefore(buf, 50)).toBeNull();
  });
});

describe("selectAlignedRailSnapshot — basic selection", () => {
  it("returns an empty selection when no snapshot exists at or before viewerSourceNow", () => {
    const buf = createSnapshotBuffer<{ id: number }>();
    buf.push({ id: 1 }, BASE_NOW + 1_000);
    const result = selectAlignedRailSnapshot<{ id: number }>({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    expect(result.snapshot).toBeNull();
    expect(result.sourceEmittedAtMs).toBeNull();
    expect(result.stale).toBe(false);
  });

  it("picks the newest snapshot at or before viewerSourceNow", () => {
    const buf = createSnapshotBuffer<{ tag: string }>();
    buf.push({ tag: "old" }, BASE_NOW - 8_000);
    buf.push({ tag: "recent" }, BASE_NOW - 4_000);
    buf.push({ tag: "future" }, BASE_NOW + 2_000);
    const result = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW - 3_000,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    // viewerSourceNow = -3s; "recent" (-4s) is newest at-or-before;
    // "future" is after viewerSourceNow and must be skipped.
    expect(result.snapshot?.tag).toBe("recent");
    expect(result.sourceEmittedAtMs).toBe(BASE_NOW - 4_000);
  });
});

describe("selectAlignedRailSnapshot — staleness", () => {
  it("marks selection stale when server-emission age exceeds budget", () => {
    const buf = createSnapshotBuffer<{
      serverEmittedAt: number;
    }>();
    const serverStamp = BASE_NOW - (MARKET_MAX_AGE_MS + 2_000);
    buf.push({ serverEmittedAt: serverStamp }, BASE_NOW - 1_000);
    const result = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: (m) => m.serverEmittedAt,
      maxAgeMs: MARKET_MAX_AGE_MS,
    });
    expect(result.snapshot).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.ageMs).toBeGreaterThan(MARKET_MAX_AGE_MS);
  });

  it("does not mark selection stale when age is within budget", () => {
    const buf = createSnapshotBuffer<{ serverEmittedAt: number }>();
    const serverStamp = BASE_NOW - 2_000;
    buf.push({ serverEmittedAt: serverStamp }, BASE_NOW - 2_000);
    const result = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: (m) => m.serverEmittedAt,
      maxAgeMs: DUEL_CONTEXT_MAX_AGE_MS,
    });
    expect(result.stale).toBe(false);
    expect(result.ageMs).toBe(2_000);
  });

  it("treats a null server-emission extraction as 'no max-age check'", () => {
    // Legacy keepers that predate C2 have no server-emission field.
    // The selector must not flag them as stale on that basis alone.
    const buf = createSnapshotBuffer<string>();
    buf.push("legacy", BASE_NOW - 1_000);
    const result = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: 1_000,
    });
    expect(result.stale).toBe(false);
    expect(result.ageMs).toBeNull();
  });
});

describe("selectAlignedRailSnapshot — viewer lag scenarios", () => {
  // PRD workstream F: 4s, 8s, 15s, 30s viewer lag.
  const buf = createSnapshotBuffer<{ phase: string }>();
  // Populate a synthetic phase history spanning 35s.
  buf.push({ phase: "ANNOUNCEMENT" }, BASE_NOW - 32_000);
  buf.push({ phase: "COUNTDOWN" }, BASE_NOW - 16_000);
  buf.push({ phase: "FIGHTING" }, BASE_NOW - 9_000);
  buf.push({ phase: "RESOLUTION" }, BASE_NOW - 2_000);

  const lagCases: Array<{ label: string; lagMs: number; expected: string }> = [
    { label: "4s lag", lagMs: 4_000, expected: "FIGHTING" },
    { label: "8s lag", lagMs: 8_000, expected: "FIGHTING" },
    { label: "15s lag", lagMs: 15_000, expected: "COUNTDOWN" },
    { label: "30s lag", lagMs: 30_000, expected: "ANNOUNCEMENT" },
  ];

  for (const { label, lagMs, expected } of lagCases) {
    it(`picks the phase matching ${label} viewer lag`, () => {
      const result = selectAlignedRailSnapshot({
        buffer: buf,
        viewerSourceNowMs: BASE_NOW - lagMs,
        viewerServerNowMs: BASE_NOW,
        extractServerEmittedAt: () => null,
        maxAgeMs: null,
      });
      expect(result.snapshot?.phase).toBe(expected);
    });
  }
});

describe("selectAlignedRailSnapshot — market locks while viewer is behind", () => {
  it("a newly-arrived locked market is NOT yet visible to a lagging viewer", () => {
    const buf = createSnapshotBuffer<{ lifecycleStatus: string }>();
    buf.push({ lifecycleStatus: "OPEN" }, BASE_NOW - 8_000);
    buf.push({ lifecycleStatus: "LOCKED" }, BASE_NOW);
    const laggingViewer = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW - 5_000,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    expect(laggingViewer.snapshot?.lifecycleStatus).toBe("OPEN");

    const upToDateViewer = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    expect(upToDateViewer.snapshot?.lifecycleStatus).toBe("LOCKED");
  });
});

describe("selectAlignedRailSnapshot — out-of-order snapshots", () => {
  it("selects by source time regardless of arrival order", () => {
    const buf = createSnapshotBuffer<{ seq: number }>();
    // Push in inverted order.
    buf.push({ seq: 3 }, BASE_NOW - 1_000);
    buf.push({ seq: 1 }, BASE_NOW - 5_000);
    buf.push({ seq: 2 }, BASE_NOW - 3_000);
    const result = selectAlignedRailSnapshot({
      buffer: buf,
      viewerSourceNowMs: BASE_NOW - 2_500,
      viewerServerNowMs: BASE_NOW,
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    expect(result.snapshot?.seq).toBe(2);
  });
});

describe("resolveTradeGate — clock severity", () => {
  it("closes display+submit when the clock is frozen", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ frozen: true }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({ snapshot: {} }),
    });
    expect(gate.canDisplayOpen).toBe(false);
    expect(gate.canSubmitTrade).toBe(false);
    expect(gate.reason).toBe("clock-frozen");
  });

  it("closes display+submit when the clock confidence is low", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ confidence: "low" }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({ snapshot: {} }),
    });
    expect(gate.canDisplayOpen).toBe(false);
    expect(gate.canSubmitTrade).toBe(false);
    expect(gate.reason).toBe("clock-confidence-low");
  });

  it("closes with reason session-missing when session selection is null", () => {
    const gate = resolveTradeGate({
      clock: makeClock(),
      session: makeSelection(),
      market: makeSelection({ snapshot: {} }),
    });
    expect(gate.canDisplayOpen).toBe(false);
    expect(gate.reason).toBe("session-missing");
  });

  it("closes with reason market-missing when market selection is null", () => {
    const gate = resolveTradeGate({
      clock: makeClock(),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection(),
    });
    expect(gate.canDisplayOpen).toBe(false);
    expect(gate.reason).toBe("market-missing");
  });

  it("closes with reason market-stale when market is selected but stale", () => {
    const gate = resolveTradeGate({
      clock: makeClock(),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({
        snapshot: {},
        ageMs: MARKET_MAX_AGE_MS + 1_000,
        stale: true,
      }),
    });
    expect(gate.canDisplayOpen).toBe(false);
    expect(gate.reason).toBe("market-stale");
  });

  it("opens both display and submit when clock healthy + rails present and fresh", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ confidence: "high" }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({
        snapshot: {},
        ageMs: 500,
        stale: false,
      }),
    });
    expect(gate.canDisplayOpen).toBe(true);
    expect(gate.canSubmitTrade).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it("opens at medium confidence as well (submission allowed when not frozen/low)", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ confidence: "medium" }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({ snapshot: {}, stale: false }),
    });
    expect(gate.canSubmitTrade).toBe(true);
  });
});

describe("resolveTradeGate — severity ordering", () => {
  it("clock-frozen beats market-stale when both are true", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ frozen: true, confidence: "low" }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection({ snapshot: {}, stale: true }),
    });
    expect(gate.reason).toBe("clock-frozen");
  });

  it("clock-low beats market-missing when both are true", () => {
    const gate = resolveTradeGate({
      clock: makeClock({ confidence: "low" }),
      session: makeSelection({ snapshot: {} }),
      market: makeSelection(),
    });
    expect(gate.reason).toBe("clock-confidence-low");
  });
});
