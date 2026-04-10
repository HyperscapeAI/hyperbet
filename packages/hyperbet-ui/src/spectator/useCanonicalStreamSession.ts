import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CONFIG } from "../lib/config";
import {
  isCanonicalDeliveryReady,
  isCanonicalRendererPlaybackReady,
} from "../lib/streamSession";
import type {
  BroadcastTimeline,
  CanonicalAuthorityInfo,
  CanonicalStreamHealth,
  HlsManifestInfo,
  CanonicalStreamPlayback,
  CanonicalStreamSession,
  CanonicalStreamStatus,
  LeaderboardEntry,
  RendererHealthInfo,
  RendererMetricsInfo,
  SourceRuntimeInfo,
  StreamChannelState,
  StreamDeliveryInfo,
  StreamDestinationState,
  StreamPublicReadiness,
  StreamingCycle,
  StreamingPhase,
  StreamingStateUpdate,
} from "./types";

const API_URL = CONFIG.gameApiUrl.replace(/\/$/, "");
// Use the canonical stream-state routes directly. They carry the same
// session-compatible payload shape and are the stable surface exposed by
// deployed keeper services.
const SESSION_SSE_URL = `${API_URL}/api/streaming/state/events`;
const SESSION_POLL_URL = `${API_URL}/api/streaming/state`;
const FALLBACK_POLL_INTERVAL_MS = 5000;

type SseSource = {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeStreamHealth(
  value: unknown,
  fallbackUpdatedAt: number | null,
  fallbackReady = true,
): CanonicalStreamHealth {
  const candidate = asRecord(value);
  return {
    ready:
      candidate?.ready === true ||
      (candidate?.ready !== false && fallbackReady),
    degradedReason:
      typeof candidate?.degradedReason === "string"
        ? candidate.degradedReason
        : null,
    updatedAt:
      asFiniteNumber(candidate?.updatedAt) ??
      fallbackUpdatedAt,
  };
}

function normalizeRendererHealth(
  value: unknown,
  fallbackUpdatedAt: number | null,
): RendererHealthInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    ready: candidate.ready === true,
    degradedReason:
      typeof candidate.degradedReason === "string"
        ? candidate.degradedReason
        : null,
    updatedAt:
      asFiniteNumber(candidate.updatedAt) ??
      fallbackUpdatedAt,
  };
}

function normalizeSourceRuntime(value: unknown): SourceRuntimeInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const statusSource = asString(candidate.statusSource);
  const captureMode = asString(candidate.captureMode);
  if (
    statusSource !== "external_worker" &&
    statusSource !== "in_process_bridge" &&
    statusSource !== "none"
  ) {
    return null;
  }
  if (
    captureMode !== "cdp" &&
    captureMode !== "webcodecs" &&
    captureMode !== "mediarecorder" &&
    captureMode !== "none"
  ) {
    return null;
  }

  return {
    ready: candidate.ready === true,
    statusSource,
    captureMode,
    degradedReason:
      typeof candidate.degradedReason === "string"
        ? candidate.degradedReason
        : null,
    currentSceneUrl: asString(candidate.currentSceneUrl),
    activeBundle: asString(candidate.activeBundle),
    lastFrameAt: asFiniteNumber(candidate.lastFrameAt),
    lastRenderTickAt: asFiniteNumber(candidate.lastRenderTickAt),
    lastVisualChangeAt: asFiniteNumber(candidate.lastVisualChangeAt),
    lastRecoveryAt: asFiniteNumber(candidate.lastRecoveryAt),
    recoveryCount: Math.max(0, asFiniteNumber(candidate.recoveryCount) ?? 0),
    workerHeartbeatAt: asFiniteNumber(candidate.workerHeartbeatAt),
  };
}

function normalizeHlsManifest(value: unknown): HlsManifestInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    updatedAt: asFiniteNumber(candidate.updatedAt),
    mediaSequence: asFiniteNumber(candidate.mediaSequence),
  };
}

