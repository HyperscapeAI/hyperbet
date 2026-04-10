import type {
  PredictionMarketLifecycleRecord,
  PredictionMarketLifecycleStatus,
  PredictionMarketWinner,
} from "../../../hyperbet-chain-registry/src/index";
import {
  normalizePredictionMarketTimestamp,
  normalizePredictionMarketWinner,
} from "../../../hyperbet-chain-registry/src/index";

type JsonRecord = Record<string, unknown>;

export type BetSyncRendererHealth = {
  ready: boolean;
  degradedReason: string | null;
  updatedAt: number | null;
};

export type BetSyncHlsManifest = {
  updatedAt: number | null;
  mediaSequence: number | null;
};

export type BetSyncRendererMetrics = {
  captureFps: number | null;
  encodeFps: number | null;
  droppedFrames: number | null;
  renderTick: number | null;
  duelStateTick: number | null;
  latestFrameAt: number | null;
  latestRenderTickAt: number | null;
  latestDuelStateTickAt: number | null;
  latestVisualChangeAt: number | null;
  visualChangeAgeMs: number | null;
  hlsManifest: BetSyncHlsManifest | null;
};

export type BetSyncDelivery = {
  mode: "self_hls" | "external_hls";
  provider: string | null;
  playbackUrl: string | null;
  hlsUrl: string | null;
  llhlsUrl: string | null;
  ingestUrl: string | null;
};

export type BetSyncBroadcastTimeline = {
  phase: string | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  presentationDelayMs: number;
  updatedAt: number | null;
};

export type BetSyncCanonicalAuthority = {
  providerLive: boolean;
  playbackProbeReady: boolean;
  decision: string | null;
  reason: string | null;
  revision: number | null;
  updatedAt: number | null;
  liveInputId: string | null;
  videoUid: string | null;
  lifecycleStatus: string | null;
  playbackUrl: string | null;
  playbackProbeStatusCode: number | null;
  playbackManifestStatus: string | null;
};

export type BetSyncEvent = {
  schemaVersion: number;
  sourceEpoch: number;
  seq: number;
  emittedAt: number;
  duelId: string | null;
  duelKey: string | null;
  phase: string | null;
  phaseVersion: number | null;
  broadcastTimeline: BetSyncBroadcastTimeline | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
  seed: string | null;
  replayHash: string | null;
  agent1: JsonRecord | null;
  agent2: JsonRecord | null;
  arenaPositions: JsonRecord | null;
  leaderboard: JsonRecord[];
  cameraTarget: string | null;
  rendererHealth: BetSyncRendererHealth | null;
  rendererMetrics: BetSyncRendererMetrics | null;
  delivery: BetSyncDelivery | null;
  sourceRuntime: JsonRecord | null;
  channel: JsonRecord | null;
  publicReadiness: JsonRecord | null;
  canonicalDestination: JsonRecord | null;
  fallbackDestination: JsonRecord | null;
  canonicalAuthority: BetSyncCanonicalAuthority | null;
  deliveryHealth: JsonRecord | null;
};

export type BetSyncBootstrapState = {
  sourceEpoch: number;
  latestSeq: number;
  oldestReplaySeq: number | null;
  latestEvent: BetSyncEvent | null;
};

export type StreamState = {
  type: "STREAMING_STATE_UPDATE";
  cycle: JsonRecord;
  leaderboard: JsonRecord[];
  cameraTarget: string | null;
  seq: number;
  emittedAt: number;
  phase?: string | null;
  phaseVersion?: number | null;
  broadcastTimeline?: BetSyncBroadcastTimeline | null;
  rendererHealth?: BetSyncRendererHealth | null;
  rendererMetrics?: BetSyncRendererMetrics | null;
  delivery?: BetSyncDelivery | null;
  sourceRuntime?: JsonRecord | null;
  channel?: JsonRecord | null;
  publicReadiness?: JsonRecord | null;
  canonicalDestination?: JsonRecord | null;
  fallbackDestination?: JsonRecord | null;
  canonicalAuthority?: BetSyncCanonicalAuthority | null;
  deliveryHealth?: JsonRecord | null;
};

export type PredictionMarketsDuelSnapshot = {
  duelKey: string | null;
  duelId: string | null;
  phase: string | null;
  winner: PredictionMarketWinner;
  betCloseTime: number | null;
  agent1Name: string | null;
  agent2Name: string | null;
};

