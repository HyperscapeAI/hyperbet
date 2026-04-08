import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Hls from "hls.js";
import { describeCanonicalRendererDegradedReason } from "../lib/streamSession";
import type { ViewerBootPhase } from "../player/viewerBootPhases";

interface StreamPlayerProps {
  streamUrl: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  deliveryMode?: string | null;
  presentationDelayMs?: number | null;
  syncToleranceMs?: number;
  showDiagnostics?: boolean;
  onStreamUnavailable?: () => void;
  onStreamReady?: () => void;
  onStatusChange?: (status: StreamPlayerStatus) => void;
}

export type ViewerSyncState =
  | "starting"
  | "aligned"
  | "buffering"
  | "out_of_sync"
  | "error";

export type StreamPlayerStatus = {
  ready: boolean;
  status: string | null;
  liveEdgeLatencyMs: number | null;
  stallCount: number;
  rebuildCount: number;
  lastBufferedFragmentAt: number | null;
  playbackUrl: string | null;
  deliveryMode: string | null;
  firstFrameAt: number | null;
  startupDurationMs: number | null;
  playbackStarted: boolean;
  presentationDelayMs: number | null;
  syncDeltaMs: number | null;
  syncState: ViewerSyncState;
  bootPhase: ViewerBootPhase;
  loaderVisible: boolean;
};

type EmbedStatusPayload = {
  type?: string;
  ready?: boolean;
  status?: string | null;
  liveEdgeLatencyMs?: number | null;
  stallCount?: number | null;
  rebuildCount?: number | null;
  lastBufferedFragmentAt?: number | null;
  playbackUrl?: string | null;
  deliveryMode?: string | null;
  firstFrameAt?: number | null;
  startupDurationMs?: number | null;
  playbackStarted?: boolean | null;
  presentationDelayMs?: number | null;
  syncDeltaMs?: number | null;
  syncState?: ViewerSyncState | null;
  bootPhase?: ViewerBootPhase | null;
  loaderVisible?: boolean | null;
  rendererHealth?: {
    ready?: boolean;
    degradedReason?: string | null;
  } | null;
};

type HlsPlaybackProfile = {
  config: Record<string, unknown>;
  driftThresholdMs: number;
  waitingGraceMs: number;
  reloadOnBufferStall: boolean;
  rebuildOnVideoError: boolean;
  minVideoErrorTailMs: number;
  startupGraceMs: number;
};

const LOW_LATENCY_HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: true,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 4,
  liveBackBufferLength: 10,
  maxBufferLength: 6,
  maxMaxBufferLength: 12,
  maxLiveSyncPlaybackRate: 1.5,
  startFragPrefetch: true,
  manifestLoadingMaxRetry: 6,
  manifestLoadingRetryDelay: 800,
  levelLoadingMaxRetry: 6,
  levelLoadingRetryDelay: 800,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 800,
} as const;

export const LIVE_EDGE_HLS_CONFIG = LOW_LATENCY_HLS_CONFIG;

const STABLE_LIVE_HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  liveSyncDurationCount: 5,
  liveMaxLatencyDurationCount: 10,
  liveBackBufferLength: 20,
  maxBufferLength: 18,
  maxMaxBufferLength: 30,
  maxLiveSyncPlaybackRate: 1.1,
  startFragPrefetch: false,
  manifestLoadingMaxRetry: 6,
  manifestLoadingRetryDelay: 800,
  levelLoadingMaxRetry: 6,
  levelLoadingRetryDelay: 800,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 800,
} as const;