function normalizeRendererMetrics(value: unknown): RendererMetricsInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    captureFps: asFiniteNumber(candidate.captureFps),
    encodeFps: asFiniteNumber(candidate.encodeFps),
    droppedFrames: asFiniteNumber(candidate.droppedFrames),
    renderTick: asFiniteNumber(candidate.renderTick),
    duelStateTick: asFiniteNumber(candidate.duelStateTick),
    latestFrameAt: asFiniteNumber(candidate.latestFrameAt),
    latestRenderTickAt: asFiniteNumber(candidate.latestRenderTickAt),
    latestDuelStateTickAt: asFiniteNumber(candidate.latestDuelStateTickAt),
    latestVisualChangeAt: asFiniteNumber(candidate.latestVisualChangeAt),
    visualChangeAgeMs: asFiniteNumber(candidate.visualChangeAgeMs),
    hlsManifest: normalizeHlsManifest(candidate.hlsManifest),
  };
}

function normalizeDelivery(value: unknown): StreamDeliveryInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const mode = asString(candidate.mode);
  if (mode !== "self_hls" && mode !== "external_hls") {
    return null;
  }

  const playbackUrl = asString(candidate.playbackUrl);
  const hlsUrl = asString(candidate.hlsUrl);
  const llhlsUrl = asString(candidate.llhlsUrl);
  if (mode === "external_hls" && !playbackUrl && !hlsUrl && !llhlsUrl) {
    return null;
  }

  return {
    mode,
    provider: asString(candidate.provider),
    playbackUrl,
    hlsUrl,
    llhlsUrl,
    ingestUrl: asString(candidate.ingestUrl),
  };
}

function normalizePublicReadiness(
  value: unknown,
  fallbackUpdatedAt: number | null,
): StreamPublicReadiness | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    ready: candidate.ready === true,
    reason: asString(candidate.reason),
    updatedAt: asFiniteNumber(candidate.updatedAt) ?? fallbackUpdatedAt,
  };
}

function normalizeCanonicalAuthority(
  value: unknown,
  fallbackUpdatedAt: number | null,
): CanonicalAuthorityInfo | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  return {
    providerLive: candidate.providerLive === true,
    playbackProbeReady: candidate.playbackProbeReady === true,
    decision: asString(candidate.decision),
    reason: asString(candidate.reason),
    revision: asFiniteNumber(candidate.revision),
    updatedAt: asFiniteNumber(candidate.updatedAt) ?? fallbackUpdatedAt,
    liveInputId: asString(candidate.liveInputId),
    videoUid: asString(candidate.videoUid),
    lifecycleStatus: asString(candidate.lifecycleStatus),
    playbackUrl: asString(candidate.playbackUrl),
    playbackProbeStatusCode: asFiniteNumber(candidate.playbackProbeStatusCode),
    playbackManifestStatus: asString(candidate.playbackManifestStatus),
  };
}

function normalizeDestinationState(value: unknown): StreamDestinationState | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  const id = asString(candidate.id);
  const role = asString(candidate.role);
  const provider = asString(candidate.provider);
  const transport = asString(candidate.transport);
  const manifestStatus = asString(candidate.manifestStatus);
  if (!id) return null;
  if (role !== "canonical" && role !== "fallback" && role !== "mirror") {
    return null;
  }
  if (
    provider !== "cloudflare_stream" &&
    provider !== "self_hls" &&
    provider !== "twitch" &&
    provider !== "kick" &&
    provider !== "youtube" &&
    provider !== "custom"
  ) {
    return null;
  }
  if (
    transport !== "llhls" &&
    transport !== "hls" &&
    transport !== "rtmps" &&
    transport !== "srt" &&
    transport !== "unknown"
  ) {
    return null;
  }
  if (
    manifestStatus !== "ok" &&
    manifestStatus !== "stale" &&
    manifestStatus !== "missing" &&
    manifestStatus !== "unknown"
  ) {
    return null;
  }
  return {
    id,
    name: asString(candidate.name) ?? id,
    role,
    provider,
    transport,
    playbackUrl: asString(candidate.playbackUrl),
    ingestUrl: asString(candidate.ingestUrl),
    connected: candidate.connected === true,
    transportHealthy: candidate.transportHealthy === true,
    playbackReady: candidate.playbackReady === true,
    manifestStatus,
    lastError: asString(candidate.lastError),
    updatedAt: asFiniteNumber(candidate.updatedAt),
  };
}

