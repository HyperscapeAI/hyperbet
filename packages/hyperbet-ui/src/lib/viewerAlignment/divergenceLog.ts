import type {
  ViewerClock,
  ViewerClockConfidence,
  ViewerClockLatencySource,
} from "./types";
import type { RailSelection, TradeGate, TradeGateReason } from "./selector";

/**
 * Pure structured event-builder for the viewer-aligned shadow-log
 * stream. Per PRD decision 3 "thresholded divergence plus sparse
 * matched-frame sampling":
 *   Emit when:
 *     - aligned phase/state differs from current displayed
 *     - |skewMs| > 1000
 *     - selected market/context snapshot exceeds its max-age budget
 *     - viewer clock enters/exits frozen state
 *   Plus 1-in-100 sampling of matched frames for baseline noise.
 *
 * This module is a transport-agnostic builder: it decides WHEN to
 * emit and BUILDS the event payload. The caller (the hook in C3c)
 * owns transport (console.info, analytics SDK, etc.).
 */

export type DivergenceReason =
  | "phase-mismatch"
  | "market-stale"
  | "duel-context-stale"
  | "skew-exceeds-budget"
  | "freeze-entered"
  | "freeze-exited"
  | "baseline-sample";

export interface DivergenceEvent {
  /** Wall-clock at emission (Date.now() at build time). */
  timestamp: number;
  /** Why this event was emitted. */
  reason: DivergenceReason;
  viewerClock: {
    wallNowMs: number;
    serverNowMs: number;
    sourceNowMs: number;
    latencyMs: number;
    latencySource: ViewerClockLatencySource;
    confidence: ViewerClockConfidence;
    frozen: boolean;
  };
  /** Clock skew in ms (|aligned - current|), null when no comparable. */
  skewMs: number | null;
  /** Age in ms of each selected rail snapshot. */
  selectedRailAges: {
    session: number | null;
    market: number | null;
    duelContext: number | null;
  };
  /** Rails whose selected snapshot exceeded its max-age budget. */
  staleRails: Array<"session" | "market" | "duelContext">;
  /** Trade-gate snapshot at emission time. */
  tradeGate: TradeGate;
  /** Phase the live bettor UI was about to display (if known). */
  currentDisplayPhase?: string | null;
  /** Phase the aligned selector would display (if known). */
  alignedDisplayPhase?: string | null;
}

/** Divergence threshold for the skew-exceeds-budget rule. */
export const DIVERGENCE_SKEW_THRESHOLD_MS = 1_000;

/** Baseline sample ratio — emit 1 in N matched frames (default 100). */
export const DIVERGENCE_BASELINE_SAMPLE_RATE = 100;

export interface DetectDivergenceInputs {
  clock: ViewerClock;
  previousFrozen: boolean;
  session: RailSelection<unknown>;
  market: RailSelection<unknown>;
  duelContext: RailSelection<unknown>;
  currentDisplayPhase: string | null;
  alignedDisplayPhase: string | null;
  tradeGate: TradeGate;
  /**
   * Monotonic counter incremented on every hook tick. Used only for
   * the 1-in-N baseline sample. Caller owns this counter.
   */
  emitCount: number;
  /** Override the 1-in-N sampling rate for tests. */
  baselineSampleRate?: number;
  /** Override the skew threshold for tests. */
  skewThresholdMs?: number;
}

/**
 * Returns a `DivergenceEvent` when the current tick should emit,
 * or null when nothing notable happened AND this tick isn't the
 * baseline-sample tick.
 */
export function detectDivergence(
  inputs: DetectDivergenceInputs,
): DivergenceEvent | null {
  const skewThreshold =
    inputs.skewThresholdMs ?? DIVERGENCE_SKEW_THRESHOLD_MS;
  const sampleRate =
    inputs.baselineSampleRate ?? DIVERGENCE_BASELINE_SAMPLE_RATE;

  const skewMs = computeSkew(
    inputs.currentDisplayPhase,
    inputs.alignedDisplayPhase,
    inputs.session,
    inputs.market,
  );
  const staleRails: Array<"session" | "market" | "duelContext"> = [];
  if (inputs.session.stale) staleRails.push("session");
  if (inputs.market.stale) staleRails.push("market");
  if (inputs.duelContext.stale) staleRails.push("duelContext");

  // Priority order mirrors the severity ranking in the PRD decision:
  // freeze transitions > phase mismatch > stale rails > skew > baseline.
  const reason = selectReason({
    previousFrozen: inputs.previousFrozen,
    clockFrozen: inputs.clock.frozen,
    currentDisplayPhase: inputs.currentDisplayPhase,
    alignedDisplayPhase: inputs.alignedDisplayPhase,
    marketStale: inputs.market.stale,
    duelContextStale: inputs.duelContext.stale,
    skewMs,
    skewThreshold,
    emitCount: inputs.emitCount,
    sampleRate,
  });

  if (!reason) return null;

  return buildEvent({
    reason,
    clock: inputs.clock,
    skewMs,
    session: inputs.session,
    market: inputs.market,
    duelContext: inputs.duelContext,
    staleRails,
    tradeGate: inputs.tradeGate,
    currentDisplayPhase: inputs.currentDisplayPhase,
    alignedDisplayPhase: inputs.alignedDisplayPhase,
  });
}

