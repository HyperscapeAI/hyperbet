import type {
  CanonicalStreamHealth,
  CanonicalStreamSession,
} from "../spectator/types";

function parseStreamSourceUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function isHyperscapeStreamRoute(parsed: URL): boolean {
  const pathname = parsed.pathname.toLowerCase();
  const page = (parsed.searchParams.get("page") || "").trim().toLowerCase();
  return (
    pathname.endsWith("/stream") ||
    pathname === "/stream" ||
    pathname.endsWith("/stream.html") ||
    pathname === "/stream.html" ||
    page === "stream"
  );
}

function isHyperscapeHostname(parsed: URL): boolean {
  return parsed.hostname.toLowerCase().includes("hyperscape");
}

function isTokenizedHyperscapeStreamSource(value: string): boolean {
  const parsed = parseStreamSourceUrl(value);
  if (!parsed) return false;
  return (
    isHyperscapeHostname(parsed) &&
    isHyperscapeStreamRoute(parsed) &&
    parsed.searchParams.has("streamToken")
  );
}

function isBareHyperscapePublicStreamSource(value: string): boolean {
  const parsed = parseStreamSourceUrl(value);
  if (!parsed) return false;
  return (
    isHyperscapeHostname(parsed) &&
    isHyperscapeStreamRoute(parsed) &&
    !parsed.searchParams.has("streamToken")
  );
}

export function sanitizeResolvedStreamSources(values: string[]): string[] {
  const uniqueSources = uniqueList(values);
  const tokenizedSources = uniqueSources.filter(isTokenizedHyperscapeStreamSource);
  if (tokenizedSources.length > 0) {
    const droppedSources = uniqueSources.filter(
      (source) => !isTokenizedHyperscapeStreamSource(source),
    );
    if (droppedSources.length > 0 && typeof console !== "undefined") {
      console.warn(
        "[config] dropping non-tokenized or non-Hyperscapes fallback streams while a tokenized Hyperscapes stream is configured",
        droppedSources,
      );
    }
    return tokenizedSources;
  }

  const bareHyperscapeSources = uniqueSources.filter(
    isBareHyperscapePublicStreamSource,
  );
  if (bareHyperscapeSources.length > 0 && typeof console !== "undefined") {
    console.error(
      "[config] bare Hyperscapes public stream URLs are invalid for staging embeds; a tokenized /stream URL is required",
      bareHyperscapeSources,
    );
  }

  return uniqueSources.filter(
    (source) => !isBareHyperscapePublicStreamSource(source),
  );
}

type SelectBetSurfaceStreamUrlInput = {
  allowFallbackWhenSessionUnavailable?: boolean;
  authorityHealth?: CanonicalStreamHealth | null;
  fallbackStreamIndex: number;
  fallbackStreamSources: string[];
  isE2eMode?: boolean;
  lifecycleDuelId?: string | null;
  lifecycleDuelKey?: string | null;
  rendererReady?: boolean | null;
  session: CanonicalStreamSession | null;
};

export type BetSurfaceStreamSelection = {
  activeStreamUrl: string;
  canUseCanonicalPlayback: boolean;
  canonicalPlaybackUrl: string;
  canonicalSessionMatchesLifecycle: boolean;
  preloadStreamUrl: string;
};

export function selectBetSurfaceStreamUrl({
  allowFallbackWhenSessionUnavailable = true,
  authorityHealth,
  fallbackStreamIndex,
  fallbackStreamSources,
  isE2eMode = false,
  lifecycleDuelId = null,
  lifecycleDuelKey = null,
  rendererReady = null,
  session,
}: SelectBetSurfaceStreamUrlInput): BetSurfaceStreamSelection {
  const fallbackStreamUrl = fallbackStreamSources[fallbackStreamIndex] ?? "";
  const canonicalPlaybackUrl =
    session?.playback?.url?.trim() ||
    session?.delivery?.playbackUrl?.trim() ||
    "";
  const canonicalSessionDuelId = session?.duelId ?? null;
  const canonicalSessionDuelKey =
    session?.duelKey ??
    session?.cycle.duelKeyHex?.replace(/^0x/i, "") ??
    null;

  const canonicalSessionMatchesLifecycle =
    (!lifecycleDuelId && !lifecycleDuelKey) ||
    ((!canonicalSessionDuelId && !canonicalSessionDuelKey) ||
      canonicalSessionDuelId === lifecycleDuelId ||
      (canonicalSessionDuelKey != null &&
        lifecycleDuelKey != null &&
        canonicalSessionDuelKey === lifecycleDuelKey));

  const authorityReady = session?.authorityHealth.ready ?? authorityHealth?.ready ?? true;
  const canonicalRendererReady =
    session?.rendererHealth?.ready ??
    session?.status.renderer?.ready ??
    rendererReady ??
    true;

  const canUseCanonicalPlayback =
    !isE2eMode &&
    canonicalPlaybackUrl.length > 0 &&
    authorityReady &&
    canonicalRendererReady &&
    canonicalSessionMatchesLifecycle;
  const preloadStreamUrl =
    !isE2eMode && canonicalPlaybackUrl.length > 0 && authorityReady
      ? canonicalPlaybackUrl
      : "";

  return {
    activeStreamUrl: isE2eMode
      ? ""
      : canUseCanonicalPlayback
        ? canonicalPlaybackUrl
        : session || !allowFallbackWhenSessionUnavailable
          ? ""
          : fallbackStreamUrl,
    canUseCanonicalPlayback,
    canonicalPlaybackUrl,
    canonicalSessionMatchesLifecycle,
    preloadStreamUrl,
  };
}

export function describeCanonicalRendererDegradedReason(
  reason: string | null | undefined,
  fallback = "Waiting for stream...",
): string {
  switch ((reason ?? "").trim().toLowerCase()) {
    case "capture_client_disconnected":
      return "Renderer offline. Waiting for capture client.";
    case "ffmpeg_not_running":
      return "Renderer offline. Waiting for encoder.";
    case "manifest_not_ready":
      return "Renderer starting up. Waiting for live output.";
    case "bridge_inactive":
      return "Renderer offline. Waiting for capture bridge.";
    case "render_tick_stale":
      return "Source stale. Waiting for renderer ticks.";
    case "visual_change_stale":
      return "Source stale. The duel scene stopped changing.";
    case "capture_fps_low":
      return "Source degraded. Capture FPS dropped below target.";
    case "encoder_fps_low":
      return "Delivery degraded. Encoder FPS dropped below target.";
    case "manifest_stale":
      return "Delivery stale. Waiting for a fresh live manifest.";
    case "asset_origin_incomplete":
      return "Renderer degraded. Asset CDN is incomplete for the stream page.";
    case "player_drifted":
      return "Playback drifted from the live edge.";
    default:
      return reason && reason.trim().length > 0
        ? `Renderer unavailable: ${reason.replace(/_/g, " ")}`
        : fallback;
  }
}
