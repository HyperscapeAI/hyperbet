import "./setup";
import { describe, expect, it } from "bun:test";

import {
  advanceViewerSyncState,
  resolveHlsPlaybackProfile,
  resolvePlayerDeliveryModeHint,
  shouldTreatPlaybackLatencyAsDrifted,
  shouldTreatPlaybackStartupAsPending,
} from "../src/components/StreamPlayer";

describe("shouldTreatPlaybackStartupAsPending", () => {
  it("keeps startup stalls non-degraded while the startup grace window is open", () => {
    expect(
      shouldTreatPlaybackStartupAsPending({
        currentTime: 0,
        now: 6_500,
        playbackStarted: false,
        startupGraceMs: 7_000,
        startupStartedAt: 0,
      }),
    ).toBe(true);
  });

  it("stops treating the player as pending after playback begins", () => {
    expect(
      shouldTreatPlaybackStartupAsPending({
        currentTime: 12.4,
        now: 6_500,
        playbackStarted: true,
        startupGraceMs: 7_000,
        startupStartedAt: 0,
      }),
    ).toBe(false);
  });
});

describe("shouldTreatPlaybackLatencyAsDrifted", () => {
  it("only declares drift after playback has actually started and the player was ready", () => {
    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 20_000,
        latencyMs: 24_000,
        playbackStarted: false,
        ready: true,
      }),
    ).toBe(false);

    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 20_000,
        latencyMs: 24_000,
        playbackStarted: true,
        ready: false,
      }),
    ).toBe(false);
  });

  it("declares drift once a ready player falls beyond the live-edge budget", () => {
    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 20_000,
        latencyMs: 24_000,
        playbackStarted: true,
        ready: true,
      }),
    ).toBe(true);
  });
});

describe("resolveHlsPlaybackProfile", () => {
  it("prefers the low-latency profile when the canonical delivery mode is external llhls", () => {
    const profile = resolveHlsPlaybackProfile(
      "https://video.example/live/stream.m3u8",
      "external_hls/llhls",
    );

    expect(profile.startupGraceMs).toBe(4_000);
    expect(profile.reloadOnBufferStall).toBe(true);
  });
});

describe("resolvePlayerDeliveryModeHint", () => {
  it("prefers llhls inferred from the playback URL over a generic external hls hint", () => {
    expect(
      resolvePlayerDeliveryModeHint(
        "https://video.example/live/stream.m3u8?protocol=llhls",
        "external_hls/hls",
      ),
    ).toBe("external_hls/llhls");

    expect(
      resolvePlayerDeliveryModeHint(
        "https://video.example/live/stream.m3u8?protocol=llhls",
        "external_hls",
      ),
    ).toBe("external_hls/llhls");
  });
});

describe("advanceViewerSyncState", () => {
  it("waits for three out-of-tolerance polls before entering sync hold", () => {
    const first = advanceViewerSyncState({
      previousState: "aligned",
      consecutiveAlignedPolls: 0,
      consecutiveOutOfSyncPolls: 0,
      liveEdgeLatencyMs: 6_200,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });
    expect(first.syncState).toBe("aligned");

    const second = advanceViewerSyncState({
      previousState: first.syncState,
      consecutiveAlignedPolls: first.consecutiveAlignedPolls,
      consecutiveOutOfSyncPolls: first.consecutiveOutOfSyncPolls,
      liveEdgeLatencyMs: 6_200,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });
    expect(second.syncState).toBe("aligned");

    const third = advanceViewerSyncState({
      previousState: second.syncState,
      consecutiveAlignedPolls: second.consecutiveAlignedPolls,
      consecutiveOutOfSyncPolls: second.consecutiveOutOfSyncPolls,
      liveEdgeLatencyMs: 6_200,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });
    expect(third.syncState).toBe("out_of_sync");
    expect(third.syncDeltaMs).toBe(2_200);
  });

  it("clears sync hold after two aligned polls", () => {
    const first = advanceViewerSyncState({
      previousState: "out_of_sync",
      consecutiveAlignedPolls: 0,
      consecutiveOutOfSyncPolls: 3,
      liveEdgeLatencyMs: 4_600,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });
    expect(first.syncState).toBe("out_of_sync");

    const second = advanceViewerSyncState({
      previousState: first.syncState,
      consecutiveAlignedPolls: first.consecutiveAlignedPolls,
      consecutiveOutOfSyncPolls: first.consecutiveOutOfSyncPolls,
      liveEdgeLatencyMs: 4_400,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });
    expect(second.syncState).toBe("aligned");
  });
});
