import { describe, expect, it } from "bun:test";
import {
  PLAYER_FREEZE_THRESHOLD_MS,
  resolveViewerClock,
  STALE_PLAYER_TELEMETRY_MS,
  type StreamPlayerTelemetrySnapshot,
  type ViewerClockInputs,
} from "../../src/lib/viewerAlignment";

/**
 * Pure tests for `resolveViewerClock`. Every case fabricates exact
 * inputs and asserts the derived viewer clock. No timers, no fakes.
 */

const BASE_NOW = 1_800_000_000_000;

function makeInputs(
  overrides: Partial<ViewerClockInputs> = {},
): ViewerClockInputs {
  return {
    nowMs: BASE_NOW,
    estimatedServerOffsetMs: 0,
    playerStatus: null,
    playerStatusReceivedAtMs: null,
    sessionPresentationDelayMs: null,
    lastAdvancingPlayerStatusAtMs: null,
    ...overrides,
  };
}

function makePlayer(
  overrides: Partial<StreamPlayerTelemetrySnapshot> = {},
): StreamPlayerTelemetrySnapshot {
  return {
    liveEdgeLatencyMs: null,
    presentationDelayMs: null,
    syncState: null,
    firstFrameAt: null,
    currentTime: null,
    playbackStarted: false,
    ...overrides,
  };
}

describe("resolveViewerClock — latency source selection", () => {
  it("prefers fresh liveEdgeLatencyMs over everything else (high confidence)", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          presentationDelayMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
        sessionPresentationDelayMs: 4_000,
      }),
    );
    expect(clock.latencyMs).toBe(4_200);
    expect(clock.latencySource).toBe("player-live-edge");
    expect(clock.confidence).toBe("high");
  });

  it("falls back to player presentation delay when live-edge latency is missing", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: null,
          presentationDelayMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
        sessionPresentationDelayMs: 4_000,
      }),
    );
    expect(clock.latencyMs).toBe(4_000);
    expect(clock.latencySource).toBe("player-presentation-delay");
    expect(clock.confidence).toBe("medium");
  });

  it("falls back to session presentation delay pre-telemetry (low confidence)", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: null,
        playerStatusReceivedAtMs: null,
        sessionPresentationDelayMs: 4_000,
      }),
    );
    expect(clock.latencyMs).toBe(4_000);
    expect(clock.latencySource).toBe("session-presentation-delay");
    expect(clock.confidence).toBe("low");
  });

  it("returns zero latency + low confidence when nothing is available", () => {
    const clock = resolveViewerClock(makeInputs());
    expect(clock.latencyMs).toBe(0);
    expect(clock.latencySource).toBe("none");
    expect(clock.confidence).toBe("low");
  });

  it("ignores negative liveEdgeLatencyMs and falls through", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: -1,
          presentationDelayMs: 4_000,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(clock.latencySource).toBe("player-presentation-delay");
    expect(clock.latencyMs).toBe(4_000);
  });
});

describe("resolveViewerClock — staleness", () => {
  it("degrades confidence to low when telemetry is stale", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({ liveEdgeLatencyMs: 4_200 }),
        // Older than STALE_PLAYER_TELEMETRY_MS.
        playerStatusReceivedAtMs: BASE_NOW - (STALE_PLAYER_TELEMETRY_MS + 1_000),
      }),
    );
    expect(clock.confidence).toBe("low");
  });

  it("falls through to session delay when telemetry is stale", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({ liveEdgeLatencyMs: 4_200 }),
        playerStatusReceivedAtMs: BASE_NOW - (STALE_PLAYER_TELEMETRY_MS + 1_000),
        sessionPresentationDelayMs: 3_500,
      }),
    );
    expect(clock.latencySource).toBe("session-presentation-delay");
    expect(clock.latencyMs).toBe(3_500);
    expect(clock.confidence).toBe("low");
  });

  it("telemetryAgeMs reflects wall-clock staleness and clamps at zero for negative skew", () => {
    const clockFuture = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({ liveEdgeLatencyMs: 4_200 }),
        playerStatusReceivedAtMs: BASE_NOW + 100, // future arrival
      }),
    );
    expect(clockFuture.telemetryAgeMs).toBe(0);

    const clockPast = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({ liveEdgeLatencyMs: 4_200 }),
        playerStatusReceivedAtMs: BASE_NOW - 750,
      }),
    );
    expect(clockPast.telemetryAgeMs).toBe(750);
  });
});