export const StreamPlayer: React.FC<StreamPlayerProps> = ({
  streamUrl,
  poster,
  autoPlay = true,
  muted = true,
  className,
  style,
  deliveryMode = null,
  presentationDelayMs = null,
  syncToleranceMs = 1_500,
  showDiagnostics = false,
  onStreamUnavailable,
  onStreamReady,
  onStatusChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncTrackerRef = useRef<{
    consecutiveOutOfSyncPolls: number;
    consecutiveAlignedPolls: number;
    syncState: ViewerSyncState;
  }>({
    consecutiveOutOfSyncPolls: 0,
    consecutiveAlignedPolls: 0,
    syncState: "starting",
  });
  const embedUrl = useMemo(
    () =>
      resolveEmbedUrl(streamUrl, autoPlay, muted, {
        deliveryMode,
        presentationDelayMs,
        showDiagnostics,
        syncToleranceMs,
      }),
    [
      autoPlay,
      deliveryMode,
      muted,
      presentationDelayMs,
      showDiagnostics,
      streamUrl,
      syncToleranceMs,
    ],
  );
  const embedKind = useMemo(() => classifyEmbedKind(embedUrl), [embedUrl]);
  const unavailableNotifiedRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const [embedFailure, setEmbedFailure] = useState<string | null>(null);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(null);
  const [playerStatus, setPlayerStatus] = useState<StreamPlayerStatus>(() =>
    createInitialPlayerStatus({
      streamUrl,
      deliveryMode,
      presentationDelayMs,
    }),
  );

  const markUnavailable = useCallback(
    (
      reason = "Live stream unavailable.",
      status: string = "error:unavailable",
    ) => {
      setDiagnosticMessage(reason);
      setEmbedFailure((current) => current ?? reason);
      setPlayerStatus((current) => ({
        ...current,
        ready: false,
        status,
        loaderVisible: true,
        bootPhase: "error",
      }));
      if (unavailableNotifiedRef.current) return;
      unavailableNotifiedRef.current = true;
      onStreamUnavailable?.();
    },
    [onStreamUnavailable],
  );

  const markReady = useCallback(() => {
    setEmbedFailure(null);
    setDiagnosticMessage(null);
    setPlayerStatus((current) => ({
      ...current,
      ready: true,
      status: "playing",
      bootPhase: "finalizing",
      loaderVisible: false,
    }));
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    onStreamReady?.();
  }, [onStreamReady]);

  const markDegraded = useCallback((reason: string | null, status?: string | null) => {
    setDiagnosticMessage(reason);
    if (status) {
      setPlayerStatus((current) => ({
        ...current,
        ready: false,
        status,
        loaderVisible: true,
      }));
    }
  }, []);

  useEffect(() => {
    unavailableNotifiedRef.current = false;
    readyNotifiedRef.current = false;
    syncTrackerRef.current = {
      consecutiveOutOfSyncPolls: 0,
      consecutiveAlignedPolls: 0,
      syncState: "starting",
    };
    setEmbedFailure(null);
    setDiagnosticMessage(null);
    setPlayerStatus(
      createInitialPlayerStatus({
        streamUrl,
        deliveryMode,
        presentationDelayMs,
      }),
    );
  }, [deliveryMode, presentationDelayMs, streamUrl]);

  useEffect(() => {
    const nextSync = advanceViewerSyncState({
      previousState: syncTrackerRef.current.syncState,
      consecutiveAlignedPolls: syncTrackerRef.current.consecutiveAlignedPolls,
      consecutiveOutOfSyncPolls: syncTrackerRef.current.consecutiveOutOfSyncPolls,
      liveEdgeLatencyMs: playerStatus.liveEdgeLatencyMs,
      playbackStarted: playerStatus.playbackStarted,
      presentationDelayMs: playerStatus.presentationDelayMs,
      ready: playerStatus.ready,
      status: playerStatus.status,
      syncToleranceMs,
    });
    syncTrackerRef.current = {
      consecutiveOutOfSyncPolls: nextSync.consecutiveOutOfSyncPolls,
      consecutiveAlignedPolls: nextSync.consecutiveAlignedPolls,
      syncState: nextSync.syncState,
    };
    if (
      playerStatus.syncDeltaMs !== nextSync.syncDeltaMs ||
      playerStatus.syncState !== nextSync.syncState
    ) {
      setPlayerStatus((current) => ({
        ...current,
        syncDeltaMs: nextSync.syncDeltaMs,
        syncState: nextSync.syncState,
      }));
    }
  }, [
    playerStatus.liveEdgeLatencyMs,
    playerStatus.playbackStarted,
    playerStatus.presentationDelayMs,
    playerStatus.ready,
    playerStatus.status,
    playerStatus.syncDeltaMs,
    playerStatus.syncState,
    syncToleranceMs,
  ]);

  useEffect(() => {
    onStatusChange?.(playerStatus);
  }, [onStatusChange, playerStatus]);

  useEffect(() => {
    if (embedUrl) return;
    markUnavailable();
  }, [embedUrl, markUnavailable]);

  useEffect(() => {
    if (embedKind !== "hyperscape-public") return;
    markUnavailable(
      "Invalid stream configuration. Embedded Hyperscapes streams must use a tokenized /stream URL.",
    );
  }, [embedKind, markUnavailable]);

  useEffect(() => {
    if (
      !embedUrl ||
      (embedKind !== "hyperscape" && embedKind !== "hls-player") ||
      typeof window === "undefined"
    ) {
      return;
    }

    const embedOrigin = getEmbedOrigin(embedUrl);
    if (!embedOrigin) {
      return;
    }

    const expectedMessageType =
      embedKind === "hyperscape"
        ? "HYPERSCAPE_STREAM_STATUS"
        : "HLS_PLAYER_STATUS";
    let seenStatusMessage = false;
    const bootstrapTimeout = window.setTimeout(() => {
      if (!seenStatusMessage) {
        markUnavailable(
          embedKind === "hyperscape"
            ? "Failed to initialize the embedded Hyperscapes stream."
            : "Failed to initialize the embedded HLS stream.",
        );
      }
    }, 10_000);

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== embedOrigin) return;
      if (!event.data || typeof event.data !== "object") return;

      const payload = event.data as EmbedStatusPayload;
      if (payload.type !== expectedMessageType) {
        return;
      }

      seenStatusMessage = true;
      window.clearTimeout(bootstrapTimeout);
      setPlayerStatus((current) => ({
        ...current,
        ready: payload.ready === true ? true : current.ready,
        status:
          typeof payload.status === "string" && payload.status.trim().length > 0
            ? payload.status.trim()
            : current.status,
        liveEdgeLatencyMs:
          typeof payload.liveEdgeLatencyMs === "number" &&
          Number.isFinite(payload.liveEdgeLatencyMs)
            ? payload.liveEdgeLatencyMs
            : current.liveEdgeLatencyMs,
        stallCount:
          typeof payload.stallCount === "number" &&
          Number.isFinite(payload.stallCount)
            ? payload.stallCount
            : current.stallCount,
        rebuildCount:
          typeof payload.rebuildCount === "number" &&
          Number.isFinite(payload.rebuildCount)
            ? payload.rebuildCount
            : current.rebuildCount,
        lastBufferedFragmentAt:
          typeof payload.lastBufferedFragmentAt === "number" &&
          Number.isFinite(payload.lastBufferedFragmentAt)
            ? payload.lastBufferedFragmentAt
            : current.lastBufferedFragmentAt,
        playbackUrl:
          typeof payload.playbackUrl === "string" && payload.playbackUrl.trim().length > 0
            ? payload.playbackUrl.trim()
            : current.playbackUrl,
        deliveryMode:
          typeof payload.deliveryMode === "string" && payload.deliveryMode.trim().length > 0
            ? payload.deliveryMode.trim()
            : current.deliveryMode,
        firstFrameAt:
          typeof payload.firstFrameAt === "number" &&
          Number.isFinite(payload.firstFrameAt)
            ? payload.firstFrameAt
            : current.firstFrameAt,
        startupDurationMs:
          typeof payload.startupDurationMs === "number" &&
          Number.isFinite(payload.startupDurationMs)
            ? payload.startupDurationMs
            : current.startupDurationMs,
        playbackStarted:
          payload.playbackStarted === true ? true : current.playbackStarted,
        presentationDelayMs:
          typeof payload.presentationDelayMs === "number" &&
          Number.isFinite(payload.presentationDelayMs)
            ? Math.max(0, payload.presentationDelayMs)
            : current.presentationDelayMs,
        syncDeltaMs:
          typeof payload.syncDeltaMs === "number" &&
          Number.isFinite(payload.syncDeltaMs)
            ? payload.syncDeltaMs
            : current.syncDeltaMs,
        syncState:
          payload.syncState && payload.syncState.trim().length > 0
            ? payload.syncState
            : current.syncState,
        bootPhase:
          payload.bootPhase && payload.bootPhase.trim().length > 0
            ? payload.bootPhase
            : current.bootPhase,
        loaderVisible:
          typeof payload.loaderVisible === "boolean"
            ? payload.loaderVisible
            : current.loaderVisible,
      }));

      if (payload.ready === true) {
        markReady();
        return;
      }

      const degradedStatus =
        typeof payload.status === "string" && payload.status.trim().length > 0
          ? payload.status.trim()
          : typeof payload.rendererHealth?.degradedReason === "string" &&
              payload.rendererHealth.degradedReason.trim().length > 0
            ? payload.rendererHealth.degradedReason.trim()
            : null;

      if (degradedStatus && degradedStatus.startsWith("error:")) {
        markUnavailable(
          embedKind === "hyperscape"
            ? describeHyperscapeEmbedError(degradedStatus)
            : describeHlsEmbedError(degradedStatus),
        );
        return;
      }

      if (!isTransientPlayerStatus(degradedStatus)) {
        markDegraded(
          describePlayerStatus(degradedStatus, embedKind),
          degradedStatus ?? undefined,
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(bootstrapTimeout);
      window.removeEventListener("message", handleMessage);
    };
  }, [embedKind, embedUrl, markDegraded, markReady, markUnavailable]);

  useEffect(() => {
    // External embeddable URLs render through iframe mode below.
    if (embedUrl) return;

    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let latencyInterval: ReturnType<typeof setInterval> | null = null;
    let waitingTimeout: ReturnType<typeof setTimeout> | null = null;
    let recoveryCooldownUntil = 0;
    let fatalErrorCount = 0;
    let disposed = false;
    let lastProgressAt = Date.now();
    let lastCurrentTime = 0;
    let recentVideoErrorRecoveries = 0;
    let playbackStarted = false;
    let startupStartedAt = Date.now();
    let playerReady = false;
    const sourceUrl = streamUrl.trim();
    const playbackProfile = resolveHlsPlaybackProfile(sourceUrl, deliveryMode);

    const updateTelemetry = (
      next:
        | Partial<StreamPlayerStatus>
        | ((current: StreamPlayerStatus) => StreamPlayerStatus),
    ) => {
      setPlayerStatus((current) =>
        typeof next === "function"
          ? next(current)
          : {
              ...current,
              ...next,
            },
      );
    };

    const clearRetry = () => {
      if (!retryTimeout) return;
      clearTimeout(retryTimeout);
      retryTimeout = null;
    };

    const clearLatencyInterval = () => {
      if (!latencyInterval) return;
      clearInterval(latencyInterval);
      latencyInterval = null;
    };

    const clearWaitingTimeout = () => {
      if (!waitingTimeout) return;
      clearTimeout(waitingTimeout);
      waitingTimeout = null;
    };

    const syncLatencyTelemetry = () => {
      const latencyMs = readLiveEdgeLatencyMs(hls, video);
      updateTelemetry({
        liveEdgeLatencyMs: latencyMs,
        playbackUrl: sourceUrl,
        deliveryMode: resolvePlayerDeliveryModeHint(sourceUrl, deliveryMode),
        presentationDelayMs:
          typeof presentationDelayMs === "number" && Number.isFinite(presentationDelayMs)
            ? Math.max(0, presentationDelayMs)
            : null,
      });
      if (
        playbackStarted &&
        !video.paused &&
        (latencyMs == null || latencyMs <= playbackProfile.driftThresholdMs)
      ) {
        playerReady = true;
        markDegraded(null);
        markReady();
        return;
      }
      if (
        shouldTreatPlaybackLatencyAsDrifted({
          driftThresholdMs: playbackProfile.driftThresholdMs,
          latencyMs,
          playbackStarted,
          ready: playerReady,
        })
      ) {
        playerReady = false;
        markDegraded(
          describeCanonicalRendererDegradedReason("player_drifted"),
        );
      }
    };

    const notePlaybackProgress = () => {
      if (video.currentTime > lastCurrentTime + 0.05) {
        playbackStarted = true;
        lastCurrentTime = video.currentTime;
        lastProgressAt = Date.now();
        recentVideoErrorRecoveries = 0;
        playerReady = true;
        const firstFrameAt = Date.now();
        updateTelemetry((current) => ({
          ...current,
          playbackStarted: true,
          firstFrameAt: current.firstFrameAt ?? firstFrameAt,
          startupDurationMs:
            current.startupDurationMs ?? firstFrameAt - startupStartedAt,
        }));
        markDegraded(null);
        markReady();
      }
    };

    const readBufferedTailMs = () => {
      if (video.buffered.length === 0) {
        return null;
      }
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const remaining = bufferedEnd - video.currentTime;
      if (!Number.isFinite(remaining) || remaining < 0) {
        return null;
      }
      return Math.round(remaining * 1000);
    };

    const startLatencyPolling = () => {
      clearLatencyInterval();
      latencyInterval = setInterval(syncLatencyTelemetry, 1000);
    };

    const isStartupPending = (now = Date.now()) =>
      shouldTreatPlaybackStartupAsPending({
        currentTime: video.currentTime,
        now,
        playbackStarted,
        startupGraceMs: playbackProfile.startupGraceMs,
        startupStartedAt,
      });

    const recoverPlayback = (
      reason: string,
      {
        reloadSource = false,
        recoverMedia = false,
        delayMs = 0,
      }: {
        reloadSource?: boolean;
        recoverMedia?: boolean;
        delayMs?: number;
      } = {},
    ) => {
      const run = () => {
        if (disposed) return;

        const now = Date.now();
        if (now < recoveryCooldownUntil) {
          return;
        }
        recoveryCooldownUntil = now + 2500;

        console.warn(`[StreamPlayer] Recovering playback: ${reason}`);
        if (recoverMedia) {
          hls?.recoverMediaError();
        }
        if (reloadSource) {
          hls?.startLoad(-1);
        }
        syncLatencyTelemetry();
        void video.play().catch(() => {});
      };

      clearRetry();
      if (delayMs > 0) {
        retryTimeout = setTimeout(run, delayMs);
        return;
      }

      run();
    };

    const rebuildPlayer = (reason: string, delayMs = 1500) => {
      console.warn(`[StreamPlayer] Rebuilding stream: ${reason}`);
      updateTelemetry((current) => ({
        ...current,
        rebuildCount: current.rebuildCount + 1,
      }));
      markDegraded("Rebuilding live stream...");
      clearRetry();
      retryTimeout = setTimeout(() => {
        if (disposed) return;
        void initPlayer();
      }, delayMs);
    };

    const initPlayer = async () => {
      if (disposed) return;

      clearRetry();
      fatalErrorCount = 0;
      recoveryCooldownUntil = 0;

      if (hls) {
        hls.destroy();
        hls = null;
      }
      clearLatencyInterval();
      clearWaitingTimeout();
      playbackStarted = false;
      playerReady = false;
      startupStartedAt = Date.now();
      lastProgressAt = startupStartedAt;
      lastCurrentTime = 0;
      recentVideoErrorRecoveries = 0;
      updateTelemetry((current) => ({
        ...current,
        liveEdgeLatencyMs: null,
        lastBufferedFragmentAt: null,
        playbackUrl: sourceUrl,
        deliveryMode: resolvePlayerDeliveryModeHint(sourceUrl, deliveryMode),
        firstFrameAt: null,
        startupDurationMs: null,
        playbackStarted: false,
        presentationDelayMs:
          typeof presentationDelayMs === "number" && Number.isFinite(presentationDelayMs)
            ? Math.max(0, presentationDelayMs)
            : null,
      }));

      video.preload = "auto";
      if (autoPlay) {
        video.autoplay = true;
      }
      video.muted = muted;

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = sourceUrl;
        startLatencyPolling();
        syncLatencyTelemetry();
        void video.play().catch(() => {});
        return;
      }

      if (!Hls.isSupported()) {
        console.error("[StreamPlayer] HLS is not supported in this browser");
        markUnavailable("HLS is not supported in this browser.");
        return;
      }

      hls = new Hls({ ...playbackProfile.config });

      hls.loadSource(sourceUrl);
      hls.attachMedia(video);
      startLatencyPolling();

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("[StreamPlayer] Manifest parsed, starting playback");
        markDegraded(null);
        syncLatencyTelemetry();
        void video.play().catch(() => {});
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        clearWaitingTimeout();
        lastProgressAt = Date.now();
        recentVideoErrorRecoveries = 0;
        updateTelemetry({
          lastBufferedFragmentAt: Date.now(),
        });
        syncLatencyTelemetry();
        markDegraded(null);
        markReady();
      });

      hls.on(Hls.Events.LEVEL_UPDATED, () => {
        syncLatencyTelemetry();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.warn(
          "[StreamPlayer] HLS error:",
          data.type,
          data.details,
          data.fatal,
        );

        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            if (isStartupPending()) {
              recoverPlayback("startup buffer stall", {
                reloadSource: true,
                recoverMedia: true,
                delayMs: 750,
              });
              return;
            }
            updateTelemetry((current) => ({
              ...current,
              stallCount: current.stallCount + 1,
            }));
            markDegraded(
              describeCanonicalRendererDegradedReason("player_drifted"),
            );
            if (playbackProfile.reloadOnBufferStall) {
              recoverPlayback("buffer stalled near live edge", {
                reloadSource: true,
              });
            } else {
              syncLatencyTelemetry();
              void video.play().catch(() => {});
            }
          } else if (
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
          ) {
            updateTelemetry((current) => ({
              ...current,
              stallCount: current.stallCount + 1,
            }));
            markDegraded("Reconnecting to the live stream.");
            recoverPlayback("fragment/level load timeout", {
              reloadSource: true,
            });
          } else if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR) {
            updateTelemetry((current) => ({
              ...current,
              stallCount: current.stallCount + 1,
            }));
            markDegraded("Recovering live stream...");
            recoverPlayback("buffer append issue", {
              recoverMedia: true,
              reloadSource: true,
            });
          }
          return;
        }

        fatalErrorCount += 1;

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (fatalErrorCount < 3) {
              markDegraded("Reconnecting to the live edge...");
              recoverPlayback("fatal network error", {
                reloadSource: true,
                delayMs: 1000,
              });
            } else {
              rebuildPlayer("repeated fatal network error", 2000);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (fatalErrorCount < 3) {
              markDegraded("Recovering live playback...");
              recoverPlayback("fatal media error", {
                recoverMedia: true,
                reloadSource: true,
                delayMs: 500,
              });
            } else {
              rebuildPlayer("repeated fatal media error", 2000);
            }
            break;
          default:
            if (fatalErrorCount < 2) {
              rebuildPlayer("fatal HLS error", 2000);
            } else {
              markUnavailable("Live stream unavailable.");
            }
            break;
        }
      });
    };

    const onLoadedMetadata = () => markReady();
    const onLoadedData = () => markReady();
    const onCanPlay = () => markReady();
    const onPlaying = () => {
      clearWaitingTimeout();
      notePlaybackProgress();
      markDegraded(null);
      syncLatencyTelemetry();
      markReady();
    };
    const onWaiting = () => {
      clearWaitingTimeout();
      waitingTimeout = setTimeout(() => {
        const now = Date.now();
        if (isStartupPending(now)) {
          syncLatencyTelemetry();
          return;
        }
        if (!playbackStarted && video.currentTime <= 0.05) {
          markDegraded("Reconnecting to the live stream.");
          recoverPlayback("startup waiting timeout", {
            reloadSource: true,
            recoverMedia: true,
            delayMs: 750,
          });
          return;
        }
        const bufferedTailMs = readBufferedTailMs();
        const idleForMs = now - lastProgressAt;
        if (
          bufferedTailMs != null &&
          bufferedTailMs > playbackProfile.minVideoErrorTailMs &&
          idleForMs < playbackProfile.waitingGraceMs * 2
        ) {
          syncLatencyTelemetry();
          return;
        }
        updateTelemetry((current) => ({
          ...current,
          stallCount: current.stallCount + 1,
        }));
        markDegraded("Player buffering near the live edge.");
      }, playbackProfile.waitingGraceMs);
    };
    const onStalled = () => {
      clearWaitingTimeout();
      if (isStartupPending()) {
        syncLatencyTelemetry();
        return;
      }
      if (!playbackStarted && video.currentTime <= 0.05) {
        markDegraded("Reconnecting to the live stream.");
        recoverPlayback("startup video stalled", {
          reloadSource: true,
          recoverMedia: true,
          delayMs: 750,
        });
        return;
      }
      updateTelemetry((current) => ({
        ...current,
        stallCount: current.stallCount + 1,
      }));
      markDegraded(describeCanonicalRendererDegradedReason("player_drifted"));
      recoverPlayback("video stalled", {
        reloadSource: true,
        recoverMedia: true,
        delayMs: 750,
      });
    };
    const onTimeUpdate = () => {
      notePlaybackProgress();
      syncLatencyTelemetry();
    };
    const onVideoError = () => {
      const bufferedTailMs = readBufferedTailMs();
      const idleForMs = Date.now() - lastProgressAt;
      if (
        !playbackProfile.rebuildOnVideoError &&
        recentVideoErrorRecoveries < 2
      ) {
        recentVideoErrorRecoveries += 1;
        updateTelemetry((current) => ({
          ...current,
          stallCount: current.stallCount + 1,
        }));
        markDegraded("Recovering live playback...");
        recoverPlayback("video element error", {
          reloadSource: true,
          recoverMedia: true,
          delayMs:
            bufferedTailMs != null &&
            bufferedTailMs > playbackProfile.minVideoErrorTailMs
              ? 1250
              : 750,
        });
        return;
      }
      rebuildPlayer("video element error", 1000);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("error", onVideoError);

    void initPlayer();

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onVideoError);
      clearRetry();
      clearLatencyInterval();
      clearWaitingTimeout();
      disposed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [
    embedUrl,
    streamUrl,
    autoPlay,
    deliveryMode,
    muted,
    markDegraded,
    markReady,
    markUnavailable,
    presentationDelayMs,
  ]);
  const overlayMessage = embedFailure ?? diagnosticMessage;

  if (!embedUrl) {
    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          ...style,
        }}
      >
        <video
          ref={videoRef}
          poster={poster}
          autoPlay={autoPlay}
          muted={muted}
          playsInline
          controls={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            backgroundColor: "#000",
          }}
        />
        {overlayMessage ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              textAlign: "center",
              color: "#f3e4ba",
              fontFamily: "system-ui, sans-serif",
              fontSize: "0.95rem",
              lineHeight: 1.5,
              background:
                embedFailure != null
                  ? "linear-gradient(180deg, rgba(2,4,10,0.76), rgba(2,4,10,0.88))"
                  : "linear-gradient(180deg, rgba(2,4,10,0.38), rgba(2,4,10,0.72))",
            }}
          >
            <div
              style={{
                maxWidth: "28rem",
                padding: "1rem 1.25rem",
                border: "1px solid rgba(243, 228, 186, 0.28)",
                borderRadius: "0.9rem",
                backgroundColor: "rgba(8, 11, 20, 0.72)",
                boxShadow: "0 16px 48px rgba(0, 0, 0, 0.28)",
              }}
            >
              {overlayMessage}
            </div>
          </div>
        ) : null}
        {showDiagnostics ? <PlayerDiagnostics telemetry={playerStatus} /> : null}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "30%",
            background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      {embedKind === "hyperscape-public" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "#000",
          }}
        />
      ) : (
        <iframe
          key={`${embedUrl}|${poster ?? ""}`}
          src={embedUrl}
          title="Live Stream"
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          loading="eager"
          onLoad={
            embedKind === "hyperscape" || embedKind === "hls-player"
              ? undefined
              : markReady
          }
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => markUnavailable()}
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            display: "block",
            backgroundColor: "#000",
          }}
        />
      )}
      {overlayMessage ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            color: "#f3e4ba",
            fontFamily: "system-ui, sans-serif",
            fontSize: "0.95rem",
            lineHeight: 1.5,
            background:
              embedFailure != null
                ? "linear-gradient(180deg, rgba(2,4,10,0.76), rgba(2,4,10,0.88))"
                : "linear-gradient(180deg, rgba(2,4,10,0.38), rgba(2,4,10,0.72))",
          }}
        >
          <div
            style={{
              maxWidth: "28rem",
              padding: "1rem 1.25rem",
              border: "1px solid rgba(243, 228, 186, 0.28)",
              borderRadius: "0.9rem",
              backgroundColor: "rgba(8, 11, 20, 0.72)",
              boxShadow: "0 16px 48px rgba(0, 0, 0, 0.28)",
            }}
          >
            {overlayMessage}
          </div>
        </div>
      ) : null}
      {showDiagnostics ? <PlayerDiagnostics telemetry={playerStatus} /> : null}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "30%",
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

