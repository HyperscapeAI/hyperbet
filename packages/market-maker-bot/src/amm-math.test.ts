import { describe, expect, it } from "vitest";

import {
  calcAmmPrice,
  calcDynamicLiquidity,
  calcInitialLiquidity,
  calcPrice,
  getSwapAmount,
} from "./amm-math.ts";

describe("amm-math", () => {
  describe("calcPrice", () => {
    it("returns ~500_000 for equal reserves (z=0 → CDF(0) = 0.5)", () => {
      const price = calcPrice(1_000_000n, 1_000_000n, 1_000_000n);
      // Allow ±1% tolerance (matches Rust test)
      expect(Number(price)).toBeGreaterThanOrEqual(490_000);
      expect(Number(price)).toBeLessThanOrEqual(510_000);
    });

    it("returns 500_000 when liquidity is zero", () => {
      expect(calcPrice(1_000_000n, 1_000_000n, 0n)).toBe(500_000n);
    });

    it("returns higher price when reserveNo > reserveYes", () => {
      const price = calcPrice(500_000n, 1_500_000n, 1_000_000n);
      expect(Number(price)).toBeGreaterThan(500_000);
    });

    it("returns lower price when reserveYes > reserveNo", () => {
      const price = calcPrice(1_500_000n, 500_000n, 1_000_000n);
      expect(Number(price)).toBeLessThan(500_000);
    });
  });

  describe("calcAmmPrice", () => {
    it("returns ~0.5 for equal reserves", () => {
      const price = calcAmmPrice(1_000_000n, 1_000_000n, 1_000_000n);
      expect(price).toBeCloseTo(0.5, 1);
    });
  });

  describe("getSwapAmount", () => {
    it("produces nonzero output", () => {
      const out = getSwapAmount(
        true,
        1_000_000n,
        1_000_000n,
        1_000_000n,
        100_000n,
      );
      expect(out).toBeGreaterThan(0n);
    });

    it("is symmetric for equal reserves", () => {
      const out1 = getSwapAmount(
        true,
        1_000_000n,
        1_000_000n,
        1_000_000n,
        100_000n,
      );
      const out2 = getSwapAmount(
        false,
        1_000_000n,
        1_000_000n,
        1_000_000n,
        100_000n,
      );
      const diff = out1 > out2 ? out1 - out2 : out2 - out1;
      // Within 1 unit of rounding
      expect(Number(diff)).toBeLessThanOrEqual(1);
    });

    it("larger input produces larger output", () => {
      const small = getSwapAmount(
        true,
        1_000_000n,
        1_000_000n,
        1_000_000n,
        50_000n,
      );
      const large = getSwapAmount(
        true,
        1_000_000n,
        1_000_000n,
        1_000_000n,
        200_000n,
      );
      expect(large).toBeGreaterThan(small);
    });
  });

  describe("calcInitialLiquidity", () => {
    it("returns approximately amount * sqrt(2π) ≈ 2.506x", () => {
      const liq = calcInitialLiquidity(1_000_000n);
      expect(Number(liq)).toBeGreaterThan(2_000_000);
      expect(Number(liq)).toBeLessThan(3_000_000);
    });

    it("scales linearly", () => {
      const l1 = calcInitialLiquidity(1_000_000n);
      const l2 = calcInitialLiquidity(2_000_000n);
      expect(Number(l2)).toBeCloseTo(Number(l1) * 2, -2);
    });
  });

  describe("calcDynamicLiquidity", () => {
    it("returns zero when deadline has passed", () => {
      expect(calcDynamicLiquidity(1_000_000n, 100n, 200n)).toBe(0n);
    });

    it("returns zero at exact deadline", () => {
      expect(calcDynamicLiquidity(1_000_000n, 100n, 100n)).toBe(0n);
    });

    it("returns positive value before deadline", () => {
      const liq = calcDynamicLiquidity(1_000_000n, 3600n, 0n);
      expect(liq).toBeGreaterThan(0n);
    });

    it("decreases as time approaches deadline", () => {
      const early = calcDynamicLiquidity(1_000_000n, 3600n, 0n);
      const late = calcDynamicLiquidity(1_000_000n, 3600n, 3500n);
      expect(early).toBeGreaterThan(late);
    });
  });
});
