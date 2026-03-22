import type { PredictionMarketSyncStatusResponse } from "@hyperbet/ui/lib/predictionMarkets";

export type StreamSyncUiState = "hidden" | "refreshing" | "degraded" | "drift";

export type StreamSyncUiSnapshot = {
  state: StreamSyncUiState;
  driftMismatchCount: number;
};

export type StreamSyncUiInput = {
  marketAligned: boolean;
  syncStatus: PredictionMarketSyncStatusResponse | null;
  rendererReady: boolean | null;
  streamSurfaceReady: boolean;
  streamSurfaceUnavailable: boolean;
  marketOverviewErrorPresent: boolean;
};

type StreamSyncUiSignal = "hidden" | "refreshing" | "degraded" | "drift-candidate";

export const INITIAL_STREAM_SYNC_UI_SNAPSHOT: StreamSyncUiSnapshot = {
  state: "hidden",
  driftMismatchCount: 0,
};

function deriveStreamSyncUiSignal(input: StreamSyncUiInput): StreamSyncUiSignal {
  const sourceEventAgeMs = input.syncStatus?.sourceEventAgeMs ?? 0;
  const rendererHealthAgeMs = input.syncStatus?.rendererHealthAgeMs ?? 0;
  const replayMode = input.syncStatus?.replayMode ?? null;
  const degradedReason = input.syncStatus?.degradedReason ?? null;
  const rendererOnlyStale =
    input.streamSurfaceReady &&
    !input.streamSurfaceUnavailable &&
    input.rendererReady === false &&
    degradedReason === "renderer_health_stale" &&
    replayMode === "live" &&
    sourceEventAgeMs <= 5_000 &&
    rendererHealthAgeMs <= 5_000;

  if (!input.marketAligned) {
    return "drift-candidate";
  }

  if (rendererOnlyStale) {
    return "hidden";
  }

  if (
    input.rendererReady === false ||
    degradedReason ||
    sourceEventAgeMs > 15_000 ||
    rendererHealthAgeMs > 15_000
  ) {
    return "degraded";
  }

  if (
    input.streamSurfaceUnavailable ||
    input.marketOverviewErrorPresent ||
    replayMode !== "live" ||
    sourceEventAgeMs > 5_000 ||
    rendererHealthAgeMs > 5_000
  ) {
    return "refreshing";
  }

  return "hidden";
}

export function advanceStreamSyncUiState(
  previous: StreamSyncUiSnapshot,
  input: StreamSyncUiInput,
): StreamSyncUiSnapshot {
  const signal = deriveStreamSyncUiSignal(input);

  if (signal !== "drift-candidate") {
    return {
      state: signal,
      driftMismatchCount: 0,
    };
  }

  const driftMismatchCount = previous.driftMismatchCount + 1;
  return {
    state: driftMismatchCount >= 2 ? "drift" : "refreshing",
    driftMismatchCount,
  };
}
