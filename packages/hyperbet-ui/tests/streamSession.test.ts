import "./setup";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, createElement } from "react";

import { LIVE_EDGE_HLS_CONFIG } from "../src/components/StreamPlayer";
import { deriveBettorStreamUiState } from "../src/lib/bettorStreamUi";
import {
  describeCanonicalRendererDegradedReason,
  isCanonicalRendererPlaybackReady,
  resolveCanonicalPlaybackDeliveryMode,
  selectBetSurfaceStreamUrl,
} from "../src/lib/streamSession";
import {
  consumeDueCanonicalStreamSession,
  normalizeCanonicalStreamSession,
  queueCanonicalStreamSession,
  useCanonicalStreamSession,
} from "../src/spectator/useCanonicalStreamSession";
import type { SourceRuntimeInfo } from "../src/spectator/types";
import { render } from "./render";

const originalFetch = globalThis.fetch;
const originalEventSource = window.EventSource;

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.EventSource = originalEventSource;
});

function makeCanonicalChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: "hyperscapes-broadcast-channel",
    mode: "always_on",
    presentationDelayMs: 4000,
    activeDuelId: "duel-1",
    activeDuelKey: "deadbeef",
    canonicalDestinationId: "canonical-cloudflare",
    fallbackDestinationId: "fallback-self-hls",
    publicPlaybackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
    publicReadiness: {
      ready: true,
      reason: null,
      updatedAt: 1,
    },
    destinations: [
      {
        id: "canonical-cloudflare",
        name: "External Delivery",
        role: "canonical",
        provider: "cloudflare_stream",
        transport: "llhls",
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        ingestUrl: "rtmps://live.cloudflare.example/input",
        connected: true,
        transportHealthy: true,
        playbackReady: true,
        manifestStatus: "ok",
        lastError: null,
        updatedAt: 1,
      },
      {
        id: "fallback-self-hls",
        name: "Self-HLS",
        role: "fallback",
        provider: "self_hls",
        transport: "hls",
        playbackUrl: "https://fallback.example/live/stream.m3u8",
        ingestUrl: null,
        connected: true,
        transportHealthy: true,
        playbackReady: true,
        manifestStatus: "ok",
        lastError: null,
        updatedAt: 1,
      },
    ],
    ...overrides,
  };
}

function makeSourceRuntime(
  overrides: Partial<SourceRuntimeInfo> = {},
): SourceRuntimeInfo {
  return {
    ready: true,
    statusSource: "external_worker",
    captureMode: "cdp",
    degradedReason: null,
    currentSceneUrl: "https://stream.example/page",
    activeBundle: "bundle-a",
    lastFrameAt: 1,
    lastRenderTickAt: 1,
    lastVisualChangeAt: 1,
    lastRecoveryAt: 1,
    recoveryCount: 0,
    workerHeartbeatAt: 1,
    ...overrides,
  };
}