function normalizeChannel(
  value: unknown,
  fallbackUpdatedAt: number | null,
): StreamChannelState | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  const id = asString(candidate.id);
  const mode = asString(candidate.mode);
  const canonicalDestinationId = asString(candidate.canonicalDestinationId);
  const publicReadiness = normalizePublicReadiness(
    candidate.publicReadiness,
    fallbackUpdatedAt,
  );
  if (!id || mode !== "always_on" || !canonicalDestinationId || !publicReadiness) {
    return null;
  }

  return {
    id,
    mode: "always_on",
    presentationDelayMs: Math.max(
      0,
      asFiniteNumber(candidate.presentationDelayMs) ?? 0,
    ),
    activeDuelId: asString(candidate.activeDuelId),
    activeDuelKey: asString(candidate.activeDuelKey),
    canonicalDestinationId,
    fallbackDestinationId: asString(candidate.fallbackDestinationId),
    publicPlaybackUrl: asString(candidate.publicPlaybackUrl),
    publicReadiness,
    destinations: Array.isArray(candidate.destinations)
      ? candidate.destinations
          .map((destination) => normalizeDestinationState(destination))
          .filter((destination): destination is StreamDestinationState => {
            return destination != null;
          })
      : [],
  };
}

function deriveDeliveryFromChannel(
  channel: StreamChannelState | null,
  canonicalDestination: StreamDestinationState | null,
): StreamDeliveryInfo | null {
  if (!canonicalDestination) {
    return null;
  }

  const playbackUrl =
    channel?.publicPlaybackUrl ?? canonicalDestination.playbackUrl ?? null;
  let hlsUrl: string | null = null;
  let llhlsUrl: string | null = null;

  if (playbackUrl) {
    try {
      const parsed = new URL(playbackUrl);
      const protocol = (parsed.searchParams.get("protocol") || "")
        .trim()
        .toLowerCase();
      if (protocol === "llhls") {
        llhlsUrl = parsed.toString();
        parsed.searchParams.delete("protocol");
        hlsUrl = parsed.toString();
      } else if (parsed.pathname.toLowerCase().endsWith(".m3u8")) {
        hlsUrl = parsed.toString();
      }
    } catch {
      hlsUrl = playbackUrl;
    }
  }

  return {
    mode:
      canonicalDestination.provider === "self_hls"
        ? "self_hls"
        : "external_hls",
    provider: canonicalDestination.provider,
    playbackUrl,
    hlsUrl,
    llhlsUrl,
    ingestUrl: canonicalDestination.ingestUrl,
  };
}

function deriveDeliveryFromPlayback(
  playback: CanonicalStreamPlayback | null,
): StreamDeliveryInfo | null {
  if (!playback?.url) {
    return null;
  }

  const kind = (playback.kind ?? "").trim().toLowerCase();
  return {
    mode: kind === "llhls" ? "external_hls" : "self_hls",
    provider: null,
    playbackUrl: playback.url,
    hlsUrl: kind === "hls" ? playback.url : null,
    llhlsUrl: kind === "llhls" ? playback.url : null,
    ingestUrl: null,
  };
}

function normalizePlayback(value: unknown): CanonicalStreamPlayback | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  const url = asString(candidate.url);
  const kind = asString(candidate.kind);
  const renderSessionId = asString(candidate.renderSessionId);
  const presentationDelayMs = Math.max(
    0,
    asFiniteNumber(candidate.presentationDelayMs) ?? 0,
  );

  if (!url && !renderSessionId && !kind) {
    return null;
  }

  return {
    url,
    kind,
    renderSessionId,
    presentationDelayMs,
  };
}

function normalizeBroadcastTimeline(value: unknown): BroadcastTimeline | null {
  const candidate = asRecord(value);
  if (!candidate) return null;

  return {
    phase: (asString(candidate.phase) as StreamingPhase | null) ?? null,
    betOpenTime: asFiniteNumber(candidate.betOpenTime),
    betCloseTime: asFiniteNumber(candidate.betCloseTime),
    fightStartTime: asFiniteNumber(candidate.fightStartTime),
    duelEndTime: asFiniteNumber(candidate.duelEndTime),
    presentationDelayMs: Math.max(
      0,
      asFiniteNumber(candidate.presentationDelayMs) ?? 0,
    ),
    updatedAt: asFiniteNumber(candidate.updatedAt),
  };
}