function createInitialPlayerStatus(params: {
  streamUrl: string;
  deliveryMode: string | null;
  presentationDelayMs: number | null;
}): StreamPlayerStatus {
  return {
    ready: false,
    status: "loading",
    liveEdgeLatencyMs: null,
    stallCount: 0,
    rebuildCount: 0,
    lastBufferedFragmentAt: null,
    playbackUrl: params.streamUrl.trim() || null,
    deliveryMode: resolvePlayerDeliveryModeHint(
      params.streamUrl,
      params.deliveryMode,
    ),
    firstFrameAt: null,
    startupDurationMs: null,
    playbackStarted: false,
    presentationDelayMs:
      typeof params.presentationDelayMs === "number" &&
      Number.isFinite(params.presentationDelayMs)
        ? Math.max(0, params.presentationDelayMs)
        : null,
    syncDeltaMs: null,
    syncState: "starting",
    bootPhase: "connecting",
    loaderVisible: true,
  };
}

export function buildHlsPlayerEmbedUrl(
  streamUrl: string,
  autoPlay: boolean,
  muted: boolean,
  options: {
    deliveryMode: string | null;
    presentationDelayMs: number | null;
    showDiagnostics: boolean;
    syncToleranceMs: number;
  },
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const baseOrigin =
    typeof window.location.origin === "string" &&
    /^https?:\/\//i.test(window.location.origin)
      ? window.location.origin
      : "http://localhost";
  const playerUrl = new URL("/hls-player", baseOrigin);
  playerUrl.searchParams.set("src", streamUrl);
  playerUrl.searchParams.set("autoplay", autoPlay ? "1" : "0");
  playerUrl.searchParams.set("muted", muted ? "1" : "0");
  const deliveryModeHint = resolvePlayerDeliveryModeHint(
    streamUrl,
    options.deliveryMode,
  );
  if (deliveryModeHint) {
    playerUrl.searchParams.set("deliveryMode", deliveryModeHint);
  }
  if (
    typeof options.presentationDelayMs === "number" &&
    Number.isFinite(options.presentationDelayMs)
  ) {
    playerUrl.searchParams.set(
      "presentationDelayMs",
      String(Math.max(0, options.presentationDelayMs)),
    );
  }
  if (options.syncToleranceMs > 0) {
    playerUrl.searchParams.set(
      "syncToleranceMs",
      String(Math.max(0, options.syncToleranceMs)),
    );
  }
  if (options.showDiagnostics) {
    playerUrl.searchParams.set("debug", "1");
  }
  return playerUrl.toString();
}

