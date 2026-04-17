import "./setup";
import { describe, expect, it } from "bun:test";

import { buildHlsPlayerEmbedUrl } from "../src/components/StreamPlayer";
import {
  resolveBufferedPresentationDelayTarget,
  resolveObservedPlaybackLatencyMs,
} from "../src/player/HlsPlayerApp";
import {
  advanceViewerLoaderState,
  createInitialViewerLoaderState,
  hideViewerLoader,
} from "../src/player/viewerBootPhases";

describe("buildHlsPlayerEmbedUrl", () => {
  it("prefers the canonical /hls-player route", () => {
    const resolved = buildHlsPlayerEmbedUrl(
      "https://videodelivery.net/example/manifest/video.m3u8?protocol=llhls",
      true,
      true,
      {
        deliveryMode: "external_hls/llhls",
        presentationDelayMs: 4_000,
        showDiagnostics: true,
        syncToleranceMs: 1_500,
      },
    );

    expect(resolved).not.toBeNull();
    const parsed = new URL(resolved!);
    expect(parsed.pathname).toBe("/hls-player");
    expect(parsed.searchParams.get("deliveryMode")).toBe("external_hls/llhls");
    expect(parsed.searchParams.get("presentationDelayMs")).toBe("4000");
    expect(parsed.searchParams.get("debug")).toBe("1");
  });
});

describe("advanceViewerLoaderState", () => {
  it("uses the viewer boot-phase defaults for startup phases", () => {
    const initial = createInitialViewerLoaderState();
    const initializing = advanceViewerLoaderState(initial, "initializing");
    const buffering = advanceViewerLoaderState(
      initializing,
      "buffering_media",
    );

    expect(initializing.progress).toBe(20);
    expect(initializing.stageLabel).toBe("Initializing stream session...");
    expect(buffering.progress).toBe(55);
    expect(buffering.stageLabel).toBe("Your playback is catching up...");
  });

  it("preserves progress and stage copy during reconnect overlays", () => {
    const buffering = advanceViewerLoaderState(
      createInitialViewerLoaderState(),
      "buffering_media",
    );
    const reconnecting = advanceViewerLoaderState(buffering, "reconnecting");

    expect(reconnecting.progress).toBe(buffering.progress);
    expect(reconnecting.stageLabel).toBe(buffering.stageLabel);
    expect(reconnecting.overlayMessage).toBe(
      "Reconnecting to the live stream.",
    );
  });

  it("hides the shell without mutating the last visual state", () => {
    const finalizing = advanceViewerLoaderState(
      createInitialViewerLoaderState(),
      "finalizing",
    );
    const hidden = hideViewerLoader(finalizing);

    expect(hidden.visible).toBe(false);
    expect(hidden.progress).toBe(finalizing.progress);
    expect(hidden.stageLabel).toBe(finalizing.stageLabel);
    expect(hidden.overlayMessage).toBeNull();
  });
});

describe("resolveBufferedPresentationDelayTarget", () => {
  it("starts buffered playback near the canonical presentation delay when headroom exists", () => {
    expect(
      resolveBufferedPresentationDelayTarget({
        bufferedStart: 2,
        bufferedEnd: 12,
        liveEdge: 12,
        presentationDelayMs: 4000,
      }),
    ).toBeCloseTo(8, 2);
  });

  it("uses the earliest buffered position when the canonical delay exceeds the buffered range", () => {
    expect(
      resolveBufferedPresentationDelayTarget({
        bufferedStart: 2,
        bufferedEnd: 2.65,
        liveEdge: 2.65,
        presentationDelayMs: 4000,
      }),
    ).toBeCloseTo(2.01, 2);
  });
});

describe("resolveObservedPlaybackLatencyMs", () => {
  it("prefers the media element's actual live-edge distance over hls.js controller latency", () => {
    expect(
      resolveObservedPlaybackLatencyMs({
        currentTime: 12,
        hlsLatencySeconds: 0.65,
        seekableEnd: 16,
        bufferedEnd: 16,
        duration: Number.NaN,
      }),
    ).toBe(4000);
  });

  it("keeps the transport latency when it exceeds the local buffered tail", () => {
    expect(
      resolveObservedPlaybackLatencyMs({
        currentTime: 12,
        hlsLatencySeconds: 4.2,
        seekableEnd: null,
        bufferedEnd: 13,
        duration: Number.NaN,
      }),
    ).toBe(4200);
  });

  it("falls back to hls.js latency when the media element does not expose a live range yet", () => {
    expect(
      resolveObservedPlaybackLatencyMs({
        currentTime: 0,
        hlsLatencySeconds: 0.65,
        seekableEnd: null,
        bufferedEnd: null,
        duration: Number.NaN,
      }),
    ).toBe(650);
  });
});
