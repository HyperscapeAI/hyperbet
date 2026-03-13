import { describe, expect, test } from "bun:test";

import {
  MAX_INDEX,
  MIN_INDEX,
  calculateSyntheticSpotIndex,
  conservativeSkill,
  modelMarketIdFromCharacterId,
} from "./modelMarkets";
import type { AgentRating } from "./trueskill";

describe("model market helpers", () => {
  test("maps character ids to stable, non-zero market ids", () => {
    const first = modelMarketIdFromCharacterId("gpt-4.1");
    const second = modelMarketIdFromCharacterId("gpt-4.1");
    const third = modelMarketIdFromCharacterId("claude-sonnet");

    expect(first).toBe(second);
    expect(first).not.toBe(0);
    expect(first).not.toBe(third);
  });

  test("prices stronger conservative skill above weaker peers", () => {
    const strong: AgentRating = {
      mu: 1140,
      sigma: 70,
      gamesPlayed: 20,
    };
    const weak: AgentRating = {
      mu: 980,
      sigma: 95,
      gamesPlayed: 20,
    };
    const neutral: AgentRating = {
      mu: 1040,
      sigma: 80,
      gamesPlayed: 20,
    };
    const population = [strong, weak, neutral];

    expect(conservativeSkill(strong)).toBeGreaterThan(conservativeSkill(weak));
    expect(calculateSyntheticSpotIndex(strong, population)).toBeGreaterThan(
      calculateSyntheticSpotIndex(neutral, population),
    );
    expect(calculateSyntheticSpotIndex(neutral, population)).toBeGreaterThan(
      calculateSyntheticSpotIndex(weak, population),
    );
    expect(calculateSyntheticSpotIndex(strong, population)).toBeLessThanOrEqual(
      MAX_INDEX,
    );
    expect(calculateSyntheticSpotIndex(weak, population)).toBeGreaterThanOrEqual(
      MIN_INDEX,
    );
  });
});
