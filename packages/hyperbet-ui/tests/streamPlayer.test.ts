import "./setup";
import { describe, expect, it } from "bun:test";

import {
  advanceViewerSyncState,
  preferHighestViableHlsLevel,
  RECENT_PLAYER_SIGNAL_THRESHOLD,
  RECENT_PLAYER_SIGNAL_WINDOW_MS,
  recordRecentPlaybackSignal,
  resolveHlsPlaybackProfile,
  resolvePlayerDeliveryModeHint,
  selectPreferredHlsStartLevelFromManifest,
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
        syncDriftThresholdMs: 2_500,
        latencyMs: 24_000,
        presentationDelayMs: null,
        playbackStarted: false,
        ready: true,
      }),
    ).toBe(false);

    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 20_000,
        syncDriftThresholdMs: 2_500,
        latencyMs: 24_000,
        presentationDelayMs: null,
        playbackStarted: true,
        ready: false,
      }),
    ).toBe(false);
  });

  it("declares drift once a ready player falls beyond the live-edge budget", () => {
    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 20_000,
        syncDriftThresholdMs: 2_500,
        latencyMs: 24_000,
        presentationDelayMs: null,
        playbackStarted: true,
        ready: true,
      }),
    ).toBe(true);
  });

  it("judges LL-HLS drift against presentation delay when one is provided", () => {
    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 12_000,
        syncDriftThresholdMs: 2_500,
        latencyMs: 6_200,
        presentationDelayMs: 4_000,
        playbackStarted: true,
        ready: true,
      }),
    ).toBe(false);

    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 12_000,
        syncDriftThresholdMs: 2_500,
        latencyMs: 7_000,
        presentationDelayMs: 4_000,
        playbackStarted: true,
        ready: true,
      }),
    ).toBe(true);
  });

  it("does not treat ahead-of-target playback as drift that needs recovery", () => {
    expect(
      shouldTreatPlaybackLatencyAsDrifted({
        driftThresholdMs: 12_000,
        syncDriftThresholdMs: 2_500,
        latencyMs: 1_000,
        presentationDelayMs: 4_000,
        playbackStarted: true,
        ready: true,
      }),
    ).toBe(false);
  });
});