export type PredictionMarketsSurface = {
  duel: PredictionMarketsDuelSnapshot;
  markets: PredictionMarketLifecycleRecord[];
  updatedAt: number | null;
};

export type PredictionMarketsOverviewResponse = {
  updatedAt: number | null;
  live: PredictionMarketsSurface | null;
  recentSettlement: PredictionMarketsSurface | null;
};

export type BetSyncReplayMode = "bootstrap" | "replay" | "reset" | "live";

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object"
    ? (value as JsonRecord)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeDuelKey(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const normalized = raw.replace(/^0x/i, "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

const PREDICTION_MARKET_STATUS_RANK: Record<
  PredictionMarketLifecycleStatus,
  number
> = {
  UNKNOWN: -1,
  PENDING: 0,
  OPEN: 1,
  LOCKED: 2,
  PROPOSED: 3,
  CHALLENGED: 4,
  RESOLVED: 5,
  CANCELLED: 5,
};

function statusRank(status: PredictionMarketLifecycleStatus): number {
  return PREDICTION_MARKET_STATUS_RANK[status] ?? -1;
}

function preferPreviousMarket(
  previous: PredictionMarketLifecycleRecord,
  next: PredictionMarketLifecycleRecord,
): boolean {
  const previousRank = statusRank(previous.lifecycleStatus);
  const nextRank = statusRank(next.lifecycleStatus);
  if (nextRank < previousRank) {
    return true;
  }
  if (
    nextRank === previousRank &&
    previous.winner !== "NONE" &&
    next.winner === "NONE"
  ) {
    return true;
  }
  return false;
}

function mergeMarketRecord(
  previous: PredictionMarketLifecycleRecord,
  next: PredictionMarketLifecycleRecord,
): PredictionMarketLifecycleRecord {
  const keepPrevious = preferPreviousMarket(previous, next);
  const preferred = keepPrevious ? previous : next;
  const fallback = keepPrevious ? next : previous;

  return {
    ...fallback,
    ...preferred,
    duelKey: preferred.duelKey ?? fallback.duelKey ?? null,
    duelId: preferred.duelId ?? fallback.duelId ?? null,
    betCloseTime: preferred.betCloseTime ?? fallback.betCloseTime ?? null,
    winner:
      preferred.winner !== "NONE"
        ? preferred.winner
        : fallback.winner,
    syncedAt:
      preferred.syncedAt != null
        ? Math.max(preferred.syncedAt, fallback.syncedAt ?? preferred.syncedAt)
        : (fallback.syncedAt ?? null),
    metadata:
      previous.metadata || next.metadata
        ? {
            ...(keepPrevious ? next.metadata ?? {} : previous.metadata ?? {}),
            ...(keepPrevious ? previous.metadata ?? {} : next.metadata ?? {}),
          }
        : undefined,
  };
}

function mergeDuelSnapshot(
  previous: PredictionMarketsDuelSnapshot,
  next: PredictionMarketsDuelSnapshot,
): PredictionMarketsDuelSnapshot {
  const nextPhase =
    next.phase === "IDLE" && previous.phase && previous.phase !== "IDLE"
      ? previous.phase
      : (next.phase ?? previous.phase ?? null);

  return {
    duelKey: next.duelKey ?? previous.duelKey ?? null,
    duelId: next.duelId ?? previous.duelId ?? null,
    phase: nextPhase,
    winner: next.winner !== "NONE" ? next.winner : previous.winner,
    betCloseTime: next.betCloseTime ?? previous.betCloseTime ?? null,
    agent1Name: next.agent1Name ?? previous.agent1Name ?? null,
    agent2Name: next.agent2Name ?? previous.agent2Name ?? null,
  };
}

function normalizeRendererHealth(value: unknown): BetSyncRendererHealth | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    ready: candidate.ready === true,
    degradedReason: asString(candidate.degradedReason),
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
  };
}

function normalizeHlsManifest(value: unknown): BetSyncHlsManifest | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
    mediaSequence: asFiniteNumber(candidate.mediaSequence),
  };
}