function normalizeCycle(value: unknown): StreamingCycle | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  const broadcastTimeline = normalizeBroadcastTimeline(candidate.broadcastTimeline);

  return {
    cycleId: asString(candidate.cycleId) ?? "cycle-0",
    phase:
      broadcastTimeline?.phase ??
      (asString(candidate.phase) as StreamingPhase | null) ??
      "IDLE",
    cycleStartTime: asFiniteNumber(candidate.cycleStartTime) ?? 0,
    phaseStartTime: asFiniteNumber(candidate.phaseStartTime) ?? 0,
    phaseEndTime: asFiniteNumber(candidate.phaseEndTime) ?? 0,
    phaseVersion: asFiniteNumber(candidate.phaseVersion) ?? 0,
    timeRemaining: asFiniteNumber(candidate.timeRemaining) ?? 0,
    agent1: (candidate.agent1 as StreamingCycle["agent1"]) ?? null,
    agent2: (candidate.agent2 as StreamingCycle["agent2"]) ?? null,
    duelId:
      typeof candidate.duelId === "string" || candidate.duelId === null
        ? (candidate.duelId as string | null)
        : null,
    duelKeyHex:
      typeof candidate.duelKeyHex === "string" || candidate.duelKeyHex === null
        ? (candidate.duelKeyHex as string | null)
        : null,
    broadcastTimeline,
    betOpenTime:
      broadcastTimeline?.betOpenTime ?? asFiniteNumber(candidate.betOpenTime),
    betCloseTime:
      broadcastTimeline?.betCloseTime ?? asFiniteNumber(candidate.betCloseTime),
    countdown: asFiniteNumber(candidate.countdown),
    fightStartTime:
      broadcastTimeline?.fightStartTime ??
      asFiniteNumber(candidate.fightStartTime),
    duelEndTime:
      broadcastTimeline?.duelEndTime ?? asFiniteNumber(candidate.duelEndTime),
    winnerId:
      typeof candidate.winnerId === "string" || candidate.winnerId === null
        ? (candidate.winnerId as string | null)
        : null,
    winnerName:
      typeof candidate.winnerName === "string" || candidate.winnerName === null
        ? (candidate.winnerName as string | null)
        : null,
    winReason:
      typeof candidate.winReason === "string" || candidate.winReason === null
        ? (candidate.winReason as string | null)
        : null,
    rendererHealth:
      normalizeRendererHealth(
        candidate.rendererHealth,
        asFiniteNumber(candidate.emittedAt),
      ) ?? null,
    seed:
      typeof candidate.seed === "string" || candidate.seed === null
        ? (candidate.seed as string | null)
        : null,
    replayHash:
      typeof candidate.replayHash === "string" || candidate.replayHash === null
        ? (candidate.replayHash as string | null)
        : null,
  };
}

