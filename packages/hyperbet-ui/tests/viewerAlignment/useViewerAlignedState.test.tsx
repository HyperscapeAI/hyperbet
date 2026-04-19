import "../setup";
import { describe, expect, it } from "bun:test";
import { useEffect } from "react";

import {
  useViewerAlignedState,
  type DivergenceEvent,
  type ViewerAlignedState,
} from "../../src/lib/viewerAlignment";
import { render } from "../render";

/**
 * Smoke-level hook wiring tests. The heavy lifting is covered by the
 * pure selector/divergence tests — these tests only verify that the
 * hook wires its inputs to outputs correctly and that `enabled=false`
 * is genuinely inert.
 *
 * Uses the existing react-dom/client test harness in `tests/render.tsx`.
 */

interface CapturedState<S, M, D> {
  value: ViewerAlignedState<S, M, D> | null;
}

function HookProbe<S, M, D>(props: {
  captured: CapturedState<S, M, D>;
  hookInputs: Parameters<typeof useViewerAlignedState<S, M, D>>[0];
}) {
  const state = useViewerAlignedState<S, M, D>(props.hookInputs);
  useEffect(() => {
    props.captured.value = state;
  });
  return null;
}

describe("useViewerAlignedState — passthrough mode", () => {
  it("returns enabled=false and passthrough rails when enabled=false", () => {
    const captured: CapturedState<{ id: number }, { tag: string }, { seed: string }> = {
      value: null,
    };
    const latestSession = { id: 42 };
    const latestMarket = { tag: "live" };
    const latestDuelContext = { seed: "abc" };

    const { unmount } = render(
      <HookProbe
        captured={captured}
        hookInputs={{
          enabled: false,
          latestSession,
          latestMarket,
          latestDuelContext,
          sessionPresentationDelayMs: 4_000,
          playerStatus: null,
          playerStatusReceivedAtMs: null,
          lastAdvancingPlayerStatusAtMs: null,
        }}
      />,
    );
    try {
      expect(captured.value?.enabled).toBe(false);
      expect(captured.value?.viewerClock).toBeNull();
      expect(captured.value?.session).toBe(latestSession);
      expect(captured.value?.marketOverview).toBe(latestMarket);
      expect(captured.value?.duelContext).toBe(latestDuelContext);
      // Passthrough trade gate is permissive (alignment layer is
      // not blocking anything).
      expect(captured.value?.tradeGate.canDisplayOpen).toBe(true);
      expect(captured.value?.tradeGate.canSubmitTrade).toBe(true);
      // Buffers are not populated in passthrough mode.
      expect(captured.value?.diagnostics.sessionBufferSize).toBe(0);
      expect(captured.value?.diagnostics.marketBufferSize).toBe(0);
    } finally {
      unmount();
    }
  });
});

describe("useViewerAlignedState — enabled mode buffer ingestion", () => {
  it("ingests session / market / duel-context payloads into their buffers", () => {
    const captured: CapturedState<
      { emittedAt: number; cycle: { phase: string } },
      { sourceEmittedAt: number; serverEmittedAt: number },
      { sourceEmittedAt: number; serverEmittedAt: number }
    > = {
      value: null,
    };
    const baseNow = Date.now();
    render(
      <HookProbe
        captured={captured}
        hookInputs={{
          enabled: true,
          latestSession: {
            emittedAt: baseNow - 2_000,
            cycle: { phase: "FIGHTING" },
          },
          latestMarket: {
            sourceEmittedAt: baseNow - 2_500,
            serverEmittedAt: baseNow - 2_400,
          },
          latestDuelContext: {
            sourceEmittedAt: baseNow - 2_000,
            serverEmittedAt: baseNow - 2_000,
          },
          sessionPresentationDelayMs: 4_000,
          playerStatus: {
            liveEdgeLatencyMs: 2_000,
            playbackStarted: true,
          },
          playerStatusReceivedAtMs: baseNow,
          lastAdvancingPlayerStatusAtMs: baseNow,
          // Turn off the interval tick — we only care about the
          // first render here; no need to keep ticking.
          tickIntervalMs: 1_000_000,
        }}
      />,
    );
    expect(captured.value?.enabled).toBe(true);
    expect(captured.value?.diagnostics.sessionBufferSize).toBe(1);
    expect(captured.value?.diagnostics.marketBufferSize).toBe(1);
    expect(captured.value?.diagnostics.duelContextBufferSize).toBe(1);
    // With live-edge latency fresh, confidence should be "high".
    expect(captured.value?.diagnostics.confidence).toBe("high");
    expect(captured.value?.viewerClock?.frozen).toBe(false);
  });
});

describe("useViewerAlignedState — divergence callback wiring", () => {
  it("fires onDivergence when the hook detects a stale rail", () => {
    // Use the stale-rail path rather than phase-mismatch for this
    // smoke test — phase-mismatch interacts with the offset estimator
    // bootstrap in a way that's hard to pin down deterministically
    // from a single render (the first session sample sets the offset
    // to something like `session.emittedAt - receivedAt`, which then
    // shifts sourceNowMs away from the buffer entry). Stale-rail
    // detection runs entirely off `serverEmittedAt`, independent of
    // source-time selection. The pure divergence test covers the
    // phase-mismatch path comprehensively.
    const events: DivergenceEvent[] = [];
    const baseNow = Date.now();
    render(
      <HookProbe<
        { emittedAt: number },
        { sourceEmittedAt: number; serverEmittedAt: number },
        unknown
      >
        captured={{ value: null }}
        hookInputs={{
          enabled: true,
          latestSession: { emittedAt: baseNow - 500 },
          // Market with serverEmittedAt deliberately old → stale
          // beyond MARKET_MAX_AGE_MS=10s.
          latestMarket: {
            sourceEmittedAt: baseNow - 20_000,
            serverEmittedAt: baseNow - 20_000,
          },
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          playerStatus: {
            liveEdgeLatencyMs: 500,
            playbackStarted: true,
          },
          playerStatusReceivedAtMs: baseNow,
          lastAdvancingPlayerStatusAtMs: baseNow,
          onDivergence: (event) => events.push(event),
          tickIntervalMs: 1_000_000,
        }}
      />,
    );
    const staleEvents = events.filter(
      (event) => event.reason === "market-stale",
    );
    expect(staleEvents.length).toBeGreaterThan(0);
    expect(staleEvents[0].staleRails).toContain("market");
  });
});
