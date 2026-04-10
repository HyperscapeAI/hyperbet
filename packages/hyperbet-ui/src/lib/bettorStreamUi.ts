import type {
  CanonicalStreamHealth,
  CanonicalStreamSession,
  SourceRuntimeInfo,
  StreamPublicReadiness,
} from "../spectator/types";

export type PlayerSyncTelemetry = {
  ready: boolean;
  status: string | null;
  playbackStarted: boolean;
  syncDeltaMs: number | null;
  syncState: "starting" | "aligned" | "buffering" | "out_of_sync" | "error";
};

export type BettorStreamUiState =
  | "connecting"
  | "recovering"
  | "aligned"
  | "drifted"
  | "degraded";

type BettorStreamUiInput = {
  session: CanonicalStreamSession | null;
  playerStatus: PlayerSyncTelemetry | null;
  authorityHealth?: CanonicalStreamHealth | null;
  publicReadiness?: StreamPublicReadiness | null;
  sourceRuntime?: SourceRuntimeInfo | null;
};

function startsWithError(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "error" || normalized.startsWith("error:");
}

export function deriveBettorStreamUiState(
  input: BettorStreamUiInput,
): BettorStreamUiState {
  const authorityHealth =
    input.authorityHealth ?? input.session?.authorityHealth ?? null;
  const publicReadiness =
    input.publicReadiness ??
    input.session?.publicReadiness ??
    input.session?.channel?.publicReadiness ??
    null;
  const sourceRuntime =
    input.sourceRuntime ??
    input.session?.sourceRuntime ??
    input.session?.status.sourceRuntime ??
    null;
  const rendererHealth =
    input.session?.rendererHealth ?? input.session?.status.renderer ?? null;
  const playerStatus = input.playerStatus;

  if (!input.session) {
    return "connecting";
  }
  if (authorityHealth?.ready === false) {
    return "connecting";
  }
  if (sourceRuntime?.ready === false) {
    return playerStatus?.playbackStarted ? "degraded" : "connecting";
  }
  if (publicReadiness?.ready === false) {
    return playerStatus?.playbackStarted ? "degraded" : "connecting";
  }
  if (rendererHealth?.ready === false) {
    return playerStatus?.playbackStarted ? "degraded" : "connecting";
  }
  if (!playerStatus) {
    return "connecting";
  }
  if (
    playerStatus.syncState === "error" ||
    startsWithError(playerStatus.status)
  ) {
    return "degraded";
  }
  if (playerStatus.syncState === "out_of_sync") {
    return "drifted";
  }
  if (!playerStatus.playbackStarted) {
    return "connecting";
  }
  if (playerStatus.syncState === "aligned" && playerStatus.ready) {
    return "aligned";
  }
  return "recovering";
}

export function isBettorStreamLiveSynced(
  input: BettorStreamUiInput,
): boolean {
  return deriveBettorStreamUiState(input) === "aligned";
}
