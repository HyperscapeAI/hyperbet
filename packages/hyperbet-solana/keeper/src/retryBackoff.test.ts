import { describe, expect, test } from "bun:test";

import { getExponentialBackoffMs } from "./retryBackoff";

describe("exponential retry backoff", () => {
  test("recovers quickly from a transient failure and caps repeated failures", () => {
    const values = Array.from({ length: 8 }, (_, index) =>
      getExponentialBackoffMs({
        baseMs: 1_000,
        maxMs: 30_000,
        consecutiveFailures: index + 1,
      }),
    );

    expect(values).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  test("rejects invalid bounds and failure counts", () => {
    expect(() =>
      getExponentialBackoffMs({
        baseMs: 0,
        maxMs: 1_000,
        consecutiveFailures: 1,
      }),
    ).toThrow("baseMs must be a positive integer");
    expect(() =>
      getExponentialBackoffMs({
        baseMs: 2_000,
        maxMs: 1_000,
        consecutiveFailures: 1,
      }),
    ).toThrow("maxMs must be an integer greater than or equal to baseMs");
    expect(() =>
      getExponentialBackoffMs({
        baseMs: 1_000,
        maxMs: 1_000,
        consecutiveFailures: 0,
      }),
    ).toThrow("consecutiveFailures must be a positive integer");
  });
});
