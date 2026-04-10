import { describe, expect, test } from "bun:test";

import {
  parseBetSyncBootstrapState,
  parseBetSyncEvent,
  resolveBetSyncBootstrapCursor,
  toStreamStateFromBetSyncEvent,
} from "./betSync";

describe("resolveBetSyncBootstrapCursor", () => {
  test("rebases the applied seq when the source epoch changes", () => {
    const next = resolveBetSyncBootstrapCursor({
      previousSourceEpoch: 100,
      nextSourceEpoch: 200,
      previousLastAppliedSeq: 91210,
      latestSeq: 433,
    });

    expect(next.sourceEpochChanged).toBe(true);
    expect(next.rebasedLastAppliedSeq).toBe(0);
    expect(next.replayUntilSeq).toBeNull();
    expect(next.replayMode).toBe("live");
  });

  test("preserves replay semantics when the source epoch is unchanged", () => {
    const next = resolveBetSyncBootstrapCursor({
      previousSourceEpoch: 200,
      nextSourceEpoch: 200,
      previousLastAppliedSeq: 25,
      latestSeq: 40,
    });

    expect(next.sourceEpochChanged).toBe(false);
    expect(next.rebasedLastAppliedSeq).toBe(25);
    expect(next.replayUntilSeq).toBe(40);
    expect(next.replayMode).toBe("replay");
  });
});

describe("parseBetSyncEvent", () => {
  test("preserves channel delivery contract fields", () => {
    const event = parseBetSyncEvent({
      sourceEpoch: 7,
      seq: 12,
      emittedAt: 1_712_345_678_000,
      channel: {
        id: "main",
        mode: "always_on",
      },
      publicReadiness: {
        ready: false,
        reason: "manifest_stale",
      },
      canonicalDestination: {
        id: "canonical-cloudflare",
        playbackReady: false,
      },
      fallbackDestination: {
        id: "fallback-self-hls",
        playbackReady: true,
      },
      canonicalAuthority: {
        providerLive: true,
        playbackProbeReady: false,
        decision: "blocked",
        reason: "probe_unready",
        revision: 9,
        updatedAt: 1_712_345_678_100,
        liveInputId: "live-input-123",
        videoUid: "video-456",
        lifecycleStatus: "connected",
        playbackUrl: "https://video.example/live.m3u8?protocol=llhls",
        playbackProbeStatusCode: 503,
        playbackManifestStatus: "stale",
      },
      sourceRuntime: {
        ready: false,
        statusSource: "external_worker",
        captureMode: "cdp",
        degradedReason: "worker_missing",
        currentSceneUrl: "https://example.com/stream",
        activeBundle: "bundle-a",
        lastFrameAt: 1000,
        lastRenderTickAt: 1001,
        lastVisualChangeAt: 1002,
        lastRecoveryAt: 1003,
        recoveryCount: 2,
        workerHeartbeatAt: 1004,
      },
      deliveryHealth: {
        ready: false,
        degradedReason: "manifest_stale",
      },
    });

    expect(event).not.toBeNull();
    expect(event?.channel).toEqual({
      id: "main",
      mode: "always_on",
    });
    expect(event?.publicReadiness).toEqual({
      ready: false,
      reason: "manifest_stale",
    });
    expect(event?.canonicalDestination).toEqual({
      id: "canonical-cloudflare",
      playbackReady: false,
    });
    expect(event?.fallbackDestination).toEqual({
      id: "fallback-self-hls",
      playbackReady: true,
    });
    expect(event?.canonicalAuthority).toEqual({
      providerLive: true,
      playbackProbeReady: false,
      decision: "blocked",
      reason: "probe_unready",
      revision: 9,
      updatedAt: 1_712_345_678_100,
      liveInputId: "live-input-123",
      videoUid: "video-456",
      lifecycleStatus: "connected",
      playbackUrl: "https://video.example/live.m3u8?protocol=llhls",
      playbackProbeStatusCode: 503,
      playbackManifestStatus: "stale",
    });
    expect(event?.sourceRuntime).toEqual({
      ready: false,
      statusSource: "external_worker",
      captureMode: "cdp",
      degradedReason: "worker_missing",
      currentSceneUrl: "https://example.com/stream",
      activeBundle: "bundle-a",
      lastFrameAt: 1000,
      lastRenderTickAt: 1001,
      lastVisualChangeAt: 1002,
      lastRecoveryAt: 1003,
      recoveryCount: 2,
      workerHeartbeatAt: 1004,
    });
    expect(event?.deliveryHealth).toEqual({
      ready: false,
      degradedReason: "manifest_stale",
    });
  });

  test("parses and republishes broadcastTimeline without disturbing legacy fields", () => {
    const event = parseBetSyncEvent({
      schemaVersion: 3,
      sourceEpoch: 8,
      seq: 13,
      emittedAt: 1_712_345_679_000,
      duelId: "duel-2",
      duelKey: "22".repeat(32),
      phase: "FIGHTING",
      betOpenTime: 1_000,
      betCloseTime: 2_000,
      fightStartTime: 3_000,
      duelEndTime: 9_000,
      broadcastTimeline: {
        phase: "COUNTDOWN",
        betOpenTime: 5_000,
        betCloseTime: 6_000,
        fightStartTime: 7_000,
        duelEndTime: 13_000,
        presentationDelayMs: 4_000,
        updatedAt: 1_712_345_679_000,
      },
    });

    expect(event?.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: 5_000,
      betCloseTime: 6_000,
      fightStartTime: 7_000,
      duelEndTime: 13_000,
      presentationDelayMs: 4_000,
      updatedAt: 1_712_345_679_000,
    });
    expect(event?.betCloseTime).toBe(2_000);

    const nextState = toStreamStateFromBetSyncEvent(event!);
    expect(nextState.cycle.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: 5_000,
      betCloseTime: 6_000,
      fightStartTime: 7_000,
      duelEndTime: 13_000,
      presentationDelayMs: 4_000,
      updatedAt: 1_712_345_679_000,
    });
    expect(nextState.cycle.betCloseTime).toBe(2_000);
  });
});

