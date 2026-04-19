import { describe, expect, test } from "bun:test";

import {
  isBetSyncEventStaleAfterSourceReset,
  mergePredictionMarketsSurface,
  parseBetSyncBootstrapState,
  parseBetSyncEvent,
  parsePredictionMarketsOverview,
  resolveBetSyncReplayMode,
  rollPredictionMarketsOverview,
  selectBetSyncReplayUntilSeq,
  selectBetSyncResumeSeq,
  toStreamStateFromBetSyncEvent,
} from "./betSync";

describe("bet-sync helpers", () => {
  test("parses internal feed events and converts them to stream state", () => {
    const duelKey = "ab".repeat(32);
    const parsed = parseBetSyncEvent({
      schemaVersion: 1,
      sourceEpoch: 4,
      seq: 12,
      emittedAt: 1_700_000_000_000,
      cycle: {
        cycleId: "raw-cycle-12",
        phase: "RESOLUTION",
        winnerId: "agent-a",
        winnerName: "Agent A",
        winReason: "knockout",
      },
      duelId: "duel-12",
      duelKey: `0x${duelKey}`,
      phase: "FIGHTING",
      phaseVersion: 3,
      betCloseTime: 1_700_000_010_000,
      fightStartTime: 1_700_000_020_000,
      duelEndTime: 1_700_000_030_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      seed: "777",
      replayHash: "cd".repeat(32),
      agent1: { id: "a" },
      agent2: { id: "b" },
      arenaPositions: { agent1: [0, 0, 0], agent2: [1, 0, 0] },
      leaderboard: [{ id: "a" }],
      rendererHealth: { ready: true, degradedReason: null, updatedAt: 123 },
      marketParity: {
        bundleId: "bundle-12",
        duelKey: `0x${duelKey}`,
        duelId: "duel-12",
        revision: 4,
        requiredChains: ["solana", "bsc"],
        confirmedChains: ["solana"],
        state: "awaiting_confirmations",
        phase: "ANNOUNCEMENT",
        safeToBet: false,
        openedAtMs: null,
        lockedAtMs: null,
        resolvedAtMs: null,
        freezeReason: null,
        updatedAtMs: 1_700_000_000_001,
        receipts: [
          {
            chainKey: "solana",
            preparedAtMs: 1_700_000_000_001,
            openedAtMs: null,
            lockedAtMs: null,
            resolvedAtMs: null,
            cancelledAtMs: null,
            confirmedAtMs: 1_700_000_000_001,
            lifecycleStatus: "PENDING",
            txRef: "sol-tx",
            note: null,
          },
        ],
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.duelKey).toBe(duelKey);
    expect(parsed?.marketParity).toMatchObject({
      bundleId: "bundle-12",
      duelKey,
      state: "awaiting_confirmations",
      safeToBet: false,
    });

    expect(toStreamStateFromBetSyncEvent(parsed!)).toMatchObject({
      seq: 12,
      emittedAt: 1_700_000_000_000,
      marketParity: {
        bundleId: "bundle-12",
        duelKey,
        state: "awaiting_confirmations",
        safeToBet: false,
      },
      cycle: {
        cycleId: "raw-cycle-12",
        duelId: "duel-12",
        duelKey: duelKey,
        duelKeyHex: `0x${duelKey}`,
        phase: "FIGHTING",
        phaseVersion: 3,
        winnerId: null,
        winnerName: null,
        winReason: null,
        rawCycle: {
          cycleId: "raw-cycle-12",
          phase: "RESOLUTION",
          winnerId: "agent-a",
          winnerName: "Agent A",
          winReason: "knockout",
        },
        seed: "777",
        replayHash: "cd".repeat(32),
      },
    });
  });

  test("preserves canonical delivery and authority contract fields", () => {
    const parsed = parseBetSyncEvent({
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
      delivery: {
        mode: "self_hls",
        provider: "self_hls",
        playbackUrl: "https://example.com/live/stream.m3u8",
        hlsUrl: "https://example.com/live/stream.m3u8",
        llhlsUrl: null,
        ingestUrl: null,
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
      },
      deliveryHealth: {
        ready: false,
        degradedReason: "manifest_stale",
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.delivery).toEqual({
      mode: "self_hls",
      provider: "self_hls",
      playbackUrl: "https://example.com/live/stream.m3u8",
      hlsUrl: "https://example.com/live/stream.m3u8",
      llhlsUrl: null,
      ingestUrl: null,
    });
    expect(parsed?.publicReadiness).toEqual({
      ready: false,
      reason: "manifest_stale",
    });
    expect(parsed?.canonicalAuthority).toEqual({
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

    expect(toStreamStateFromBetSyncEvent(parsed!)).toMatchObject({
      delivery: {
        mode: "self_hls",
        provider: "self_hls",
        playbackUrl: "https://example.com/live/stream.m3u8",
      },
      publicReadiness: {
        ready: false,
        reason: "manifest_stale",
      },
      canonicalAuthority: {
        decision: "blocked",
        reason: "probe_unready",
        revision: 9,
      },
      sourceRuntime: {
        ready: false,
        statusSource: "external_worker",
        captureMode: "cdp",
      },
      deliveryHealth: {
        ready: false,
        degradedReason: "manifest_stale",
      },
    });
  });

  test("preserves broadcastTimeline without disturbing legacy cycle fields", () => {
    const parsed = parseBetSyncEvent({
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

    expect(parsed?.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: 5_000,
      betCloseTime: 6_000,
      fightStartTime: 7_000,
      duelEndTime: 13_000,
      presentationDelayMs: 4_000,
      updatedAt: 1_712_345_679_000,
    });
    expect(parsed?.betCloseTime).toBe(2_000);

    const nextState = toStreamStateFromBetSyncEvent(parsed!);
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
    expect(nextState.phase).toBe("FIGHTING");
    expect(nextState.phaseVersion).toBeNull();
    expect(nextState.broadcastTimeline).toEqual({
      phase: "COUNTDOWN",
      betOpenTime: 5_000,
      betCloseTime: 6_000,
      fightStartTime: 7_000,
      duelEndTime: 13_000,
      presentationDelayMs: 4_000,
      updatedAt: 1_712_345_679_000,
    });
  });

  test("parses bootstrap state with latest event", () => {
    const parsed = parseBetSyncBootstrapState({
      sourceEpoch: 9,
      latestSeq: 88,
      oldestReplaySeq: 55,
      latestEvent: {
        schemaVersion: 1,
        sourceEpoch: 9,
        seq: 88,
        emittedAt: 1_700_000_050_000,
        duelId: "duel-88",
        duelKey: "cd".repeat(32),
        phase: "COUNTDOWN",
        phaseVersion: 2,
      },
    });

    expect(parsed).toMatchObject({
      sourceEpoch: 9,
      latestSeq: 88,
      oldestReplaySeq: 55,
      latestEvent: {
        duelId: "duel-88",
        phase: "COUNTDOWN",
      },
    });
  });

  test("retains latest event delivery fields during bootstrap", () => {
    const parsed = parseBetSyncBootstrapState({
      sourceEpoch: 9,
      latestSeq: 101,
      latestEvent: {
        sourceEpoch: 9,
        seq: 101,
        emittedAt: 1_712_345_678_999,
        delivery: {
          mode: "self_hls",
          provider: "self_hls",
          playbackUrl: "https://example.com/live/stream.m3u8",
          hlsUrl: "https://example.com/live/stream.m3u8",
          llhlsUrl: null,
          ingestUrl: null,
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
          playbackUrl: "https://video.example/live.m3u8",
          playbackProbeStatusCode: 200,
          playbackManifestStatus: "ok",
        },
      },
    });

    expect(parsed?.latestEvent?.delivery).toEqual({
      mode: "self_hls",
      provider: "self_hls",
      playbackUrl: "https://example.com/live/stream.m3u8",
      hlsUrl: "https://example.com/live/stream.m3u8",
      llhlsUrl: null,
      ingestUrl: null,
    });
    expect(parsed?.latestEvent?.publicReadiness).toEqual({
      ready: true,
      reason: null,
    });
    expect(parsed?.latestEvent?.canonicalAuthority).toEqual({
      providerLive: true,
      playbackProbeReady: true,
      decision: "ready",
      reason: null,
      revision: 5,
      updatedAt: 1_712_345_679_111,
      liveInputId: "live-input-123",
      videoUid: "video-456",
      lifecycleStatus: "connected",
      playbackUrl: "https://video.example/live.m3u8",
      playbackProbeStatusCode: 200,
      playbackManifestStatus: "ok",
    });
  });

  test("rolls previous live duel into recent settlement on handoff", () => {
    const overview = parsePredictionMarketsOverview({
      updatedAt: 10,
      live: {
        duel: {
          duelKey: "11".repeat(32),
          duelId: "duel-live",
          phase: "FIGHTING",
          winner: "NONE",
          betCloseTime: 123,
          agent1Name: "Alpha",
          agent2Name: "Beta",
        },
        markets: [],
        updatedAt: 10,
      },
      recentSettlement: null,
    });

    const next = rollPredictionMarketsOverview(
      overview,
      {
        duel: {
          duelKey: "22".repeat(32),
          duelId: "duel-next",
          phase: "ANNOUNCEMENT",
          winner: "NONE",
          betCloseTime: 456,
          agent1Name: "Gamma",
          agent2Name: "Delta",
        },
        markets: [],
        updatedAt: 11,
        sourceEmittedAt: 11,
        serverEmittedAt: 11,
      },
      11,
    );

    expect(next.live?.duel.duelId).toBe("duel-next");
    expect(next.recentSettlement?.duel.duelId).toBe("duel-live");
    // recentSettlement.sourceEmittedAt must be preserved from the
    // previous live surface — rolling forward does not re-stamp the
    // source anchor. The selector in commit 3 depends on this invariant
    // to place recentSettlement at the right point on the viewer's
    // playback timeline.
    expect(next.recentSettlement?.sourceEmittedAt).toBe(10);
    // live.sourceEmittedAt comes from the new live surface.
    expect(next.live?.sourceEmittedAt).toBe(11);
    // Envelope max over the two surfaces.
    expect(next.sourceEmittedAt).toBe(11);
    // serverEmittedAt tracks the roll wall-clock.
    expect(next.serverEmittedAt).toBe(11);
  });

  test("preserves stronger lifecycle state when the same duel refresh weakens", () => {
    const duelKey = "33".repeat(32);
    const merged = mergePredictionMarketsSurface(
      {
        duel: {
          duelKey,
          duelId: "duel-strong",
          phase: "RESOLUTION",
          winner: "A",
          betCloseTime: 999,
          agent1Name: "Alpha",
          agent2Name: "Beta",
        },
        markets: [
          {
            chainKey: "bsc",
            duelKey,
            duelId: "duel-strong",
            marketId: "m1",
            marketRef: "m1",
            lifecycleStatus: "PROPOSED",
            winner: "A",
            betCloseTime: 999,
            contractAddress: "0x1",
            programId: null,
            txRef: "0xabc",
            syncedAt: 100,
            metadata: { proposalId: "p1" },
          },
        ],
        updatedAt: 100,
        sourceEmittedAt: 100,
        serverEmittedAt: 100,
      },
      {
        duel: {
          duelKey,
          duelId: "duel-strong",
          phase: "IDLE",
          winner: "NONE",
          betCloseTime: null,
          agent1Name: null,
          agent2Name: null,
        },
        markets: [
          {
            chainKey: "bsc",
            duelKey,
            duelId: "duel-strong",
            marketId: "m1",
            marketRef: "m1",
            lifecycleStatus: "OPEN",
            winner: "NONE",
            betCloseTime: null,
            contractAddress: "0x1",
            programId: null,
            txRef: null,
            syncedAt: 200,
            metadata: {},
          },
        ],
        updatedAt: 200,
        sourceEmittedAt: 200,
        serverEmittedAt: 200,
      },
    );

    expect(merged?.duel.phase).toBe("RESOLUTION");
    expect(merged?.duel.winner).toBe("A");
    expect(merged?.duel.betCloseTime).toBe(999);
    expect(merged?.markets[0]).toMatchObject({
      lifecycleStatus: "PROPOSED",
      winner: "A",
      txRef: "0xabc",
      metadata: { proposalId: "p1" },
    });
    expect(merged?.duel.agent1Name).toBe("Alpha");
    expect(merged?.duel.agent2Name).toBe("Beta");
  });

  test("selects the durable resume cursor from the last applied sequence", () => {
    expect(selectBetSyncResumeSeq({ lastAppliedSeq: 0 })).toBe(0);
    expect(selectBetSyncResumeSeq({ lastAppliedSeq: 17 })).toBe(17);
  });

  test("treats replay catch-up as a bounded phase and returns to live", () => {
    const replayUntilSeq = selectBetSyncReplayUntilSeq({
      resumeSeq: 12,
      latestSeq: 15,
    });

    expect(replayUntilSeq).toBe(15);
    expect(
      resolveBetSyncReplayMode({
        eventName: "betting",
        eventSeq: 13,
        replayUntilSeq,
        sourceEpochChanged: false,
      }),
    ).toMatchObject({
      replayMode: "replay",
      replayUntilSeq: 15,
    });
    expect(
      resolveBetSyncReplayMode({
        eventName: "betting",
        eventSeq: 15,
        replayUntilSeq,
        sourceEpochChanged: false,
      }),
    ).toMatchObject({
      replayMode: "live",
      replayUntilSeq: null,
    });
  });

  test("marks explicit source resets separately from replay", () => {
    expect(
      resolveBetSyncReplayMode({
        eventName: "reset",
        eventSeq: 44,
        replayUntilSeq: 50,
        sourceEpochChanged: false,
      }),
    ).toMatchObject({
      replayMode: "reset",
      replayUntilSeq: null,
    });
  });

  test("rejects materially stale reset events before projection rollback", () => {
    expect(
      isBetSyncEventStaleAfterSourceReset({
        sourceEpochChanged: true,
        currentStreamEmittedAt: 10_000,
        eventEmittedAt: 4_000,
        toleranceMs: 1_000,
      }),
    ).toBe(true);
    expect(
      isBetSyncEventStaleAfterSourceReset({
        sourceEpochChanged: true,
        currentStreamEmittedAt: 10_000,
        eventEmittedAt: 9_500,
        toleranceMs: 1_000,
      }),
    ).toBe(false);
    expect(
      isBetSyncEventStaleAfterSourceReset({
        sourceEpochChanged: false,
        currentStreamEmittedAt: 10_000,
        eventEmittedAt: 1_000,
        toleranceMs: 1_000,
      }),
    ).toBe(false);
  });
});
