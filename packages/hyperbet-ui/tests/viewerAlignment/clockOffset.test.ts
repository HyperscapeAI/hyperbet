import { describe, expect, it } from "bun:test";
import {
  createClockOffsetEstimator,
  medianOfOffsets,
} from "../../src/lib/viewerAlignment";

/**
 * Unit tests for the SSE-derived clock-offset estimator.
 * Pure, no timers — every case passes synthetic samples directly.
 */

describe("medianOfOffsets", () => {
  it("returns 0 for empty input", () => {
    expect(medianOfOffsets([])).toBe(0);
  });

  it("returns the single value for a 1-element array", () => {
    expect(medianOfOffsets([42])).toBe(42);
  });

  it("picks the middle of an odd-length sorted result", () => {
    expect(medianOfOffsets([3, 1, 2])).toBe(2);
    expect(medianOfOffsets([-10, 0, 10])).toBe(0);
  });

  it("averages the two middle values for even-length arrays", () => {
    expect(medianOfOffsets([1, 2, 3, 4])).toBe(2.5);
    expect(medianOfOffsets([-5, 5])).toBe(0);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    medianOfOffsets(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("createClockOffsetEstimator", () => {
  it("returns 0 offset and low confidence with no samples", () => {
    const est = createClockOffsetEstimator();
    expect(est.getOffsetMs()).toBe(0);
    expect(est.getSampleCount()).toBe(0);
    expect(est.getConfidence()).toBe("low");
  });

  it("ignores samples with non-finite timestamps", () => {
    const est = createClockOffsetEstimator();
    est.pushSample({ emittedAt: Number.NaN, receivedAt: 100 });
    est.pushSample({ emittedAt: 100, receivedAt: Number.POSITIVE_INFINITY });
    expect(est.getSampleCount()).toBe(0);
    expect(est.getOffsetMs()).toBe(0);
  });

  it("computes positive offset when the server clock leads the client", () => {
    const est = createClockOffsetEstimator();
    // Server stamp ahead of client receive by 100ms → offset = +100.
    est.pushSample({ emittedAt: 1_100, receivedAt: 1_000 });
    expect(est.getOffsetMs()).toBe(100);
  });

  it("computes negative offset when the server clock lags the client", () => {
    const est = createClockOffsetEstimator();
    est.pushSample({ emittedAt: 1_000, receivedAt: 1_200 });
    expect(est.getOffsetMs()).toBe(-200);
  });

  it("bumps confidence from low → medium → high as samples accrue", () => {
    const est = createClockOffsetEstimator();
    for (let i = 0; i < 2; i += 1) {
      est.pushSample({ emittedAt: 1_000 + i, receivedAt: 1_000 });
    }
    expect(est.getConfidence()).toBe("low");

    for (let i = 0; i < 5; i += 1) {
      est.pushSample({ emittedAt: 1_000 + i, receivedAt: 1_000 });
    }
    expect(est.getConfidence()).toBe("medium");

    for (let i = 0; i < 10; i += 1) {
      est.pushSample({ emittedAt: 1_000 + i, receivedAt: 1_000 });
    }
    expect(est.getConfidence()).toBe("high");
  });

  it("computes the median offset under mixed-jitter samples", () => {
    const est = createClockOffsetEstimator({ bootstrapSamples: 5 });
    // Three "typical" samples at +100, +120, +110.
    est.pushSample({ emittedAt: 1_100, receivedAt: 1_000 });
    est.pushSample({ emittedAt: 2_120, receivedAt: 2_000 });
    est.pushSample({ emittedAt: 3_110, receivedAt: 3_000 });
    // Median of [100, 120, 110] = 110.
    expect(est.getOffsetMs()).toBe(110);
  });

  it("rejects outliers beyond the configured threshold (post-bootstrap)", () => {
    const est = createClockOffsetEstimator({
      bootstrapSamples: 3,
      outlierThresholdMs: 500,
    });
    // Bootstrap with three consistent samples around +100ms.
    est.pushSample({ emittedAt: 1_100, receivedAt: 1_000 });
    est.pushSample({ emittedAt: 2_100, receivedAt: 2_000 });
    est.pushSample({ emittedAt: 3_100, receivedAt: 3_000 });
    // Now a wild outlier (+10s) should be rejected — it would
    // otherwise snap the median and produce an unsafe viewer clock.
    est.pushSample({ emittedAt: 14_000, receivedAt: 4_000 });
    expect(est.getSampleCount()).toBe(3);
    expect(est.getOffsetMs()).toBe(100);
  });

  it("accepts outliers during bootstrap so the estimator can find its initial value", () => {
    const est = createClockOffsetEstimator({
      bootstrapSamples: 3,
      outlierThresholdMs: 500,
    });
    // First sample is "wild" by post-bootstrap standards but still
    // accepted — we need some data to define the median against.
    est.pushSample({ emittedAt: 11_000, receivedAt: 1_000 });
    est.pushSample({ emittedAt: 12_000, receivedAt: 2_000 });
    expect(est.getSampleCount()).toBe(2);
    expect(est.getOffsetMs()).toBe(10_000);
  });

  it("bounds the window at maxSamples, dropping the oldest sample", () => {
    const est = createClockOffsetEstimator({
      maxSamples: 3,
      bootstrapSamples: 2,
      outlierThresholdMs: 1_000_000,
    });
    est.pushSample({ emittedAt: 100, receivedAt: 0 });
    est.pushSample({ emittedAt: 200, receivedAt: 0 });
    est.pushSample({ emittedAt: 300, receivedAt: 0 });
    est.pushSample({ emittedAt: 400, receivedAt: 0 });
    // Window is now [200, 300, 400] — the 100 sample was dropped.
    expect(est.getSampleCount()).toBe(3);
    expect(est.getOffsetMs()).toBe(300);
  });

  it("reset() clears the window and drops confidence to low", () => {
    const est = createClockOffsetEstimator();
    for (let i = 0; i < 15; i += 1) {
      est.pushSample({ emittedAt: 1_000 + i, receivedAt: 1_000 });
    }
    expect(est.getConfidence()).toBe("high");
    est.reset();
    expect(est.getSampleCount()).toBe(0);
    expect(est.getOffsetMs()).toBe(0);
    expect(est.getConfidence()).toBe("low");
  });

  it("handles client-ahead skew symmetrically with server-ahead skew", () => {
    const clientAhead = createClockOffsetEstimator();
    const serverAhead = createClockOffsetEstimator();
    for (let i = 0; i < 10; i += 1) {
      clientAhead.pushSample({ emittedAt: 1_000 + i, receivedAt: 1_500 + i });
      serverAhead.pushSample({ emittedAt: 1_500 + i, receivedAt: 1_000 + i });
    }
    expect(clientAhead.getOffsetMs()).toBe(-500);
    expect(serverAhead.getOffsetMs()).toBe(500);
  });
});