function resolveEmbedUrl(
  inputUrl: string,
  autoPlay: boolean,
  muted: boolean,
  options: {
    deliveryMode: string | null;
    presentationDelayMs: number | null;
    showDiagnostics: boolean;
    syncToleranceMs: number;
  },
): string | null {
  const trimmed = inputUrl.trim();
  if (!trimmed) return null;

  const parsed = parseUrl(trimmed);
  if (!parsed) return null;
  const pathname = parsed.pathname.toLowerCase();

  if (pathname.endsWith(".m3u8")) {
    return buildHlsPlayerEmbedUrl(
      parsed.toString(),
      autoPlay,
      muted,
      options,
    );
  }

  const host = parsed.hostname.toLowerCase();

  if (
    host.includes("youtube.com") ||
    host.includes("youtu.be") ||
    host.includes("youtube-nocookie.com")
  ) {
    return toYoutubeEmbedUrl(parsed, autoPlay, muted);
  }

  if (host.includes("twitch.tv")) {
    return toTwitchEmbedUrl(parsed, autoPlay, muted);
  }

  parsed.searchParams.set("autoplay", autoPlay ? "1" : "0");
  parsed.searchParams.set("mute", muted ? "1" : "0");
  return parsed.toString();
}

function toYoutubeEmbedUrl(
  url: URL,
  autoPlay: boolean,
  muted: boolean,
): string | null {
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);
  const embeddedId =
    pathParts[0] === "embed" && pathParts[1] !== "live_stream"
      ? pathParts[1]
      : null;
  const videoId =
    host === "youtu.be" || host.endsWith(".youtu.be")
      ? pathParts[0]
      : url.searchParams.get("v") ||
        (pathParts[0] === "live" ? pathParts[1] : null) ||
        (pathParts[0] === "shorts" ? pathParts[1] : null) ||
        embeddedId;

  let embed: URL;
  if (videoId) {
    embed = new URL(`https://www.youtube.com/embed/${videoId}`);
  } else {
    const channelId =
      url.searchParams.get("channel") || url.searchParams.get("c");
    if (!channelId) return null;
    embed = new URL("https://www.youtube.com/embed/live_stream");
    embed.searchParams.set("channel", channelId);
  }

  embed.searchParams.set("autoplay", autoPlay ? "1" : "0");
  embed.searchParams.set("mute", muted ? "1" : "0");
  embed.searchParams.set("playsinline", "1");
  embed.searchParams.set("controls", "0");
  embed.searchParams.set("rel", "0");
  embed.searchParams.set("modestbranding", "1");
  return embed.toString();
}

