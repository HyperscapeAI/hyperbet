import { describe, expect, test } from "bun:test";

import {
  deriveSpectatorPresentationState,
  getSpectatorStatusCopy,
  getStreamRecoveryHeading,
  selectSpectatorDisplayPhase,
  selectSpectatorPresentationUpdate,
} from "../../src/spectator/presentation";
import type { StreamingStateUpdate } from "../../src/spectator/types";

const NOW_MS = 1_700_000_000_000;
const DUEL_KEY = "ab".repeat(32);

function makeState(
  overrides: Partial<StreamingStateUpdate> = {},
): StreamingStateUpdate {
  return {
    type: "STREAMING_STATE_UPDATE",
    emittedAt: NOW_MS - 8_000,
    seq: 42,
    cameraTarget: null,
    leaderboard: [],
    cycle: {
      cycleId: "cycle-42",
      phase: "FIGHTING",
      cycleStartTime: NOW_MS - 30_000,
      phaseStartTime: NOW_MS - 20_000,
      phaseEndTime: NOW_MS + 70_000,
      timeRemaining: 70_000,
      agent1: {
        id: "astra",
        name: "Astra",
        provider: "",
        model: "",
        hp: 40,
        maxHp: 50,
        combatLevel: 70,
        wins: 1,
        losses: 0,
        damageDealtThisFight: 10,
      },
      agent2: {
        id: "boros",
        name: "Boros",
        provider: "",
        model: "",
        hp: 35,
        maxHp: 50,
        combatLevel: 71,
        wins: 0,
        losses: 1,
        damageDealtThisFight: 15,
      },
      duelId: "duel-42",
      duelKeyHex: DUEL_KEY,
      countdown: null,
      winnerId: null,
      winnerName: null,
      winReason: null,
      rendererHealth: {
        ready: true,
        degradedReason: null,
        updatedAt: NOW_MS - 250,
      },
    },
    ...overrides,
  };
}

