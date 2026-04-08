import "./setup";
import { describe, expect, it } from "bun:test";

import { buildHlsPlayerEmbedUrl } from "../src/components/StreamPlayer";
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
    expect(buffering.stageLabel).toBe("Aligning stream with live bets...");
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