describe("parseBetSyncBootstrapState", () => {
  test("retains latest event channel fields during bootstrap", () => {
    const state = parseBetSyncBootstrapState({
      sourceEpoch: 9,
      latestSeq: 101,
      latestEvent: {
        sourceEpoch: 9,
        seq: 101,
        emittedAt: 1_712_345_678_999,
        channel: {
          id: "main",
          canonicalDestinationId: "canonical-cloudflare",
        },
        publicReadiness: {
          ready: true,
          reason: null,
        },
        canonicalAuthority: {
          providerLive: true,
          playbackProbeReady: true,
          decision: "ready",
          reason: null,
          revision: 5,
          updatedAt: 1_712_345_679_111,
          liveInputId: "live-input-123",
          videoUid: "video-456",
          lifecycleStatus: "connected",
          playbackUrl: "https://video.example/live.m3u8?protocol=llhls",
          playbackProbeStatusCode: 200,
          playbackManifestStatus: "ok",
        },
        sourceRuntime: {
          ready: true,
          statusSource: "external_worker",
          captureMode: "webcodecs",
          degradedReason: null,
          currentSceneUrl: "https://example.com/stream",
          activeBundle: "bundle-b",
          lastFrameAt: 1001,
          lastRenderTickAt: 1002,
          lastVisualChangeAt: 1003,
          lastRecoveryAt: 1004,
          recoveryCount: 0,
          workerHeartbeatAt: 1005,
        },
      },
    });

    expect(state).not.toBeNull();
    expect(state?.latestEvent?.channel).toEqual({
      id: "main",
      canonicalDestinationId: "canonical-cloudflare",
    });
    expect(state?.latestEvent?.publicReadiness).toEqual({
      ready: true,
      reason: null,
    });
    expect(state?.latestEvent?.canonicalAuthority).toEqual({
      providerLive: true,
      playbackProbeReady: true,
      decision: "ready",
      reason: null,
      revision: 5,
      updatedAt: 1_712_345_679_111,
      liveInputId: "live-input-123",
      videoUid: "video-456",
      lifecycleStatus: "connected",
      playbackUrl: "https://video.example/live.m3u8?protocol=llhls",
      playbackProbeStatusCode: 200,
      playbackManifestStatus: "ok",
    });
    expect(state?.latestEvent?.sourceRuntime).toEqual({
      ready: true,
      statusSource: "external_worker",
      captureMode: "webcodecs",
      degradedReason: null,
      currentSceneUrl: "https://example.com/stream",
      activeBundle: "bundle-b",
      lastFrameAt: 1001,
      lastRenderTickAt: 1002,
      lastVisualChangeAt: 1003,
      lastRecoveryAt: 1004,
      recoveryCount: 0,
      workerHeartbeatAt: 1005,
    });
  });
});
