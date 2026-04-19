/**
 * Viewer-clock alignment layer (C3a clock core + C3b rail buffers).
 *
 * This module is intentionally inert in the current commit — nothing
 * in the app consumes it yet. The aligned selector (C3c) extends
 * this surface; the app-side cutover happens in C4 behind
 * `VITE_ENABLE_VIEWER_ALIGNED_BET_STATE`.
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
export {
  createSnapshotBuffer,
  type SnapshotBuffer,
  type SnapshotBufferEntry,
  type SnapshotBufferOptions,
} from "./snapshotBuffer";
export {
  MARKET_MAX_AGE_MS,
  DUEL_CONTEXT_MAX_AGE_MS,
  isStaleByServerEmission,
  ageByServerEmission,
} from "./maxAge";
export {
  createSessionSnapshotBuffer,
  createMarketSnapshotBuffer,
  createDuelContextSnapshotBuffer,
  extractSessionSourceEmittedAt,
  extractMarketSourceEmittedAt,
  extractMarketServerEmittedAt,
  extractDuelContextSourceEmittedAt,
  extractDuelContextServerEmittedAt,
  type SessionSnapshotBuffer,
  type MarketSnapshotBuffer,
  type DuelContextSnapshotBuffer,
} from "./railBuffers";
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
