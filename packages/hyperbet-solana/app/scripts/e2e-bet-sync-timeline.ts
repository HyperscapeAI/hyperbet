export function normalizeFightStartTime(args: {
  scheduledFightStartTime: number | null;
  duelEndTime: number | null;
  emittedAt: number;
}): number | null {
  const { scheduledFightStartTime, duelEndTime, emittedAt } = args;
  if (
    scheduledFightStartTime === null ||
    scheduledFightStartTime > emittedAt ||
    (duelEndTime !== null && duelEndTime < scheduledFightStartTime)
  ) {
    return null;
  }
  return scheduledFightStartTime;
}
