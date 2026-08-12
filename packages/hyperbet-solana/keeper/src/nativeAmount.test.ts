import { describe, expect, test } from "bun:test";
import {
  legacySolAmountToLamports,
  normalizeLamports,
  pointsForLamports,
  referralPointsForBetPoints,
} from "./nativeAmount";

describe("native SOL amount handling", () => {
  test("normalizes only non-negative SQLite-safe integer lamports", () => {
    expect(normalizeLamports("001500000000")).toBe("1500000000");
    expect(normalizeLamports(42n)).toBe("42");
    expect(normalizeLamports(-1)).toBeNull();
    expect(normalizeLamports(1.25)).toBeNull();
    expect(normalizeLamports("1e9")).toBeNull();
    expect(normalizeLamports("9223372036854775808")).toBeNull();
  });

  test("converts legacy decimal SOL values for compatibility reads", () => {
    expect(legacySolAmountToLamports("1.25")).toBe("1250000000");
    expect(legacySolAmountToLamports("0.000000001")).toBe("1");
    expect(legacySolAmountToLamports("0.0000000005")).toBe("1");
    expect(legacySolAmountToLamports("invalid")).toBe("0");
  });

  test("awards noncash points deterministically from lamports", () => {
    expect(pointsForLamports("0")).toBe(0);
    expect(pointsForLamports("1")).toBe(1);
    expect(pointsForLamports("1000000000")).toBe(10);
    expect(pointsForLamports("1250000000")).toBe(13);
  });

  test("never grants referral rewards for zero bettor value", () => {
    expect(referralPointsForBetPoints(0)).toBe(0);
    expect(referralPointsForBetPoints(1)).toBe(1);
    expect(referralPointsForBetPoints(20)).toBe(4);
    expect(() => referralPointsForBetPoints(-1)).toThrow(
      "safe non-negative integer",
    );
  });
});
