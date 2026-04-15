import { describe, expect, test } from "bun:test";

import { sourceStatePhaseAllowsUnmaskedDuelIdentity } from "./streamPhaseUnmask";

// `StreamState` is structurally loose enough for these tests that we
// drive the predicate with a minimal inline shape. The helper only
// reads `cycle.phase` and top-level `phase` off the source state.
const build = (overrides: {
  cyclePhase?: string | null;
  topPhase?: string | null;
}): Parameters<typeof sourceStatePhaseAllowsUnmaskedDuelIdentity>[0] => {
  const cycle: Record<string, unknown> = {};
  if (overrides.cyclePhase !== undefined) cycle.phase = overrides.cyclePhase;
  return {
    cycle: overrides.cyclePhase !== undefined ? cycle : null,
    phase: overrides.topPhase ?? null,
  } as unknown as Parameters<typeof sourceStatePhaseAllowsUnmaskedDuelIdentity>[0];
};

describe("sourceStatePhaseAllowsUnmaskedDuelIdentity", () => {
  test("returns true when cycle.phase is FIGHTING", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(build({ cyclePhase: "FIGHTING" })),
    ).toBe(true);
  });

  test("returns true when cycle.phase is RESOLUTION", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(
        build({ cyclePhase: "RESOLUTION" }),
      ),
    ).toBe(true);
  });

  test("returns true when cycle.phase is missing but top-level phase is FIGHTING", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(build({ topPhase: "FIGHTING" })),
    ).toBe(true);
  });

  test("returns false when cycle.phase is IDLE", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(build({ cyclePhase: "IDLE" })),
    ).toBe(false);
  });

  test("returns false when cycle.phase is ANNOUNCEMENT", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(
        build({ cyclePhase: "ANNOUNCEMENT" }),
      ),
    ).toBe(false);
  });

  test("returns false when cycle.phase is COUNTDOWN", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(
        build({ cyclePhase: "COUNTDOWN" }),
      ),
    ).toBe(false);
  });

  test("returns false when both phases are null/undefined", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(build({})),
    ).toBe(false);
  });

  test("returns false for unknown phase strings", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(
        build({ cyclePhase: "MYSTERY_PHASE" }),
      ),
    ).toBe(false);
  });

  test("cycle.phase wins over top-level phase when both are set", () => {
    expect(
      sourceStatePhaseAllowsUnmaskedDuelIdentity(
        build({ cyclePhase: "IDLE", topPhase: "FIGHTING" }),
      ),
    ).toBe(false);
  });

  test("ignores non-string cycle.phase", () => {
    const sourceState = {
      cycle: { phase: 42 },
      phase: "FIGHTING",
    } as unknown as Parameters<typeof sourceStatePhaseAllowsUnmaskedDuelIdentity>[0];
    // cycle.phase is non-string so it falls through to top-level phase
    expect(sourceStatePhaseAllowsUnmaskedDuelIdentity(sourceState)).toBe(true);
  });
});
