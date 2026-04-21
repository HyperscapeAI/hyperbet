import type { StreamingPhase } from "../../spectator/types";
import type { ViewerClock } from "./types";

export type AlignedCountdownHoldState =
  | "preparing_arena"
  | "starting"
  | null;

export interface AlignedCountdownDisplay {
  text: string;
  kind: "timer" | "hold" | "none";
  holdState: AlignedCountdownHoldState;
  remainingMs: number | null;
  remainingSeconds: number | null;
}

export interface ResolveAlignedCountdownDisplayInputs {
  phase: StreamingPhase | null | undefined;
  viewerClock: ViewerClock | null;
  betCloseTime?: number | null;
  fightStartTime?: number | null;
  fallbackTimeRemaining?: number | null;
}

function ceilRemainingSeconds(value: number | null | undefined): number {
  if (!Number.isFinite(value as number)) return 0;
  const raw = Math.max(0, Number(value));
  // Streaming API commonly reports milliseconds; mocks sometimes use seconds.
  return raw > 10_000 ? Math.ceil(raw / 1000) : Math.ceil(raw);
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function resolveAlignedCountdownDisplay(
  inputs: ResolveAlignedCountdownDisplayInputs,
): AlignedCountdownDisplay {
  const {
    phase,
    viewerClock,
    betCloseTime = null,
    fightStartTime = null,
    fallbackTimeRemaining = null,
  } = inputs;

  const targetTimeMs =
    phase === "ANNOUNCEMENT"
      ? betCloseTime
      : phase === "COUNTDOWN"
        ? fightStartTime
        : null;

  if (
    targetTimeMs != null &&
    Number.isFinite(targetTimeMs) &&
    viewerClock?.sourceNowMs != null &&
    Number.isFinite(viewerClock.sourceNowMs)
  ) {
    const remainingMs = Math.max(0, targetTimeMs - viewerClock.sourceNowMs);
    if (remainingMs > 0) {
      const remainingSeconds = ceilRemainingSeconds(remainingMs);
      return {
        text: formatCountdown(remainingSeconds),
        kind: "timer",
        holdState: null,
        remainingMs,
        remainingSeconds,
      };
    }

    if (phase === "ANNOUNCEMENT") {
      return {
        text: "Preparing arena",
        kind: "hold",
        holdState: "preparing_arena",
        remainingMs: 0,
        remainingSeconds: 0,
      };
    }

    if (phase === "COUNTDOWN") {
      return {
        text: "Starting...",
        kind: "hold",
        holdState: "starting",
        remainingMs: 0,
        remainingSeconds: 0,
      };
    }
  }

  if (phase === "ANNOUNCEMENT" || phase === "COUNTDOWN") {
    const fallbackSeconds = ceilRemainingSeconds(fallbackTimeRemaining);
    if (fallbackSeconds > 0) {
      return {
        text: formatCountdown(fallbackSeconds),
        kind: "timer",
        holdState: null,
        remainingMs: fallbackTimeRemaining ?? null,
        remainingSeconds: fallbackSeconds,
      };
    }

    return {
      text: phase === "ANNOUNCEMENT" ? "Preparing arena" : "Starting...",
      kind: "hold",
      holdState: phase === "ANNOUNCEMENT" ? "preparing_arena" : "starting",
      remainingMs: 0,
      remainingSeconds: 0,
    };
  }

  const fallbackSeconds = ceilRemainingSeconds(fallbackTimeRemaining);
  if (fallbackSeconds > 0 || fallbackTimeRemaining === 0) {
    return {
      text: formatCountdown(fallbackSeconds),
      kind: "timer",
      holdState: null,
      remainingMs: fallbackTimeRemaining ?? null,
      remainingSeconds: fallbackSeconds,
    };
  }

  return {
    text: "",
    kind: "none",
    holdState: null,
    remainingMs: null,
    remainingSeconds: null,
  };
}
