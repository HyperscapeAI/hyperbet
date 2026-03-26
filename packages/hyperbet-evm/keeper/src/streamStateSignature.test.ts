import { describe, expect, test } from "bun:test";

import { buildStreamStateSignature } from "./streamStateSignature";

describe("buildStreamStateSignature", () => {
  test("changes when duel identity changes without a phase transition", () => {
    const base = {
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "0x11",
        agent1: { id: "a", name: "Agent A" },
        agent2: { id: "b", name: "Agent B" },
      },
      leaderboard: [],
      cameraTarget: "arena",
    };

    const next = {
      ...base,
      cycle: {
        ...base.cycle,
        duelId: "duel-2",
        duelKeyHex: "0x22",
      },
    };

    expect(buildStreamStateSignature(base)).not.toBe(
      buildStreamStateSignature(next),
    );
  });

  test("changes when stream-facing payload changes within the same duel", () => {
    const base = {
      cycle: {
        cycleId: "cycle-1",
        phase: "FIGHTING",
        duelId: "duel-1",
        duelKeyHex: "0x11",
        timeRemaining: 90,
        agent1: { id: "a", name: "Agent A", hp: 100 },
        agent2: { id: "b", name: "Agent B", hp: 100 },
      },
      leaderboard: [{ wallet: "0x1", points: 10 }],
      cameraTarget: "arena",
    };

    const next = {
      ...base,
      cycle: {
        ...base.cycle,
        timeRemaining: 89,
        agent1: { ...base.cycle.agent1, hp: 96 },
      },
    };

    expect(buildStreamStateSignature(base)).not.toBe(
      buildStreamStateSignature(next),
    );
  });

  test("is stable across key ordering differences", () => {
    const left = {
      leaderboard: [],
      cameraTarget: "arena",
      cycle: {
        duelKeyHex: "0x11",
        duelId: "duel-1",
        phase: "ANNOUNCEMENT",
        cycleId: "cycle-1",
      },
    };

    const right = {
      cycle: {
        phase: "ANNOUNCEMENT",
        cycleId: "cycle-1",
        duelId: "duel-1",
        duelKeyHex: "0x11",
      },
      cameraTarget: "arena",
      leaderboard: [],
    };

    expect(buildStreamStateSignature(left)).toBe(
      buildStreamStateSignature(right),
    );
  });
});