describe("resolveViewerClock — unhealthy sync state", () => {
  it("demotes high → medium on buffering", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          syncState: "buffering",
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(clock.confidence).toBe("medium");
  });

  it("demotes to low on out_of_sync and error", () => {
    const out = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          syncState: "out_of_sync",
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(out.confidence).toBe("medium");

    const err = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          syncState: "error",
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(err.confidence).toBe("medium");
  });

  it("does not demote on benign sync states", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          syncState: "in_sync",
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(clock.confidence).toBe("high");
  });
});

describe("resolveViewerClock — freeze behavior", () => {
  it("does not freeze before playback has started (bootstrap state)", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_200,
          playbackStarted: false,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
        lastAdvancingPlayerStatusAtMs:
          BASE_NOW - (PLAYER_FREEZE_THRESHOLD_MS * 5),
      }),
    );
    expect(clock.frozen).toBe(false);
  });

  it("freezes when media time hasn't advanced for longer than the threshold", () => {
    const frozenSince = BASE_NOW - (PLAYER_FREEZE_THRESHOLD_MS + 1_000);
    const clock = resolveViewerClock(
      makeInputs({
        estimatedServerOffsetMs: 50,
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
        lastAdvancingPlayerStatusAtMs: frozenSince,
      }),
    );
    expect(clock.frozen).toBe(true);
    expect(clock.confidence).toBe("low");
    // sourceNowMs pinned to the last-advancing moment, not wall-now.
    expect(clock.sourceNowMs).toBe(frozenSince + 50 - 4_000);
    // wallNow and serverNow continue advancing.
    expect(clock.wallNowMs).toBe(BASE_NOW);
    expect(clock.serverNowMs).toBe(BASE_NOW + 50);
  });

  it("does not freeze just below the threshold", () => {
    const clock = resolveViewerClock(
      makeInputs({
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
        lastAdvancingPlayerStatusAtMs:
          BASE_NOW - (PLAYER_FREEZE_THRESHOLD_MS - 100),
      }),
    );
    expect(clock.frozen).toBe(false);
  });
});

describe("resolveViewerClock — clock-skew invariant", () => {
  it("applies positive server offset (server ahead of client)", () => {
    const clock = resolveViewerClock(
      makeInputs({
        estimatedServerOffsetMs: 2_000,
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(clock.serverNowMs).toBe(BASE_NOW + 2_000);
    expect(clock.sourceNowMs).toBe(BASE_NOW + 2_000 - 4_000);
  });

  it("applies negative server offset (client ahead of server)", () => {
    const clock = resolveViewerClock(
      makeInputs({
        estimatedServerOffsetMs: -1_500,
        playerStatus: makePlayer({
          liveEdgeLatencyMs: 4_000,
          playbackStarted: true,
        }),
        playerStatusReceivedAtMs: BASE_NOW - 500,
      }),
    );
    expect(clock.serverNowMs).toBe(BASE_NOW - 1_500);
    expect(clock.sourceNowMs).toBe(BASE_NOW - 1_500 - 4_000);
  });
});

describe("resolveViewerClock — envelope stability", () => {
  it("returns a new object on each call (no hidden mutation)", () => {
    const inputs = makeInputs({
      playerStatus: makePlayer({ liveEdgeLatencyMs: 4_000 }),
      playerStatusReceivedAtMs: BASE_NOW - 500,
    });
    const a = resolveViewerClock(inputs);
    const b = resolveViewerClock(inputs);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
