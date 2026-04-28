import { afterEach, describe, expect, it } from "bun:test";

import {
  compareTruths,
  fetchJsonSettled,
  probePlaybackSettled,
  summarizePayload,
} from "./enoomian-staging-authority-audit";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("enoomian staging authority audit", () => {
  it("preserves endpoint evidence when a JSON probe throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("capture timed out");
    }) as typeof fetch;

    const result = await fetchJsonSettled("https://example.com/capture", 100);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("capture timed out");
    expect(result.body).toEqual({ error: "capture timed out" });
  });

  it("preserves endpoint evidence when a playback probe throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    const result = await probePlaybackSettled("https://example.com/video.m3u8", 100);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("socket hang up");
  });

  it("reports probe failures alongside surviving truth comparisons", () => {
    const betSync = {
      url: "https://example.com/bet-sync",
      status: 200,
      ok: true,
      headers: {},
      body: {},
      error: null,
    };
    const capture = {
      url: "https://example.com/capture",
      status: 0,
      ok: false,
      headers: {},
      body: { error: "timeout" },
      error: "timeout",
    };
    const keeper = {
      url: "https://example.com/keeper",
      status: 200,
      ok: true,
      headers: {},
      body: {},
      error: null,
    };

    const betSyncSummary = summarizePayload({
      publicReadiness: { ready: false, reason: "source_unready" },
      sourceRuntime: { ready: false, captureMode: "none" },
      canonicalAuthority: { decision: "blocked" },
    });
    const captureSummary = summarizePayload({
      publicReadiness: { ready: true },
      sourceRuntime: { ready: true, captureMode: "x11_nvenc" },
      delivery: { playbackUrl: "https://example.com/video.m3u8" },
    });
    const keeperSummary = summarizePayload({
      publicReadiness: { ready: false, reason: "source_unready" },
      sourceRuntime: { ready: true, captureMode: "x11_nvenc" },
      canonicalAuthority: { decision: "blocked" },
      delivery: { playbackUrl: "https://example.com/video.m3u8" },
    });

    const issues = compareTruths(
      betSync,
      capture,
      keeper,
      captureSummary,
      betSyncSummary,
      keeperSummary,
    );

    expect(issues).toContain("capture/status probe failed: timeout");
    expect(issues).toContain("capture/status returned HTTP 0");
    expect(issues).toContain(
      "bet-sync blocks public readiness while capture/status reports sourceReady=true",
    );
    expect(issues).toContain(
      "keeper blocks public readiness while capture/status reports sourceReady=true",
    );
  });
});
