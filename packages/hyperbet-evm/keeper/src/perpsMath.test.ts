import { describe, expect, test } from "bun:test";

import {
  calculateExitPriceLamports,
  calculateMaintenanceMarginLamports,
  estimatePositionEquityLamports,
  resolveOracleMaxAgeSeconds,
} from "./perpsMath";

const SOL = 1_000_000_000n;

describe("perps math helpers", () => {
  test("uses the vault-configured oracle staleness threshold when present", () => {
    expect(resolveOracleMaxAgeSeconds(45, 120)).toBe(45);
    expect(resolveOracleMaxAgeSeconds(0, 120)).toBe(120);
    expect(resolveOracleMaxAgeSeconds(undefined, 120)).toBe(120);
  });

  test("marks a short as underwater when skew-adjusted exit price is worse than spot", () => {
    const market = {
      currentFundingRate: 0n,
      oracleLastUpdatedSeconds: 0,
      spotIndexLamports: 100n * SOL,
      totalLongOiLamports: 100n * SOL,
      totalShortOiLamports: 0n,
    };
    const position = {
      marginLamports: 10n * SOL,
      lastFundingRate: 0n,
      entryPriceLamports: 100n * SOL,
      sizeLamports: -(10n * SOL),
    };
    const skewScaleLamports = 100n * SOL;

    const exitPriceLamports = calculateExitPriceLamports(
      position.sizeLamports,
      market,
      skewScaleLamports,
    );
    const skewAdjustedEquityLamports = estimatePositionEquityLamports(
      position,
      market,
      skewScaleLamports,
    );
    const maintenanceMarginLamports = calculateMaintenanceMarginLamports(
      position.sizeLamports,
      1_000,
    );

    expect(exitPriceLamports).toBeGreaterThan(market.spotIndexLamports);
    expect(skewAdjustedEquityLamports).toBeLessThan(maintenanceMarginLamports);
    expect(position.marginLamports).toBeGreaterThan(maintenanceMarginLamports);
  });
});