describe("normalizeCanonicalStreamSession", () => {
  it("parses additive renderer metrics and delivery fields", () => {
    const session = normalizeCanonicalStreamSession({
      schemaVersion: 2,
      seq: 42,
      emittedAt: 1234567890,
      duelId: "duel-1",
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        phaseVersion: 7,
        rendererHealth: {
          ready: true,
          degradedReason: null,
          updatedAt: 1234567890,
        },
      },
      rendererMetrics: {
        captureFps: 30,
        encodeFps: 29,
        visualChangeAgeMs: 200,
        hlsManifest: {
          updatedAt: 1234567890,
          mediaSequence: 77,
        },
      },
      channel: makeCanonicalChannel({
        publicReadiness: {
          ready: true,
          reason: null,
          updatedAt: 1234567890,
        },
      }),
      sourceRuntime: makeSourceRuntime(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 0,
      },
    });

    expect(session).not.toBeNull();
    expect(session?.rendererMetrics?.captureFps).toBe(30);
    expect(session?.rendererMetrics?.hlsManifest?.mediaSequence).toBe(77);
    expect(session?.publicReadiness?.ready).toBe(true);
    expect(session?.canonicalDestination?.id).toBe("canonical-cloudflare");
    expect(session?.sourceRuntime?.ready).toBe(true);
    expect(session?.status.sourceRuntime?.ready).toBe(true);
    expect(session?.deliveryHealth?.ready).toBe(true);
    expect(session?.delivery?.mode).toBe("external_hls");
    expect(session?.delivery?.playbackUrl).toContain("protocol=llhls");
    expect(session?.delivery?.llhlsUrl).toContain("protocol=llhls");
    expect(session?.delivery?.hlsUrl).toBe("https://video.example/manifest.m3u8");
    expect(session?.status.delivery?.provider).toBe("cloudflare_stream");
    expect(session?.status.deliveryHealth?.ready).toBe(true);
  });

  it("parses canonical authority reconciliation metadata when present", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 8,
      emittedAt: 1_234_567_890,
      cycle: {
        cycleId: "cycle-1",
        phase: "ANNOUNCEMENT",
      },
      canonicalAuthority: {
        providerLive: true,
        playbackProbeReady: true,
        decision: "ready",
        reason: null,
        revision: 12,
        updatedAt: 1_234_567_890,
        liveInputId: "live-input-123",
        videoUid: "video-456",
        lifecycleStatus: "connected",
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        playbackProbeStatusCode: 200,
        playbackManifestStatus: "ok",
      },
    });

    expect(session?.canonicalAuthority).toEqual({
      providerLive: true,
      playbackProbeReady: true,
      decision: "ready",
      reason: null,
      revision: 12,
      updatedAt: 1_234_567_890,
      liveInputId: "live-input-123",
      videoUid: "video-456",
      lifecycleStatus: "connected",
      playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
      playbackProbeStatusCode: 200,
      playbackManifestStatus: "ok",
    });
    expect(session?.authorityHealth.ready).toBe(true);
  });

  it("preserves llhls playback semantics when canonical ingest transport is srt", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 7,
      emittedAt: 1234567890,
      cycle: {
        cycleId: "cycle-1",
        phase: "ANNOUNCEMENT",
      },
      channel: makeCanonicalChannel({
        publicPlaybackUrl:
          "https://video.example/manifest.m3u8?protocol=llhls",
        destinations: [
          {
            id: "canonical-cloudflare",
            name: "External Delivery",
            role: "canonical",
            provider: "cloudflare_stream",
            transport: "srt",
            playbackUrl:
              "https://video.example/manifest.m3u8?protocol=llhls",
            ingestUrl: "srt://live.cloudflare.com:778",
            connected: true,
            transportHealthy: true,
            playbackReady: true,
            manifestStatus: "ok",
            lastError: null,
            updatedAt: 1,
          },
        ],
      }),
      sourceRuntime: makeSourceRuntime(),
    });

    expect(session?.delivery?.llhlsUrl).toBe(
      "https://video.example/manifest.m3u8?protocol=llhls",
    );
    expect(session?.delivery?.hlsUrl).toBe(
      "https://video.example/manifest.m3u8",
    );
    expect(resolveCanonicalPlaybackDeliveryMode(session)).toBe(
      "external_hls/llhls",
    );
  });

  it("ignores legacy cycle renderer staleness when top-level readiness is present", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 8,
      emittedAt: 1234567890,
      cycle: {
        cycleId: "cycle-1",
        phase: "RESOLUTION",
        rendererHealth: {
          ready: false,
          degradedReason: "render_tick_stale",
          updatedAt: 1234567890,
        },
      },
      channel: makeCanonicalChannel(),
      sourceRuntime: makeSourceRuntime(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 4000,
      },
    });

    expect(session?.publicReadiness?.ready).toBe(true);
    expect(session?.rendererHealth).toBeNull();
    expect(session?.cycle.rendererHealth).toBeNull();
  });

  it("prefers broadcastTimeline timing and phase fields when present", () => {
    const session = normalizeCanonicalStreamSession({
      schemaVersion: 3,
      seq: 9,
      emittedAt: 1234567890,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        betOpenTime: 1000,
        betCloseTime: 2000,
        fightStartTime: 3000,
        duelEndTime: 9000,
        broadcastTimeline: {
          phase: "COUNTDOWN",
          betOpenTime: 5000,
          betCloseTime: 6000,
          fightStartTime: 7000,
          duelEndTime: 13000,
          presentationDelayMs: 4000,
          updatedAt: 1234567890,
        },
      },
      channel: makeCanonicalChannel(),
      sourceRuntime: makeSourceRuntime(),
    });

    expect(session?.schemaVersion).toBe(3);
    expect(session?.phase).toBe("COUNTDOWN");
    expect(session?.cycle.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: 5000,
      betCloseTime: 6000,
      fightStartTime: 7000,
      duelEndTime: 13000,
      presentationDelayMs: 4000,
      updatedAt: 1234567890,
    });
    expect(session?.cycle.betOpenTime).toBe(5000);
    expect(session?.cycle.betCloseTime).toBe(6000);
    expect(session?.cycle.fightStartTime).toBe(7000);
    expect(session?.cycle.duelEndTime).toBe(13000);
  });

  it("preserves legacy timing fields when broadcastTimeline is sparse", () => {
    const session = normalizeCanonicalStreamSession({
      schemaVersion: 3,
      seq: 10,
      emittedAt: 1234567891,
      cycle: {
        cycleId: "cycle-2",
        phase: "FIGHTING",
        betOpenTime: 1000,
        betCloseTime: 2000,
        fightStartTime: 3000,
        duelEndTime: 9000,
        broadcastTimeline: {
          phase: "COUNTDOWN",
          betOpenTime: null,
          betCloseTime: null,
          fightStartTime: null,
          duelEndTime: 13000,
          presentationDelayMs: 4000,
          updatedAt: 1234567891,
        },
      },
      channel: makeCanonicalChannel(),
      sourceRuntime: makeSourceRuntime(),
    });

    expect(session?.phase).toBe("COUNTDOWN");
    expect(session?.cycle.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: null,
      betCloseTime: null,
      fightStartTime: null,
      duelEndTime: 13000,
      presentationDelayMs: 4000,
      updatedAt: 1234567891,
    });
    expect(session?.cycle.betOpenTime).toBe(1000);
    expect(session?.cycle.betCloseTime).toBe(2000);
    expect(session?.cycle.fightStartTime).toBe(3000);
    expect(session?.cycle.duelEndTime).toBe(13000);
  });
});

