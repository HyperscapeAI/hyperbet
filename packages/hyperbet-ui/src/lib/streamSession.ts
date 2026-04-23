import type {
  CanonicalStreamHealth,
  CanonicalStreamSession,
  SourceRuntimeInfo,
  StreamDestinationState,
  StreamPublicReadiness,
} from "../spectator/types";
import { normalizePredictionMarketDuelKeyHex } from "./predictionMarkets";

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

function isHlsPlaybackUrl(value: string): boolean {
  const parsed = parseStreamSourceUrl(value);
  return parsed?.pathname.toLowerCase().endsWith(".m3u8") ?? false;
}

export function isNonBlockingCanonicalRendererFailure(params: {
  degradedReason: string | null | undefined;
  playbackUrl: string | null | undefined;
}): boolean {
  const reason = (params.degradedReason ?? "").trim().toLowerCase();
  const playbackUrl = params.playbackUrl?.trim() ?? "";
  return reason.startsWith("probe_failed:") && isHlsPlaybackUrl(playbackUrl);
}

export function isCanonicalRendererPlaybackReady(params: {
  rendererReady: boolean | null | undefined;
  degradedReason: string | null | undefined;
  publicReadiness?: StreamPublicReadiness | null | undefined;
  sourceRuntime?: SourceRuntimeInfo | null | undefined;
  playbackUrl: string | null | undefined;
}): boolean {
  if (params.rendererReady !== false) {
    return true;
  }

  if (isNonBlockingCanonicalRendererFailure(params)) {
    return true;
  }
  return false;
}

export function isCanonicalDeliveryReady(params: {
  deliveryMode: "self_hls" | "external_hls" | null | undefined;
  deliveryHealth: CanonicalStreamHealth | null | undefined;
  publicReadiness?: StreamPublicReadiness | null | undefined;
  playbackUrl: string | null | undefined;
}): boolean {
  const playbackUrl = params.playbackUrl?.trim() ?? "";
  if (playbackUrl.length === 0) {
    return false;
  }

  if (params.publicReadiness != null) {
    return params.publicReadiness.ready;
  }

  if (params.deliveryMode !== "external_hls") {
    return params.deliveryHealth?.ready ?? true;
  }

  if (params.deliveryHealth == null) {
    return false;
  }

  return params.deliveryHealth.ready;
}

function isCanonicalSourceRuntimeReady(
  sourceRuntime: SourceRuntimeInfo | null | undefined,
): boolean {
  return sourceRuntime?.ready === true;
}

function findCanonicalDestination(
  session: CanonicalStreamSession | null,
): StreamDestinationState | null {
  if (!session?.channel) {
    return session?.canonicalDestination ?? null;
  }

  return (
    session.channel.destinations.find(
      (destination) => destination.id === session.channel?.canonicalDestinationId,
    ) ??
    session.canonicalDestination ??
    null
  );
}

function normalizeLifecycleDuelId(value: string | null | undefined): string | null {
  const duelId = value?.trim() ?? "";
  return duelId.length > 0 ? duelId : null;
}

function matchesCanonicalSessionLifecycle(params: {
  canonicalSessionDuelId: string | null | undefined;
  canonicalSessionDuelKey: string | null | undefined;
  lifecycleDuelId: string | null | undefined;
  lifecycleDuelKey: string | null | undefined;
}): boolean {
  const lifecycleDuelId = normalizeLifecycleDuelId(params.lifecycleDuelId);
  const lifecycleDuelKey = normalizePredictionMarketDuelKeyHex(
    params.lifecycleDuelKey ?? null,
  );
  if (lifecycleDuelId == null && lifecycleDuelKey == null) {
    return true;
  }

  const canonicalSessionDuelId = normalizeLifecycleDuelId(
    params.canonicalSessionDuelId,
  );
  const canonicalSessionDuelKey = normalizePredictionMarketDuelKeyHex(
    params.canonicalSessionDuelKey ?? null,
  );
  if (canonicalSessionDuelId == null && canonicalSessionDuelKey == null) {
    return false;
  }

  let hasMatchingIdentifier = false;

  if (lifecycleDuelId != null && canonicalSessionDuelId != null) {
    if (canonicalSessionDuelId !== lifecycleDuelId) {
      return false;
    }
    hasMatchingIdentifier = true;
  }

  if (lifecycleDuelKey != null && canonicalSessionDuelKey != null) {
    if (canonicalSessionDuelKey !== lifecycleDuelKey) {
      return false;
    }
    hasMatchingIdentifier = true;
  }

  return hasMatchingIdentifier;
}

