const LAMPORTS_PER_SOL = 1_000_000_000n;
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;

export function normalizeLamports(value: unknown): string | null {
  let parsed: bigint;
  try {
    if (typeof value === "bigint") {
      parsed = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
      parsed = BigInt(value);
    } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      parsed = BigInt(value.trim());
    } else {
      return null;
    }
  } catch {
    return null;
  }

  if (parsed < 0n || parsed > MAX_SQLITE_INTEGER) {
    return null;
  }
  return parsed.toString();
}

export function legacySolAmountToLamports(value: unknown): string {
  const raw = String(value ?? "0").trim();
  const decimal = /^\d+(?:\.\d+)?$/.test(raw)
    ? raw
    : Number.isFinite(Number(raw)) && Number(raw) >= 0
      ? Number(raw).toFixed(9)
      : "0";
  const [whole = "0", rawFraction = ""] = decimal.split(".");
  const fraction = rawFraction.padEnd(10, "0");
  let lamports =
    BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.slice(0, 9) || "0");
  if (Number(fraction[9] ?? "0") >= 5) {
    lamports += 1n;
  }
  return normalizeLamports(lamports) ?? "0";
}

export function pointsForLamports(value: string): number {
  const normalized = normalizeLamports(value);
  if (!normalized || normalized === "0") return 0;
  const rounded =
    (BigInt(normalized) * 10n + LAMPORTS_PER_SOL / 2n) / LAMPORTS_PER_SOL;
  const points =
    rounded > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(rounded);
  return Math.max(1, points);
}

export function referralPointsForBetPoints(points: number): number {
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new Error("bet points must be a safe non-negative integer");
  }
  return points === 0 ? 0 : Math.max(1, Math.round(points * 0.2));
}
