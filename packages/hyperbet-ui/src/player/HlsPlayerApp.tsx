import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";

import {
  advanceViewerSyncState,
  isPlaybackLatencyWithinBudget,
  resolveHlsPlaybackProfile,
  resolvePlayerDeliveryModeHint,
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
  telemetry: StreamPlayerStatus;
  loader: ViewerLoaderState;
};

export function HlsPlayerApp() {
  const params = useMemo(readPlayerQuery, []);
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

    const runtime = runtimeRef.current;

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
      updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
      syncTelemetry();
      console.info(`[hls-player] promoting buffered startup via ${reason}`, {
        target,
        buffered: readBufferedRanges(),
        streamUrl: runtime.activeStreamUrl,
      });
      void video.play().catch(() => {});
      return true;
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

    const buildStandardHlsUrl = (url: string | null) => {
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
    };

    const fallbackToStandardHls = (reason: string) => {
      if (runtime.llhlsFallbackUsed) {
        return false;
      }
      const standardUrl = buildStandardHlsUrl(runtime.activeStreamUrl);
      if (!standardUrl || standardUrl === runtime.activeStreamUrl) {
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
      if (
        runtime.hls &&
        typeof runtime.hls.latency === "number" &&
        Number.isFinite(runtime.hls.latency)
      ) {
        return Math.max(0, Math.round(runtime.hls.latency * 1000));
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
    };

    const syncTelemetry = () => {
      const latencyMs = readLiveEdgeLatencyMs();
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
        updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
        promoteBufferedStartup("loadedmetadata");
        revealDecodedFrame("loadedmetadata");
        if (runtime.playbackStarted) {
          markReady();
        }
      });
      video.addEventListener("loadeddata", () => {
        updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
        promoteBufferedStartup("loadeddata");
        revealDecodedFrame("loadeddata");
        if (runtime.playbackStarted) {
          markReady();
        }
      });
      video.addEventListener("canplay", () => {
        updateLoaderPhase("finalizing", { overlayMessage: null, visible: true });
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

    const initPlayer = () => {
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

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
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

      runtime.hls = new Hls(runtime.playbackProfile.config);
      runtime.hls.loadSource(runtime.activeStreamUrl);
      runtime.hls.attachMedia(video);
      startLatencyPolling();

      runtime.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        updateLoaderPhase("initializing", {
          overlayMessage: null,
          visible: true,
        });
        runtime.currentStatus = "manifest_ready";
        emitStatus();
        syncTelemetry();
        if (params.autoplay) {
          void video.play().catch(() => {});
        }
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
        }
      });

      runtime.hls.on(Hls.Events.LEVEL_UPDATED, syncTelemetry);
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
      syncToleranceMs: 1_500,
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
    syncToleranceMs: parsePositiveInt(params.get("syncToleranceMs")) ?? 1_500,
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
