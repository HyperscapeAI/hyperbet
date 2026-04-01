import { createHash } from "node:crypto";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeForSignature(value: unknown): JsonValue | undefined {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeForSignature(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entryValue]) => {
        const normalized = normalizeForSignature(entryValue);
        return normalized === undefined ? [] : [[key, normalized] as const];
      });
    return Object.fromEntries(entries);
  }
  return undefined;
}

export function buildStreamStateSignature(state: {
  cycle?: unknown;
  leaderboard?: unknown;
  cameraTarget?: unknown;
}): string {
  const normalized = normalizeForSignature({
    cycle: state.cycle ?? null,
    leaderboard: state.leaderboard ?? [],
    cameraTarget: state.cameraTarget ?? null,
  });
  return createHash("sha256")
    .update(JSON.stringify(normalized ?? null))
    .digest("hex");
}