function toTwitchEmbedUrl(
  url: URL,
  autoPlay: boolean,
  muted: boolean,
): string | null {
  const host = url.hostname.toLowerCase();
  const parentHost =
    typeof window !== "undefined" ? window.location.hostname : "localhost";

  let embed = url;
  if (!host.includes("player.twitch.tv")) {
    const channel = url.pathname.split("/").filter(Boolean)[0];
    if (!channel) return null;
    embed = new URL("https://player.twitch.tv/");
    embed.searchParams.set("channel", channel);
  }

  embed.searchParams.set("parent", parentHost);
  embed.searchParams.set("autoplay", autoPlay ? "true" : "false");
  embed.searchParams.set("muted", muted ? "true" : "false");
  return embed.toString();
}

function classifyEmbedKind(
  embedUrl: string | null,
): "generic" | "hls-player" | "hyperscape" | "hyperscape-public" {
  if (!embedUrl) return "generic";

  const parsed = parseUrl(embedUrl);
  if (!parsed) return "generic";

  const pathname = parsed.pathname.toLowerCase();
  if (
    pathname.endsWith("/hls-player.html") ||
    pathname === "/hls-player.html" ||
    pathname.endsWith("/hls-player") ||
    pathname === "/hls-player"
  ) {
    return "hls-player";
  }
  const page = (parsed.searchParams.get("page") || "").trim().toLowerCase();
  const isStreamRoute =
    pathname.endsWith("/stream") ||
    pathname === "/stream" ||
    pathname.endsWith("/stream.html") ||
    pathname === "/stream.html" ||
    page === "stream";

  if (!isStreamRoute) return "generic";
  if (parsed.searchParams.has("streamToken")) return "hyperscape";
  if (parsed.hostname.toLowerCase().includes("hyperscape")) {
    return "hyperscape-public";
  }
  return "generic";
}

