import { normalizePredictionMarketDuelKeyHex } from "@hyperbet/ui/lib/solanaPredictionMarkets";
import { isStreamingRendererHealthReady } from "@hyperbet/ui/spectator/useStreamingState";

import type { StreamingStateUpdate } from "./types";

export interface SpectatorPresentationInput {
  state: StreamingStateUpdate | null;
  streamConnected: boolean;
  nowMs: number;
  streamMaxAgeMs: number;
  uiSyncDelayMs: number;
}

export interface SpectatorPresentationState {
  hasFreshCycle: boolean;
  hasMatchup: boolean;
  activityLabel: "LIVE" | "CONNECTED" | "RECONNECTING" | "UNAVAILABLE";
}

interface SpectatorStatusCopyInput {
  phase: string | null | undefined;
  winnerName: string | null | undefined;
  hasFreshCycle: boolean;
  activityLabel: SpectatorPresentationState["activityLabel"];
}

interface StreamRecoveryHeadingInput {
  playbackReady: boolean;
  telemetryConnected: boolean;
  rendererReady: boolean;
  hasStreamState: boolean;
  presentationReady: boolean;
}

export function selectSpectatorPresentationUpdate(
  current: StreamingStateUpdate | null,
  lastMatch: StreamingStateUpdate | null,
  streamConnected: boolean,
): StreamingStateUpdate | null {
  if (
    streamConnected &&
    current?.cycle.phase === "IDLE" &&
    lastMatch?.cycle.phase === "RESOLUTION" &&
    lastMatch?.cycle.agent1 &&
    lastMatch.cycle.agent2
  ) {
    return lastMatch;
  }
  return current;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Selects the phase shown in the spectator rail.
 *
 * Market lifecycle state is intentionally excluded here. A market may remain
 * locked while live renderer authority is unavailable; presenting that stale
 * lifecycle as the stream phase would contradict the fail-closed recovery UI.
 */
export function selectSpectatorDisplayPhase(
  cyclePhase: string | null | undefined,
  hasFreshCycle: boolean,
): string {
  return hasFreshCycle && hasText(cyclePhase) ? cyclePhase : "UNAVAILABLE";
}

export function getSpectatorStatusCopy(
  input: SpectatorStatusCopyInput,
): string {
  if (!input.hasFreshCycle) {
    return input.activityLabel === "RECONNECTING"
      ? "Reconnecting to verified live arena telemetry."
      : "Waiting for verified live arena telemetry.";
  }

  switch (input.phase) {
    case "ANNOUNCEMENT":
      return "Matchup locked — fighters are preparing in the arena.";
    case "COUNTDOWN":
      return "Loadouts locked — the fight is about to begin.";
    case "FIGHTING":
      return "Round in progress — live combat telemetry is updating.";
    case "RESOLUTION":
      return input.winnerName
        ? `${input.winnerName} wins the round.`
        : "The round is complete.";
    default:
      return "Waiting for the next matchup.";
  }
}

export function getStreamRecoveryHeading(
  input: StreamRecoveryHeadingInput,
): string | null {
  if (!input.playbackReady) {
    return input.hasStreamState
      ? "Reconnecting to the live arena"
      : "Connecting to the live arena";
  }
  if (!input.telemetryConnected) {
    return "Live match data temporarily unavailable";
  }
  if (!input.rendererReady) {
    return "Live arena view temporarily unavailable";
  }
  if (!input.presentationReady) {
    return "Live match data temporarily unavailable";
  }
  return null;
}

/**
 * Derives presentation authority from the delayed public stream itself.
 *
 * The wagering gate intentionally compares the public stream with the latest
 * market lifecycle. The spectator rail must not do that: during a lifecycle
 * rollover, the buffered video is still showing the preceding duel. Keeping
 * these concerns separate prevents the visible fighters from disappearing
 * while all transaction controls remain fail-closed against current state.
 */
export function deriveSpectatorPresentationState(
  input: SpectatorPresentationInput,
): SpectatorPresentationState {
  const emittedAt = input.state?.emittedAt;
  const ageMs =
    typeof emittedAt === "number" && Number.isFinite(emittedAt) && emittedAt > 0
      ? Math.max(0, input.nowMs - emittedAt)
      : null;
  const allowedAgeMs =
    Math.max(0, input.streamMaxAgeMs) + Math.max(0, input.uiSyncDelayMs);
  const cycle = input.state?.cycle ?? null;
  const rendererReady = isStreamingRendererHealthReady(
    cycle?.rendererHealth,
    input.nowMs,
    allowedAgeMs,
  );
  const hasFreshCycle =
    input.streamConnected &&
    rendererReady &&
    ageMs !== null &&
    ageMs <= allowedAgeMs &&
    hasText(cycle?.cycleId) &&
    cycle.cycleId !== "cycle-0";
  const hasMatchup =
    hasFreshCycle &&
    hasText(cycle?.duelId) &&
    normalizePredictionMarketDuelKeyHex(cycle?.duelKeyHex) !== null &&
    hasText(cycle?.agent1?.name) &&
    hasText(cycle?.agent2?.name);

  const activityLabel =
    hasMatchup && cycle?.phase === "FIGHTING"
      ? "LIVE"
      : hasFreshCycle
        ? "CONNECTED"
        : input.state &&
            (!input.streamConnected || ageMs === null || ageMs > allowedAgeMs)
          ? "RECONNECTING"
          : "UNAVAILABLE";

  return { hasFreshCycle, hasMatchup, activityLabel };
}
