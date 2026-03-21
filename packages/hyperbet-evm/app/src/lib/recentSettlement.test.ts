import { describe, expect, test } from "bun:test";

import { getRecentSettlementTitle } from "./recentSettlement";

describe("getRecentSettlementTitle", () => {
  test("uses the settled duel participant name for the resolved side", () => {
    expect(
      getRecentSettlementTitle({
        duel: {
          winner: "A",
          phase: "RESOLUTION",
          agent1Name: "Settled Alpha",
          agent2Name: "Settled Beta",
        },
        fallbackLabel: "Latest settlement",
        idleLabel: "Idle",
      }),
    ).toBe("Settled Alpha");
  });

  test("falls back to a neutral label when the winner side has no settled name", () => {
    expect(
      getRecentSettlementTitle({
        duel: {
          winner: "B",
          phase: "RESOLUTION",
          agent1Name: "Settled Alpha",
          agent2Name: null,
        },
        fallbackLabel: "Latest settlement",
        idleLabel: "Idle",
      }),
    ).toBe("Latest settlement");
  });
});
