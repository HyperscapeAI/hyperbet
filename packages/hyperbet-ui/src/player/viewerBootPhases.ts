export type ViewerBootPhase =
  | "connecting"
  | "initializing"
  | "buffering_media"
  | "finalizing"
  | "reconnecting"
  | "error";

export type ViewerLoaderState = {
  visible: boolean;
  phase: ViewerBootPhase;
  progress: number;
  stageLabel: string;
  overlayMessage: string | null;
};

const DEFAULT_PROGRESS_BY_PHASE: Record<ViewerBootPhase, number> = {
  connecting: 3,
  initializing: 20,
  buffering_media: 55,
  finalizing: 92,
  reconnecting: 55,
  error: 55,
};

const DEFAULT_STAGE_LABEL_BY_PHASE: Record<ViewerBootPhase, string> = {
  connecting: "Connecting to live stream...",
  initializing: "Initializing stream session...",
  buffering_media: "Your playback is catching up...",
  finalizing: "Your playback is catching up...",
  reconnecting: "Your playback is catching up...",
  error: "Your playback is catching up...",
};

const DEFAULT_OVERLAY_BY_PHASE: Partial<Record<ViewerBootPhase, string>> = {
  reconnecting: "Reconnecting to the live stream.",
  error: "Live stream unavailable.",
};

export function createInitialViewerLoaderState(): ViewerLoaderState {
  return {
    visible: true,
    phase: "connecting",
    progress: DEFAULT_PROGRESS_BY_PHASE.connecting,
    stageLabel: DEFAULT_STAGE_LABEL_BY_PHASE.connecting,
    overlayMessage: null,
  };
}

export function resolveViewerBootProgress(
  phase: ViewerBootPhase,
  previousProgress: number,
): number {
  if (phase === "reconnecting" || phase === "error") {
    return previousProgress;
  }
  return DEFAULT_PROGRESS_BY_PHASE[phase];
}

export function resolveViewerBootStageLabel(
  phase: ViewerBootPhase,
  previousLabel: string,
): string {
  if (phase === "reconnecting" || phase === "error") {
    return previousLabel;
  }
  return DEFAULT_STAGE_LABEL_BY_PHASE[phase];
}

export function advanceViewerLoaderState(
  current: ViewerLoaderState,
  phase: ViewerBootPhase,
  options: {
    overlayMessage?: string | null;
    stageLabel?: string | null;
    visible?: boolean;
  } = {},
): ViewerLoaderState {
  const progress = resolveViewerBootProgress(phase, current.progress);
  const stageLabel =
    typeof options.stageLabel === "string" && options.stageLabel.trim().length > 0
      ? options.stageLabel.trim()
      : resolveViewerBootStageLabel(phase, current.stageLabel);
  const overlayMessage =
    options.overlayMessage === undefined
      ? DEFAULT_OVERLAY_BY_PHASE[phase] ?? null
      : options.overlayMessage;

  return {
    visible: options.visible ?? true,
    phase,
    progress,
    stageLabel,
    overlayMessage,
  };
}

export function hideViewerLoader(
  current: ViewerLoaderState,
): ViewerLoaderState {
  return {
    ...current,
    visible: false,
    overlayMessage: null,
  };
}