export function normalizeCanonicalStreamSession(
  payload: unknown,
): CanonicalStreamSession | null {
  const candidate = asRecord(payload);
  if (!candidate) return null;

  const cycle = normalizeCycle(candidate.cycle);
  if (!cycle) return null;

  const emittedAt = asFiniteNumber(candidate.emittedAt) ?? Date.now();
  const channel = normalizeChannel(candidate.channel, emittedAt);
  const publicReadiness =
    channel?.publicReadiness ??
    normalizePublicReadiness(candidate.publicReadiness, emittedAt);
  const canonicalAuthority = normalizeCanonicalAuthority(
    candidate.canonicalAuthority,
    emittedAt,
  );
  const sourceRuntime =
    normalizeSourceRuntime(candidate.sourceRuntime) ??
    normalizeSourceRuntime(asRecord(candidate.status)?.sourceRuntime);
  const canonicalDestination =
    channel?.destinations.find(
      (destination) => destination.id === channel.canonicalDestinationId,
    ) ??
    normalizeDestinationState(candidate.canonicalDestination) ??
    null;
  const fallbackDestination =
    (channel?.fallbackDestinationId
      ? channel.destinations.find(
          (destination) => destination.id === channel.fallbackDestinationId,
        )
      : null) ??
    normalizeDestinationState(candidate.fallbackDestination) ??
    null;
  const topLevelRendererHealth =
    normalizeRendererHealth(
      candidate.rendererHealth,
      emittedAt,
    ) ??
    normalizeRendererHealth(
      candidate.status && asRecord(candidate.status)?.renderer,
      emittedAt,
    );
  const rendererHealth =
    topLevelRendererHealth ??
    (publicReadiness == null && sourceRuntime == null
      ? normalizeRendererHealth(cycle.rendererHealth, emittedAt)
      : null);
  const rendererMetrics =
    normalizeRendererMetrics(candidate.rendererMetrics) ??
    normalizeRendererMetrics(asRecord(candidate.status)?.rendererMetrics) ??
    null;
  const playback = normalizePlayback(candidate.playback);
  const delivery =
    deriveDeliveryFromChannel(channel, canonicalDestination) ??
    deriveDeliveryFromPlayback(playback) ??
    normalizeDelivery(candidate.delivery) ??
    normalizeDelivery(asRecord(candidate.status)?.delivery) ??
    null;
  const deliveryHealth =
    publicReadiness != null
      ? {
          ready: publicReadiness.ready,
          degradedReason: publicReadiness.reason,
          updatedAt: publicReadiness.updatedAt,
        }
      : normalizeStreamHealth(
          candidate.deliveryHealth ??
            asRecord(candidate.status)?.deliveryHealth,
          emittedAt,
          delivery?.mode === "self_hls" && Boolean(delivery.playbackUrl),
        );
  const authorityHealth =
    canonicalAuthority != null
      ? {
          ready: canonicalAuthority.decision === "ready",
          degradedReason: canonicalAuthority.reason,
          updatedAt: canonicalAuthority.updatedAt,
        }
      : publicReadiness != null
      ? {
          ready: publicReadiness.ready,
          degradedReason: publicReadiness.reason,
          updatedAt: publicReadiness.updatedAt,
        }
      : normalizeStreamHealth(
          candidate.authorityHealth ??
            asRecord(candidate.status)?.authority,
          emittedAt,
          Boolean(playback?.url ?? delivery?.playbackUrl),
        );
  const status: CanonicalStreamStatus = {
    authority: authorityHealth,
    renderer: rendererHealth,
    sourceRuntime,
    delivery,
    deliveryHealth,
  };
  const normalizedCycle: StreamingCycle = {
    ...cycle,
    rendererHealth,
  };

  return {
    schemaVersion: asFiniteNumber(candidate.schemaVersion) ?? 1,
    sourceEpoch: asFiniteNumber(candidate.sourceEpoch),
    seq: asFiniteNumber(candidate.seq) ?? 0,
    emittedAt,
    duelId:
      asString(candidate.duelId) ??
      normalizedCycle.duelId ??
      null,
    duelKey:
      asString(candidate.duelKey) ??
      normalizedCycle.duelKeyHex?.replace(/^0x/i, "") ??
      null,
    phase:
      normalizedCycle.broadcastTimeline?.phase ??
      (asString(candidate.phase) as StreamingPhase | null) ??
      normalizedCycle.phase,
    phaseVersion:
      asFiniteNumber(candidate.phaseVersion) ??
      normalizedCycle.phaseVersion ??
      null,
    cycle: normalizedCycle,
    leaderboard: Array.isArray(candidate.leaderboard)
      ? (candidate.leaderboard as LeaderboardEntry[])
      : [],
    cameraTarget:
      typeof candidate.cameraTarget === "string" || candidate.cameraTarget === null
        ? (candidate.cameraTarget as string | null)
        : null,
    playback,
    rendererHealth,
    sourceRuntime,
    deliveryHealth,
    channel,
    publicReadiness,
    canonicalDestination,
    fallbackDestination,
    canonicalAuthority,
    rendererMetrics,
    delivery,
    authorityHealth,
    status,
  };
}

