import "./setup";

import { act, useState } from "react";
import { afterEach, describe, expect, it } from "bun:test";

import {
  getStreamingReconnectDelayMs,
  isStreamingRendererHealthReady,
  selectStreamingStateForPlayback,
  useStreamingState,
} from "../src/spectator/useStreamingState";
import type { StreamingStateUpdate } from "../src/spectator/types";
import { render } from "./render";

type StreamingHookResult = ReturnType<typeof useStreamingState>;

const originalFetch = globalThis.fetch;
const originalEventSource = window.EventSource;
let latestResult: StreamingHookResult | null = null;
let setPlaybackDate: ((value: number) => void) | null = null;

function makeState(seq: number): StreamingStateUpdate {
  return {
    type: "STREAMING_STATE_UPDATE",
    seq,
    emittedAt: Date.now(),
    cameraTarget: "agent-a",
    leaderboard: [],
    cycle: {
      cycleId: "cycle-a",
      phase: "FIGHTING",
      cycleStartTime: Date.now() - 10_000,
      phaseStartTime: Date.now() - 5_000,
      phaseEndTime: Date.now() + 60_000,
      timeRemaining: 60_000,
      agent1: null,
      agent2: null,
      duelId: "duel-a",
      duelKeyHex: "ab".repeat(32),
      countdown: null,
      winnerId: null,
      winnerName: null,
      winReason: null,
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: Date.now(),
      },
    },
  };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, state: StreamingStateUpdate, eventId: number) {
    const event = new MessageEvent<string>(type, {
      data: JSON.stringify(state),
      lastEventId: String(eventId),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  fail() {
    this.onerror?.();
  }

  close() {
    this.closed = true;
  }
}

function Probe() {
  latestResult = useStreamingState({
    apiUrl: "http://127.0.0.1:5555",
    uiSyncDelayMs: 25,
    fallbackPollIntervalMs: 1_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 5,
    reconnectJitterRatio: 0,
    sseFrameTimeoutMs: 500,
  });
  return null;
}

function PlaybackSynchronizedProbe() {
  const [playbackDateMs, setDate] = useState(500);
  setPlaybackDate = setDate;
  latestResult = useStreamingState({
    apiUrl: "http://127.0.0.1:5555",
    uiSyncDelayMs: 10_000,
    presentationTimeMs: playbackDateMs,
    playbackPresentationLagMs: 0,
    fallbackPollIntervalMs: 1_000,
    reconnectBaseDelayMs: 5,
    reconnectMaxDelayMs: 5,
    reconnectJitterRatio: 0,
    sseFrameTimeoutMs: 500,
  });
  return null;
}

async function waitMs(durationMs: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.EventSource = originalEventSource;
  FakeEventSource.instances = [];
  latestResult = null;
  setPlaybackDate = null;
});

describe("streaming state recovery", () => {
  it("selects the newest telemetry frame at the HLS program date", () => {
    const state1 = { ...makeState(1), emittedAt: 1_000 };
    const state2 = { ...makeState(2), emittedAt: 2_000 };
    const sameTimeNewerSeq = { ...makeState(3), emittedAt: 2_000 };
    const future = { ...makeState(4), emittedAt: 3_000 };

    expect(
      selectStreamingStateForPlayback(
        [future, state1, state2, sameTimeNewerSeq],
        2_100,
        0,
      )?.seq,
    ).toBe(3);
    expect(
      selectStreamingStateForPlayback([state1, state2], 2_250, 250)?.seq,
    ).toBe(2);
    expect(selectStreamingStateForPlayback([state1, state2], 2_200)?.seq).toBe(
      1,
    );
    expect(selectStreamingStateForPlayback([state1, state2], 2_250)?.seq).toBe(
      2,
    );
    expect(selectStreamingStateForPlayback([state1], 1_249, 250)).toBe(null);
    expect(selectStreamingStateForPlayback([state1], Number.NaN)).toBe(null);
  });

  it("holds future telemetry until playback reaches it and can follow a restarted timeline backward", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    window.EventSource =
      FakeEventSource as unknown as typeof window.EventSource;

    const rendered = render(<PlaybackSynchronizedProbe />);
    const source = FakeEventSource.instances[0];
    const state1 = { ...makeState(1), emittedAt: 1_000 };
    const state2 = { ...makeState(2), emittedAt: 2_000 };
    act(() => {
      source?.emit("state", state1, 1);
      source?.emit("state", state2, 2);
    });
    expect(latestResult?.state).toBe(null);
    expect(latestResult?.isConnected).toBe(false);

    act(() => setPlaybackDate?.(1_100));
    expect(latestResult?.state?.seq).toBe(1);
    expect(latestResult?.isConnected).toBe(true);

    act(() => setPlaybackDate?.(2_100));
    expect(latestResult?.state?.seq).toBe(2);

    act(() => setPlaybackDate?.(1_100));
    expect(latestResult?.state?.seq).toBe(1);
    rendered.unmount();
  });

  it("uses timeline frames for presentation without restoring stale renderer authority", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    window.EventSource =
      FakeEventSource as unknown as typeof window.EventSource;

    const rendered = render(<PlaybackSynchronizedProbe />);
    const source = FakeEventSource.instances[0];
    const unavailable = {
      ...makeState(10),
      emittedAt: 2_000,
      cycle: {
        ...makeState(10).cycle,
        rendererHealth: {
          ready: false,
          degradedReason: "capture_starting",
          updatedAt: Date.now(),
        },
      },
    };
    const presentation = { ...makeState(11), emittedAt: 1_000 };

    act(() => {
      source?.emit("state", unavailable, 10);
      source?.emit("timeline", presentation, 11);
      setPlaybackDate?.(1_100);
    });

    expect(latestResult?.state?.seq).toBe(11);
    expect(latestResult?.isConnected).toBe(true);
    expect(latestResult?.isRendererReady).toBe(false);
    rendered.unmount();
  });

  it("bounds exponential reconnect delay with symmetric jitter", () => {
    expect(getStreamingReconnectDelayMs(0, 1_000, 15_000, 0, 0)).toBe(1_000);
    expect(getStreamingReconnectDelayMs(4, 1_000, 15_000, 0, 1)).toBe(15_000);
    expect(getStreamingReconnectDelayMs(1, 1_000, 15_000, 0.2, 0)).toBe(1_600);
    expect(getStreamingReconnectDelayMs(1, 1_000, 15_000, 0.2, 1)).toBe(2_400);
  });

  it("accepts only fresh, explicitly healthy renderer authority", () => {
    expect(
      isStreamingRendererHealthReady(
        { ready: true, degradedReason: null, updatedAt: 9_500 },
        10_000,
        1_000,
      ),
    ).toBe(true);
    expect(
      isStreamingRendererHealthReady(
        {
          ready: false,
          degradedReason: "camera_target_unresolved",
          updatedAt: 10_000,
        },
        10_000,
        1_000,
      ),
    ).toBe(false);
    expect(
      isStreamingRendererHealthReady(
        { ready: true, degradedReason: null, updatedAt: 8_999 },
        10_000,
        1_000,
      ),
    ).toBe(false);
    expect(isStreamingRendererHealthReady(null, 10_000, 1_000)).toBe(false);
  });

  it("invalidates delayed stale telemetry and resumes SSE from the last event without a reload", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    window.EventSource =
      FakeEventSource as unknown as typeof window.EventSource;

    const rendered = render(<Probe />);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      FakeEventSource.instances[0]?.emit("state", makeState(7), 7);
      FakeEventSource.instances[0]?.fail();
    });
    await waitMs(40);

    expect(latestResult?.state).toBe(null);
    expect(latestResult?.isConnected).toBe(false);
    expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(2);

    const replacement = FakeEventSource.instances.at(-1);
    expect(replacement?.url).toContain("since=7");
    act(() => {
      replacement?.emit("state", makeState(8), 8);
    });
    await waitMs(35);

    expect(latestResult?.state?.seq).toBe(8);
    expect(latestResult?.isConnected).toBe(true);
    expect(latestResult?.isRendererReady).toBe(true);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    rendered.unmount();
  });
});