describe("canonical session delay buffering", () => {
  const baseCycle = {
    cycleId: "cycle-1",
    phase: "FIGHTING",
    duelId: "duel-1",
    duelKeyHex: "deadbeef",
    rendererHealth: {
      ready: true,
      degradedReason: null,
      updatedAt: 1,
    },
  };

  function makeSession(seq: number, emittedAt: number, delayMs = 4000) {
    return normalizeCanonicalStreamSession({
      seq,
      emittedAt,
      cycle: baseCycle,
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: emittedAt,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: emittedAt,
      },
      sourceRuntime: makeSourceRuntime(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: `render-${seq}`,
        presentationDelayMs: delayMs,
      },
    });
  }

  it("keeps the newest eligible delayed session while leaving future sessions queued", () => {
    const session1 = makeSession(1, 1000);
    const session2 = makeSession(2, 1500);
    const session3 = makeSession(3, 2000);
    expect(session1).not.toBeNull();
    expect(session2).not.toBeNull();
    expect(session3).not.toBeNull();

    const queued = queueCanonicalStreamSession(
      queueCanonicalStreamSession(
        queueCanonicalStreamSession([], session1!, 0),
        session2!,
        0,
      ),
      session3!,
      0,
    );

    const drained = consumeDueCanonicalStreamSession(queued, 5600);
    expect(drained.dueSession?.seq).toBe(2);
    expect(drained.remainingQueue.map((session) => session.seq)).toEqual([3]);
    expect(drained.waitMs).toBe(400);
  });

  it("drops already-applied sessions when reconnects replay older seq values", () => {
    const session2 = makeSession(2, 1500);
    const session3 = makeSession(3, 2000);
    expect(session2).not.toBeNull();
    expect(session3).not.toBeNull();

    const queued = queueCanonicalStreamSession([session3!], session2!, 2);
    expect(queued.map((session) => session.seq)).toEqual([3]);
  });
});

