/**
 * Viewer-clock alignment layer (C3a: clock core only).
 *
 * This module is intentionally inert in the current commit — nothing
 * in the app consumes it yet. Rail buffers (C3b) and the aligned
 * selector (C3c) extend this surface; the app-side cutover happens
 * in C4 behind `VITE_ENABLE_VIEWER_ALIGNED_BET_STATE`.
 *
 * See `docs/frontier_duel_bet_stream_sync_prd_sow.md` for the
 * full architectural description.
 */

export {
  createClockOffsetEstimator,
  medianOfOffsets,
  type ClockOffsetEstimatorOptions,
} from "./clockOffset";
export {
  resolveViewerClock,
  PLAYER_FREEZE_THRESHOLD_MS,
  STALE_PLAYER_TELEMETRY_MS,
} from "./viewerClock";
export type {
  ClockOffsetConfidence,
  ClockOffsetEstimator,
  ClockOffsetSample,
  StreamPlayerTelemetrySnapshot,
  ViewerClock,
  ViewerClockConfidence,
  ViewerClockInputs,
  ViewerClockLatencySource,
} from "./types";