function getEmbedOrigin(embedUrl: string): string | null {
  const parsed = parseUrl(embedUrl);
  return parsed?.origin ?? null;
}

function inferDeliveryMode(streamUrl: string): string | null {
  const parsed = parseUrl(streamUrl);
  if (!parsed) return null;
  const protocol = (parsed.searchParams.get("protocol") || "").trim().toLowerCase();
  if (protocol === "llhls") {
    return "external_hls/llhls";
  }
  if (parsed.pathname.toLowerCase().endsWith(".m3u8")) {
    return "self_hls/hls";
  }
  if (
    parsed.pathname.toLowerCase().endsWith("/stream") ||
    parsed.pathname.toLowerCase().endsWith("/stream.html")
  ) {
    return "embedded_hyperscape";
  }
  return null;
}

export function resolvePlayerDeliveryModeHint(
  streamUrl: string,
  explicitDeliveryMode: string | null | undefined,
): string | null {
  const inferredDeliveryMode = inferDeliveryMode(streamUrl);
  const normalizedExplicitDeliveryMode =
    explicitDeliveryMode && explicitDeliveryMode.trim().length > 0
      ? explicitDeliveryMode.trim()
      : null;

  if (
    inferredDeliveryMode === "external_hls/llhls" &&
    normalizedExplicitDeliveryMode !== "external_hls/llhls"
  ) {
    return inferredDeliveryMode;
  }

  return normalizedExplicitDeliveryMode ?? inferredDeliveryMode;
}