describe("resolveHlsPlaybackProfile", () => {
  it("prefers the low-latency profile when the canonical delivery mode is external llhls", () => {
    const profile = resolveHlsPlaybackProfile(
      "https://video.example/live/stream.m3u8",
      "external_hls/llhls",
    );

    expect(profile.startupGraceMs).toBe(4_000);
    expect(profile.waitingGraceMs).toBe(1_200);
    expect(profile.syncDriftThresholdMs).toBe(2_500);
    expect(profile.reloadOnBufferStall).toBe(true);
    expect(profile.config.liveSyncDurationCount).toBe(3);
    expect(profile.config.liveMaxLatencyDurationCount).toBe(6);
    expect(profile.config.maxBufferLength).toBe(12);
  });

  it("keeps stable HLS away from the playlist tail without pinning to the old edge", () => {
    const profile = resolveHlsPlaybackProfile(
      "https://video.example/live/stream.m3u8",
      "self_hls/hls",
    );

    expect(profile.config.liveSyncDurationCount).toBe(10);
    expect(profile.config.liveMaxLatencyDurationCount).toBe(16);
    expect(profile.config.maxBufferLength).toBe(45);
    expect(profile.driftThresholdMs).toBe(35_000);
    expect(profile.syncDriftThresholdMs).toBe(8_000);
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

describe("preferHighestViableHlsLevel", () => {
  it("picks the highest fitting rendition by resolution instead of trusting manifest order", () => {
    const hls = {
      autoLevelCapping: -1,
      currentLevel: -1,
      capLevelToPlayerSize: false,
      levels: [
        { width: 1280, height: 720, bitrate: 3_100_000 },
        { width: 1920, height: 1080, bitrate: 3_690_000 },
        { width: 854, height: 480, bitrate: 1_900_000 },
        { width: 640, height: 360, bitrate: 1_100_000 },
        { width: 426, height: 240, bitrate: 700_000 },
      ],
      loadLevel: -1,
      nextAutoLevel: -1,
      nextLevel: -1,
      startLevel: -1,
    } as unknown as {
      autoLevelCapping: number;
      currentLevel: number;
      capLevelToPlayerSize: boolean;
      levels: Array<{ width: number; height: number; bitrate: number }>;
      loadLevel: number;
      nextAutoLevel: number;
      nextLevel: number;
      startLevel: number;
    };
    const video = {
      clientHeight: 900,
      clientWidth: 1600,
      videoHeight: 0,
      videoWidth: 0,
    } as HTMLVideoElement;

    preferHighestViableHlsLevel(hls as never, video);

    expect(hls.capLevelToPlayerSize).toBe(true);
    expect(hls.autoLevelCapping).toBe(1);
    expect(hls.nextAutoLevel).toBe(1);
    expect(hls.currentLevel).toBe(1);
    expect(hls.startLevel).toBe(1);
    expect(hls.nextLevel).toBe(1);
    expect(hls.loadLevel).toBe(1);
  });

  it("falls back to the best available rendition when nothing fits the player size", () => {
    const hls = {
      autoLevelCapping: -1,
      currentLevel: -1,
      capLevelToPlayerSize: false,
      levels: [
        { width: 1280, height: 720, bitrate: 3_100_000 },
        { width: 1920, height: 1080, bitrate: 3_690_000 },
        { width: 854, height: 480, bitrate: 1_900_000 },
        { width: 640, height: 360, bitrate: 1_100_000 },
        { width: 426, height: 240, bitrate: 700_000 },
      ],
      loadLevel: -1,
      nextAutoLevel: -1,
      nextLevel: -1,
      startLevel: -1,
    } as unknown as {
      autoLevelCapping: number;
      currentLevel: number;
      capLevelToPlayerSize: boolean;
      levels: Array<{ width: number; height: number; bitrate: number }>;
      loadLevel: number;
      nextAutoLevel: number;
      nextLevel: number;
      startLevel: number;
    };
    const video = {
      clientHeight: 120,
      clientWidth: 160,
      videoHeight: 0,
      videoWidth: 0,
    } as HTMLVideoElement;

    preferHighestViableHlsLevel(hls as never, video);

    expect(hls.autoLevelCapping).toBe(1);
    expect(hls.nextAutoLevel).toBe(1);
    expect(hls.currentLevel).toBe(1);
    expect(hls.startLevel).toBe(1);
    expect(hls.nextLevel).toBe(1);
    expect(hls.loadLevel).toBe(1);
  });
});

describe("selectPreferredHlsStartLevelFromManifest", () => {
  const cloudflareMasterManifest = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_audio",NAME="original",LANGUAGE="en-0f817925",DEFAULT=YES,AUTOSELECT=YES,URI="stream_t0f8179256ccba8265f345779d51d8234_r1570586493.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true"
#EXT-X-STREAM-INF:RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",BANDWIDTH=3101821,AVERAGE-BANDWIDTH=3101821,SCORE=4.0,FRAME-RATE=24.000,AUDIO="group_audio"
stream_t43322e00a1dfcad9a7b8f4609800c461_r1570586491.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true
#EXT-X-STREAM-INF:RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",BANDWIDTH=3694794,AVERAGE-BANDWIDTH=3694794,SCORE=5.0,FRAME-RATE=24.000,AUDIO="group_audio"
stream_t43322e00a1dfcad9a7b8f4609800c461_r1570586492.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true
#EXT-X-STREAM-INF:RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2",BANDWIDTH=2607677,AVERAGE-BANDWIDTH=2607677,SCORE=3.0,FRAME-RATE=24.000,AUDIO="group_audio"
stream_t43322e00a1dfcad9a7b8f4609800c461_r1570586490.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true
#EXT-X-STREAM-INF:RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",BANDWIDTH=1525654,AVERAGE-BANDWIDTH=1525654,SCORE=2.0,FRAME-RATE=24.000,AUDIO="group_audio"
stream_t43322e00a1dfcad9a7b8f4609800c461_r1570586489.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true
#EXT-X-STREAM-INF:RESOLUTION=426x240,CODECS="avc1.42c015,mp4a.40.2",BANDWIDTH=197407,AVERAGE-BANDWIDTH=197407,SCORE=1.0,FRAME-RATE=24.000,AUDIO="group_audio"
stream_t43322e00a1dfcad9a7b8f4609800c461_r1570586488.m3u8?protocol=llhls&llhlsHBs=0.5&useExposeMetadata=true&blockReload=true`;

  it("chooses the best fitting startup level from an unsorted master manifest", () => {
    expect(
      selectPreferredHlsStartLevelFromManifest(
        cloudflareMasterManifest,
        1600,
        900,
      ),
    ).toBe(4);
  });

  it("falls back to the highest quality startup level when nothing fits", () => {
    expect(
      selectPreferredHlsStartLevelFromManifest(cloudflareMasterManifest, 160, 120),
    ).toBe(4);
  });
});

describe("recordRecentPlaybackSignal", () => {
  it("requires three playback faults inside the active window before escalating", () => {
    const first = recordRecentPlaybackSignal([], 1_000);
    const second = recordRecentPlaybackSignal(first, 10_000);
    const third = recordRecentPlaybackSignal(second, 20_000);
    const expired = recordRecentPlaybackSignal(third, 60_001);

    expect(first.length).toBe(1);
    expect(second.length).toBe(2);
    expect(third.length).toBe(RECENT_PLAYER_SIGNAL_THRESHOLD);
    expect(expired).toEqual([60_001]);
    expect(RECENT_PLAYER_SIGNAL_WINDOW_MS).toBe(30_000);
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

  it("does not compare HLS live latency against a zero presentation delay", () => {
    const next = advanceViewerSyncState({
      previousState: "aligned",
      consecutiveAlignedPolls: 0,
      consecutiveOutOfSyncPolls: 0,
      liveEdgeLatencyMs: 20_000,
      playbackStarted: true,
      presentationDelayMs: 0,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });

    expect(next.syncDeltaMs).toBeNull();
    expect(next.syncState).toBe("aligned");
  });

  it("keeps ahead-of-target playback aligned instead of flagging sync drift", () => {
    const next = advanceViewerSyncState({
      previousState: "aligned",
      consecutiveAlignedPolls: 0,
      consecutiveOutOfSyncPolls: 0,
      liveEdgeLatencyMs: 1_000,
      playbackStarted: true,
      presentationDelayMs: 4_000,
      ready: true,
      status: "playing",
      syncToleranceMs: 1_500,
    });

    expect(next.syncDeltaMs).toBe(-3_000);
    expect(next.syncState).toBe("aligned");
  });
});
