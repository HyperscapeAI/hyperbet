import "./setup";
import { describe, expect, it } from "bun:test";

import { deriveBettorLiveStatus } from "../src/lib/bettorLiveStatus";

const copy = {
  phaseLive: "LIVE",
  phaseStarting: (value: string | number | null) => `Starting ${value ?? ""}`,
  phaseResolved: "RESOLVED",
  phaseNextMatch: "NEXT MATCH",
  phaseIdle: "IDLE",
  waitingForMarketOperator: "PENDING",
  resolvedFor: (name: string) => `Resolved for ${name}`,
  resolved: "RESOLVED",
  marketCancelled: "CANCELLED",
  bettingLocked: "LOCKED",
  resolutionProposed: "PROPOSED",
  resolutionChallenged: "CHALLENGED",
  marketOpen: "OPEN",
  statusOpen: "OPEN",
  statusResolved: "RESOLVED",
  statusPending: "PENDING",
};

describe("deriveBettorLiveStatus", () => {
  it("uses canonical session phase for the live label and market lifecycle for settlement", () => {
    const status = deriveBettorLiveStatus({
      copy,
      session: {
        duelId: "duel-1",
        phase: "FIGHTING",
        cycle: {
          cycleId: "cycle-1",
          phase: "FIGHTING",
          cycleStartTime: 0,
          phaseStartTime: 0,
          phaseEndTime: 0,
          timeRemaining: 0,
          countdown: 3,
          agent1: null,
          agent2: null,
          winnerId: null,
          winnerName: null,
          winReason: null,
          broadcastTimeline: {
            phase: "COUNTDOWN",
            betOpenTime: null,
            betCloseTime: null,
            fightStartTime: null,
            duelEndTime: null,
            presentationDelayMs: 4000,
            updatedAt: 1,
          },
        },
      } as any,
      fallbackPhase: "IDLE",
      countdown: 3,
      marketLifecycleStatus: "RESOLVED",
      marketWinner: "A",
      agent1Name: "Alpha",
      agent2Name: "Beta",
      marketPhase: "RESOLUTION",
      marketDuelId: "duel-1",
    });

    expect(status.livePhase).toBe("COUNTDOWN");
    expect(status.livePhaseLabel).toBe("Starting 3");
    expect(status.marketSettlementLabel).toBe("Resolved for Alpha");
    expect(status.driftDiagnostic.detected).toBe(true);
    expect(status.driftDiagnostic.type).toBe("phase_mismatch");
  });

  it("treats duel mismatches as diagnostic-only without changing the live label", () => {
    const status = deriveBettorLiveStatus({
      copy,
      session: {
        duelId: "duel-canonical",
        phase: "ANNOUNCEMENT",
        cycle: {
          cycleId: "cycle-1",
          phase: "ANNOUNCEMENT",
          cycleStartTime: 0,
          phaseStartTime: 0,
          phaseEndTime: 0,
          timeRemaining: 0,
          countdown: null,
          agent1: null,
          agent2: null,
          winnerId: null,
          winnerName: null,
          winReason: null,
        },
      } as any,
      countdown: null,
      marketLifecycleStatus: "OPEN",
      marketWinner: "NONE",
      agent1Name: "Alpha",
      agent2Name: "Beta",
      marketPhase: "OPEN",
      marketDuelId: "duel-market",
    });

    expect(status.livePhaseLabel).toBe("NEXT MATCH");
    expect(status.marketSettlementLabel).toBe("OPEN");
    expect(status.driftDiagnostic.detected).toBe(true);
    expect(status.driftDiagnostic.type).toBe("duel_mismatch");
  });
});
