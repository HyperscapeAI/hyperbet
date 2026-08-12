import { describe, expect, test } from "bun:test";

import { normalizeFightStartTime } from "../../scripts/e2e-bet-sync-timeline";

describe("E2E canonical bet-sync timeline", () => {
  test("preserves a fight start once combat has begun", () => {
    expect(
      normalizeFightStartTime({
        scheduledFightStartTime: 2_000,
        duelEndTime: null,
        emittedAt: 2_500,
      }),
    ).toBe(2_000);
    expect(
      normalizeFightStartTime({
        scheduledFightStartTime: 2_000,
        duelEndTime: 3_000,
        emittedAt: 3_500,
      }),
    ).toBe(2_000);
  });

  test("does not claim combat began when a duel ended before its scheduled start", () => {
    expect(
      normalizeFightStartTime({
        scheduledFightStartTime: 2_000,
        duelEndTime: 1_900,
        emittedAt: 2_500,
      }),
    ).toBeNull();
  });

  test("does not publish a future or absent fight start", () => {
    expect(
      normalizeFightStartTime({
        scheduledFightStartTime: 3_000,
        duelEndTime: null,
        emittedAt: 2_500,
      }),
    ).toBeNull();
    expect(
      normalizeFightStartTime({
        scheduledFightStartTime: null,
        duelEndTime: null,
        emittedAt: 2_500,
      }),
    ).toBeNull();
  });
});