export function resolveHlsPlaybackProfile(
  streamUrl: string,
  explicitDeliveryMode: string | null | undefined = null,
): HlsPlaybackProfile {
  const deliveryMode = resolvePlayerDeliveryModeHint(
    streamUrl,
    explicitDeliveryMode,
  );
  if (deliveryMode === "external_hls/llhls") {
    return {
      config: LOW_LATENCY_HLS_CONFIG,
      driftThresholdMs: 8_000,
      waitingGraceMs: 450,
      reloadOnBufferStall: true,
      rebuildOnVideoError: true,
      minVideoErrorTailMs: 750,
      startupGraceMs: 4_000,
    };
  }

  return {
    config: STABLE_LIVE_HLS_CONFIG,
    driftThresholdMs: 20_000,
    waitingGraceMs: 2_500,
    reloadOnBufferStall: false,
    rebuildOnVideoError: false,
    minVideoErrorTailMs: 1_500,
    startupGraceMs: 7_000,
  };
}

export function shouldTreatPlaybackStartupAsPending(params: {
  currentTime: number;
  now: number;
  playbackStarted: boolean;
  startupGraceMs: number;
  startupStartedAt: number;
}): boolean {
  return (
    !params.playbackStarted &&
    params.currentTime <= 0.05 &&
    params.now - params.startupStartedAt < params.startupGraceMs
  );
}

export function shouldTreatPlaybackLatencyAsDrifted(params: {
  driftThresholdMs: number;
  latencyMs: number | null;
  playbackStarted: boolean;
  ready: boolean;
}): boolean {
  return (
    params.ready &&
    params.playbackStarted &&
    params.latencyMs != null &&
    Number.isFinite(params.latencyMs) &&
    params.latencyMs > params.driftThresholdMs
  );
}

