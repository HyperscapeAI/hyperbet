import { describe, expect, it } from "bun:test";
import {
  ageByServerEmission,
  DUEL_CONTEXT_MAX_AGE_MS,
  isStaleByServerEmission,
  MARKET_MAX_AGE_MS,
} from "../../src/lib/viewerAlignment";

/**
 * Pure tests for staleness helpers + budget constants. Covers PRD
 * decision 3 (market=10s, duelContext=8s) and the server-emission-
 * time keyed staleness rule.
 */

describe("max-age budget constants", () => {
  it("market = 10s, duel-context = 10s per rollout tuning", () => {
    expect(MARKET_MAX_AGE_MS).toBe(10_000);
    expect(DUEL_CONTEXT_MAX_AGE_MS).toBe(10_000);
  });
});

describe("isStaleByServerEmission", () => {
  it("returns false when budget is null/undefined/zero (check disabled)", () => {
    expect(isStaleByServerEmission(100, 100_000, null)).toBe(false);
    expect(isStaleByServerEmission(100, 100_000, undefined)).toBe(false);
    expect(isStaleByServerEmission(100, 100_000, 0)).toBe(false);
  });

  it("returns false when snapshot timestamp is null/undefined", () => {
    expect(isStaleByServerEmission(null, 100_000, 10_000)).toBe(false);
    expect(isStaleByServerEmission(undefined, 100_000, 10_000)).toBe(false);
  });

  it("returns false when age is within budget", () => {
    expect(
      isStaleByServerEmission(100_000 - 5_000, 100_000, 10_000),
    ).toBe(false);
    // Exactly at budget — not stale (strict >).
    expect(
      isStaleByServerEmission(100_000 - 10_000, 100_000, 10_000),
    ).toBe(false);
  });

  it("returns true when age exceeds budget", () => {
    expect(
      isStaleByServerEmission(100_000 - 10_001, 100_000, 10_000),
    ).toBe(true);
    expect(isStaleByServerEmission(0, 100_000, 10_000)).toBe(true);
  });

  it("returns false for non-finite snapshot timestamps", () => {
    expect(isStaleByServerEmission(Number.NaN, 100_000, 10_000)).toBe(false);
    expect(
      isStaleByServerEmission(Number.POSITIVE_INFINITY, 100_000, 10_000),
    ).toBe(false);
  });

  it("handles snapshots ahead of viewer-server time as fresh (negative age)", () => {
    // Clock skew can produce this transiently; don't flag as stale.
    expect(
      isStaleByServerEmission(100_100, 100_000, 10_000),
    ).toBe(false);
  });
});

describe("ageByServerEmission", () => {
  it("returns null for missing or non-finite snapshot timestamps", () => {
    expect(ageByServerEmission(null, 100_000)).toBeNull();
    expect(ageByServerEmission(undefined, 100_000)).toBeNull();
    expect(ageByServerEmission(Number.NaN, 100_000)).toBeNull();
  });

  it("returns viewerNow - snapshot (positive when snapshot is older)", () => {
    expect(ageByServerEmission(95_000, 100_000)).toBe(5_000);
    expect(ageByServerEmission(100_000, 100_000)).toBe(0);
  });

  it("returns negative values for snapshots ahead of viewer-now (clock skew diagnostic)", () => {
    expect(ageByServerEmission(101_000, 100_000)).toBe(-1_000);
  });
});
