import type {
  ClockOffsetConfidence,
  ClockOffsetEstimator,
  ClockOffsetSample,
} from "./types";

/**
 * Rolling-median SSE-derived server/client clock offset estimator.
 *
 * Algorithm (per PRD decision: "SSE-derived rolling estimator from
 * session frames"):
 *   - For each incoming frame, record `emittedAt - receivedAt` as a
 *     sample. Positive means the server clock is ahead of the client
 *     clock (the common case when client is on a UTC-agreeing device
 *     but has small skew).
 *   - Keep the last `maxSamples` samples in a bounded window.
 *   - Return the median as the offset estimate. Median is robust to
 *     network-jitter outliers (a single slow SSE frame shifts one
 *     sample but does not snap the estimate).
 *   - On each `pushSample`, reject samples whose magnitude differs
 *     from the current median by more than `outlierThresholdMs`; the
 *     first `bootstrapSamples` samples are always accepted so the
 *     estimator can find its initial value.
 *
 * Confidence tiers are coarse:
 *   - `"high"`   ≥ 10 samples
 *   - `"medium"` 3–9 samples
 *   - `"low"`    ≤ 2 samples (including zero, which returns offset 0)
 *
 * The estimator is intentionally decoupled from any SSE transport —
 * the caller (e.g. `useCanonicalStreamSession` in C3b) stamps
 * `receivedAt` at wire-receipt and feeds samples in.
 */

export interface ClockOffsetEstimatorOptions {
  /** Max samples held in the rolling window. Default 30. */
  maxSamples?: number;
  /**
   * Max distance (absolute ms) from the current median at which a
   * sample is still accepted. Default 10_000. Samples outside this
   * band are dropped (protects against a single transient slow frame
   * snapping the offset).
   */
  outlierThresholdMs?: number;
  /**
   * Number of samples at the start during which outlier rejection is
   * disabled — we need some data to define "the median" before we
   * can reject deviations from it. Default 3.
   */
  bootstrapSamples?: number;
}

const DEFAULT_MAX_SAMPLES = 30;
const DEFAULT_OUTLIER_THRESHOLD_MS = 10_000;
const DEFAULT_BOOTSTRAP_SAMPLES = 3;
const HIGH_CONFIDENCE_SAMPLES = 10;
const MEDIUM_CONFIDENCE_SAMPLES = 3;

/**
 * Robust median over a numeric array. Returns 0 for empty input.
 * Unlike `sort().then pick middle`, this doesn't mutate the input.
 */
export function medianOfOffsets(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  // Average of the two middle values — safe under mixed sign offsets.
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createClockOffsetEstimator(
  options: ClockOffsetEstimatorOptions = {},
): ClockOffsetEstimator {
  const maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  const outlierThresholdMs = Math.max(
    0,
    options.outlierThresholdMs ?? DEFAULT_OUTLIER_THRESHOLD_MS,
  );
  const bootstrapSamples = Math.max(
    1,
    options.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES,
  );

  const offsets: number[] = [];

  function currentMedian(): number {
    return medianOfOffsets(offsets);
  }

  function pushSample(sample: ClockOffsetSample): void {
    if (
      !Number.isFinite(sample.emittedAt) ||
      !Number.isFinite(sample.receivedAt)
    ) {
      return;
    }
    const offset = sample.emittedAt - sample.receivedAt;

    // Outlier rejection is skipped for the first `bootstrapSamples`
    // pushes — we need some data to define "the median" before we
    // can reject deviations from it.
    if (offsets.length >= bootstrapSamples) {
      const median = currentMedian();
      if (Math.abs(offset - median) > outlierThresholdMs) {
        return;
      }
    }

    offsets.push(offset);
    if (offsets.length > maxSamples) {
      // Bounded ring — drop oldest. Keeps the estimator responsive to
      // slow clock drift over time.
      offsets.shift();
    }
  }

  function getOffsetMs(): number {
    return currentMedian();
  }

  function getSampleCount(): number {
    return offsets.length;
  }

  function getConfidence(): ClockOffsetConfidence {
    if (offsets.length >= HIGH_CONFIDENCE_SAMPLES) return "high";
    if (offsets.length >= MEDIUM_CONFIDENCE_SAMPLES) return "medium";
    return "low";
  }

  function reset(): void {
    offsets.length = 0;
  }

  return {
    pushSample,
    getOffsetMs,
    getSampleCount,
    getConfidence,
    reset,
  };
}
