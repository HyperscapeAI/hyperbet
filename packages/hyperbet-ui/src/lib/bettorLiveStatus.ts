import type {
  PredictionMarketLifecycleStatus,
  PredictionMarketWinner,
} from "@hyperbet/chain-registry";

import type {
  CanonicalStreamSession,
  StreamingPhase,
} from "../spectator/types";

type PhaseLabelCopy = {
  phaseLive: string;
  phaseStarting: (value: string | number | null) => string;
  phaseResolved: string;
  phaseNextMatch: string;
  phaseIdle: string;
};

type SettlementLabelCopy = {
  waitingForMarketOperator?: string;
  resolvedFor?: (name: string) => string;
  resolved?: string;
  marketCancelled?: string;
  bettingLocked?: string;
  resolutionProposed?: string;
  resolutionChallenged?: string;
  marketOpen?: string;
  statusOpen?: string;
  statusResolved?: string;
  statusPending?: string;
};

export type BettorLiveStatusCopy = PhaseLabelCopy & SettlementLabelCopy;

export type BettorDriftDiagnostic = {
  detected: boolean;
  type: "phase_mismatch" | "duel_mismatch" | null;
  canonicalPhase: string | null;
  marketPhase: string | null;
  canonicalDuelId: string | null;
  marketDuelId: string | null;
};

export type BettorLiveStatus = {
  livePhase: StreamingPhase | string | null;
  livePhaseLabel: string;
  marketSettlementLabel: string | null;
  driftDiagnostic: BettorDriftDiagnostic;
};

export function resolveCanonicalLivePhase(
  session: CanonicalStreamSession | null,
  fallbackPhase: string | null = null,
): StreamingPhase | string | null {
  return (
    session?.cycle.broadcastTimeline?.phase ??
    session?.phase ??
    session?.cycle.phase ??
    fallbackPhase
  );
}

function formatLivePhaseLabel(
  phase: string | null | undefined,
  countdown: string | number | null,
  copy: PhaseLabelCopy,
): string {
  switch (phase) {
    case "FIGHTING":
      return copy.phaseLive;
    case "COUNTDOWN":
      return copy.phaseStarting(countdown);
    case "RESOLUTION":
      return copy.phaseResolved;
    case "ANNOUNCEMENT":
      return copy.phaseNextMatch;
    default:
      return copy.phaseIdle;
  }
}

function formatMarketSettlementLabel(
  lifecycleStatus: PredictionMarketLifecycleStatus | string | null | undefined,
  winner: PredictionMarketWinner | string | null | undefined,
  agent1Name: string,
  agent2Name: string,
  copy: SettlementLabelCopy,
): string | null {
  switch (lifecycleStatus) {
    case "RESOLVED":
      if (winner === "A") {
        return copy.resolvedFor?.(agent1Name) ?? copy.statusResolved ?? null;
      }
      if (winner === "B") {
        return copy.resolvedFor?.(agent2Name) ?? copy.statusResolved ?? null;
      }
      return copy.resolved ?? copy.statusResolved ?? null;
    case "CANCELLED":
      return copy.marketCancelled ?? copy.statusResolved ?? null;
    case "LOCKED":
      return copy.bettingLocked ?? copy.statusPending ?? null;
    case "PROPOSED":
      return copy.resolutionProposed ?? copy.statusPending ?? null;
    case "CHALLENGED":
      return copy.resolutionChallenged ?? copy.statusPending ?? null;
    case "OPEN":
      return copy.marketOpen ?? copy.statusOpen ?? null;
    case "PENDING":
    case "UNKNOWN":
      return copy.waitingForMarketOperator ?? copy.statusPending ?? null;
    default:
      return null;
  }
}

export function deriveBettorLiveStatus(params: {
  copy: BettorLiveStatusCopy;
  session: CanonicalStreamSession | null;
  fallbackPhase?: string | null;
  countdown: string | number | null;
  marketLifecycleStatus: PredictionMarketLifecycleStatus | string | null | undefined;
  marketWinner: PredictionMarketWinner | string | null | undefined;
  agent1Name: string;
  agent2Name: string;
  marketPhase?: string | null;
  marketDuelId?: string | null;
}): BettorLiveStatus {
  const livePhase = resolveCanonicalLivePhase(
    params.session,
    params.fallbackPhase ?? null,
  );
  const canonicalDuelId =
    params.session?.duelId ?? params.session?.cycle.duelId ?? null;
  const marketPhase = params.marketPhase?.trim() || null;
  const marketDuelId = params.marketDuelId?.trim() || null;
  const canonicalPhase = typeof livePhase === "string" ? livePhase : null;
  const duelMismatch =
    canonicalDuelId != null &&
    marketDuelId != null &&
    canonicalDuelId !== marketDuelId;
  const phaseMismatch =
    !duelMismatch &&
    canonicalPhase != null &&
    marketPhase != null &&
    canonicalPhase !== marketPhase;

  return {
    livePhase,
    livePhaseLabel: formatLivePhaseLabel(
      livePhase,
      params.countdown,
      params.copy,
    ),
    marketSettlementLabel: formatMarketSettlementLabel(
      params.marketLifecycleStatus,
      params.marketWinner,
      params.agent1Name,
      params.agent2Name,
      params.copy,
    ),
    driftDiagnostic: {
      detected: duelMismatch || phaseMismatch,
      type: duelMismatch
        ? "duel_mismatch"
        : phaseMismatch
          ? "phase_mismatch"
          : null,
      canonicalPhase,
      marketPhase,
      canonicalDuelId,
      marketDuelId,
    },
  };
}
