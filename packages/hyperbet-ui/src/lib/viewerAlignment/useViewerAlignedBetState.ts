import { useEffect, useMemo, useRef, useState } from "react";

import type { StreamPlayerStatus } from "../../components/StreamPlayer";
import type { DivergenceEvent } from "./divergenceLog";
import type { StreamPlayerTelemetrySnapshot } from "./types";
import {
  useViewerAlignedState,
  type UseViewerAlignedStateInputs,
  type ViewerAlignedState,
} from "./useViewerAlignedState";

/**
 * App-shell adapter for `useViewerAlignedState`. Centralises the work
 * that every App.tsx would otherwise duplicate:
 *
 *   1. Reads the dark-flag `VITE_ENABLE_VIEWER_ALIGNED_BET_STATE` from
 *      the Vite client env (`"true"` enables, anything else leaves the
 *      inner hook in passthrough mode).
 *   2. Maps `StreamPlayerStatus` (the iframe's status shape) onto the
 *      narrower `StreamPlayerTelemetrySnapshot` the clock expects.
 *   3. Tracks two wall-clock stamps derived from player telemetry:
 *        - `playerStatusReceivedAtMs`: wall-clock at the most recent
 *          telemetry we observed (drives telemetry staleness).
 *        - `lastAdvancingPlayerStatusAtMs`: wall-clock at the most
 *          recent telemetry that showed evidence the media clock moved
 *          forward. We derive this from the iframe's
 *          `lastPlaybackProgressAt` stamp, which only advances when
 *          `video.currentTime` itself advances. That avoids false
 *          "freeze" detection when HLS continues buffering fragments
 *          while the visible media clock is still healthy.
 *          This stamp lets
 *          `resolveViewerClock` pin `sourceNowMs` at the freeze edge
 *          per PRD decision 2.
 *
 * Kept deliberately thin: the callers supply the rail payloads and
 * optionally an `onDivergence` sink; everything else is derived.
 * Divergence emission is shadow-only: once the aligned UI is enabled,
 * the adapter suppresses the sink so post-cutover logs do not compare
 * against a pre-alignment phase source and produce false positives.
 */

export interface UseViewerAlignedBetStateInputs<S, M, D>
  extends Omit<
    UseViewerAlignedStateInputs<S, M, D>,
    | "enabled"
    | "playerStatus"
    | "playerStatusReceivedAtMs"
    | "lastAdvancingPlayerStatusAtMs"
  > {
  /**
   * Override the env-derived flag. Tests and Storybook pass this
   * explicitly; app shells leave it undefined so the env flag rules.
   */
  enabledOverride?: boolean;
  /** Latest `StreamPlayerStatus` from the iframe (via `onStatusChange`). */
  streamPlayerStatus: StreamPlayerStatus | null;
}

function readViewerAlignmentEnvFlag(): boolean {
  try {
    const env = (
      import.meta as unknown as {
        env?: Record<string, string | undefined>;
      }
    ).env;
    return env?.VITE_ENABLE_VIEWER_ALIGNED_BET_STATE === "true";
  } catch {
    return false;
  }
}

export function useViewerAlignedBetState<S, M, D>(
  inputs: UseViewerAlignedBetStateInputs<S, M, D>,
): ViewerAlignedState<S, M, D> {
  const { enabledOverride, streamPlayerStatus, ...rest } = inputs;
  const enabled = enabledOverride ?? readViewerAlignmentEnvFlag();
  const shadowDivergenceSink =
    enabled ? undefined : rest.onDivergence;
  const shadowEnabled = enabled || typeof shadowDivergenceSink === "function";

  const [playerStatusReceivedAtMs, setPlayerStatusReceivedAtMs] = useState<
    number | null
  >(null);
  const [lastAdvancingPlayerStatusAtMs, setLastAdvancingPlayerStatusAtMs] =
    useState<number | null>(null);
  const previousPlaybackProgressAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shadowEnabled) return;
    if (!streamPlayerStatus) return;
    const now = Date.now();
    setPlayerStatusReceivedAtMs(now);
    const nextPlaybackProgress =
      streamPlayerStatus.lastPlaybackProgressAt ??
      streamPlayerStatus.lastBufferedFragmentAt ??
      null;
    const prevPlaybackProgress = previousPlaybackProgressAtRef.current;
    if (
      nextPlaybackProgress != null &&
      (prevPlaybackProgress == null ||
        nextPlaybackProgress > prevPlaybackProgress)
    ) {
      setLastAdvancingPlayerStatusAtMs(now);
    }
    previousPlaybackProgressAtRef.current = nextPlaybackProgress;
  }, [shadowEnabled, streamPlayerStatus]);

  const telemetry = useMemo<StreamPlayerTelemetrySnapshot | null>(() => {
    if (!streamPlayerStatus) return null;
    return {
      liveEdgeLatencyMs: streamPlayerStatus.liveEdgeLatencyMs,
      presentationDelayMs: streamPlayerStatus.presentationDelayMs,
      syncState: streamPlayerStatus.syncState ?? null,
      firstFrameAt: streamPlayerStatus.firstFrameAt,
      playbackStarted: streamPlayerStatus.playbackStarted,
      lastPlaybackProgressAt: streamPlayerStatus.lastPlaybackProgressAt,
    };
  }, [streamPlayerStatus]);

  return useViewerAlignedState<S, M, D>({
    ...rest,
    enabled,
    onDivergence: shadowDivergenceSink,
    playerStatus: telemetry,
    playerStatusReceivedAtMs,
    lastAdvancingPlayerStatusAtMs,
  });
}

/**
 * Default console sink for divergence events. The sink serialises to
 * a stable single-line JSON so it's easy to grep in browser devtools
 * and forward to remote shippers later without a schema change.
 *
 * Emits via `console.info("[viewer-align]", ...)` so it doesn't
 * trigger error-count telemetry or alert feeds — shadow logs only,
 * per PRD decision 3.
 */
export function logViewerAlignmentDivergence(event: DivergenceEvent): void {
  if (typeof console === "undefined") return;
  try {
    // eslint-disable-next-line no-console
    console.info("[viewer-align]", JSON.stringify(event));
  } catch {
    // Best-effort — refuse to throw from a shadow-log sink.
  }
}
