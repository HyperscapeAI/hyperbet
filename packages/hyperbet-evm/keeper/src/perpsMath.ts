const FUNDING_RATE_PRECISION = 1_000_000_000n;
const BPS_DENOMINATOR = 10_000n;

export interface PerpsMarketSnapshot {
  currentFundingRate: bigint;
  oracleLastUpdatedSeconds: number;
  spotIndexLamports: bigint;
  totalLongOiLamports: bigint;
  totalShortOiLamports: bigint;
}

export interface PerpsPositionSnapshot {
  entryPriceLamports: bigint;
  lastFundingRate: bigint;
  marginLamports: bigint;
  sizeLamports: bigint;
}

export function resolveOracleMaxAgeSeconds(
  configuredSeconds: number | null | undefined,
  fallbackSeconds: number,
): number {
  if (
    typeof configuredSeconds === "number" &&
    Number.isFinite(configuredSeconds) &&
    configuredSeconds > 0
  ) {
    return Math.floor(configuredSeconds);
  }
  return Math.max(1, Math.floor(fallbackSeconds));
}

export function calculateExecutionPriceLamports(
  indexPriceLamports: bigint,
  totalLongOiLamports: bigint,
  totalShortOiLamports: bigint,
  sizeDeltaLamports: bigint,
  skewScaleLamports: bigint,
): bigint {
  if (indexPriceLamports <= 0n || skewScaleLamports <= 0n) {
    throw new Error("invalid market state");
  }

  const skewLamports = totalLongOiLamports - totalShortOiLamports;
  const y1 = skewScaleLamports + skewLamports;
  const y2 = y1 + sizeDeltaLamports;
  if (y1 <= 0n || y2 <= 0n) {
    throw new Error("invalid virtual reserve state");
  }

  const part1 = (indexPriceLamports * y1) / skewScaleLamports;
  return (part1 * y2) / skewScaleLamports;
}

export function calculateExitPriceLamports(
  sizeLamportsSigned: bigint,
  market: Pick<
    PerpsMarketSnapshot,
    "spotIndexLamports" | "totalLongOiLamports" | "totalShortOiLamports"
  >,
  skewScaleLamports: bigint,
): bigint {
  return calculateExecutionPriceLamports(
    market.spotIndexLamports,
    market.totalLongOiLamports,
    market.totalShortOiLamports,
    -sizeLamportsSigned,
    skewScaleLamports,
  );
}

export function calculateTradePnlLamports(
  sizeLamportsSigned: bigint,
  entryPriceLamports: bigint,
  exitPriceLamports: bigint,
): bigint {
  if (entryPriceLamports <= 0n || sizeLamportsSigned === 0n) {
    throw new Error("invalid position state");
  }

  const absSize =
    sizeLamportsSigned < 0n ? -sizeLamportsSigned : sizeLamportsSigned;
  if (sizeLamportsSigned > 0n) {
    return (
      ((exitPriceLamports - entryPriceLamports) * absSize) / entryPriceLamports
    );
  }

  return (
    ((entryPriceLamports - exitPriceLamports) * absSize) / entryPriceLamports
  );
}

export function calculateFundingPnlLamports(
  sizeLamportsSigned: bigint,
  fundingDelta: bigint,
): bigint {
  return -((sizeLamportsSigned * fundingDelta) / FUNDING_RATE_PRECISION);
}

export function calculateMaintenanceMarginLamports(
  sizeLamportsSigned: bigint,
  maintenanceMarginBps: number,
): bigint {
  const absSize =
    sizeLamportsSigned < 0n ? -sizeLamportsSigned : sizeLamportsSigned;
  return (absSize * BigInt(maintenanceMarginBps)) / BPS_DENOMINATOR;
}

export function estimatePositionEquityLamports(
  position: PerpsPositionSnapshot,
  market: PerpsMarketSnapshot,
  skewScaleLamports: bigint,
): bigint {
  const exitPriceLamports = calculateExitPriceLamports(
    position.sizeLamports,
    market,
    skewScaleLamports,
  );
  const tradePnlLamports = calculateTradePnlLamports(
    position.sizeLamports,
    position.entryPriceLamports,
    exitPriceLamports,
  );
  const fundingPnlLamports = calculateFundingPnlLamports(
    position.sizeLamports,
    market.currentFundingRate - position.lastFundingRate,
  );
  return position.marginLamports + tradePnlLamports + fundingPnlLamports;
}
