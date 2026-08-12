import "./setup";

import { describe, expect, it, mock } from "bun:test";
import { act } from "react";

import {
  isHlsStreamUrl,
  isExpectedNonFatalHlsRecovery,
  resolveStreamPlaybackMode,
  shouldMarkStreamUnavailable,
  StreamPlayer,
} from "../src/components/StreamPlayer";
import { render } from "./render";

describe("StreamPlayer lifecycle", () => {
  it("prefers hls.js over advertised native HLS support", () => {
    expect(resolveStreamPlaybackMode(true, "probably")).toBe("hls.js");
    expect(resolveStreamPlaybackMode(false, "maybe")).toBe("native");
    expect(resolveStreamPlaybackMode(false, "")).toBe("unsupported");
  });

  it("classifies the self-healing initial buffer seek separately from actionable HLS errors", () => {
    expect(isExpectedNonFatalHlsRecovery(false, "bufferSeekOverHole")).toBe(
      true,
    );
    expect(isExpectedNonFatalHlsRecovery(true, "bufferSeekOverHole")).toBe(
      false,
    );
    expect(isExpectedNonFatalHlsRecovery(false, "bufferStalledError")).toBe(
      false,
    );
  });

  it("recognizes HLS URLs and applies a bounded failure threshold", () => {
    expect(isHlsStreamUrl("https://stream.test/live/arena.m3u8?token=x")).toBe(
      true,
    );
    expect(isHlsStreamUrl("https://stream.test/embed/arena")).toBe(false);
    expect(shouldMarkStreamUnavailable(2, 3)).toBe(false);
    expect(shouldMarkStreamUnavailable(3, 3)).toBe(true);
  });

  it("does not attach a stale manifest probe after effect cleanup", async () => {
    const originalFetch = globalThis.fetch;
    const originalCanPlayType = Object.getOwnPropertyDescriptor(
      window.HTMLMediaElement.prototype,
      "canPlayType",
    );
    const originalPlay = Object.getOwnPropertyDescriptor(
      window.HTMLMediaElement.prototype,
      "play",
    );
    const originalWarn = console.warn;

    let resolveManifest!: (response: Response) => void;
    const manifestPromise = new Promise<Response>((resolve) => {
      resolveManifest = resolve;
    });
    const play = mock(async () => undefined);
    const warn = mock(() => {});
    const onStreamReady = mock(() => {});
    const onStreamUnavailable = mock(() => {});

    globalThis.fetch = mock(
      () => manifestPromise,
    ) as unknown as typeof globalThis.fetch;
    Object.defineProperty(window.HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "probably",
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    console.warn = warn;

    try {
      const rendered = render(
        <StreamPlayer
          streamUrl="http://127.0.0.1/live/stream.m3u8"
          onStreamReady={onStreamReady}
          onStreamUnavailable={onStreamUnavailable}
        />,
      );
      const video = rendered.container.querySelector("video");
      if (!video) throw new Error("StreamPlayer did not render a video");
      expect(video.dataset.streamSource).toBe(
        "http://127.0.0.1/live/stream.m3u8",
      );

      rendered.unmount();
      await act(async () => {
        resolveManifest(
          new Response("#EXTM3U\n#EXTINF:1,\nsegment-1.ts\n", {
            status: 200,
          }),
        );
        await manifestPromise;
        await Promise.resolve();
      });

      expect(video.getAttribute("src")).toBe(null);
      expect(play).not.toHaveBeenCalled();
      expect(onStreamReady).not.toHaveBeenCalled();
      expect(onStreamUnavailable).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
      if (originalCanPlayType) {
        Object.defineProperty(
          window.HTMLMediaElement.prototype,
          "canPlayType",
          originalCanPlayType,
        );
      }
      if (originalPlay) {
        Object.defineProperty(
          window.HTMLMediaElement.prototype,
          "play",
          originalPlay,
        );
      }
    }
  });

  it("marks a persistently missing HLS manifest unavailable without repeated notifications", async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const onStreamUnavailable = mock(() => {});
    const warn = mock(() => {});
    globalThis.fetch = mock(
      async () => new Response("", { status: 503 }),
    ) as unknown as typeof fetch;
    console.warn = warn;

    try {
      const rendered = render(
        <StreamPlayer
          streamUrl="http://127.0.0.1/live/stream.m3u8"
          onStreamUnavailable={onStreamUnavailable}
          unavailableAfterManifestFailures={1}
          manifestRetryDelayMs={5}
        />,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
      });

      expect(onStreamUnavailable).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
      rendered.unmount();
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });
});