describe("useCanonicalStreamSession", () => {
  it("bootstraps from polling even when EventSource never connects", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            seq: 99,
            emittedAt: 123,
            cycle: {
              cycleId: "cycle-1",
              phase: "ANNOUNCEMENT",
              duelId: "duel-1",
              duelKeyHex: "deadbeef",
              rendererHealth: {
                ready: true,
                degradedReason: null,
                updatedAt: 123,
              },
            },
            rendererHealth: {
              ready: true,
              degradedReason: null,
              updatedAt: 123,
            },
            sourceRuntime: makeSourceRuntime(),
            channel: makeCanonicalChannel(),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    class HangingEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string) { }

      addEventListener() { }

      close() { }
    }

    window.EventSource = HangingEventSource as unknown as typeof window.EventSource;

    function Probe() {
      const { session } = useCanonicalStreamSession();
      return createElement(
        "div",
        { "data-testid": "session-seq" },
        session ? String(session.seq) : "none",
      );
    }

    const view = render(createElement(Probe));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.container.querySelector("[data-testid='session-seq']")?.textContent).toBe(
      "99",
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("selectBetSurfaceStreamUrl", () => {
  it("prefers canonical external delivery when the renderer is healthy", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: true,
          degradedReason: null,
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      channel: makeCanonicalChannel(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 0,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(selection.activeStreamUrl).toContain("protocol=llhls");
    expect(selection.canUseCanonicalPlayback).toBe(true);
  });

  it("does not use canonical external delivery when broadcast delivery is disconnected", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: true,
          degradedReason: null,
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      channel: makeCanonicalChannel({
        publicReadiness: {
          ready: false,
          reason: "delivery_disconnected",
          updatedAt: 1,
        },
        destinations: [
          {
            id: "canonical-cloudflare",
            name: "External Delivery",
            role: "canonical",
            provider: "cloudflare_stream",
            transport: "llhls",
            playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
            ingestUrl: "rtmps://live.cloudflare.example/input",
            connected: false,
            transportHealthy: false,
            playbackReady: false,
            manifestStatus: "missing",
            lastError: "delivery_disconnected",
            updatedAt: 1,
          },
        ],
      }),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 4000,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      allowFallbackWhenSessionUnavailable: false,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(selection.canUseCanonicalPlayback).toBe(false);
    expect(selection.activeStreamUrl).toBe("");
    expect(selection.preloadStreamUrl).toBe("");
  });

  it("fails closed for legacy external delivery when readiness is missing", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
      },
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      delivery: {
        mode: "external_hls",
        provider: "cloudflare_stream",
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        hlsUrl: "https://video.example/manifest.m3u8",
        llhlsUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        ingestUrl: "rtmps://live.cloudflare.example/input",
      },
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 4000,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      allowFallbackWhenSessionUnavailable: false,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(selection.canUseCanonicalPlayback).toBe(false);
    expect(selection.activeStreamUrl).toBe("");
  });

  it("keeps canonical self-hls playback active when only the renderer probe fails", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: false,
          degradedReason:
            "probe_failed:evaluate: Target page, context or browser has been closed",
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: false,
        degradedReason:
          "probe_failed:evaluate: Target page, context or browser has been closed",
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      playback: {
        url: "https://video.example/live/stream.m3u8",
        kind: "hls",
        renderSessionId: "render-1",
        presentationDelayMs: 0,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(selection.activeStreamUrl).toBe("https://video.example/live/stream.m3u8");
    expect(selection.canUseCanonicalPlayback).toBe(true);
  });

  it("does not preload canonical playback when renderer health is blocking-bad", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: false,
          degradedReason: "renderer_health_stale",
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: false,
        degradedReason: "renderer_health_stale",
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      channel: makeCanonicalChannel(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 4000,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      allowFallbackWhenSessionUnavailable: false,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(selection.canUseCanonicalPlayback).toBe(false);
    expect(selection.activeStreamUrl).toBe("");
    expect(selection.preloadStreamUrl).toBe("");
  });

  it("keeps canonical playback mounted when top-level readiness is green despite renderer staleness", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "RESOLUTION",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: false,
          degradedReason: "render_tick_stale",
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: false,
        degradedReason: "render_tick_stale",
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      sourceRuntime: makeSourceRuntime(),
      channel: makeCanonicalChannel(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 4000,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      allowFallbackWhenSessionUnavailable: false,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(session?.publicReadiness?.ready).toBe(true);
    expect(session?.sourceRuntime?.ready).toBe(true);
    expect(selection.canUseCanonicalPlayback).toBe(true);
    expect(selection.activeStreamUrl).toContain("protocol=llhls");
  });

  it("fails closed when source runtime is missing for an existing session", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 1,
      emittedAt: 1,
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "deadbeef",
        rendererHealth: {
          ready: true,
          degradedReason: null,
          updatedAt: 1,
        },
      },
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      authorityHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: 1,
      },
      channel: makeCanonicalChannel(),
      playback: {
        url: "https://video.example/manifest.m3u8?protocol=llhls",
        kind: "llhls",
        renderSessionId: "render-1",
        presentationDelayMs: 0,
      },
    });

    const selection = selectBetSurfaceStreamUrl({
      allowFallbackWhenSessionUnavailable: false,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      authorityHealth: session?.authorityHealth,
      rendererReady: session?.rendererHealth?.ready,
      session,
    });

    expect(session?.sourceRuntime).toBeNull();
    expect(selection.canUseCanonicalPlayback).toBe(false);
    expect(selection.activeStreamUrl).toBe("");
  });

  it("keeps fallback sources disabled by default when the canonical session is absent", () => {
    const selection = selectBetSurfaceStreamUrl({
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      session: null,
    });

    expect(selection.activeStreamUrl).toBe("");
    expect(selection.preloadStreamUrl).toBe("");
  });

  it("only activates fallback sources when an explicit override is enabled", () => {
    const selection = selectBetSurfaceStreamUrl({
      allowFallbackOverride: true,
      fallbackStreamIndex: 0,
      fallbackStreamSources: ["https://fallback.example/live/stream.m3u8"],
      session: null,
    });

    expect(selection.activeStreamUrl).toBe(
      "https://fallback.example/live/stream.m3u8",
    );
  });
});

