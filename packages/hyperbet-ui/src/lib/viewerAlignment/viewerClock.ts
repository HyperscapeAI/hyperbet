import type {
  StreamPlayerTelemetrySnapshot,
  ViewerClock,
  ViewerClockConfidence,
  ViewerClockInputs,
  ViewerClockLatencySource,
} from "./types";

/**
 * Pure viewer-clock resolver.
 *
 * Computes `ViewerClock` from a set of scalar inputs — no hooks, no
 * timers, no side effects. Call with fresh `nowMs` each time a
 * selector re-runs. See PRD decisions:
 *
 *   - Latency source order (PRD §P0 "Viewer clock"):
 *       fresh player live-edge > player presentation delay > session
 *       presentation delay > none
 *   - Pre-telemetry fallback (decision 2): `session-presentation-delay`
 *     may drive phase/copy with `confidence: "low"`; the caller is
 *     responsible for gating trade submission off confidence, not off
 *     this module.
 *   - Freeze behavior (PRD §P0 "Viewer clock" + decision constraint):
 *     when media time stops advancing while wall time advances,
 *     `sourceNowMs` is pinned to the last-advancing moment and
 *     confidence drops to `"low"`. This is what stops the UI from
 *     marching open/locked/phase transitions forward while playback
 *     is stalled.
 */

/**
 * Max age of the last `playerStatus` sample before we treat it as
 * stale. If staleness > this, confidence is forced to `"low"` and we
 * refuse to trust `liveEdgeLatencyMs` as authoritative.
 */
export const STALE_PLAYER_TELEMETRY_MS = 3_000;

/**
 * Max time the media clock may "not advance" before we declare the
 * viewer clock frozen. Small enough to catch real stalls, big enough
 * to absorb the gap between normal `timeupdate` events.
 */
export const PLAYER_FREEZE_THRESHOLD_MS = 2_000;

/** Set of `syncState` values that indicate the player is degraded. */
const UNHEALTHY_SYNC_STATES: ReadonlySet<string> = new Set([
  "buffering",
  "out_of_sync",
  "error",
]);

/**
 * Demote a confidence value by one tier (`high` → `medium` → `low`).
 * Used when a secondary signal (stale telemetry, unhealthy sync) is
 * observed.
 */
function demote(confidence: ViewerClockConfidence): ViewerClockConfidence {
  if (confidence === "high") return "medium";
  return "low";
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Resolve the latency value + source from available telemetry. Returns
 * null-ish only when nothing is available.
 */
function resolveLatency(
  playerStatus: StreamPlayerTelemetrySnapshot | null,
  telemetryFresh: boolean,
  sessionPresentationDelayMs: number | null,
): { latencyMs: number; latencySource: ViewerClockLatencySource } {
  if (playerStatus && telemetryFresh) {
    if (isFinitePositive(playerStatus.liveEdgeLatencyMs)) {
      return {
        latencyMs: playerStatus.liveEdgeLatencyMs,
        latencySource: "player-live-edge",
      };
    }
    if (isFinitePositive(playerStatus.presentationDelayMs)) {
      return {
        latencyMs: playerStatus.presentationDelayMs,
        latencySource: "player-presentation-delay",
      };
    }
  }

  if (isFinitePositive(sessionPresentationDelayMs)) {
    return {
      latencyMs: sessionPresentationDelayMs,
      latencySource: "session-presentation-delay",
    };
  }

  return { latencyMs: 0, latencySource: "none" };
}

/**
 * Seed confidence for a given latency source, before degradations.
 */
function initialConfidence(
  latencySource: ViewerClockLatencySource,
): ViewerClockConfidence {
  switch (latencySource) {
    case "player-live-edge":
      return "high";
    case "player-presentation-delay":
      return "medium";
    case "session-presentation-delay":
      return "low";
    case "none":
      return "low";
  }
}

export function resolveViewerClock(inputs: ViewerClockInputs): ViewerClock {
  const {
    nowMs,
    estimatedServerOffsetMs,
    playerStatus,
    playerStatusReceivedAtMs,
    sessionPresentationDelayMs,
    lastAdvancingPlayerStatusAtMs,
  } = inputs;

  const wallNowMs = nowMs;
  const serverNowMs = wallNowMs + estimatedServerOffsetMs;

  // ── Telemetry staleness ─────────────────────────────────────────
  const telemetryAgeMs =
    playerStatusReceivedAtMs != null
      ? Math.max(0, wallNowMs - playerStatusReceivedAtMs)
      : null;
  const telemetryFresh =
    telemetryAgeMs != null && telemetryAgeMs <= STALE_PLAYER_TELEMETRY_MS;

  // ── Latency + initial confidence ────────────────────────────────
  const { latencyMs, latencySource } = resolveLatency(
    playerStatus,
    telemetryFresh,
    sessionPresentationDelayMs,
  );
  let confidence: ViewerClockConfidence = initialConfidence(latencySource);

  // ── Staleness degradation ───────────────────────────────────────
  // When telemetry is stale AND we're using a player-based source,
  // drop confidence — the latency value may no longer reflect the
  // viewer's real buffer depth. Session-delay fallback already starts
  // at "low" so no further degradation is required there.
  if (
    !telemetryFresh &&
    (latencySource === "player-live-edge" ||
      latencySource === "player-presentation-delay")
  ) {
    confidence = "low";
  }

  // ── Unhealthy sync state degradation ────────────────────────────
  if (
    playerStatus?.syncState != null &&
    UNHEALTHY_SYNC_STATES.has(playerStatus.syncState)
  ) {
    confidence = demote(confidence);
  }

  // ── Freeze detection ────────────────────────────────────────────
  // A freeze is: media clock stopped advancing for > threshold while
  // wall clock still advances AND playback was previously started.
  // Before first-play we don't freeze (there's nothing to freeze yet —
  // that's a bootstrap/pre-telemetry state, handled via confidence).
  let frozen = false;
  if (
    lastAdvancingPlayerStatusAtMs != null &&
    playerStatus?.playbackStarted === true &&
    wallNowMs - lastAdvancingPlayerStatusAtMs > PLAYER_FREEZE_THRESHOLD_MS
  ) {
    frozen = true;
    confidence = "low";
  }

  // ── sourceNowMs derivation ──────────────────────────────────────
  // When frozen, pin `sourceNowMs` to the server time corresponding
  // to the wall-clock moment the media clock last advanced. This
  // stops the selector from advancing open/locked/phase transitions
  // while the viewer's video is stuck. When not frozen, the normal
  // derivation is serverNow - latency.
  const sourceNowMs =
    frozen && lastAdvancingPlayerStatusAtMs != null
      ? lastAdvancingPlayerStatusAtMs + estimatedServerOffsetMs - latencyMs
      : serverNowMs - latencyMs;

  return {
    wallNowMs,
    serverNowMs,
    sourceNowMs,
    latencyMs,
    latencySource,
    telemetryAgeMs,
    estimatedServerOffsetMs,
    frozen,
    confidence,
  };
}