export function canonicalSessionToStreamingState(
  session: CanonicalStreamSession,
): StreamingStateUpdate {
  return {
    type: "STREAMING_STATE_UPDATE",
    cycle: session.cycle,
    leaderboard: session.leaderboard,
    cameraTarget: session.cameraTarget,
    seq: session.seq,
    emittedAt: session.emittedAt,
  };
}

export function sessionPlaybackDelayMs(
  session: CanonicalStreamSession | null,
): number {
  return Math.max(0, session?.playback?.presentationDelayMs ?? 0);
}

export function queueCanonicalStreamSession(
  queue: CanonicalStreamSession[],
  nextSession: CanonicalStreamSession,
  lastAppliedSeq = 0,
): CanonicalStreamSession[] {
  if (nextSession.seq <= lastAppliedSeq) {
    return queue.filter((session) => session.seq > lastAppliedSeq);
  }

  const deduped = queue.filter(
    (session) =>
      session.seq > lastAppliedSeq && session.seq !== nextSession.seq,
  );
  const result: CanonicalStreamSession[] = [];
  let inserted = false;

  for (const session of deduped) {
    if (!inserted && nextSession.seq < session.seq) {
      result.push(nextSession);
      inserted = true;
    }
    result.push(session);
  }

  if (!inserted) {
    result.push(nextSession);
  }

  return result;
}

export function consumeDueCanonicalStreamSession(
  queue: CanonicalStreamSession[],
  nowMs: number,
): {
  dueSession: CanonicalStreamSession | null;
  remainingQueue: CanonicalStreamSession[];
  waitMs: number | null;
} {
  let dueSession: CanonicalStreamSession | null = null;
  let nextIndex = 0;

  for (; nextIndex < queue.length; nextIndex += 1) {
    const candidate = queue[nextIndex];
    const readyAt = candidate.emittedAt + sessionPlaybackDelayMs(candidate);
    if (readyAt > nowMs) {
      return {
        dueSession,
        remainingQueue: dueSession ? queue.slice(nextIndex) : queue,
        waitMs: Math.max(0, readyAt - nowMs),
      };
    }
    dueSession = candidate;
  }

  return {
    dueSession,
    remainingQueue: [],
    waitMs: null,
  };
}

