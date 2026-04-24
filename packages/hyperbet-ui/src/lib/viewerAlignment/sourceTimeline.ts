import type {
  BroadcastTimeline,
  CanonicalStreamSession,
  SourceTimeline,
  StreamingPhase,
} from "../../spectator/types";
import type { DuelContextState } from "../../spectator/useDuelContext";

function mergeBroadcastTimelineWithSource(
  broadcastTimeline: BroadcastTimeline | null | undefined,
  sourceTimeline: SourceTimeline,
): BroadcastTimeline {
  return {
    phase: sourceTimeline.phase ?? broadcastTimeline?.phase ?? null,
    betOpenTime:
      sourceTimeline.betOpenTime ?? broadcastTimeline?.betOpenTime ?? null,
    betCloseTime:
      sourceTimeline.betCloseTime ?? broadcastTimeline?.betCloseTime ?? null,
    fightStartTime:
      sourceTimeline.fightStartTime ?? broadcastTimeline?.fightStartTime ?? null,
    duelEndTime:
      sourceTimeline.duelEndTime ?? broadcastTimeline?.duelEndTime ?? null,
    presentationDelayMs: broadcastTimeline?.presentationDelayMs ?? 0,
    updatedAt: sourceTimeline.updatedAt ?? broadcastTimeline?.updatedAt ?? null,
  };
}

export function projectCanonicalSessionToSourceTimeline(
  session: CanonicalStreamSession | null,
): CanonicalStreamSession | null {
  if (!session?.cycle?.sourceTimeline) {
    return session;
  }

  const sourceTimeline = session.cycle.sourceTimeline;
  const mergedTimeline = mergeBroadcastTimelineWithSource(
    session.cycle.broadcastTimeline,
    sourceTimeline,
  );
  const projectedPhase =
    (sourceTimeline.phase as StreamingPhase | null) ??
    session.phase ??
    session.cycle.phase;

  return {
    ...session,
    phase: projectedPhase,
    cycle: {
      ...session.cycle,
      phase: projectedPhase,
      broadcastTimeline: mergedTimeline,
      betOpenTime: sourceTimeline.betOpenTime ?? session.cycle.betOpenTime ?? null,
      betCloseTime:
        sourceTimeline.betCloseTime ?? session.cycle.betCloseTime ?? null,
      fightStartTime:
        sourceTimeline.fightStartTime ?? session.cycle.fightStartTime ?? null,
      duelEndTime: sourceTimeline.duelEndTime ?? session.cycle.duelEndTime ?? null,
    },
  };
}

export function projectDuelContextToSourceTimeline(
  duelContext: DuelContextState | null,
): DuelContextState | null {
  if (!duelContext?.cycle?.sourceTimeline) {
    return duelContext;
  }

  const sourceTimeline = duelContext.cycle.sourceTimeline;
  const broadcastTimeline = duelContext.cycle.broadcastTimeline
    ? {
        phase:
          sourceTimeline.phase ??
          duelContext.cycle.broadcastTimeline.phase ??
          null,
        betOpenTime:
          sourceTimeline.betOpenTime ??
          duelContext.cycle.broadcastTimeline.betOpenTime ??
          null,
        betCloseTime:
          sourceTimeline.betCloseTime ??
          duelContext.cycle.broadcastTimeline.betCloseTime ??
          null,
        fightStartTime:
          sourceTimeline.fightStartTime ??
          duelContext.cycle.broadcastTimeline.fightStartTime ??
          null,
        duelEndTime:
          sourceTimeline.duelEndTime ??
          duelContext.cycle.broadcastTimeline.duelEndTime ??
          null,
        presentationDelayMs:
          duelContext.cycle.broadcastTimeline.presentationDelayMs ?? 0,
        updatedAt:
          sourceTimeline.updatedAt ??
          duelContext.cycle.broadcastTimeline.updatedAt ??
          null,
      }
    : null;

  return {
    ...duelContext,
    cycle: {
      ...duelContext.cycle,
      phase: sourceTimeline.phase ?? duelContext.cycle.phase,
      broadcastTimeline,
      betOpenTime:
        sourceTimeline.betOpenTime ?? duelContext.cycle.betOpenTime ?? null,
      betCloseTime:
        sourceTimeline.betCloseTime ?? duelContext.cycle.betCloseTime ?? null,
      fightStartTime:
        sourceTimeline.fightStartTime ?? duelContext.cycle.fightStartTime ?? null,
      duelEndTime:
        sourceTimeline.duelEndTime ?? duelContext.cycle.duelEndTime ?? null,
    },
  };
}

export function resolveAlignedSessionPhase(
  session: CanonicalStreamSession | null,
): string | null {
  const projected = projectCanonicalSessionToSourceTimeline(session);
  if (!projected) return null;
  return (
    projected.cycle.broadcastTimeline?.phase ??
    projected.phase ??
    projected.cycle.phase ??
    null
  );
}