function normalizeRendererMetrics(
  value: unknown,
): BetSyncRendererMetrics | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    captureFps: asFiniteNumber(candidate.captureFps),
    encodeFps: asFiniteNumber(candidate.encodeFps),
    droppedFrames: asFiniteNumber(candidate.droppedFrames),
    renderTick: asFiniteNumber(candidate.renderTick),
    duelStateTick: asFiniteNumber(candidate.duelStateTick),
    latestFrameAt: normalizePredictionMarketTimestamp(candidate.latestFrameAt),
    latestRenderTickAt: normalizePredictionMarketTimestamp(
      candidate.latestRenderTickAt,
    ),
    latestDuelStateTickAt: normalizePredictionMarketTimestamp(
      candidate.latestDuelStateTickAt,
    ),
    latestVisualChangeAt: normalizePredictionMarketTimestamp(
      candidate.latestVisualChangeAt,
    ),
    visualChangeAgeMs: asFiniteNumber(candidate.visualChangeAgeMs),
    hlsManifest: normalizeHlsManifest(candidate.hlsManifest),
  };
}

function normalizeDelivery(value: unknown): BetSyncDelivery | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  const mode = asString(candidate.mode);
  if (mode !== "self_hls" && mode !== "external_hls") {
    return null;
  }
  return {
    mode,
    provider: asString(candidate.provider),
    playbackUrl: asString(candidate.playbackUrl),
    hlsUrl: asString(candidate.hlsUrl),
    llhlsUrl: asString(candidate.llhlsUrl),
    ingestUrl: asString(candidate.ingestUrl),
  };
}

function normalizeBroadcastTimeline(
  value: unknown,
): BetSyncBroadcastTimeline | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    phase: asString(candidate.phase),
    betOpenTime: normalizePredictionMarketTimestamp(candidate.betOpenTime),
    betCloseTime: normalizePredictionMarketTimestamp(candidate.betCloseTime),
    fightStartTime: normalizePredictionMarketTimestamp(candidate.fightStartTime),
    duelEndTime: normalizePredictionMarketTimestamp(candidate.duelEndTime),
    presentationDelayMs: Math.max(
      0,
      asFiniteNumber(candidate.presentationDelayMs) ?? 0,
    ),
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
  };
}

function normalizeCanonicalAuthority(
  value: unknown,
): BetSyncCanonicalAuthority | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    providerLive: candidate.providerLive === true,
    playbackProbeReady: candidate.playbackProbeReady === true,
    decision: asString(candidate.decision),
    reason: asString(candidate.reason),
    revision: asFiniteNumber(candidate.revision),
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
    liveInputId: asString(candidate.liveInputId),
    videoUid: asString(candidate.videoUid),
    lifecycleStatus: asString(candidate.lifecycleStatus),
    playbackUrl: asString(candidate.playbackUrl),
    playbackProbeStatusCode: asFiniteNumber(candidate.playbackProbeStatusCode),
    playbackManifestStatus: asString(candidate.playbackManifestStatus),
  };
}

export function parseBetSyncEvent(payload: unknown): BetSyncEvent | null {
  const candidate = asRecord(payload);
  if (!candidate) return null;

  const seq = asFiniteNumber(candidate.seq);
  const emittedAt = normalizePredictionMarketTimestamp(candidate.emittedAt);
  const sourceEpoch = asFiniteNumber(candidate.sourceEpoch);

  if (seq == null || emittedAt == null || sourceEpoch == null) {
    return null;
  }

  const broadcastTimeline = normalizeBroadcastTimeline(
    candidate.broadcastTimeline,
  );

  return {
    schemaVersion: asFiniteNumber(candidate.schemaVersion) ?? 1,
    sourceEpoch,
    seq,
    emittedAt,
    duelId: asString(candidate.duelId),
    duelKey: normalizeDuelKey(candidate.duelKey),
    phase: asString(candidate.phase),
    phaseVersion: asFiniteNumber(candidate.phaseVersion),
    broadcastTimeline,
    betOpenTime: normalizePredictionMarketTimestamp(candidate.betOpenTime),
    betCloseTime: normalizePredictionMarketTimestamp(candidate.betCloseTime),
    fightStartTime: normalizePredictionMarketTimestamp(candidate.fightStartTime),
    duelEndTime: normalizePredictionMarketTimestamp(candidate.duelEndTime),
    winnerId: asString(candidate.winnerId),
    winnerName: asString(candidate.winnerName),
    winReason: asString(candidate.winReason),
    seed: asString(candidate.seed),
    replayHash: asString(candidate.replayHash),
    agent1: asRecord(candidate.agent1),
    agent2: asRecord(candidate.agent2),
    arenaPositions: asRecord(candidate.arenaPositions),
    leaderboard: Array.isArray(candidate.leaderboard)
      ? candidate.leaderboard
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonRecord => entry !== null)
      : [],
    cameraTarget: asString(candidate.cameraTarget),
    rendererHealth: normalizeRendererHealth(candidate.rendererHealth),
    rendererMetrics: normalizeRendererMetrics(candidate.rendererMetrics),
    delivery: normalizeDelivery(candidate.delivery),
    sourceRuntime: asRecord(candidate.sourceRuntime),
    channel: asRecord(candidate.channel),
    publicReadiness: asRecord(candidate.publicReadiness),
    canonicalDestination: asRecord(candidate.canonicalDestination),
    fallbackDestination: asRecord(candidate.fallbackDestination),
    canonicalAuthority: normalizeCanonicalAuthority(candidate.canonicalAuthority),
    deliveryHealth: asRecord(candidate.deliveryHealth),
  };
}