export function useCanonicalStreamSession(
  options: { disabled?: boolean } = {},
) {
  const { disabled = false } = options;
  const [session, setSession] = useState<CanonicalStreamSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<SseSource | null>(null);
  const queuedSessionsRef = useRef<CanonicalStreamSession[]>([]);
  const lastEventIdRef = useRef<number>(0);
  const lastAppliedSeqRef = useRef<number>(0);
  const closedRef = useRef(false);

  const clearPollTimer = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const clearApplyTimer = () => {
    if (applyTimer.current) {
      clearTimeout(applyTimer.current);
      applyTimer.current = null;
    }
  };

  const flushQueuedSessions = useCallback(() => {
    clearApplyTimer();

    const { dueSession, remainingQueue, waitMs } =
      consumeDueCanonicalStreamSession(
        queuedSessionsRef.current,
        Date.now(),
      );
    queuedSessionsRef.current = remainingQueue;

    if (dueSession) {
      lastAppliedSeqRef.current = dueSession.seq;
      setSession(dueSession);
      setIsConnected(true);
    }

    if (waitMs != null) {
      applyTimer.current = setTimeout(() => {
        flushQueuedSessions();
      }, waitMs);
    }
  }, []);

  const queueSession = useCallback((nextSession: CanonicalStreamSession) => {
    if (nextSession.seq > lastEventIdRef.current) {
      lastEventIdRef.current = nextSession.seq;
    }

    queuedSessionsRef.current = queueCanonicalStreamSession(
      queuedSessionsRef.current,
      nextSession,
      lastAppliedSeqRef.current,
    );
    flushQueuedSessions();
  }, [flushQueuedSessions]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(SESSION_POLL_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      const nextSession = normalizeCanonicalStreamSession(await res.json());
      if (nextSession) {
        queueSession(nextSession);
      }
    } catch {
      setIsConnected(false);
    }
  }, [queueSession]);

  const startFallbackPolling = useCallback(() => {
    if (pollTimer.current) return;
    void poll();
    pollTimer.current = setInterval(() => {
      void poll();
    }, FALLBACK_POLL_INTERVAL_MS);
  }, [poll]);

  const connectSse = useCallback(() => {
    if (
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      startFallbackPolling();
      return;
    }

    const url = new URL(SESSION_SSE_URL);
    if (lastEventIdRef.current > 0) {
      url.searchParams.set("since", String(lastEventIdRef.current));
    }

    const source = new window.EventSource(
      url.toString(),
    ) as unknown as SseSource;
    eventSourceRef.current = source;

    source.onopen = () => {
      setIsConnected(true);
      clearPollTimer();
    };

    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const parsed = normalizeCanonicalStreamSession(JSON.parse(event.data));
        if (parsed) {
          queueSession(parsed);
        }
        const eventId = Number.parseInt(event.lastEventId || "", 10);
        if (Number.isFinite(eventId) && eventId > lastEventIdRef.current) {
          lastEventIdRef.current = eventId;
        }
        clearPollTimer();
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    source.addEventListener("session", handleEvent);
    source.addEventListener("reset", handleEvent);

    source.addEventListener("unavailable", () => {
      setIsConnected(false);
      startFallbackPolling();
    });

    source.onerror = () => {
      setIsConnected(false);
      if (!closedRef.current) {
        source.close();
        eventSourceRef.current = null;
        startFallbackPolling();
      }
    };
  }, [queueSession, startFallbackPolling]);

  useEffect(() => {
    closedRef.current = false;
    if (!disabled) {
      void poll();
      connectSse();
    } else {
      clearApplyTimer();
      clearPollTimer();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      queuedSessionsRef.current = [];
    }

    return () => {
      closedRef.current = true;
      clearApplyTimer();
      clearPollTimer();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      queuedSessionsRef.current = [];
    };
  }, [connectSse, disabled, poll]);

  const playback = session?.playback ?? null;
  const rendererHealth = session?.rendererHealth ?? null;
  const deliveryHealth = session?.deliveryHealth ?? null;
  const publicReadiness = session?.publicReadiness ?? null;
  const channel = session?.channel ?? null;
  const authorityHealth = session?.authorityHealth ?? null;
  const phase = session?.phase ?? session?.cycle.phase ?? null;
  const duelId = session?.duelId ?? session?.cycle.duelId ?? null;
  const presentationDelayMs = sessionPlaybackDelayMs(session);
  const canonicalPlaybackUrl =
    playback?.url ?? channel?.publicPlaybackUrl ?? session?.delivery?.playbackUrl ?? null;
  const rendererPlaybackReady = useMemo(
    () =>
      isCanonicalRendererPlaybackReady({
        rendererReady: rendererHealth?.ready,
        degradedReason: rendererHealth?.degradedReason,
        publicReadiness,
        sourceRuntime: session?.sourceRuntime ?? null,
        playbackUrl: canonicalPlaybackUrl,
      }),
    [
      canonicalPlaybackUrl,
      rendererHealth?.degradedReason,
      rendererHealth?.ready,
      publicReadiness,
      session?.sourceRuntime,
    ],
  );
  const isLive = useMemo(
    () =>
      Boolean(canonicalPlaybackUrl) &&
      (publicReadiness?.ready ?? authorityHealth?.ready ?? true) &&
      rendererPlaybackReady &&
      isCanonicalDeliveryReady({
        deliveryMode: session?.delivery?.mode ?? null,
        deliveryHealth,
        publicReadiness,
        playbackUrl: canonicalPlaybackUrl,
      }),
    [
      canonicalPlaybackUrl,
      publicReadiness,
      authorityHealth?.ready,
      deliveryHealth,
      rendererPlaybackReady,
      session?.delivery?.mode,
    ],
  );

  return {
    session,
    playback,
    rendererHealth,
    deliveryHealth,
    publicReadiness,
    channel,
    authorityHealth,
    isLive,
    phase,
    duelId,
    presentationDelayMs,
    isConnected,
  };
}