export function advanceViewerSyncState(params: {
  previousState: ViewerSyncState;
  consecutiveOutOfSyncPolls: number;
  consecutiveAlignedPolls: number;
  liveEdgeLatencyMs: number | null;
  playbackStarted: boolean;
  presentationDelayMs: number | null;
  ready: boolean;
  status: string | null;
  syncToleranceMs: number;
}): {
  consecutiveOutOfSyncPolls: number;
  consecutiveAlignedPolls: number;
  syncDeltaMs: number | null;
  syncState: ViewerSyncState;
} {
  const normalizedStatus = (params.status ?? "").trim().toLowerCase();
  const syncDeltaMs =
    params.liveEdgeLatencyMs != null &&
    Number.isFinite(params.liveEdgeLatencyMs) &&
    params.presentationDelayMs != null &&
    Number.isFinite(params.presentationDelayMs)
      ? Math.round(params.liveEdgeLatencyMs - params.presentationDelayMs)
      : null;

  if (normalizedStatus.startsWith("error:")) {
    return {
      consecutiveOutOfSyncPolls: 0,
      consecutiveAlignedPolls: 0,
      syncDeltaMs,
      syncState: "error",
    };
  }

  if (
    !params.playbackStarted ||
    !params.ready ||
    normalizedStatus === "loading" ||
    normalizedStatus === "manifest_ready" ||
    normalizedStatus === "reconnecting"
  ) {
    return {
      consecutiveOutOfSyncPolls: 0,
      consecutiveAlignedPolls: 0,
      syncDeltaMs,
      syncState: "starting",
    };
  }

  if (normalizedStatus === "buffering") {
    return {
      consecutiveOutOfSyncPolls: 3,
      consecutiveAlignedPolls: 0,
      syncDeltaMs,
      syncState: "buffering",
    };
  }

  if (normalizedStatus === "player_drifted") {
    return {
      consecutiveOutOfSyncPolls: 3,
      consecutiveAlignedPolls: 0,
      syncDeltaMs,
      syncState: "out_of_sync",
    };
  }

  const overTolerance =
    syncDeltaMs != null &&
    Math.abs(syncDeltaMs) > Math.max(0, params.syncToleranceMs);

  if (overTolerance) {
    const consecutiveOutOfSyncPolls = params.consecutiveOutOfSyncPolls + 1;
    return {
      consecutiveOutOfSyncPolls,
      consecutiveAlignedPolls: 0,
      syncDeltaMs,
      syncState:
        consecutiveOutOfSyncPolls >= 3
          ? "out_of_sync"
          : params.previousState === "buffering" ||
              params.previousState === "out_of_sync"
            ? params.previousState
            : "aligned",
    };
  }

  const consecutiveAlignedPolls =
    params.previousState === "buffering" ||
    params.previousState === "out_of_sync"
      ? params.consecutiveAlignedPolls + 1
      : 0;

  return {
    consecutiveOutOfSyncPolls: 0,
    consecutiveAlignedPolls,
    syncDeltaMs,
    syncState:
      params.previousState === "buffering" ||
      params.previousState === "out_of_sync"
        ? consecutiveAlignedPolls >= 2
          ? "aligned"
          : params.previousState
        : "aligned",
  };
}

function readLiveEdgeLatencyMs(
  hls: Hls | null,
  video: HTMLVideoElement,
): number | null {
  if (hls && typeof hls.latency === "number" && Number.isFinite(hls.latency)) {
    return Math.max(0, Math.round(hls.latency * 1000));
  }

  if (video.seekable.length > 0) {
    const liveEdge = video.seekable.end(video.seekable.length - 1);
    const remaining = liveEdge - video.currentTime;
    if (Number.isFinite(remaining) && remaining >= 0) {
      return Math.round(remaining * 1000);
    }
  }

  if (video.buffered.length > 0) {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const remaining = bufferedEnd - video.currentTime;
    if (Number.isFinite(remaining) && remaining >= 0) {
      return Math.round(remaining * 1000);
    }
  }

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return null;
  }

  const remaining = video.duration - video.currentTime;
  if (!Number.isFinite(remaining) || remaining < 0) {
    return null;
  }

  return Math.round(remaining * 1000);
}

function describeHyperscapeEmbedError(status: string): string {
  switch (status) {
    case "error:viewer_access_denied":
      return "Live stream access is currently restricted for this page.";
    case "error:webgpu_required":
      return "This browser cannot render the live 3D stream.";
    case "error:http":
      return "The live stream is temporarily unavailable.";
    case "error:init_failed":
      return "Failed to initialize the live 3D stream.";
    default:
      return "Live stream unavailable.";
  }
}

function describeHlsEmbedError(status: string): string {
  switch (status) {
    case "error:missing_stream_url":
      return "Missing live stream URL.";
    case "error:hls_not_supported":
      return "HLS playback is not supported in this browser.";
    case "error:unavailable":
    case "error:fatal":
      return "Live stream unavailable.";
    default:
      return "Failed to initialize the embedded HLS stream.";
  }
}

function describePlayerStatus(
  status: string | null,
  embedKind: "generic" | "hls-player" | "hyperscape" | "hyperscape-public",
): string | null {
  const normalized = (status || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("error:")) {
    return embedKind === "hyperscape"
      ? describeHyperscapeEmbedError(normalized)
      : describeHlsEmbedError(normalized);
  }
  switch (normalized) {
    case "player_drifted":
      return describeCanonicalRendererDegradedReason("player_drifted");
    case "buffering":
      return "Player buffering near the live edge.";
    case "reconnecting":
      return "Reconnecting to the live stream.";
    default:
      return describeCanonicalRendererDegradedReason(normalized);
  }
}

function isTransientPlayerStatus(status: string | null): boolean {
  const normalized = (status || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "loading" ||
    normalized === "playing" ||
    normalized === "manifest_ready"
  );
}

function formatLatencyLabel(latencyMs: number | null): string {
  if (latencyMs == null || !Number.isFinite(latencyMs)) {
    return "n/a";
  }
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

function formatBufferedLabel(timestamp: number | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return "n/a";
  }
  const ageMs = Math.max(0, Date.now() - timestamp);
  return `${(ageMs / 1000).toFixed(1)}s ago`;
}

function PlayerDiagnostics({
  telemetry,
}: {
  telemetry: StreamPlayerStatus;
}) {
  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: 2,
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(5, 8, 16, 0.7)",
        color: "#d3dae8",
        fontFamily:
          'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        pointerEvents: "none",
        minWidth: 156,
      }}
    >
      <div>latency {formatLatencyLabel(telemetry.liveEdgeLatencyMs)}</div>
      <div>stalls {telemetry.stallCount}</div>
      <div>rebuilds {telemetry.rebuildCount}</div>
      <div>buffered {formatBufferedLabel(telemetry.lastBufferedFragmentAt)}</div>
      {telemetry.deliveryMode ? <div>mode {telemetry.deliveryMode}</div> : null}
      {telemetry.presentationDelayMs != null ? (
        <div>delay {formatLatencyLabel(telemetry.presentationDelayMs)}</div>
      ) : null}
      <div>sync {telemetry.syncState}</div>
    </div>
  );
}

function parseUrl(rawValue: string): URL | null {
  try {
    return new URL(rawValue);
  } catch {
    return null;
  }
}
