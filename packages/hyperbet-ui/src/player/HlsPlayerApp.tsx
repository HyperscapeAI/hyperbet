import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";

import {
  advanceViewerSyncState,
  DEFAULT_SYNC_TOLERANCE_MS,
  isPlaybackLatencyWithinBudget,
  preferHighestViableHlsLevel,
  RECENT_PLAYER_SIGNAL_THRESHOLD,
  recordRecentPlaybackSignal,
  resolveHlsPlaybackProfile,
  resolvePlaybackTargetSize,
  resolvePlaybackSyncDeltaMs,
  resolvePlayerDeliveryModeHint,
  selectPreferredHlsStartLevelFromManifest,
  shouldTreatPlaybackLatencyAsDrifted,
  type StreamPlayerStatus,
  type ViewerSyncState,
} from "../components/StreamPlayer";
import {
  advanceViewerLoaderState,
  createInitialViewerLoaderState,
  hideViewerLoader,
  type ViewerBootPhase,
  type ViewerLoaderState,
} from "./viewerBootPhases";
import { HyperscapeLoadingShell } from "./HyperscapeLoadingShell";

type EmbedStatusPayload = {
  type: "HLS_PLAYER_STATUS";
  ready: boolean;
  status: string;
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

type ParsedPlayerQuery = {
  streamUrl: string | null;
  autoplay: boolean;
  muted: boolean;
  debugEnabled: boolean;
  deliveryMode: string | null;
  presentationDelayMs: number | null;
  syncToleranceMs: number;
};

type DebugWindow = Window & {
  __HB_HLS_DEBUG?: Record<string, unknown>;
};

type RuntimeState = {
  readySent: boolean;
  currentStatus: string;
  stalledCount: number;
  rebuildCount: number;
  fatalErrorCount: number;
  recoveryCooldownUntil: number;
  retryTimeout: number | null;
  latencyInterval: number | null;
  waitingTimeout: number | null;
  hls: Hls | null;
  activeStreamUrl: string | null;
  llhlsFallbackUsed: boolean;
  llhlsFallbackFailureTimestamps: number[];
  waitingSignalTimestamps: number[];
  lastHlsError: {
    type: string | null;
    details: string | null;
    fatal: boolean;
    responseCode: number | null;
    url: string | null;
  } | null;
  lastProgressAt: number;
  lastCurrentTime: number;
  recentVideoErrorRecoveries: number;
  startupStartedAt: number;
  playerReady: boolean;
  playbackStarted: boolean;
  playbackProfile: ReturnType<typeof resolveHlsPlaybackProfile> | null;
  syncState: ViewerSyncState;
  consecutiveOutOfSyncPolls: number;
  consecutiveAlignedPolls: number;
  debugPreferredStartLevel: number | null;
  debugTargetWidth: number | null;
  debugTargetHeight: number | null;
  telemetry: StreamPlayerStatus;
  loader: ViewerLoaderState;
};

function buildStandardHlsUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (
      (parsed.searchParams.get("protocol") || "").trim().toLowerCase() !==
      "llhls"
    ) {
      return parsed.toString();
    }
    parsed.searchParams.delete("protocol");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveBufferedPresentationDelayTarget(params: {
  bufferedStart: number;
  bufferedEnd: number;
  liveEdge: number;
  presentationDelayMs: number | null;
}): number | null {
  if (
    !Number.isFinite(params.bufferedStart) ||
    !Number.isFinite(params.bufferedEnd) ||
    !Number.isFinite(params.liveEdge) ||
    params.bufferedEnd <= params.bufferedStart
  ) {
    return null;
  }
  if (
    params.presentationDelayMs == null ||
    !Number.isFinite(params.presentationDelayMs) ||
    params.presentationDelayMs <= 0
  ) {
    return null;
  }

  const minTarget = params.bufferedStart + 0.01;
  const maxTarget = params.bufferedEnd - 0.01;
  if (!Number.isFinite(minTarget) || !Number.isFinite(maxTarget) || maxTarget <= minTarget) {
    return null;
  }

  const desiredTarget = params.liveEdge - params.presentationDelayMs / 1000;
  if (!Number.isFinite(desiredTarget)) {
    return null;
  }

  return Math.min(maxTarget, Math.max(minTarget, desiredTarget));
}

export function shouldPreferNativeHlsPlayback(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouchPoints =
    typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  const isIosWebKit =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const isSafariDesktop =
    /Safari\//.test(userAgent) &&
    !/Chrome\/|Chromium\/|CriOS\/|Edg\/|OPR\/|Firefox\/|FxiOS\//.test(userAgent);
  return isIosWebKit || isSafariDesktop;
}

export function normalizeManagedPlaybackQuery(
  params: ParsedPlayerQuery,
): ParsedPlayerQuery {
  const deliveryMode = resolvePlayerDeliveryModeHint(
    params.streamUrl || "",
    params.deliveryMode,
  );
  if (
    deliveryMode !== "external_hls/llhls" ||
    shouldPreferNativeHlsPlayback()
  ) {
    return params;
  }

  const standardUrl = buildStandardHlsUrl(params.streamUrl);
  return {
    ...params,
    streamUrl: standardUrl,
    deliveryMode: standardUrl ? "external_hls/hls" : params.deliveryMode,
  };
}

export function resolveObservedPlaybackLatencyMs(params: {
  currentTime: number;
  hlsLatencySeconds: number | null;
  seekableEnd: number | null;
  bufferedEnd: number | null;
  duration: number | null;
}): number | null {
  const candidates: number[] = [];

  if (
    params.seekableEnd != null &&
    Number.isFinite(params.seekableEnd) &&
    Number.isFinite(params.currentTime)
  ) {
    const remaining = params.seekableEnd - params.currentTime;
    if (Number.isFinite(remaining) && remaining >= 0) {
      candidates.push(Math.round(remaining * 1000));
    }
  }

  if (
    params.bufferedEnd != null &&
    Number.isFinite(params.bufferedEnd) &&
    Number.isFinite(params.currentTime)
  ) {
    const remaining = params.bufferedEnd - params.currentTime;
    if (Number.isFinite(remaining) && remaining >= 0) {
      candidates.push(Math.round(remaining * 1000));
    }
  }

  if (
    params.hlsLatencySeconds != null &&
    Number.isFinite(params.hlsLatencySeconds)
  ) {
    candidates.push(Math.max(0, Math.round(params.hlsLatencySeconds * 1000)));
  }

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  if (
    params.duration == null ||
    !Number.isFinite(params.duration) ||
    params.duration <= 0 ||
    !Number.isFinite(params.currentTime)
  ) {
    return null;
  }

  const remaining = params.duration - params.currentTime;
  if (!Number.isFinite(remaining) || remaining < 0) {
    return null;
  }

  return Math.round(remaining * 1000);
}

export function HlsPlayerApp() {
  const params = useMemo(
    () => normalizeManagedPlaybackQuery(readPlayerQuery()),
    [],
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runtimeRef = useRef<RuntimeState>({
    readySent: false,
    currentStatus: "loading",
    stalledCount: 0,
    rebuildCount: 0,
    fatalErrorCount: 0,
    recoveryCooldownUntil: 0,
    retryTimeout: null,
    latencyInterval: null,
    waitingTimeout: null,
    hls: null,
    activeStreamUrl: params.streamUrl,
    llhlsFallbackUsed: false,
    llhlsFallbackFailureTimestamps: [],
    waitingSignalTimestamps: [],
    lastHlsError: null,
    lastProgressAt: Date.now(),
    lastCurrentTime: 0,
    recentVideoErrorRecoveries: 0,
    startupStartedAt: Date.now(),
    playerReady: false,
    playbackStarted: false,
    playbackProfile: null,
    syncState: "starting",
    consecutiveOutOfSyncPolls: 0,
    consecutiveAlignedPolls: 0,
    debugPreferredStartLevel: null,
    debugTargetWidth: null,
    debugTargetHeight: null,
    telemetry: createInitialTelemetry(params),
    loader: createInitialViewerLoaderState(),
  });
  const [loaderState, setLoaderState] = useState<ViewerLoaderState>(
    runtimeRef.current.loader,
  );
  const [diagnosticsText, setDiagnosticsText] = useState("");
  const [videoVisible, setVideoVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let disposed = false;
    const runtime = runtimeRef.current;
    const setDebugState = (patch: Record<string, unknown>) => {
      if (!params.debugEnabled) {
        return;
      }
      const debugWindow = window as DebugWindow;
      debugWindow.__HB_HLS_DEBUG = {
        ...(debugWindow.__HB_HLS_DEBUG ?? {}),
        ...patch,
      };
    };

    const setLoaderStateAndRemember = (next: ViewerLoaderState) => {
      runtime.loader = next;
      runtime.telemetry.bootPhase = next.phase;
      runtime.telemetry.loaderVisible = next.visible;
      setLoaderState(next);
    };

    const updateLoaderPhase = (
      phase: ViewerBootPhase,
      options: {
        overlayMessage?: string | null;
        stageLabel?: string | null;
        visible?: boolean;
      } = {},
    ) => {
      setLoaderStateAndRemember(
        advanceViewerLoaderState(runtime.loader, phase, options),
      );
    };

    const setLoaderVisible = (visible: boolean) => {
      setLoaderStateAndRemember(
        visible ? { ...runtime.loader, visible } : hideViewerLoader(runtime.loader),
      );
    };

    const readBufferedRanges = () => {
      if (!video.buffered || video.buffered.length === 0) {
        return [];
      }
      const ranges: Array<[number, number]> = [];
      for (let index = 0; index < video.buffered.length; index += 1) {
        ranges.push([
          Number(video.buffered.start(index).toFixed(3)),
          Number(video.buffered.end(index).toFixed(3)),
        ]);
      }
      return ranges;
    };

    const parseDeliveryMode = (url: string | null) =>
      url ? resolvePlayerDeliveryModeHint(url, params.deliveryMode) : null;

    const emitStatus = () => {
      const nextSync = advanceViewerSyncState({
        previousState: runtime.syncState,
        consecutiveAlignedPolls: runtime.consecutiveAlignedPolls,
        consecutiveOutOfSyncPolls: runtime.consecutiveOutOfSyncPolls,
        liveEdgeLatencyMs: runtime.telemetry.liveEdgeLatencyMs,
        playbackStarted: runtime.playbackStarted,
        presentationDelayMs: runtime.telemetry.presentationDelayMs,
        ready: runtime.readySent,
        status: runtime.currentStatus,
        syncToleranceMs: params.syncToleranceMs,
      });
      runtime.syncState = nextSync.syncState;
      runtime.consecutiveAlignedPolls = nextSync.consecutiveAlignedPolls;
      runtime.consecutiveOutOfSyncPolls = nextSync.consecutiveOutOfSyncPolls;
      runtime.telemetry.syncDeltaMs = nextSync.syncDeltaMs;
      runtime.telemetry.syncState = nextSync.syncState;

      if (params.debugEnabled) {
        setDiagnosticsText(
          [
            `latency ${formatLatencyLabel(runtime.telemetry.liveEdgeLatencyMs)}`,
            `delay ${formatLatencyLabel(runtime.telemetry.presentationDelayMs)}`,
            `stalls ${runtime.telemetry.stallCount}`,
            `rebuilds ${runtime.telemetry.rebuildCount}`,
            `buffered ${formatBufferedLabel(runtime.telemetry.lastBufferedFragmentAt)}`,
            runtime.telemetry.deliveryMode
              ? `mode ${runtime.telemetry.deliveryMode}`
              : null,
            runtime.debugPreferredStartLevel != null
              ? `pref ${runtime.debugPreferredStartLevel}`
              : null,
            runtime.debugTargetWidth != null && runtime.debugTargetHeight != null
              ? `target ${runtime.debugTargetWidth}x${runtime.debugTargetHeight}`
              : null,
            runtime.hls != null
              ? `levels c${runtime.hls.currentLevel} n${runtime.hls.nextLevel} nl${runtime.hls.nextLoadLevel} a${runtime.hls.autoLevelCapping}`
              : null,
            `sync ${runtime.telemetry.syncState}`,
            `boot ${runtime.loader.phase}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      try {
        if (window.parent && window.parent !== window) {
          const payload: EmbedStatusPayload = {
            type: "HLS_PLAYER_STATUS",
            ready: runtime.readySent,
            status: runtime.currentStatus,
            liveEdgeLatencyMs: runtime.telemetry.liveEdgeLatencyMs,
            stallCount: runtime.telemetry.stallCount,
            rebuildCount: runtime.telemetry.rebuildCount,
            lastBufferedFragmentAt: runtime.telemetry.lastBufferedFragmentAt,
            playbackUrl: runtime.telemetry.playbackUrl,
            deliveryMode: runtime.telemetry.deliveryMode,
            firstFrameAt: runtime.telemetry.firstFrameAt,
            startupDurationMs: runtime.telemetry.startupDurationMs,
            playbackStarted: runtime.telemetry.playbackStarted,
            presentationDelayMs: runtime.telemetry.presentationDelayMs,
            syncDeltaMs: runtime.telemetry.syncDeltaMs,
            syncState: runtime.telemetry.syncState,
            bootPhase: runtime.loader.phase,
            loaderVisible: runtime.loader.visible,
          };
          window.parent.postMessage(payload, window.location.origin);
        }
      } catch {
        // Ignore cross-frame postMessage failures.
      }
    };

    const setTelemetry = (patch: Partial<StreamPlayerStatus>) => {
      Object.assign(runtime.telemetry, patch);
      emitStatus();
    };

    const clearRetry = () => {
      if (runtime.retryTimeout == null) return;
      window.clearTimeout(runtime.retryTimeout);
      runtime.retryTimeout = null;
    };

    const clearLatencyInterval = () => {
      if (runtime.latencyInterval == null) return;
      window.clearInterval(runtime.latencyInterval);
      runtime.latencyInterval = null;
    };

    const clearWaitingTimeout = () => {
      if (runtime.waitingTimeout == null) return;
      window.clearTimeout(runtime.waitingTimeout);
      runtime.waitingTimeout = null;
    };

    const destroyPlayer = () => {
      clearRetry();
      clearLatencyInterval();
      clearWaitingTimeout();
      runtime.hls?.destroy();
      runtime.hls = null;
    };

    const showOverlay = (message: string | null, phase: ViewerBootPhase) => {
      updateLoaderPhase(phase, {
        overlayMessage: message,
        visible: true,
      });
    };

    const markLoading = (
      nextStatus = "loading",
      nextPhase: ViewerBootPhase = "connecting",
    ) => {
      runtime.currentStatus = nextStatus;
      runtime.readySent = false;
      runtime.playerReady = false;
      if (!runtime.playbackStarted) {
        updateLoaderPhase(nextPhase, { overlayMessage: null, visible: true });
      }
      emitStatus();
    };

    const markDegraded = (
      message: string,
      nextStatus: string,
      phase: ViewerBootPhase = "reconnecting",
    ) => {
      runtime.currentStatus = nextStatus;
      runtime.readySent = false;
      runtime.playerReady = false;
      showOverlay(message, phase);
      emitStatus();
    };

    const markUnavailable = (
      message: string,
      nextStatus = "error:unavailable",
    ) => {
      runtime.currentStatus = nextStatus;
      runtime.readySent = false;
      runtime.playerReady = false;
      updateLoaderPhase("error", {
        overlayMessage: message,
        visible: true,
      });
      emitStatus();
    };

    const markReady = () => {
      runtime.currentStatus = "playing";
      runtime.readySent = true;
      runtime.playerReady = true;
      setVideoVisible(true);
      setLoaderVisible(false);
      emitStatus();
    };

    const chooseBufferedStartupTarget = () => {
      if (!video.buffered || video.buffered.length === 0) {
        return null;
      }
      const lastIndex = video.buffered.length - 1;
      const bufferedStart = video.buffered.start(lastIndex);
      const bufferedEnd = video.buffered.end(lastIndex);
      if (!Number.isFinite(bufferedStart) || !Number.isFinite(bufferedEnd)) {
        return null;
      }
      const liveEdge =
        video.seekable.length > 0
          ? video.seekable.end(video.seekable.length - 1)
          : bufferedEnd;

      const delayedTarget = resolveBufferedPresentationDelayTarget({
        bufferedStart,
        bufferedEnd,
        liveEdge,
        presentationDelayMs: params.presentationDelayMs,
      });
      if (delayedTarget != null) {
        return delayedTarget;
      }

      let target: number | null =
        runtime.hls && Number.isFinite(runtime.hls.liveSyncPosition)
          ? runtime.hls.liveSyncPosition
          : null;
      if (
        target == null ||
        !Number.isFinite(target) ||
        target < bufferedStart ||
        target > bufferedEnd
      ) {
        const tailPadding = Math.min(
          0.35,
          Math.max(0.05, bufferedEnd - bufferedStart),
        );
        target = bufferedEnd - tailPadding;
      }

      const safeTarget = target ?? bufferedEnd - 0.01;
      return Math.min(
        bufferedEnd - 0.01,
        Math.max(bufferedStart + 0.01, safeTarget),
      );
    };

    const alignPlaybackToPresentationDelay = (reason: string) => {
      if (!video.buffered || video.buffered.length === 0) {
        return false;
      }
      const lastIndex = video.buffered.length - 1;
      const bufferedStart = video.buffered.start(lastIndex);
      const bufferedEnd = video.buffered.end(lastIndex);
      if (!Number.isFinite(bufferedStart) || !Number.isFinite(bufferedEnd)) {
        return false;
      }
      const liveEdge =
        video.seekable.length > 0
          ? video.seekable.end(video.seekable.length - 1)
          : bufferedEnd;
      const target = resolveBufferedPresentationDelayTarget({
        bufferedStart,
        bufferedEnd,
        liveEdge,
        presentationDelayMs: params.presentationDelayMs,
      });
      if (target == null || Math.abs(video.currentTime - target) <= 0.1) {
        return false;
      }

      try {
        video.currentTime = target;
      } catch {
        return false;
      }

      runtime.lastProgressAt = Date.now();
      if (!runtime.readySent) {
        updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
      }
      console.info(`[hls-player] aligning playback via ${reason}`, {
        target,
        liveEdge,
        buffered: readBufferedRanges(),
        streamUrl: runtime.activeStreamUrl,
      });
      void video.play().catch(() => {});
      return true;
    };

    const syncFirstFrameTelemetry = () => {
      if (!runtime.telemetry.firstFrameAt) {
        runtime.telemetry.firstFrameAt = Date.now();
        runtime.telemetry.startupDurationMs =
          runtime.telemetry.firstFrameAt - runtime.startupStartedAt;
      }
    };

    const promoteBufferedStartup = (reason: string) => {
      if (
        runtime.playbackStarted ||
        video.currentTime > 0.05 ||
        !video.buffered ||
        video.buffered.length === 0
      ) {
        return false;
      }

      const target = chooseBufferedStartupTarget();
      if (!Number.isFinite(target)) {
        return false;
      }

      const safeTarget = target ?? video.currentTime;

      if (Math.abs(video.currentTime - safeTarget) > 0.05) {
        try {
          video.currentTime = safeTarget;
        } catch {
          return false;
        }
      }

      runtime.lastProgressAt = Date.now();
      if (!runtime.readySent) {
        updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
      }
      syncTelemetry();
      console.info(`[hls-player] promoting buffered startup via ${reason}`, {
        target,
        buffered: readBufferedRanges(),
        streamUrl: runtime.activeStreamUrl,
      });
      void video.play().catch(() => {});
      return true;
    };

    const hasBufferedPresentationDelay = () => {
      if (params.presentationDelayMs == null || params.presentationDelayMs <= 0) {
        return true;
      }
      const bufferedTailMs = readBufferedTailMs();
      return bufferedTailMs != null && bufferedTailMs >= params.presentationDelayMs;
    };

    const maybeStartPlayback = (reason: string) => {
      if (!params.autoplay) {
        return;
      }
      if (!hasBufferedPresentationDelay()) {
        if (!runtime.readySent) {
          updateLoaderPhase("buffering_media", {
            overlayMessage: null,
            visible: true,
          });
        }
        syncTelemetry();
        return;
      }
      promoteBufferedStartup(`${reason}_startup`);
      void video.play().catch(() => {});
    };

    const revealDecodedFrame = (reason: string) => {
      if (runtime.readySent || runtime.playbackStarted || video.readyState < 2) {
        return false;
      }
      syncFirstFrameTelemetry();
      updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
      console.info(`[hls-player] decoded first frame via ${reason}`, {
        readyState: video.readyState,
        buffered: readBufferedRanges(),
        streamUrl: runtime.activeStreamUrl,
      });
      markReady();
      return true;
    };

    const fallbackToStandardHls = (reason: string) => {
      if (runtime.llhlsFallbackUsed) {
        return false;
      }
      const standardUrl = buildStandardHlsUrl(runtime.activeStreamUrl);
      if (!standardUrl || standardUrl === runtime.activeStreamUrl) {
        return false;
      }
      runtime.llhlsFallbackFailureTimestamps = recordRecentPlaybackSignal(
        runtime.llhlsFallbackFailureTimestamps,
        Date.now(),
      );
      if (
        runtime.llhlsFallbackFailureTimestamps.length <
        RECENT_PLAYER_SIGNAL_THRESHOLD
      ) {
        return false;
      }

      runtime.llhlsFallbackUsed = true;
      runtime.activeStreamUrl = standardUrl;
      console.warn(`[hls-player] falling back to standard HLS: ${reason}`, {
        nextUrl: standardUrl,
      });
      markDegraded(
        "Low-latency stream unstable. Switching to stable playback.",
        "reconnecting",
        "reconnecting",
      );
      destroyPlayer();
      runtime.retryTimeout = window.setTimeout(() => {
        runtime.retryTimeout = null;
        initPlayer();
      }, 250);
      return true;
    };

    const notePlaybackProgress = () => {
      if (video.currentTime > runtime.lastCurrentTime + 0.05) {
        runtime.playbackStarted = true;
        runtime.lastCurrentTime = video.currentTime;
        runtime.lastProgressAt = Date.now();
        runtime.recentVideoErrorRecoveries = 0;
        runtime.waitingSignalTimestamps = [];
        syncFirstFrameTelemetry();
        setTelemetry({
          firstFrameAt: runtime.telemetry.firstFrameAt,
          startupDurationMs: runtime.telemetry.startupDurationMs,
          playbackStarted: true,
        });
        markReady();
      }
    };

    const isStartupPending = (now = Date.now()) =>
      runtime.playbackProfile != null &&
      !runtime.playbackStarted &&
      video.currentTime <= 0.05 &&
      now - runtime.startupStartedAt < runtime.playbackProfile.startupGraceMs;

    const readBufferedTailMs = () => {
      if (!video.buffered || video.buffered.length === 0) {
        return null;
      }
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const remaining = bufferedEnd - video.currentTime;
      if (!Number.isFinite(remaining) || remaining < 0) {
        return null;
      }
      return Math.round(remaining * 1000);
    };

    const readLiveEdgeLatencyMs = () => {
      return resolveObservedPlaybackLatencyMs({
        currentTime: video.currentTime,
        hlsLatencySeconds:
          runtime.hls && typeof runtime.hls.latency === "number"
            ? runtime.hls.latency
            : null,
        seekableEnd:
          video.seekable.length > 0
            ? video.seekable.end(video.seekable.length - 1)
            : null,
        bufferedEnd:
          video.buffered.length > 0
            ? video.buffered.end(video.buffered.length - 1)
            : null,
        duration: Number.isFinite(video.duration) ? video.duration : null,
      });
    };

    const syncTelemetry = () => {
      const latencyMs = readLiveEdgeLatencyMs();
      const syncDeltaMs = resolvePlaybackSyncDeltaMs(
        latencyMs,
        params.presentationDelayMs,
      );
      setTelemetry({
        liveEdgeLatencyMs: latencyMs,
        playbackUrl: runtime.activeStreamUrl,
        deliveryMode: parseDeliveryMode(runtime.activeStreamUrl),
        presentationDelayMs: params.presentationDelayMs,
      });
      if (
        runtime.playbackStarted &&
        !video.paused &&
        (runtime.playbackProfile == null ||
          isPlaybackLatencyWithinBudget({
            driftThresholdMs: runtime.playbackProfile.driftThresholdMs,
            syncDriftThresholdMs:
              runtime.playbackProfile.syncDriftThresholdMs,
            latencyMs,
            presentationDelayMs: params.presentationDelayMs,
          }))
      ) {
        if (!runtime.readySent || runtime.currentStatus !== "playing") {
          markReady();
        }
        return;
      }
      const tooCloseToLiveEdge =
        runtime.playbackProfile != null &&
        syncDeltaMs != null &&
        syncDeltaMs < -runtime.playbackProfile.syncDriftThresholdMs;
      if (tooCloseToLiveEdge && alignPlaybackToPresentationDelay("sync_drift")) {
        return;
      }
      if (
        runtime.playbackProfile != null &&
        shouldTreatPlaybackLatencyAsDrifted({
          driftThresholdMs: runtime.playbackProfile.driftThresholdMs,
          syncDriftThresholdMs: runtime.playbackProfile.syncDriftThresholdMs,
          latencyMs,
          presentationDelayMs: params.presentationDelayMs,
          playbackStarted: runtime.playbackStarted,
          ready: runtime.readySent,
        })
      ) {
        markDegraded(
          "Playback drifted from the live edge.",
          "player_drifted",
          "reconnecting",
        );
        recoverPlayback({ reloadSource: true });
      }
    };

    const startLatencyPolling = () => {
      clearLatencyInterval();
      runtime.latencyInterval = window.setInterval(syncTelemetry, 1000);
    };

    const recoverPlayback = ({
      reloadSource = false,
      recoverMedia = false,
      delayMs = 0,
    }: {
      reloadSource?: boolean;
      recoverMedia?: boolean;
      delayMs?: number;
    } = {}) => {
      const run = () => {
        const now = Date.now();
        if (now < runtime.recoveryCooldownUntil) return;
        runtime.recoveryCooldownUntil = now + 2000;
        if (recoverMedia && runtime.hls) {
          runtime.hls.recoverMediaError();
        }
        if (reloadSource && runtime.hls) {
          runtime.hls.startLoad(-1);
        }
        syncTelemetry();
        void video.play().catch(() => {});
      };

      clearRetry();
      if (delayMs > 0) {
        runtime.retryTimeout = window.setTimeout(run, delayMs);
        return;
      }
      run();
    };

    const rebuildPlayer = (reason: string, delayMs = 1500) => {
      console.warn(`[hls-player] rebuilding: ${reason}`);
      runtime.rebuildCount += 1;
      setTelemetry({ rebuildCount: runtime.rebuildCount });
      markDegraded("Rebuilding live stream...", "reconnecting", "reconnecting");
      destroyPlayer();
      runtime.retryTimeout = window.setTimeout(() => {
        runtime.retryTimeout = null;
        initPlayer();
      }, delayMs);
    };

    const logPlaybackDiagnostic = (reason: string) => {
      const videoError = video.error
        ? {
            code: video.error.code,
            message: video.error.message || null,
          }
        : null;
      console.warn(`[hls-player] ${reason}`, {
        streamUrl: runtime.activeStreamUrl,
        currentTime: Number(video.currentTime.toFixed(3)),
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        buffered: readBufferedRanges(),
        videoError,
        lastHlsError: runtime.lastHlsError,
      });
    };

    const attachCommonVideoEvents = () => {
      video.addEventListener("loadedmetadata", () => {
        if (runtime.hls) {
          preferHighestViableHlsLevel(runtime.hls, video);
        }
        if (!runtime.readySent) {
          updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
        }
        promoteBufferedStartup("loadedmetadata");
        revealDecodedFrame("loadedmetadata");
        if (runtime.playbackStarted) {
          markReady();
        }
      });
      video.addEventListener("loadeddata", () => {
        if (runtime.hls) {
          preferHighestViableHlsLevel(runtime.hls, video);
        }
        if (!runtime.readySent) {
          updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
        }
        promoteBufferedStartup("loadeddata");
        revealDecodedFrame("loadeddata");
        if (runtime.playbackStarted) {
          markReady();
        }
      });
      video.addEventListener("canplay", () => {
        if (runtime.hls) {
          preferHighestViableHlsLevel(runtime.hls, video);
        }
        if (!runtime.readySent) {
          updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
        }
        promoteBufferedStartup("canplay");
        revealDecodedFrame("canplay");
        if (runtime.playbackStarted) {
          markReady();
        }
      });
      video.addEventListener("playing", () => {
        clearWaitingTimeout();
        notePlaybackProgress();
        syncTelemetry();
      });
      video.addEventListener("timeupdate", () => {
        notePlaybackProgress();
        syncTelemetry();
      });
      video.addEventListener("waiting", () => {
        clearWaitingTimeout();
        runtime.waitingTimeout = window.setTimeout(() => {
          const now = Date.now();
          if (isStartupPending(now)) {
            promoteBufferedStartup("waiting_startup");
            syncTelemetry();
            return;
          }
          if (!runtime.playbackStarted && video.currentTime <= 0.05) {
            if (promoteBufferedStartup("waiting_recovery")) {
              return;
            }
            markDegraded(
              "Reconnecting to the live stream.",
              "reconnecting",
              "reconnecting",
            );
            recoverPlayback({
              reloadSource: true,
              recoverMedia: true,
              delayMs: 750,
            });
            return;
          }
          const bufferedTailMs = readBufferedTailMs();
          const idleForMs = now - runtime.lastProgressAt;
          if (
            runtime.playbackProfile != null &&
            bufferedTailMs != null &&
            bufferedTailMs > runtime.playbackProfile.minVideoErrorTailMs &&
            idleForMs < runtime.playbackProfile.waitingGraceMs * 2
          ) {
            syncTelemetry();
            return;
          }
          runtime.stalledCount += 1;
          setTelemetry({ stallCount: runtime.stalledCount });
          runtime.waitingSignalTimestamps = recordRecentPlaybackSignal(
            runtime.waitingSignalTimestamps,
            now,
          );
          const repeatedWaitingSignals =
            runtime.waitingSignalTimestamps.length >=
            RECENT_PLAYER_SIGNAL_THRESHOLD;
          const sustainedIdleWithoutTail =
            bufferedTailMs == null &&
            runtime.playbackProfile != null &&
            idleForMs > runtime.playbackProfile.waitingGraceMs * 2;
          if (!repeatedWaitingSignals && !sustainedIdleWithoutTail) {
            syncTelemetry();
            return;
          }
          markDegraded(
            "Your playback is catching up to the live edge.",
            "buffering",
            "reconnecting",
          );
        }, runtime.playbackProfile?.waitingGraceMs ?? 750);
      });
      video.addEventListener("stalled", () => {
        clearWaitingTimeout();
        if (isStartupPending()) {
          promoteBufferedStartup("stalled_startup");
          syncTelemetry();
          return;
        }
        if (!runtime.playbackStarted && video.currentTime <= 0.05) {
          if (promoteBufferedStartup("stalled_recovery")) {
            return;
          }
          markDegraded(
            "Reconnecting to the live stream.",
            "reconnecting",
            "reconnecting",
          );
          recoverPlayback({
            reloadSource: true,
            recoverMedia: true,
            delayMs: 750,
          });
          return;
        }
        runtime.stalledCount += 1;
        setTelemetry({ stallCount: runtime.stalledCount });
        markDegraded(
          "Playback drifted from the live edge.",
          "player_drifted",
          "reconnecting",
        );
        recoverPlayback({
          reloadSource: true,
          recoverMedia: true,
          delayMs: 750,
        });
      });
      video.addEventListener("error", () => {
        logPlaybackDiagnostic("video element error");
        if (fallbackToStandardHls("video element error")) {
          return;
        }
        const bufferedTailMs = readBufferedTailMs();
        if (
          runtime.playbackProfile &&
          !runtime.playbackProfile.rebuildOnVideoError &&
          runtime.recentVideoErrorRecoveries < 2
        ) {
          runtime.recentVideoErrorRecoveries += 1;
          runtime.stalledCount += 1;
          setTelemetry({ stallCount: runtime.stalledCount });
          markDegraded(
            "Recovering live playback...",
            "buffering",
            "reconnecting",
          );
          recoverPlayback({
            reloadSource: true,
            recoverMedia: true,
            delayMs:
              bufferedTailMs != null &&
              runtime.playbackProfile != null &&
              bufferedTailMs > runtime.playbackProfile.minVideoErrorTailMs
                ? 1250
                : 750,
          });
          return;
        }
        rebuildPlayer("video element error", 1000);
      });
    };

    const resolvePreferredStartLevel = async (sourceUrl: string) => {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 4000);
        const response = await fetch(sourceUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        if (!response.ok) {
          return null;
        }
        const manifestText = await response.text();
        const { targetHeight, targetWidth } = resolvePlaybackTargetSize(video);
        runtime.debugTargetWidth = targetWidth;
        runtime.debugTargetHeight = targetHeight;
        return selectPreferredHlsStartLevelFromManifest(
          manifestText,
          targetWidth,
          targetHeight,
        );
      } catch {
        return null;
      }
    };

    const initPlayer = async () => {
      destroyPlayer();
      runtime.playbackProfile = resolveHlsPlaybackProfile(
        runtime.activeStreamUrl || "",
        params.deliveryMode,
      );
      runtime.telemetry = createInitialTelemetry(params);
      runtime.telemetry.playbackUrl = runtime.activeStreamUrl;
      runtime.telemetry.deliveryMode = parseDeliveryMode(runtime.activeStreamUrl);
      runtime.telemetry.presentationDelayMs = params.presentationDelayMs;
      runtime.currentStatus = "loading";
      runtime.readySent = false;
      runtime.playerReady = false;
      runtime.playbackStarted = false;
      runtime.lastHlsError = null;
      runtime.startupStartedAt = Date.now();
      runtime.lastProgressAt = runtime.startupStartedAt;
      runtime.lastCurrentTime = 0;
      runtime.recentVideoErrorRecoveries = 0;
      runtime.waitingSignalTimestamps = [];
      runtime.fatalErrorCount = 0;
      runtime.recoveryCooldownUntil = 0;
      runtime.consecutiveOutOfSyncPolls = 0;
      runtime.consecutiveAlignedPolls = 0;
      runtime.syncState = "starting";
      setVideoVisible(false);
      updateLoaderPhase("connecting", {
        overlayMessage: null,
        visible: true,
      });
      emitStatus();

      video.muted = params.muted;
      video.defaultMuted = params.muted;
      video.autoplay = params.autoplay;
      video.playsInline = true;
      if (params.muted) {
        video.setAttribute("muted", "");
      } else {
        video.removeAttribute("muted");
      }
      if (params.autoplay) {
        video.setAttribute("autoplay", "");
      } else {
        video.removeAttribute("autoplay");
      }

      if (!runtime.activeStreamUrl) {
        markUnavailable("Missing HLS stream URL.", "error:missing_stream_url");
        return;
      }

      const canUseNativeHls =
        video.canPlayType("application/vnd.apple.mpegurl") !== "";
      if (canUseNativeHls && shouldPreferNativeHlsPlayback()) {
        video.src = runtime.activeStreamUrl;
        startLatencyPolling();
        syncTelemetry();
        if (params.autoplay) {
          void video.play().catch(() => {});
        }
        return;
      }

      if (!Hls.isSupported()) {
        markUnavailable(
          "HLS playback is not supported in this browser.",
          "error:hls_not_supported",
        );
        return;
      }

      const {
        liveSyncDurationCount: _liveSyncDurationCount,
        liveMaxLatencyDurationCount: _liveMaxLatencyDurationCount,
        ...baseHlsConfig
      } = runtime.playbackProfile.config;
      const presentationDelaySeconds =
        params.presentationDelayMs != null && params.presentationDelayMs > 0
          ? params.presentationDelayMs / 1000
          : null;
      const hlsConfig =
        presentationDelaySeconds != null
          ? {
              ...baseHlsConfig,
              liveSyncDuration: Math.max(0.5, presentationDelaySeconds),
              liveMaxLatencyDuration: Math.max(
                presentationDelaySeconds + 2,
                presentationDelaySeconds * 1.5,
              ),
            }
          : runtime.playbackProfile.config;
      const preferredStartLevel = runtime.activeStreamUrl
        ? await resolvePreferredStartLevel(runtime.activeStreamUrl)
        : null;
      if (disposed) {
        return;
      }
      if (params.debugEnabled) {
        console.info("[hls-player] resolved preferred startup level", {
          preferredStartLevel,
          sourceUrl: runtime.activeStreamUrl,
        });
      }
      runtime.debugPreferredStartLevel = preferredStartLevel;
      setDebugState({
        preferredStartLevel,
        sourceUrl: runtime.activeStreamUrl,
      });
      runtime.hls = new Hls({
        ...hlsConfig,
        startLevel: preferredStartLevel ?? undefined,
      });
      if (preferredStartLevel != null) {
        runtime.hls.firstLevel = preferredStartLevel;
        runtime.hls.startLevel = preferredStartLevel;
        runtime.hls.autoLevelCapping = preferredStartLevel;
        runtime.hls.nextAutoLevel = preferredStartLevel;
      }
      runtime.hls.loadSource(runtime.activeStreamUrl);
      runtime.hls.attachMedia(video);
      startLatencyPolling();

      runtime.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setDebugState({
          manifestLevels: runtime.hls?.levels.map((level, index) => ({
            bitrate: level.bitrate ?? 0,
            height: level.height ?? 0,
            index,
            width: level.width ?? 0,
          })),
        });
        if (params.debugEnabled && runtime.hls) {
          console.info("[hls-player] manifest levels", {
            autoLevelCapping: runtime.hls.autoLevelCapping,
            currentLevel: runtime.hls.currentLevel,
            firstLevel: runtime.hls.firstLevel,
            levels: runtime.hls.levels.map((level, index) => ({
              bitrate: level.bitrate ?? 0,
              height: level.height ?? 0,
              index,
              width: level.width ?? 0,
            })),
            nextAutoLevel: runtime.hls.nextAutoLevel,
            startLevel: runtime.hls.startLevel,
          });
        }
        if (runtime.hls) {
          preferHighestViableHlsLevel(runtime.hls, video);
          setDebugState({
            postPreferAutoLevelCapping: runtime.hls.autoLevelCapping,
            postPreferCurrentLevel: runtime.hls.currentLevel,
            postPreferNextAutoLevel: runtime.hls.nextAutoLevel,
            postPreferStartLevel: runtime.hls.startLevel,
          });
        }
        updateLoaderPhase("initializing", {
          overlayMessage: null,
          visible: true,
        });
        runtime.currentStatus = "manifest_ready";
        emitStatus();
        syncTelemetry();
        maybeStartPlayback("manifest_parsed");
      });

      runtime.hls.on(Hls.Events.FRAG_BUFFERED, () => {
        clearWaitingTimeout();
        runtime.lastProgressAt = Date.now();
        runtime.recentVideoErrorRecoveries = 0;
        updateLoaderPhase("buffering_media", {
          overlayMessage: null,
          visible: true,
        });
        setTelemetry({ lastBufferedFragmentAt: Date.now() });
        promoteBufferedStartup("frag_buffered");
        revealDecodedFrame("frag_buffered");
        syncTelemetry();
        if (runtime.playbackStarted) {
          markReady();
        } else {
          maybeStartPlayback("frag_buffered");
        }
      });

      runtime.hls.on(Hls.Events.LEVEL_UPDATED, syncTelemetry);
      runtime.hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
        setDebugState({
          fragLevel: data.frag?.level ?? null,
          fragSn: data.frag?.sn ?? null,
          fragType: data.frag?.type ?? null,
        });
        if (!params.debugEnabled) {
          return;
        }
        console.info("[hls-player] loading fragment", {
          level: data.frag?.level ?? null,
          sn: data.frag?.sn ?? null,
          type: data.frag?.type ?? null,
        });
      });
      runtime.hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setDebugState({
          switchedLevel: data.level ?? null,
        });
        if (!params.debugEnabled) {
          return;
        }
        console.info("[hls-player] switched level", {
          level: data.level ?? null,
        });
      });
      runtime.hls.on(Hls.Events.ERROR, (_event, data) => {
        runtime.lastHlsError = {
          type: data.type || null,
          details: data.details || null,
          fatal: Boolean(data.fatal),
          responseCode: data.response?.code ?? null,
          url: data.context?.url || null,
        };

        const isLlhlsTransportFailure =
          parseDeliveryMode(runtime.activeStreamUrl) === "external_hls/llhls" &&
          (data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT);

        if (
          isLlhlsTransportFailure &&
          fallbackToStandardHls(data.details || data.type)
        ) {
          return;
        }

        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            if (isStartupPending()) {
              recoverPlayback({
                reloadSource: true,
                recoverMedia: true,
                delayMs: 750,
              });
              return;
            }
            runtime.stalledCount += 1;
            setTelemetry({ stallCount: runtime.stalledCount });
            markDegraded(
              "Playback drifted from the live edge.",
              "player_drifted",
              "reconnecting",
            );
            if (runtime.playbackProfile?.reloadOnBufferStall) {
              recoverPlayback({ reloadSource: true });
            } else {
              syncTelemetry();
              void video.play().catch(() => {});
            }
          } else if (
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
          ) {
            runtime.stalledCount += 1;
            setTelemetry({ stallCount: runtime.stalledCount });
            markDegraded(
              "Reconnecting to the live stream.",
              "reconnecting",
              "reconnecting",
            );
            recoverPlayback({ reloadSource: true });
          } else if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR) {
            runtime.stalledCount += 1;
            setTelemetry({ stallCount: runtime.stalledCount });
            markDegraded(
              "Recovering live playback...",
              "buffering",
              "reconnecting",
            );
            recoverPlayback({ recoverMedia: true, reloadSource: true });
          }
          return;
        }

        runtime.fatalErrorCount += 1;
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          runtime.fatalErrorCount < 3
        ) {
          markDegraded(
            "Reconnecting to the live edge...",
            "reconnecting",
            "reconnecting",
          );
          recoverPlayback({ reloadSource: true, delayMs: 1000 });
          return;
        }

        if (
          data.type === Hls.ErrorTypes.MEDIA_ERROR &&
          runtime.fatalErrorCount < 3
        ) {
          markDegraded(
            "Recovering live playback...",
            "buffering",
            "reconnecting",
          );
          recoverPlayback({
            recoverMedia: true,
            reloadSource: true,
            delayMs: 500,
          });
          return;
        }

        if (runtime.fatalErrorCount < 2) {
          rebuildPlayer("fatal hls error", 2000);
          return;
        }

        markUnavailable("Live stream unavailable.", "error:fatal");
      });
    };

    attachCommonVideoEvents();
    emitStatus();
    initPlayer();

    return () => {
      disposed = true;
      destroyPlayer();
    };
  }, [params]);

  return (
    <div className="hb-hls-player">
      <video
        ref={videoRef}
        className={`hb-hls-player__video${videoVisible ? " is-visible" : ""}`}
        autoPlay={params.autoplay}
        muted={params.muted}
        playsInline
      />
      <HyperscapeLoadingShell
        visible={loaderState.visible}
        phase={loaderState.phase}
        progress={loaderState.progress}
        stageLabel={loaderState.stageLabel}
        overlayMessage={loaderState.overlayMessage}
      />
      {params.debugEnabled ? (
        <div className="hb-hls-player__diagnostics">{diagnosticsText}</div>
      ) : null}
    </div>
  );
}

function readPlayerQuery(): ParsedPlayerQuery {
  if (typeof window === "undefined") {
    return {
      streamUrl: null,
      autoplay: true,
      muted: true,
      debugEnabled: false,
      deliveryMode: null,
      presentationDelayMs: null,
      syncToleranceMs: DEFAULT_SYNC_TOLERANCE_MS,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    streamUrl: params.get("src"),
    autoplay: params.get("autoplay") !== "0",
    muted: params.get("muted") !== "0",
    debugEnabled: params.get("debug") === "1",
    deliveryMode: params.get("deliveryMode"),
    presentationDelayMs: parsePositiveInt(params.get("presentationDelayMs")),
    syncToleranceMs:
      parsePositiveInt(params.get("syncToleranceMs")) ??
      DEFAULT_SYNC_TOLERANCE_MS,
  };
}

function createInitialTelemetry(
  params: ParsedPlayerQuery,
): StreamPlayerStatus {
  return {
    ready: false,
    status: "loading",
    liveEdgeLatencyMs: null,
    stallCount: 0,
    rebuildCount: 0,
    lastBufferedFragmentAt: null,
    playbackUrl: params.streamUrl,
    deliveryMode: resolvePlayerDeliveryModeHint(
      params.streamUrl || "",
      params.deliveryMode,
    ),
    firstFrameAt: null,
    startupDurationMs: null,
    playbackStarted: false,
    presentationDelayMs: params.presentationDelayMs,
    syncDeltaMs: null,
    syncState: "starting",
    bootPhase: "connecting",
    loaderVisible: true,
  };
}

function parsePositiveInt(value: string | null): number | null {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatLatencyLabel(value: number | null): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value! / 1000).toFixed(1)}s`;
}

function formatBufferedLabel(value: number | null): string {
  if (!Number.isFinite(value)) return "n/a";
  const ageMs = Math.max(0, Date.now() - value!);
  return `${(ageMs / 1000).toFixed(1)}s ago`;
}