describe("spectator presentation authority", () => {
  test("keeps delayed stream telemetry visible inside the synchronization budget", () => {
    const state = deriveSpectatorPresentationState({
      state: makeState(),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });

    expect(state.hasFreshCycle).toBe(true);
    expect(state.hasMatchup).toBe(true);
    expect(state.activityLabel).toBe("LIVE");
  });

  test("does not depend on a newer market lifecycle during rollover", () => {
    const state = deriveSpectatorPresentationState({
      state: makeState({
        cycle: {
          ...makeState().cycle,
          phase: "RESOLUTION",
          winnerId: "boros",
          winnerName: "Boros",
          winReason: "hp_advantage",
        },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });

    expect(state.hasMatchup).toBe(true);
    expect(state.activityLabel).toBe("CONNECTED");
  });

  test("rejects stale, synthetic, or identity-free cycles", () => {
    const stale = deriveSpectatorPresentationState({
      state: makeState({ emittedAt: NOW_MS - 23_001 }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });
    const synthetic = deriveSpectatorPresentationState({
      state: makeState({
        cycle: { ...makeState().cycle, cycleId: "cycle-0" },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });
    const identityFree = deriveSpectatorPresentationState({
      state: makeState({
        cycle: { ...makeState().cycle, duelKeyHex: null },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });

    expect(stale.activityLabel).toBe("RECONNECTING");
    expect(stale.hasMatchup).toBe(false);
    expect(synthetic.hasFreshCycle).toBe(false);
    expect(identityFree.hasFreshCycle).toBe(true);
    expect(identityFree.hasMatchup).toBe(false);
  });

  test("fails closed when renderer or camera authority is missing, degraded, or stale", () => {
    const missing = deriveSpectatorPresentationState({
      state: makeState({
        cycle: { ...makeState().cycle, rendererHealth: null },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });
    const degraded = deriveSpectatorPresentationState({
      state: makeState({
        cycle: {
          ...makeState().cycle,
          rendererHealth: {
            ready: false,
            degradedReason: "camera_target_unresolved",
            updatedAt: NOW_MS,
          },
        },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });
    const stale = deriveSpectatorPresentationState({
      state: makeState({
        cycle: {
          ...makeState().cycle,
          rendererHealth: {
            ready: true,
            degradedReason: null,
            updatedAt: NOW_MS - 23_001,
          },
        },
      }),
      streamConnected: true,
      nowMs: NOW_MS,
      streamMaxAgeMs: 15_000,
      uiSyncDelayMs: 8_000,
    });

    expect(missing).toMatchObject({
      hasFreshCycle: false,
      hasMatchup: false,
      activityLabel: "UNAVAILABLE",
    });
    expect(degraded).toMatchObject({
      hasFreshCycle: false,
      hasMatchup: false,
      activityLabel: "UNAVAILABLE",
    });
    expect(stale).toMatchObject({
      hasFreshCycle: false,
      hasMatchup: false,
      activityLabel: "UNAVAILABLE",
    });
  });

  test("never presents a retained market phase as live stream authority", () => {
    expect(selectSpectatorDisplayPhase("FIGHTING", false)).toBe("UNAVAILABLE");
    expect(selectSpectatorDisplayPhase("LOCKED", false)).toBe("UNAVAILABLE");
    expect(selectSpectatorDisplayPhase("FIGHTING", true)).toBe("FIGHTING");
    expect(selectSpectatorDisplayPhase(null, true)).toBe("UNAVAILABLE");
  });

  test("does not describe stale combat telemetry as live during recovery", () => {
    expect(
      getSpectatorStatusCopy({
        phase: "FIGHTING",
        winnerName: null,
        hasFreshCycle: false,
        activityLabel: "RECONNECTING",
      }),
    ).toBe("Reconnecting to verified live arena telemetry.");
    expect(
      getSpectatorStatusCopy({
        phase: "FIGHTING",
        winnerName: null,
        hasFreshCycle: true,
        activityLabel: "LIVE",
      }),
    ).toBe("Round in progress — live combat telemetry is updating.");
  });

  test("explains every incomplete public-stream authority state", () => {
    expect(
      getStreamRecoveryHeading({
        playbackReady: false,
        telemetryConnected: false,
        rendererReady: false,
        hasStreamState: false,
        presentationReady: false,
      }),
    ).toBe("Connecting to the live arena");
    expect(
      getStreamRecoveryHeading({
        playbackReady: true,
        telemetryConnected: false,
        rendererReady: true,
        hasStreamState: true,
        presentationReady: false,
      }),
    ).toBe("Live match data temporarily unavailable");
    expect(
      getStreamRecoveryHeading({
        playbackReady: true,
        telemetryConnected: true,
        rendererReady: false,
        hasStreamState: true,
        presentationReady: false,
      }),
    ).toBe("Live arena view temporarily unavailable");
    expect(
      getStreamRecoveryHeading({
        playbackReady: true,
        telemetryConnected: true,
        rendererReady: true,
        hasStreamState: true,
        presentationReady: false,
      }),
    ).toBe("Live match data temporarily unavailable");
    expect(
      getStreamRecoveryHeading({
        playbackReady: true,
        telemetryConnected: true,
        rendererReady: true,
        hasStreamState: true,
        presentationReady: true,
      }),
    ).toBe(null);
  });

  test("holds the completed matchup across the short between-round idle frame", () => {
    const completed = makeState({
      cycle: {
        ...makeState().cycle,
        phase: "RESOLUTION",
        winnerId: "astra",
        winnerName: "Astra",
        winReason: "kill",
      },
    });
    const idle = makeState({
      seq: 43,
      cycle: {
        ...makeState().cycle,
        cycleId: "cycle-0",
        phase: "IDLE",
        agent1: null,
        agent2: null,
        duelId: null,
        duelKeyHex: null,
      },
    });

    expect(selectSpectatorPresentationUpdate(idle, completed, true)).toBe(
      completed,
    );
    expect(selectSpectatorPresentationUpdate(idle, completed, false)).toBe(
      idle,
    );
  });

  test("never bridges an idle frame with a missed nonterminal phase", () => {
    const fighting = makeState();
    const idle = makeState({
      seq: 43,
      cycle: {
        ...makeState().cycle,
        cycleId: "cycle-0",
        phase: "IDLE",
        agent1: null,
        agent2: null,
        duelId: null,
        duelKeyHex: null,
      },
    });

    expect(selectSpectatorPresentationUpdate(idle, fighting, true)).toBe(idle);
  });
});
