import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const embedUrl = useMemo(
    () => resolveEmbedUrl(streamUrl, autoPlay, muted),
    [autoPlay, muted, streamUrl],
  );
  const embedKind = useMemo(() => classifyEmbedKind(embedUrl), [embedUrl]);
  const unavailableNotifiedRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const [embedFailure, setEmbedFailure] = useState<string | null>(null);

  const markUnavailable = useCallback(
    (reason = "Live stream unavailable.") => {
      setEmbedFailure((current) => current ?? reason);
      if (unavailableNotifiedRef.current) return;
      unavailableNotifiedRef.current = true;
      onStreamUnavailable?.();
    },
    [onStreamUnavailable],
  );

  const markReady = useCallback(() => {
    setEmbedFailure(null);
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    onStreamReady?.();
  }, [onStreamReady]);

  useEffect(() => {
    unavailableNotifiedRef.current = false;
    readyNotifiedRef.current = false;
    setEmbedFailure(null);
  }, [streamUrl]);

  useEffect(() => {
    if (embedUrl) return;
    markUnavailable();
  }, [embedUrl, markUnavailable]);

  useEffect(() => {
    if (!embedUrl || embedKind !== "hyperscape" || typeof window === "undefined") {
      return;
    }

    const embedOrigin = getEmbedOrigin(embedUrl);
    if (!embedOrigin) {
      return;
    }

    let seenStatusMessage = false;
    const bootstrapTimeout = window.setTimeout(() => {
      if (!seenStatusMessage) {
        markUnavailable("Failed to initialize the embedded Hyperscapes stream.");
      }
    }, 10_000);

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== embedOrigin) return;
      if (!event.data || typeof event.data !== "object") return;

      const payload = event.data as {
        type?: string;
        ready?: boolean;
        status?: string | null;
      };
      if (payload.type !== "HYPERSCAPE_STREAM_STATUS") {
        return;
      }

      seenStatusMessage = true;
      window.clearTimeout(bootstrapTimeout);

      if (payload.ready === true) {
        markReady();
        return;
      }

      if (typeof payload.status === "string" && payload.status.startsWith("error:")) {
        markUnavailable(describeHyperscapeEmbedError(payload.status));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(bootstrapTimeout);
      window.removeEventListener("message", handleMessage);
    };
  }, [embedKind, embedUrl, markReady, markUnavailable]);

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
    let disposed = false;

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
          console.warn(
            "[StreamPlayer] Playlist stalled; forcing manifest/fragment reload",
          );
          hls.startLoad();
          nudgeToLiveEdge();
          lastPlaylistUpdateAt = now;
        }

        lastPlaybackTime = video.currentTime;
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
      if (!manifestReady) {
        scheduleRebuild("manifest not ready", 1000);
        return;
      }

      // Check if browser supports HLS natively (Safari)
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = sourceUrl();
        void video.play().catch(() => {});
        startHealthWatchdog();
      } else if (Hls.isSupported()) {
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
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("[StreamPlayer] Manifest parsed, starting playback");
          markReady();
          void video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.warn(
            "[StreamPlayer] HLS error:",
            data.type,
            data.details,
            data.fatal,
          );

          if (data.fatal) {
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
      } else {
        console.error("[StreamPlayer] HLS is not supported in this browser");
      }
    };

    const onWaiting = () => nudgeToLiveEdge();
    const onStalled = () => nudgeToLiveEdge();
    const onLoadedMetadata = () => markReady();
    const onVideoError = () => scheduleRebuild("video element error", 1000);

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
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
      video.removeEventListener("error", onVideoError);
      clearTimers();
      disposed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
  }, [embedUrl, streamUrl, autoPlay, muted, markReady]);

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
        onLoad={embedKind === "hyperscape" ? undefined : markReady}
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
      {embedFailure ? (
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
              "linear-gradient(180deg, rgba(2,4,10,0.76), rgba(2,4,10,0.88))",
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
            {embedFailure}
          </div>
        </div>
      ) : null}
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

function classifyEmbedKind(embedUrl: string | null): "generic" | "hyperscape" {
  if (!embedUrl) return "generic";

  const parsed = parseUrl(embedUrl);
  if (!parsed) return "generic";

  const pathname = parsed.pathname.toLowerCase();
  const page = (parsed.searchParams.get("page") || "").trim().toLowerCase();
  const isStreamRoute =
    pathname.endsWith("/stream") ||
    pathname === "/stream" ||
    pathname.endsWith("/stream.html") ||
    pathname === "/stream.html" ||
    page === "stream";

  if (!isStreamRoute) return "generic";
  if (parsed.searchParams.has("streamToken")) return "hyperscape";
  if (parsed.hostname.toLowerCase().includes("hyperscape")) return "hyperscape";
  return "generic";
}

function getEmbedOrigin(embedUrl: string): string | null {
  const parsed = parseUrl(embedUrl);
  return parsed?.origin ?? null;
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

function parseUrl(rawValue: string): URL | null {
  try {
    return new URL(rawValue);
  } catch {
    return null;
  }
}