export function parseBetSyncBootstrapState(
  payload: unknown,
): BetSyncBootstrapState | null {
  const candidate = asRecord(payload);
  if (!candidate) return null;

  const replay = asRecord(candidate.replay);
  const sourceEpoch =
    asFiniteNumber(candidate.sourceEpoch) ??
    asFiniteNumber(replay?.sourceEpoch);
  const latestSeq =
    asFiniteNumber(candidate.latestSeq) ??
    asFiniteNumber(replay?.latestSeq) ??
    asFiniteNumber(candidate.seq);
  if (sourceEpoch == null || latestSeq == null) {
    return null;
  }

  return {
    sourceEpoch,
    latestSeq,
    oldestReplaySeq:
      asFiniteNumber(candidate.oldestReplaySeq) ??
      asFiniteNumber(replay?.oldestSeq),
    latestEvent:
      parseBetSyncEvent(candidate.latestEvent) ?? parseBetSyncEvent(candidate),
  };
}

export function toStreamStateFromBetSyncEvent(event: BetSyncEvent): StreamState {
  return {
    type: "STREAMING_STATE_UPDATE",
    cycle: {
      cycleId: event.duelId ?? `bet-sync-${event.sourceEpoch}-${event.seq}`,
      duelId: event.duelId,
      duelKey: event.duelKey,
      duelKeyHex: event.duelKey ? `0x${event.duelKey}` : null,
      phase: event.phase ?? "IDLE",
      phaseVersion: event.phaseVersion,
      broadcastTimeline: event.broadcastTimeline,
      betOpenTime: event.betOpenTime,
      betCloseTime: event.betCloseTime,
      fightStartTime: event.fightStartTime,
      duelEndTime: event.duelEndTime,
      winnerId: event.winnerId,
      winnerName: event.winnerName,
      winReason: event.winReason,
      seed: event.seed,
      replayHash: event.replayHash,
      agent1: event.agent1,
      agent2: event.agent2,
      arenaPositions: event.arenaPositions,
      rendererHealth: event.rendererHealth,
    },
    leaderboard: event.leaderboard,
    cameraTarget: event.cameraTarget,
    seq: event.seq,
    emittedAt: event.emittedAt,
    phase: event.phase,
    phaseVersion: event.phaseVersion,
    broadcastTimeline: event.broadcastTimeline,
    rendererHealth: event.rendererHealth,
    rendererMetrics: event.rendererMetrics,
    delivery: event.delivery,
    sourceRuntime: event.sourceRuntime,
    channel: event.channel,
    publicReadiness: event.publicReadiness,
    canonicalDestination: event.canonicalDestination,
    fallbackDestination: event.fallbackDestination,
    canonicalAuthority: event.canonicalAuthority,
    deliveryHealth: event.deliveryHealth,
  };
}

export function parsePredictionMarketsSurface(
  payload: unknown,
): PredictionMarketsSurface | null {
  const candidate = asRecord(payload);
  const duel = asRecord(candidate?.duel);
  if (!candidate || !duel || !Array.isArray(candidate.markets)) {
    return null;
  }

  return {
    duel: {
      duelKey: normalizeDuelKey(duel.duelKey),
      duelId: asString(duel.duelId),
      phase: asString(duel.phase),
      winner: normalizePredictionMarketWinner(duel.winner),
      betCloseTime: normalizePredictionMarketTimestamp(duel.betCloseTime),
      agent1Name: asString(duel.agent1Name),
      agent2Name: asString(duel.agent2Name),
    },
    markets: candidate.markets.filter(
      (market): market is PredictionMarketLifecycleRecord =>
        Boolean(market) && typeof market === "object",
    ) as PredictionMarketLifecycleRecord[],
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
  };
}

