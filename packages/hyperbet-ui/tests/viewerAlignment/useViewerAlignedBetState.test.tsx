import "../setup";
import { describe, expect, it } from "bun:test";
import { act, useEffect } from "react";

import type { StreamPlayerStatus } from "../../src/components/StreamPlayer";
import {
  type DivergenceEvent,
  useViewerAlignedBetState,
  type ViewerAlignedState,
} from "../../src/lib/viewerAlignment";
import { render } from "../render";

/**
 * Smoke tests for the app-shell adapter. The inner hook is already
 * covered by `useViewerAlignedState.test.tsx`; here we only verify
 * that the adapter correctly:
 *   - defaults to disabled (env-driven passthrough)
 *   - honours the explicit override
 *   - maps `StreamPlayerStatus` into the narrower telemetry shape
 *     without throwing on optional fields
 */

function makeStreamPlayerStatus(
  overrides: Partial<StreamPlayerStatus> = {},
): StreamPlayerStatus {
  return {
    ready: true,
    status: null,
    liveEdgeLatencyMs: 1_500,
    stallCount: 0,
    rebuildCount: 0,
    lastBufferedFragmentAt: Date.now(),
    playbackUrl: null,
    deliveryMode: null,
    firstFrameAt: Date.now() - 2_000,
    startupDurationMs: 2_000,
    playbackStarted: true,
    presentationDelayMs: 4_000,
    syncDeltaMs: 0,
    syncState: "aligned",
    bootPhase: "finalizing",
    loaderVisible: false,
    ...overrides,
  };
}

interface CapturedState<S, M, D> {
  value: ViewerAlignedState<S, M, D> | null;
}

function BetStateProbe<S, M, D>(props: {
  captured: CapturedState<S, M, D>;
  inputs: Parameters<typeof useViewerAlignedBetState<S, M, D>>[0];
}) {
  const state = useViewerAlignedBetState<S, M, D>(props.inputs);
  useEffect(() => {
    props.captured.value = state;
  });
  return null;
}

describe("useViewerAlignedBetState — adapter passthrough", () => {
  it("defaults to disabled when no override is provided (env is empty in tests)", () => {
    const captured: CapturedState<{ id: number }, unknown, unknown> = {
      value: null,
    };
    const { unmount } = render(
      <BetStateProbe
        captured={captured}
        inputs={{
          latestSession: { id: 1 },
          latestMarket: null,
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          streamPlayerStatus: null,
        }}
      />,
    );
    try {
      expect(captured.value?.enabled).toBe(false);
      // Passthrough gate is permissive.
      expect(captured.value?.tradeGate.canSubmitTrade).toBe(true);
    } finally {
      unmount();
    }
  });

  it("honours enabledOverride=true and ingests session payload into the buffer", () => {
    const captured: CapturedState<
      { emittedAt: number },
      unknown,
      unknown
    > = { value: null };
    const baseNow = Date.now();
    const { unmount } = render(
      <BetStateProbe
        captured={captured}
        inputs={{
          enabledOverride: true,
          latestSession: { emittedAt: baseNow - 500 },
          latestMarket: null,
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          streamPlayerStatus: makeStreamPlayerStatus(),
        }}
      />,
    );
    try {
      expect(captured.value?.enabled).toBe(true);
      expect(captured.value?.diagnostics.sessionBufferSize).toBe(1);
      // Live-edge latency is fresh → latency source should be
      // player-live-edge, not the session-presentation-delay fallback.
      expect(captured.value?.diagnostics.latencySource).toBe(
        "player-live-edge",
      );
    } finally {
      unmount();
    }
  });

  it("tolerates a null StreamPlayerStatus without throwing", () => {
    const captured: CapturedState<{ emittedAt: number }, unknown, unknown> = {
      value: null,
    };
    const { unmount } = render(
      <BetStateProbe
        captured={captured}
        inputs={{
          enabledOverride: true,
          latestSession: { emittedAt: Date.now() - 500 },
          latestMarket: null,
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          streamPlayerStatus: null,
        }}
      />,
    );
    try {
      expect(captured.value?.enabled).toBe(true);
      // With no telemetry and no advancing timestamp, the clock's
      // latencySource falls back to the session presentation delay.
      expect(captured.value?.diagnostics.latencySource).toBe(
        "session-presentation-delay",
      );
    } finally {
      unmount();
    }
  });

  it("keeps player telemetry alive in shadow mode when enabledOverride is false", async () => {
    const events: DivergenceEvent[] = [];
    const captured: CapturedState<
      { emittedAt: number },
      { sourceEmittedAt: number; serverEmittedAt: number },
      unknown
    > = { value: null };
    const baseNow = Date.now();
    const { unmount } = render(
      <BetStateProbe
        captured={captured}
        inputs={{
          enabledOverride: false,
          latestSession: { emittedAt: baseNow - 500 },
          latestMarket: {
            sourceEmittedAt: baseNow - 20_000,
            serverEmittedAt: baseNow - 20_000,
          },
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          streamPlayerStatus: makeStreamPlayerStatus({
            liveEdgeLatencyMs: 1_250,
            lastBufferedFragmentAt: baseNow,
          }),
          onDivergence: (event) => events.push(event),
          tickIntervalMs: 1,
        }}
      />,
    );
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(captured.value?.enabled).toBe(false);
      const liveEdgeEvent = events.find(
        (event) =>
          event.reason === "market-stale" &&
          event.viewerClock.latencySource === "player-live-edge",
      );
      expect(liveEdgeEvent).not.toBeUndefined();
      expect(liveEdgeEvent?.viewerClock.latencyMs).toBe(1_250);
    } finally {
      unmount();
    }
  });

  it("suppresses divergence callbacks once viewer alignment is enabled", async () => {
    const events: DivergenceEvent[] = [];
    const captured: CapturedState<
      { emittedAt: number },
      { sourceEmittedAt: number; serverEmittedAt: number },
      unknown
    > = { value: null };
    const baseNow = Date.now();
    const { unmount } = render(
      <BetStateProbe
        captured={captured}
        inputs={{
          enabledOverride: true,
          latestSession: { emittedAt: baseNow - 500 },
          latestMarket: {
            sourceEmittedAt: baseNow - 20_000,
            serverEmittedAt: baseNow - 20_000,
          },
          latestDuelContext: null,
          sessionPresentationDelayMs: 4_000,
          streamPlayerStatus: makeStreamPlayerStatus({
            liveEdgeLatencyMs: 1_250,
            lastBufferedFragmentAt: baseNow,
          }),
          onDivergence: (event) => events.push(event),
          tickIntervalMs: 1,
        }}
      />,
    );
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(captured.value?.enabled).toBe(true);
      expect(events.length).toBe(0);
    } finally {
      unmount();
    }
  });
});
