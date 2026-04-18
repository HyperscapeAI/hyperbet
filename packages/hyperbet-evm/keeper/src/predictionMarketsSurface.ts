export function extractCycleIdFromStreamingDuelId(
  duelId: unknown,
): string | null {
  if (typeof duelId !== "string") {
    return null;
  }
  const stripped = duelId.trim().replace(/^streaming-/i, "");
  return stripped.length > 0 ? stripped : null;
}

export function streamCycleAdvancedBeyondPinnedParity(params: {
  streamCycleId: unknown;
  previousLiveDuelId: unknown;
  marketParityDuelId: unknown;
}): boolean {
  const streamCycleId =
    typeof params.streamCycleId === "string" &&
    params.streamCycleId.trim().length > 0
      ? params.streamCycleId.trim()
      : null;
  if (streamCycleId == null) {
    return false;
  }

  const previousCycleId = extractCycleIdFromStreamingDuelId(
    params.previousLiveDuelId,
  );
  const parityCycleId = extractCycleIdFromStreamingDuelId(
    params.marketParityDuelId,
  );
  return (
    (previousCycleId == null || streamCycleId !== previousCycleId) &&
    (parityCycleId == null || streamCycleId !== parityCycleId)
  );
}
