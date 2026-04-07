import "./setup";
import { describe, expect, it } from "bun:test";

import { LIVE_EDGE_HLS_CONFIG } from "../src/components/StreamPlayer";
import {
  describeCanonicalRendererDegradedReason,
  selectBetSurfaceStreamUrl,
} from "../src/lib/streamSession";
import { normalizeCanonicalStreamSession } from "../src/spectator/useCanonicalStreamSession";

describe("normalizeCanonicalStreamSession", () => {
  it("parses additive renderer metrics and delivery fields", () => {
    const session = normalizeCanonicalStreamSession({
      schemaVersion: 1,
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
      delivery: {
        mode: "external_hls",
        provider: "cloudflare_stream",
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        hlsUrl: "https://video.example/manifest.m3u8",
        llhlsUrl: "https://video.example/manifest.m3u8?protocol=llhls",
      },
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
    expect(session?.delivery?.mode).toBe("external_hls");
    expect(session?.delivery?.playbackUrl).toContain("protocol=llhls");
    expect(session?.status.delivery?.provider).toBe("cloudflare_stream");
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
      delivery: {
        mode: "external_hls",
        provider: "cloudflare_stream",
        playbackUrl: "https://video.example/manifest.m3u8?protocol=llhls",
        hlsUrl: "https://video.example/manifest.m3u8",
        llhlsUrl: "https://video.example/manifest.m3u8?protocol=llhls",
      },
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
