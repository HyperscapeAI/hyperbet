import React, { useCallback, useEffect, useMemo, useRef } from "react";
import Hls from "hls.js";

interface StreamPlayerProps {
  streamUrl: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onStreamUnavailable?: () => void;
  onStreamReady?: () => void;
  onPlaybackDateChange?: (playbackDateMs: number | null) => void;
  unavailableAfterManifestFailures?: number;
  manifestRetryDelayMs?: number;
}

const DEFAULT_UNAVAILABLE_AFTER_MANIFEST_FAILURES = 3;
const DEFAULT_MANIFEST_RETRY_DELAY_MS = 1_000;

export function resolveStreamPlaybackMode(
  hlsJsSupported: boolean,
  nativeHlsSupport: string,
): "hls.js" | "native" | "unsupported" {
  if (hlsJsSupported) return "hls.js";
  if (nativeHlsSupport) return "native";
  return "unsupported";
}

export function isExpectedNonFatalHlsRecovery(
  fatal: boolean,
  details: string,
): boolean {
  return !fatal && details === Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE;
}

export function isHlsStreamUrl(streamUrl: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(streamUrl.trim());
}

export function shouldMarkStreamUnavailable(
  consecutiveFailures: number,
  failureLimit = DEFAULT_UNAVAILABLE_AFTER_MANIFEST_FAILURES,
): boolean {
  return (
    Math.max(0, Math.floor(consecutiveFailures)) >=
    Math.max(1, Math.floor(failureLimit))
  );
}