export function parsePredictionMarketsOverview(
  payload: unknown,
): PredictionMarketsOverviewResponse | null {
  const candidate = asRecord(payload);
  if (!candidate) return null;
  return {
    updatedAt: normalizePredictionMarketTimestamp(candidate.updatedAt),
    live: parsePredictionMarketsSurface(candidate.live),
    recentSettlement: parsePredictionMarketsSurface(candidate.recentSettlement),
  };
}

export function hasMeaningfulSurface(
  surface: PredictionMarketsSurface | null | undefined,
): boolean {
  if (!surface) return false;
  return Boolean(surface.duel.duelKey || surface.duel.duelId || surface.markets.length);
}

export function sameDuelIdentity(
  left: PredictionMarketsSurface | null | undefined,
  right: PredictionMarketsSurface | null | undefined,
): boolean {
  if (!left || !right) return false;
  if (left.duel.duelKey && right.duel.duelKey) {
    return left.duel.duelKey === right.duel.duelKey;
  }
  if (left.duel.duelId && right.duel.duelId) {
    return left.duel.duelId === right.duel.duelId;
  }
  return false;
}

export function mergePredictionMarketsSurface(
  previous: PredictionMarketsSurface | null,
  next: PredictionMarketsSurface | null,
): PredictionMarketsSurface | null {
  if (!next) return previous;
  if (!previous) return next;

  const byChain = new Map<string, PredictionMarketLifecycleRecord>();
  for (const market of previous.markets) {
    byChain.set(market.chainKey, market);
  }
  for (const market of next.markets) {
    const existing = byChain.get(market.chainKey);
    byChain.set(
      market.chainKey,
      existing ? mergeMarketRecord(existing, market) : market,
    );
  }

  return {
    duel: mergeDuelSnapshot(previous.duel, next.duel),
    markets: Array.from(byChain.values()),
    updatedAt: next.updatedAt,
  };
}

export function rollPredictionMarketsOverview(
  previous: PredictionMarketsOverviewResponse | null,
  live: PredictionMarketsSurface | null,
  updatedAt: number,
): PredictionMarketsOverviewResponse {
  const nextLive = live;
  let recentSettlement = previous?.recentSettlement ?? null;

  if (
    hasMeaningfulSurface(previous?.live) &&
    hasMeaningfulSurface(nextLive) &&
    !sameDuelIdentity(previous?.live, nextLive)
  ) {
    recentSettlement = previous?.live ?? null;
  }

  return {
    updatedAt,
    live: nextLive,
    recentSettlement,
  };
}

export function selectBetSyncResumeSeq(params: {
  lastAppliedSeq: number;
}): number {
  return Math.max(0, params.lastAppliedSeq);
}

export function selectBetSyncReplayUntilSeq(params: {
  resumeSeq: number;
  latestSeq: number | null;
}): number | null {
  const resumeSeq = Math.max(0, params.resumeSeq);
  if (resumeSeq <= 0 || params.latestSeq == null) {
    return null;
  }
  return params.latestSeq > resumeSeq ? params.latestSeq : null;
}

export function isBetSyncEventStaleAfterSourceReset(params: {
  sourceEpochChanged: boolean;
  currentStreamEmittedAt: number | null;
  eventEmittedAt: number;
  toleranceMs: number;
}): boolean {
  if (!params.sourceEpochChanged || params.currentStreamEmittedAt == null) {
    return false;
  }
  return (
    params.eventEmittedAt + Math.max(0, params.toleranceMs) <
    params.currentStreamEmittedAt
  );
}

export function resolveBetSyncReplayMode(params: {
  eventName: string;
  eventSeq: number;
  replayUntilSeq: number | null;
  sourceEpochChanged: boolean;
}): {
  replayMode: BetSyncReplayMode;
  replayUntilSeq: number | null;
} {
  if (params.sourceEpochChanged || params.eventName === "reset") {
    return {
      replayMode: "reset",
      replayUntilSeq: null,
    };
  }

  if (params.replayUntilSeq != null) {
    if (params.eventSeq < params.replayUntilSeq) {
      return {
        replayMode: "replay",
        replayUntilSeq: params.replayUntilSeq,
      };
    }
    return {
      replayMode: "live",
      replayUntilSeq: null,
    };
  }

  return {
    replayMode: "live",
    replayUntilSeq: null,
  };
}
