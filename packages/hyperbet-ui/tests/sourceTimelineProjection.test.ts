import "./setup";
import { describe, expect, it } from "bun:test";

import {
  projectCanonicalSessionToSourceTimeline,
  resolveAlignedSessionPhase,
} from "../src/lib/viewerAlignment";
import type { CanonicalStreamSession } from "../src/spectator/types";

function makeSession(): CanonicalStreamSession {
  return {
    schemaVersion: 3,
    sourceEpoch: 1,
    seq: 9,
    emittedAt: 1_000,
    duelId: "duel-1",
    duelKey: "ab".repeat(32),
    phase: "COUNTDOWN",
    phaseVersion: 2,
    cycle: {
      cycleId: "cycle-1",
      phase: "COUNTDOWN",
      cycleStartTime: 0,
      phaseStartTime: 0,
      phaseEndTime: 0,
      phaseVersion: 2,
      timeRemaining: 12,
      agent1: null,
      agent2: null,
      duelId: "duel-1",
      duelKeyHex: `0x${"ab".repeat(32)}`,
      rawCycle: null,
      broadcastTimeline: {
        phase: "COUNTDOWN",
        betOpenTime: 5_000,
        betCloseTime: 6_000,
        fightStartTime: 7_000,
        duelEndTime: 13_000,
        presentationDelayMs: 4_000,
        updatedAt: 950,
      },
      sourceTimeline: {
        phase: "FIGHTING",
        betOpenTime: 1_000,
        betCloseTime: 2_000,
        fightStartTime: 3_000,
        duelEndTime: 9_000,
        updatedAt: 900,
      },
      betOpenTime: 5_000,
      betCloseTime: 6_000,
      countdown: 12,
      fightStartTime: 7_000,
      duelEndTime: 13_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      rendererHealth: null,
      seed: null,
      replayHash: null,
    },
    leaderboard: [],
    cameraTarget: null,
    playback: null,
    rendererHealth: null,
    sourceRuntime: null,
    deliveryHealth: null,
    channel: null,
    publicReadiness: null,
    canonicalDestination: null,
    fallbackDestination: null,
    canonicalAuthority: null,
    rendererMetrics: null,
    delivery: null,
    authorityHealth: {
      ready: true,
      degradedReason: null,
      updatedAt: 1_000,
    },
    marketParity: null,
    status: {
      authority: {
        ready: true,
        degradedReason: null,
        updatedAt: 1_000,
      },
      renderer: null,
      sourceRuntime: null,
      delivery: null,
      deliveryHealth: null,
    },
  };
}

describe("sourceTimeline projection", () => {
  it("projects raw source timing into the aligned session clone", () => {
    const projected = projectCanonicalSessionToSourceTimeline(makeSession());

    expect(projected?.phase).toBe("FIGHTING");
    expect(projected?.cycle.phase).toBe("FIGHTING");
    expect(projected?.cycle.broadcastTimeline).toEqual({
      phase: "FIGHTING",
      betOpenTime: 1_000,
      betCloseTime: 2_000,
      fightStartTime: 3_000,
      duelEndTime: 9_000,
      presentationDelayMs: 4_000,
      updatedAt: 900,
    });
    expect(projected?.cycle.betCloseTime).toBe(2_000);
  });

  it("leaves sessions without sourceTimeline untouched", () => {
    const session = makeSession();
    session.cycle.sourceTimeline = null;

    expect(projectCanonicalSessionToSourceTimeline(session)).toBe(session);
    expect(resolveAlignedSessionPhase(session)).toBe("COUNTDOWN");
  });
});