/**
 * Skew in ms between the display view the app is about to paint and
 * the aligned view. Reported only when both a current display phase
 * and an aligned phase exist; otherwise null.
 */
function computeSkew(
  currentPhase: string | null,
  alignedPhase: string | null,
  session: RailSelection<unknown>,
  market: RailSelection<unknown>,
): number | null {
  // When no phase comparison is available, fall back to the larger
  // absolute rail-age delta as a coarse skew proxy.
  if (currentPhase == null || alignedPhase == null) {
    if (session.ageMs != null && market.ageMs != null) {
      return Math.abs(session.ageMs - market.ageMs);
    }
    return null;
  }
  if (currentPhase === alignedPhase) return 0;
  // When phases differ, the exact numerical skew isn't knowable
  // without more context (we don't know when each phase would flip).
  // Use the session age as a proxy for "how far behind the video is
  // the display" — it's the rail that carries phase timing.
  if (session.ageMs != null) return session.ageMs;
  return null;
}

interface SelectReasonInputs {
  previousFrozen: boolean;
  clockFrozen: boolean;
  currentDisplayPhase: string | null;
  alignedDisplayPhase: string | null;
  marketStale: boolean;
  duelContextStale: boolean;
  skewMs: number | null;
  skewThreshold: number;
  emitCount: number;
  sampleRate: number;
}

function selectReason(inputs: SelectReasonInputs): DivergenceReason | null {
  // Freeze transitions take priority (operators want to see every
  // transition, not just the first emission in a frozen run).
  if (inputs.clockFrozen && !inputs.previousFrozen) return "freeze-entered";
  if (!inputs.clockFrozen && inputs.previousFrozen) return "freeze-exited";

  if (
    inputs.currentDisplayPhase != null &&
    inputs.alignedDisplayPhase != null &&
    inputs.currentDisplayPhase !== inputs.alignedDisplayPhase
  ) {
    return "phase-mismatch";
  }
  if (inputs.marketStale) return "market-stale";
  if (inputs.duelContextStale) return "duel-context-stale";
  if (inputs.skewMs != null && Math.abs(inputs.skewMs) > inputs.skewThreshold) {
    return "skew-exceeds-budget";
  }

  // 1-in-N baseline sample. Zero sampleRate disables baseline emission.
  if (
    inputs.sampleRate > 0 &&
    inputs.emitCount > 0 &&
    inputs.emitCount % inputs.sampleRate === 0
  ) {
    return "baseline-sample";
  }
  return null;
}

interface BuildEventInputs {
  reason: DivergenceReason;
  clock: ViewerClock;
  skewMs: number | null;
  session: RailSelection<unknown>;
  market: RailSelection<unknown>;
  duelContext: RailSelection<unknown>;
  staleRails: Array<"session" | "market" | "duelContext">;
  tradeGate: TradeGate;
  currentDisplayPhase: string | null;
  alignedDisplayPhase: string | null;
}

function buildEvent(inputs: BuildEventInputs): DivergenceEvent {
  return {
    timestamp: Date.now(),
    reason: inputs.reason,
    viewerClock: {
      wallNowMs: inputs.clock.wallNowMs,
      serverNowMs: inputs.clock.serverNowMs,
      sourceNowMs: inputs.clock.sourceNowMs,
      latencyMs: inputs.clock.latencyMs,
      latencySource: inputs.clock.latencySource,
      confidence: inputs.clock.confidence,
      frozen: inputs.clock.frozen,
    },
    skewMs: inputs.skewMs,
    selectedRailAges: {
      session: inputs.session.ageMs,
      market: inputs.market.ageMs,
      duelContext: inputs.duelContext.ageMs,
    },
    staleRails: inputs.staleRails,
    tradeGate: inputs.tradeGate,
    currentDisplayPhase: inputs.currentDisplayPhase,
    alignedDisplayPhase: inputs.alignedDisplayPhase,
  };
}

// Re-export types that appear in the DivergenceEvent surface so
// consumers can destructure them without importing from three places.
export type { TradeGate, TradeGateReason };