type SelectBetSurfaceStreamUrlInput = {
  allowFallbackOverride?: boolean;
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
  allowFallbackOverride,
  allowFallbackWhenSessionUnavailable = false,
  authorityHealth,
  fallbackStreamIndex,
  fallbackStreamSources,
  isE2eMode = false,
  lifecycleDuelId = null,
  lifecycleDuelKey = null,
  rendererReady = null,
  session,
}: SelectBetSurfaceStreamUrlInput): BetSurfaceStreamSelection {
  const allowFallbackSelection =
    allowFallbackOverride ?? allowFallbackWhenSessionUnavailable;
  const fallbackStreamUrl = fallbackStreamSources[fallbackStreamIndex] ?? "";
  const canonicalDestination = findCanonicalDestination(session);
  const canonicalPlaybackUrl =
    session?.channel?.publicPlaybackUrl?.trim() ||
    session?.playback?.url?.trim() ||
    canonicalDestination?.playbackUrl?.trim() ||
    session?.delivery?.playbackUrl?.trim() ||
    "";
  const canonicalSourceRuntime =
    session?.sourceRuntime ?? session?.status.sourceRuntime ?? null;
  const canonicalSessionDuelId = session?.duelId ?? null;
  const canonicalSessionDuelKey =
    session?.duelKey ??
    session?.cycle.duelKeyHex?.replace(/^0x/i, "") ??
    null;

  const canonicalSessionMatchesLifecycle = matchesCanonicalSessionLifecycle({
    canonicalSessionDuelId,
    canonicalSessionDuelKey,
    lifecycleDuelId,
    lifecycleDuelKey,
  });

  const authorityReady = session?.authorityHealth.ready ?? authorityHealth?.ready ?? true;
  const canonicalRendererReady =
    session?.rendererHealth?.ready ??
    session?.status.renderer?.ready ??
    rendererReady ??
    true;
  const canonicalRendererDegradedReason =
    session?.rendererHealth?.degradedReason ??
    session?.status.renderer?.degradedReason ??
    null;
  const canonicalDeliveryHealth =
    session?.deliveryHealth ??
    session?.status.deliveryHealth ??
    null;
  const canonicalRendererPlaybackReady = isCanonicalRendererPlaybackReady({
    rendererReady: canonicalRendererReady,
    degradedReason: canonicalRendererDegradedReason,
    publicReadiness: session?.publicReadiness ?? session?.channel?.publicReadiness,
    sourceRuntime: canonicalSourceRuntime,
    playbackUrl: canonicalPlaybackUrl,
  });
  const canonicalDeliveryReady = isCanonicalDeliveryReady({
    deliveryMode:
      session?.delivery?.mode ??
      session?.status.delivery?.mode ??
      (canonicalDestination?.provider === "self_hls" ? "self_hls" : null),
    deliveryHealth: canonicalDeliveryHealth,
    publicReadiness: session?.publicReadiness ?? session?.channel?.publicReadiness,
    playbackUrl: canonicalPlaybackUrl,
  });
  const canonicalSourceReady = isCanonicalSourceRuntimeReady(
    canonicalSourceRuntime,
  );

  const canUseCanonicalPlayback =
    !isE2eMode &&
    canonicalPlaybackUrl.length > 0 &&
    authorityReady &&
    canonicalRendererPlaybackReady &&
    canonicalSourceReady &&
    canonicalDeliveryReady &&
    canonicalSessionMatchesLifecycle;
  const preloadStreamUrl =
    !isE2eMode &&
    canonicalPlaybackUrl.length > 0 &&
    authorityReady &&
    canonicalRendererPlaybackReady &&
    canonicalSourceReady &&
    canonicalDeliveryReady &&
    canonicalSessionMatchesLifecycle
      ? canonicalPlaybackUrl
      : "";

  return {
    activeStreamUrl: isE2eMode
      ? ""
      : canUseCanonicalPlayback
        ? canonicalPlaybackUrl
        : session || !allowFallbackSelection
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
  const normalizedReason = (reason ?? "").trim().toLowerCase();

  switch (normalizedReason) {
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
    case "worker_missing":
      return "Source offline. Waiting for the capture worker.";
    case "browser_missing":
      return "Source offline. Waiting for the capture browser.";
    case "page_not_ready":
      return "Source not ready. Waiting for the stream page.";
    case "unexpected_navigation":
      return "Source reset. The capture page navigated away.";
    case "capture_stalled":
      return "Source stalled. Waiting for capture traffic.";
    case "encoder_stalled":
      return "Delivery stalled. Waiting for encoder traffic.";
    case "capture_fps_low":
      return "Source degraded. Capture FPS dropped below target.";
    case "encoder_fps_low":
      return "Delivery degraded. Encoder FPS dropped below target.";
    case "manifest_stale":
      return "Source or delivery stale. Waiting for a fresh live manifest.";
    case "destination_disconnected":
      return "Delivery unavailable. Waiting for the live destination.";
    case "delivery_status_unavailable":
      return "Delivery unavailable. Waiting for broadcast status.";
    case "delivery_status_stale":
      return "Delivery stale. Waiting for fresh broadcast telemetry.";
    case "delivery_pipeline_inactive":
      return "Delivery unavailable. Waiting for the live broadcast pipeline.";
    case "delivery_destination_missing":
      return "Delivery unavailable. No live broadcast destination is configured.";
    case "delivery_disconnected":
      return "Delivery unavailable. Waiting for the live broadcast connection.";
    case "delivery_unhealthy":
      return "Delivery degraded. Waiting for the live broadcast to recover.";
    case "status_stale":
      return "Source stale. Waiting for fresh source status.";
    case "unknown":
      return "Source unavailable. Waiting for stream status.";
    case "asset_origin_incomplete":
      return "Renderer degraded. Asset CDN is incomplete for the stream page.";
    case "player_drifted":
      return "Playback drifted from the live edge.";
    default:
      if (normalizedReason.startsWith("probe_failed:")) {
        return "Renderer probe degraded. Waiting for source confirmation.";
      }
      return reason && reason.trim().length > 0
        ? `Renderer unavailable: ${reason.replace(/_/g, " ")}`
        : fallback;
  }
}

export function resolveCanonicalPlaybackDeliveryMode(
  session: CanonicalStreamSession | null,
): string | null {
  const canonicalDestination = findCanonicalDestination(session);
  const playbackUrl =
    session?.channel?.publicPlaybackUrl?.trim() ||
    session?.delivery?.playbackUrl?.trim() ||
    canonicalDestination?.playbackUrl?.trim() ||
    "";
  if (playbackUrl.includes("protocol=llhls")) {
    return "external_hls/llhls";
  }
  if (canonicalDestination?.provider === "self_hls") {
    return "self_hls/hls";
  }
  if (canonicalDestination?.transport === "llhls") {
    return "external_hls/llhls";
  }
  if (canonicalDestination?.transport === "hls") {
    return "external_hls/hls";
  }

  const deliveryMode = session?.delivery?.mode ?? null;
  const playbackKind = (session?.playback?.kind ?? "").trim().toLowerCase();

  if (deliveryMode === "external_hls") {
    if (playbackKind === "llhls" || session?.delivery?.llhlsUrl) {
      return "external_hls/llhls";
    }
    return "external_hls/hls";
  }

  if (deliveryMode === "self_hls") {
    return "self_hls/hls";
  }

  if (playbackKind === "llhls") {
    return "external_hls/llhls";
  }
  if (playbackKind === "hls") {
    return "self_hls/hls";
  }
  return null;
}
