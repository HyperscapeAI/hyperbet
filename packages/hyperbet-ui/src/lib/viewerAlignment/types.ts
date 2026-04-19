/**
 * Shared types for the viewer-clock alignment layer.
 *
 * The alignment layer is a pure, inert library in this commit (C3a) —
 * it has no app wiring, no side effects, and is gated behind the
 * `VITE_ENABLE_VIEWER_ALIGNED_BET_STATE` flag in the UI once C3c lands
 * and C4 wires it. See `docs/frontier_duel_bet_stream_sync_prd_sow.md`
 * for the cross-rail architecture.
 *
 * Key terminology used throughout:
 *   - wallNowMs   — raw client `Date.now()` sample
 *   - serverNowMs — wallNowMs + estimatedServerOffsetMs (compensates
 *                   for client/server clock skew)
 *   - sourceNowMs — serverNowMs - resolvedViewerLatencyMs (the server
 *                   time the currently-rendered video frame was
 *                   captured at)
 * The selector in C3c keys snapshot history off `sourceNowMs`;
 * staleness budgets key off `serverNowMs`.
 */

/**
 * Qualitative confidence in the current viewer clock. Trade-affecting
 * display state should only be enabled at `high` (and in some cases
 * `medium` for non-irreversible affordances).
 */
export type ViewerClockConfidence = "high" | "medium" | "low";

/**
 * Origin of the latency value used to derive `sourceNowMs` from
 * `serverNowMs`. Order roughly reflects decreasing trustworthiness.
 */
export type ViewerClockLatencySource =
  /** Taken from fresh `HLS_PLAYER_STATUS.liveEdgeLatencyMs` telemetry. */
  | "player-live-edge"
  /**
   * Taken from fresh `HLS_PLAYER_STATUS.presentationDelayMs` — the
   * player's own best-effort estimate, used when `liveEdgeLatencyMs`
   * is not yet reported (e.g. pre-first-buffered-fragment).
   */
  | "player-presentation-delay"
  /**
   * Taken from the canonical session's advertised
   * `presentationDelayMs` (server-side configured latency target).
   * Used only during pre-telemetry bootstrap per PRD decision 2;
   * confidence stays `low` until real player telemetry lands.
   */
  | "session-presentation-delay"
  /** No latency source available — cannot derive `sourceNowMs`. */
  | "none";

export interface ViewerClock {
  /** Raw `Date.now()` sample at construction. */
  wallNowMs: number;
  /** `wallNowMs + estimatedServerOffsetMs`. */
  serverNowMs: number;
  /**
   * `serverNowMs - latencyMs`, or — when `frozen` — the source-time
   * corresponding to the most recent moment the player's media clock
   * advanced. The selector MUST NOT advance display state faster than
   * this value.
   */
  sourceNowMs: number;
  /** Viewer-side playback latency in ms (≥ 0). */
  latencyMs: number;
  /** Which input we used to compute `latencyMs`. */
  latencySource: ViewerClockLatencySource;
  /**
   * Age of the `playerStatus` telemetry input in ms (null if we never
   * received one). Useful for diagnostics and max-age gating.
   */
  telemetryAgeMs: number | null;
  /** Current best-estimate offset `serverNow - clientNow`. */
  estimatedServerOffsetMs: number;
  /**
   * True when the media clock has stopped advancing while the wall
   * clock continued. When frozen, `sourceNowMs` is pinned and the
   * selector should stop advancing open/locked/phase transitions.
   */
  frozen: boolean;
  /** Aggregate confidence in this clock value. */
  confidence: ViewerClockConfidence;
}

/**
 * Snapshot of player telemetry forwarded from `HLS_PLAYER_STATUS`.
 * Fields are optional because the iframe emits a superset and we
 * consume a narrow subset; missing fields must not throw.
 */
export interface StreamPlayerTelemetrySnapshot {
  liveEdgeLatencyMs?: number | null;
  presentationDelayMs?: number | null;
  syncState?: string | null;
  firstFrameAt?: number | null;
  currentTime?: number | null;
  playbackStarted?: boolean | null;
}

/**
 * All inputs required to compute a `ViewerClock`. Pure — the caller is
 * responsible for threading `nowMs` and the estimator outputs in.
 */
export interface ViewerClockInputs {
  /** Current wall-clock sample (typically `Date.now()`). */
  nowMs: number;
  /** Current offset estimate (`serverNow - clientNow`). 0 if unknown. */
  estimatedServerOffsetMs: number;
  /** Most recent player telemetry, or null if none received yet. */
  playerStatus: StreamPlayerTelemetrySnapshot | null;
  /**
   * Wall-clock time at which `playerStatus` was received. Needed to
   * compute staleness; null only if no telemetry has been received.
   */
  playerStatusReceivedAtMs: number | null;
  /**
   * Canonical session's advertised `presentationDelayMs`, used only
   * as a pre-telemetry bootstrap fallback. `null` means we don't have
   * one (in which case the clock reports `latencySource: "none"` when
   * player telemetry is also absent).
   */
  sessionPresentationDelayMs: number | null;
  /**
   * Wall-clock time at which the player's `currentTime` last
   * increased (i.e. the media clock visibly advanced). Used to detect
   * the freeze condition.
   */
  lastAdvancingPlayerStatusAtMs: number | null;
}

/** A single offset sample: we received `emittedAt` from the server at `receivedAt`. */
export interface ClockOffsetSample {
  emittedAt: number;
  receivedAt: number;
}

/** Qualitative confidence from the offset estimator. */
export type ClockOffsetConfidence = "high" | "medium" | "low";

export interface ClockOffsetEstimator {
  /** Push a new sample into the rolling window. Outliers are rejected. */
  pushSample(sample: ClockOffsetSample): void;
  /**
   * Current offset estimate (`serverNow - clientNow`). Returns 0 when
   * no samples have been pushed yet — callers should treat that as a
   * `"low"`-confidence default.
   */
  getOffsetMs(): number;
  /** Number of samples currently held in the rolling window. */
  getSampleCount(): number;
  /** Qualitative confidence — scales with sample count. */
  getConfidence(): ClockOffsetConfidence;
  /** Clear all samples (e.g. when re-subscribing after a reconnect). */
  reset(): void;
}
