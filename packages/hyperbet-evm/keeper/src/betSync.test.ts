import { describe, expect, test } from "bun:test";

import {
  mergePredictionMarketsSurface,
  parseBetSyncBootstrapState,
  parseBetSyncEvent,
  parsePredictionMarketsOverview,
  rollPredictionMarketsOverview,
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
  });
});