export const StreamPlayer: React.FC<StreamPlayerProps> = ({
  streamUrl,
  poster,
  autoPlay = true,
  muted = true,
  className,
  style,
  onStreamUnavailable,
  onStreamReady,
  onPlaybackDateChange,
  unavailableAfterManifestFailures = DEFAULT_UNAVAILABLE_AFTER_MANIFEST_FAILURES,
  manifestRetryDelayMs = DEFAULT_MANIFEST_RETRY_DELAY_MS,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const embedUrl = useMemo(
    () => resolveEmbedUrl(streamUrl, autoPlay, muted),
    [autoPlay, muted, streamUrl],
  );
  const unavailableNotifiedRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const onStreamUnavailableRef = useRef(onStreamUnavailable);
  const onStreamReadyRef = useRef(onStreamReady);
  const onPlaybackDateChangeRef = useRef(onPlaybackDateChange);
  onStreamUnavailableRef.current = onStreamUnavailable;
  onStreamReadyRef.current = onStreamReady;
  onPlaybackDateChangeRef.current = onPlaybackDateChange;

  const markUnavailable = useCallback(() => {
    readyNotifiedRef.current = false;
    if (unavailableNotifiedRef.current) return;
    unavailableNotifiedRef.current = true;
    onStreamUnavailableRef.current?.();
  }, []);

  const markReady = useCallback(() => {
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    unavailableNotifiedRef.current = false;
    onStreamReadyRef.current?.();
  }, []);

  useEffect(() => {
    unavailableNotifiedRef.current = false;
    readyNotifiedRef.current = false;
    onPlaybackDateChangeRef.current?.(null);
  }, [streamUrl]);

  useEffect(() => {
    if (embedUrl || isHlsStreamUrl(streamUrl)) return;
    markUnavailable();
  }, [embedUrl, markUnavailable, streamUrl]);

  useEffect(() => {
    // External embeddable URLs render through iframe mode below.
    if (embedUrl) return;

    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let healthWatchdog: ReturnType<typeof setInterval> | null = null;
    let lastPlaybackTime = 0;
    let lastPlaylistUpdateAt = Date.now();
    let stallCount = 0;
    let manifestFailureCount = 0;
    let disposed = false;
    let lastReportedPlaybackDateMs: number | null = null;

    const readPlaybackDateMs = (): number | null => {
      const hlsDateMs = hls?.playingDate?.getTime();
      if (typeof hlsDateMs === "number" && Number.isFinite(hlsDateMs)) {
        return hlsDateMs;
      }

      const nativeStartDate = (
        video as HTMLVideoElement & { getStartDate?: () => Date }
      ).getStartDate?.();
      const nativeStartDateMs = nativeStartDate?.getTime();
      return typeof nativeStartDateMs === "number" &&
        Number.isFinite(nativeStartDateMs)
        ? nativeStartDateMs + video.currentTime * 1_000
        : null;
    };

    const reportPlaybackDate = () => {
      const playbackDateMs = readPlaybackDateMs();
      if (
        playbackDateMs === null ||
        lastReportedPlaybackDateMs === null ||
        Math.abs(playbackDateMs - lastReportedPlaybackDateMs) >= 100
      ) {
        lastReportedPlaybackDateMs = playbackDateMs;
        if (playbackDateMs === null) {
          delete video.dataset.streamPlaybackDateMs;
        } else {
          video.dataset.streamPlaybackDateMs = String(playbackDateMs);
        }
        onPlaybackDateChangeRef.current?.(playbackDateMs);
      }
    };

    const clearTimers = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (healthWatchdog) {
        clearInterval(healthWatchdog);
        healthWatchdog = null;
      }
    };

    const sourceUrl = () =>
      `${streamUrl}${streamUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

    const probeManifest = async () => {
      try {
        const response = await fetch(sourceUrl(), { cache: "no-store" });
        if (!response.ok) return false;
        const text = await response.text();
        // A valid live playlist should include media segments.
        return /#EXTINF/i.test(text) && /\.(ts|m4s|mp4)\b/i.test(text);
      } catch {
        return false;
      }
    };

    const nudgeToLiveEdge = () => {
      if (!video) return;

      const syncPosition = hls?.liveSyncPosition;
      if (typeof syncPosition === "number" && Number.isFinite(syncPosition)) {
        if (syncPosition - video.currentTime > 1) {
          video.currentTime = Math.max(0, syncPosition - 0.5);
        }
      } else if (video.buffered.length > 0) {
        const liveEdge = video.buffered.end(video.buffered.length - 1);
        if (liveEdge - video.currentTime > 1) {
          video.currentTime = Math.max(0, liveEdge - 0.5);
        }
      }

      void video.play().catch(() => {});
    };

    const scheduleRebuild = (reason: string, delayMs = 1500) => {
      console.warn(`[StreamPlayer] Rebuilding stream: ${reason}`);
      if (retryTimeout) clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        void initPlayer();
      }, delayMs);
    };

    const startHealthWatchdog = () => {
      if (healthWatchdog) clearInterval(healthWatchdog);

      lastPlaybackTime = 0;
      stallCount = 0;

      // Recovery loop for tiny stalls and stale playlist updates.
      healthWatchdog = setInterval(() => {
        if (!video) return;

        const now = Date.now();
        const playbackDelta = Math.abs(video.currentTime - lastPlaybackTime);
        const stalled =
          video.currentTime > 0 &&
          playbackDelta < 0.01 &&
          !video.paused &&
          !video.ended;

        if (stalled) {
          stallCount += 1;
          console.warn(
            `[StreamPlayer] Playback stalled (count: ${stallCount})`,
          );

          if (stallCount >= 3) {
            markUnavailable();
            scheduleRebuild("playback stalled repeatedly");
            return;
          }

          if (stallCount === 1) {
            nudgeToLiveEdge();
          } else {
            hls?.recoverMediaError();
            nudgeToLiveEdge();
          }
        } else {
          stallCount = 0;
        }

        if (hls && now - lastPlaylistUpdateAt > 8000) {
          markUnavailable();
          console.warn(
            "[StreamPlayer] Playlist stalled; forcing manifest/fragment reload",
          );
          hls.startLoad();
          nudgeToLiveEdge();
          lastPlaylistUpdateAt = now;
        }

        lastPlaybackTime = video.currentTime;
        reportPlaybackDate();
      }, 2000);
    };

    const initPlayer = async () => {
      if (disposed) return;
      clearTimers();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      lastPlaylistUpdateAt = Date.now();

      const manifestReady = await probeManifest();
      // React Strict Mode intentionally mounts, cleans up, and remounts effects
      // in development. Never let the stale probe from the cleaned-up effect
      // attach a second HLS instance to the current video element.
      if (disposed) return;
      if (!manifestReady) {
        manifestFailureCount += 1;
        if (
          shouldMarkStreamUnavailable(
            manifestFailureCount,
            unavailableAfterManifestFailures,
          )
        ) {
          markUnavailable();
        }
        scheduleRebuild(
          "manifest not ready",
          Math.max(0, manifestRetryDelayMs),
        );
        return;
      }
      manifestFailureCount = 0;

      // Prefer hls.js whenever Media Source Extensions are available. Chromium
      // can advertise native HLS support while still rejecting FFmpeg MPEG-TS
      // live playlists in its native demuxer; hls.js performs the required
      // transmuxing. Native HLS remains the fallback for Safari-class clients.
      const playbackMode = resolveStreamPlaybackMode(
        Hls.isSupported(),
        video.canPlayType("application/vnd.apple.mpegurl"),
      );
      if (playbackMode === "hls.js") {
        hls = new Hls({
          enableWorker: true,
          // FFmpeg emits standard live HLS, not LL-HLS parts.
          lowLatencyMode: false,
          // Keep a wider live window to absorb network jitter.
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 12,
          liveBackBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          // Aggressive retries when manifests/fragments fail.
          manifestLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 800,
          levelLoadingMaxRetry: 10,
          levelLoadingRetryDelay: 800,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 800,
        });

        hls.loadSource(sourceUrl());
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
        });

        hls.on(Hls.Events.LEVEL_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
          markReady();
          reportPlaybackDate();
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("[StreamPlayer] Manifest parsed, starting playback");
          markReady();
          void video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          const logHlsError = isExpectedNonFatalHlsRecovery(
            data.fatal,
            data.details,
          )
            ? console.debug
            : console.warn;
          logHlsError(
            "[StreamPlayer] HLS error:",
            data.type,
            data.details,
            data.fatal,
          );

          if (data.fatal) {
            markUnavailable();
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("[StreamPlayer] Network error, retrying load...");
                hls?.startLoad(-1);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("[StreamPlayer] Media error, recovering...");
                hls?.recoverMediaError();
                nudgeToLiveEdge();
                break;
              default:
                scheduleRebuild("fatal HLS error", 2000);
                break;
            }
          } else if (
            data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR
          ) {
            console.warn(
              "[StreamPlayer] Non-fatal buffering/loading issue; forcing recovery",
            );
            hls?.startLoad();
            nudgeToLiveEdge();
          }
        });

        startHealthWatchdog();
      } else if (playbackMode === "native") {
        video.src = sourceUrl();
        void video.play().catch(() => {});
        startHealthWatchdog();
      } else {
        console.error("[StreamPlayer] HLS is not supported in this browser");
        markUnavailable();
      }
    };

    const onWaiting = () => nudgeToLiveEdge();
    const onStalled = () => nudgeToLiveEdge();
    const onLoadedMetadata = () => {
      markReady();
      reportPlaybackDate();
    };
    const onTimeUpdate = () => reportPlaybackDate();
    const onVideoError = () => {
      markUnavailable();
      const mediaError = video.error;
      const detail = mediaError
        ? `code=${mediaError.code}${mediaError.message ? ` message=${mediaError.message}` : ""}`
        : "no MediaError detail";
      scheduleRebuild(`video element error (${detail})`, 1000);
    };

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("error", onVideoError);

    if (autoPlay) {
      video.autoplay = true;
    }
    video.muted = muted;

    void initPlayer();

    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onVideoError);
      clearTimers();
      disposed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      delete video.dataset.streamPlaybackDateMs;
      onPlaybackDateChangeRef.current?.(null);
    };
  }, [
    autoPlay,
    embedUrl,
    manifestRetryDelayMs,
    markReady,
    markUnavailable,
    muted,
    streamUrl,
    unavailableAfterManifestFailures,
  ]);

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
          data-stream-source={streamUrl}
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
      <iframe
        key={`${embedUrl}|${poster ?? ""}`}
        src={embedUrl}
        title="Live Stream"
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
        allowFullScreen
        loading="eager"
        onLoad={markReady}
        referrerPolicy="strict-origin-when-cross-origin"
        onError={markUnavailable}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
          backgroundColor: "#000",
        }}
      />
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

function resolveEmbedUrl(
  inputUrl: string,
  autoPlay: boolean,
  muted: boolean,
): string | null {
  const trimmed = inputUrl.trim();
  if (!trimmed || trimmed.includes(".m3u8")) return null;

  const parsed = parseUrl(trimmed);
  if (!parsed) return null;
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

function parseUrl(rawValue: string): URL | null {
  try {
    return new URL(rawValue);
  } catch {
    return null;
  }
}
