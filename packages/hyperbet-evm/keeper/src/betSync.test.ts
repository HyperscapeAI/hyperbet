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
      agent1: { id: "a" },
      agent2: { id: "b" },
      arenaPositions: { agent1: [0, 0, 0], agent2: [1, 0, 0] },
      leaderboard: [{ id: "a" }],
      rendererHealth: { ready: true, degradedReason: null, updatedAt: 123 },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.duelKey).toBe(duelKey);

    expect(toStreamStateFromBetSyncEvent(parsed!)).toMatchObject({
      seq: 12,
      emittedAt: 1_700_000_000_000,
      cycle: {
        duelId: "duel-12",
        duelKey: duelKey,
        duelKeyHex: `0x${duelKey}`,
        phase: "FIGHTING",
        phaseVersion: 3,
      },
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
      },
      11,
    );

    expect(next.live?.duel.duelId).toBe("duel-next");
    expect(next.recentSettlement?.duel.duelId).toBe("duel-live");
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
