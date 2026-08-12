export type ExponentialBackoffInput = {
  baseMs: number;
  maxMs: number;
  consecutiveFailures: number;
};

export function getExponentialBackoffMs(
  input: ExponentialBackoffInput,
): number {
  const { baseMs, maxMs, consecutiveFailures } = input;
  if (!Number.isInteger(baseMs) || baseMs < 1) {
    throw new Error("baseMs must be a positive integer");
  }
  if (!Number.isInteger(maxMs) || maxMs < baseMs) {
    throw new Error("maxMs must be an integer greater than or equal to baseMs");
  }
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new Error("consecutiveFailures must be a positive integer");
  }

  const exponent = Math.min(consecutiveFailures - 1, 30);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}