describe("describeCanonicalRendererDegradedReason", () => {
  it("maps the new source and delivery failure reasons", () => {
    expect(describeCanonicalRendererDegradedReason("render_tick_stale")).toContain(
      "renderer ticks",
    );
    expect(describeCanonicalRendererDegradedReason("manifest_stale")).toContain(
      "manifest",
    );
    expect(describeCanonicalRendererDegradedReason("player_drifted")).toContain(
      "Playback drifted",
    );
    expect(describeCanonicalRendererDegradedReason("worker_missing")).toContain(
      "capture worker",
    );
    expect(describeCanonicalRendererDegradedReason("page_not_ready")).toContain(
      "stream page",
    );
  });

  it("treats renderer probe failures as degraded but not fatal messaging", () => {
    expect(
      describeCanonicalRendererDegradedReason(
        "probe_failed:evaluate: Target page, context or browser has been closed",
      ),
    ).toContain("probe degraded");
  });
});

describe("isCanonicalRendererPlaybackReady", () => {
  it("allows self-hls playback to continue through transient renderer probe failures", () => {
    expect(
      isCanonicalRendererPlaybackReady({
        rendererReady: false,
        degradedReason:
          "probe_failed:evaluate: Target page, context or browser has been closed",
        playbackUrl: "https://video.example/live/stream.m3u8",
      }),
    ).toBe(true);
  });

  it("treats renderer staleness as non-blocking when top-level readiness stays green", () => {
    expect(
      isCanonicalRendererPlaybackReady({
        rendererReady: false,
        degradedReason: "render_tick_stale",
        publicReadiness: {
          ready: true,
          reason: null,
          updatedAt: 1,
        },
        sourceRuntime: makeSourceRuntime(),
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
      }),
    ).toBe(true);
  });
});

describe("deriveBettorStreamUiState", () => {
  it("stays connecting until the canonical session and player telemetry are both live", () => {
    expect(
      deriveBettorStreamUiState({
        session: null,
        playerStatus: null,
      }),
    ).toBe("connecting");
  });

  it("reports aligned only when server readiness and player sync are both healthy", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 11,
      emittedAt: 11,
      cycle: {
        cycleId: "cycle-11",
        phase: "FIGHTING",
      },
      channel: makeCanonicalChannel(),
      sourceRuntime: makeSourceRuntime(),
    });

    expect(
      deriveBettorStreamUiState({
        session,
        playerStatus: {
          ready: true,
          status: "playing",
          playbackStarted: true,
          syncDeltaMs: 250,
          syncState: "aligned",
        },
      }),
    ).toBe("aligned");
  });

  it("reports drifted when the player telemetry falls out of sync", () => {
    const session = normalizeCanonicalStreamSession({
      seq: 12,
      emittedAt: 12,
      cycle: {
        cycleId: "cycle-12",
        phase: "FIGHTING",
      },
      channel: makeCanonicalChannel(),
      sourceRuntime: makeSourceRuntime(),
    });

    expect(
      deriveBettorStreamUiState({
        session,
        playerStatus: {
          ready: true,
          status: "playing",
          playbackStarted: true,
          syncDeltaMs: 2_400,
          syncState: "out_of_sync",
        },
      }),
    ).toBe("drifted");
  });
});

describe("LIVE_EDGE_HLS_CONFIG", () => {
  it("keeps the shared live-edge tuning tight", () => {
    expect(LIVE_EDGE_HLS_CONFIG.lowLatencyMode).toBe(true);
    expect(LIVE_EDGE_HLS_CONFIG.liveSyncDurationCount).toBe(2);
    expect(LIVE_EDGE_HLS_CONFIG.liveMaxLatencyDurationCount).toBe(4);
    expect(LIVE_EDGE_HLS_CONFIG.maxBufferLength).toBe(6);
    expect(LIVE_EDGE_HLS_CONFIG.maxMaxBufferLength).toBe(12);
    expect(LIVE_EDGE_HLS_CONFIG.liveBackBufferLength).toBe(10);
    expect(LIVE_EDGE_HLS_CONFIG.maxLiveSyncPlaybackRate).toBe(1.5);
  });
});
