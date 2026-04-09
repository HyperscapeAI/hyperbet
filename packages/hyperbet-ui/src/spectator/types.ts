export type StreamingPhase =
  | "IDLE"
  | "ANNOUNCEMENT"
  | "COUNTDOWN"
  | "FIGHTING"
  | "RESOLUTION";

export interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  hp: number;
  maxHp: number;
  combatLevel: number;
  wins: number;
  losses: number;
  damageDealtThisFight: number;
}

export interface RendererHealthInfo {
  ready: boolean;
  degradedReason: string | null;
  updatedAt: number | null;
}

export type SourceRuntimeStatusSource =
  | "external_worker"
  | "in_process_bridge"
  | "none";

export type SourceRuntimeCaptureMode =
  | "cdp"
  | "webcodecs"
  | "mediarecorder"
  | "none";

export type SourceRuntimeDegradedReason =
  | "worker_missing"
  | "browser_missing"
  | "page_not_ready"
  | "unexpected_navigation"
  | "capture_stalled"
  | "encoder_stalled"
  | "manifest_stale"
  | "destination_disconnected"
  | "status_stale"
  | "unknown";

export interface SourceRuntimeInfo {
  ready: boolean;
  statusSource: SourceRuntimeStatusSource;
  captureMode: SourceRuntimeCaptureMode;
  degradedReason: SourceRuntimeDegradedReason | string | null;
  currentSceneUrl: string | null;
  activeBundle: string | null;
  lastFrameAt: number | null;
  lastRenderTickAt: number | null;
  lastVisualChangeAt: number | null;
  lastRecoveryAt: number | null;
  recoveryCount: number;
  workerHeartbeatAt: number | null;
}

export interface HlsManifestInfo {
  updatedAt: number | null;
  mediaSequence: number | null;
}

export interface RendererMetricsInfo {
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
  hlsManifest: HlsManifestInfo | null;
}

export interface StreamDeliveryInfo {
  mode: "self_hls" | "external_hls";
  provider: string | null;
  playbackUrl: string | null;
  hlsUrl: string | null;
  llhlsUrl: string | null;
  ingestUrl: string | null;
}

export type StreamDestinationRole = "canonical" | "fallback" | "mirror";
export type StreamDestinationProvider =
  | "cloudflare_stream"
  | "self_hls"
  | "twitch"
  | "kick"
  | "youtube"
  | "custom";
export type StreamDeliveryTransport =
  | "llhls"
  | "hls"
  | "rtmps"
  | "srt"
  | "unknown";
export type StreamManifestStatus = "ok" | "stale" | "missing" | "unknown";

export interface StreamPublicReadiness {
  ready: boolean;
  reason: string | null;
  updatedAt: number | null;
}

export interface StreamDestinationState {
  id: string;
  name: string;
  role: StreamDestinationRole;
  provider: StreamDestinationProvider;
  transport: StreamDeliveryTransport;
  playbackUrl: string | null;
  ingestUrl: string | null;
  connected: boolean;
  transportHealthy: boolean;
  playbackReady: boolean;
  manifestStatus: StreamManifestStatus;
  lastError: string | null;
  updatedAt: number | null;
}

export interface StreamChannelState {
  id: string;
  mode: "always_on";
  presentationDelayMs: number;
  activeDuelId: string | null;
  activeDuelKey: string | null;
  canonicalDestinationId: string;
  fallbackDestinationId: string | null;
  publicPlaybackUrl: string | null;
  publicReadiness: StreamPublicReadiness;
  destinations: StreamDestinationState[];
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface BroadcastTimeline {
  phase: StreamingPhase | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  presentationDelayMs: number;
  updatedAt: number | null;
}

export interface StreamingCycle {
  cycleId: string;
  phase: StreamingPhase;
  cycleStartTime: number;
  phaseStartTime: number;
  phaseEndTime: number;
  phaseVersion?: number | null;
  timeRemaining: number;
  agent1: AgentInfo | null;
  agent2: AgentInfo | null;
  duelId?: string | null;
  duelKeyHex?: string | null;
  broadcastTimeline?: BroadcastTimeline | null;
  betOpenTime?: number | null;
  betCloseTime?: number | null;
  countdown: number | null;
  fightStartTime?: number | null;
  duelEndTime?: number | null;
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
  rendererHealth?: RendererHealthInfo | null;
  seed?: string | null;
  replayHash?: string | null;
}

export interface StreamingStateUpdate {
  type: "STREAMING_STATE_UPDATE";
  cycle: StreamingCycle;
  leaderboard: LeaderboardEntry[];
  cameraTarget: string | null;
  seq?: number;
  emittedAt?: number;
}

export interface CanonicalStreamHealth {
  ready: boolean;
  degradedReason: string | null;
  updatedAt: number | null;
}

export interface CanonicalStreamPlayback {
  url: string | null;
  kind: string | null;
  renderSessionId: string | null;
  presentationDelayMs: number;
}

export interface CanonicalStreamStatus {
  authority: CanonicalStreamHealth;
  renderer: RendererHealthInfo | null;
  sourceRuntime?: SourceRuntimeInfo | null;
  delivery: StreamDeliveryInfo | null;
  deliveryHealth?: CanonicalStreamHealth | null;
}

export interface CanonicalStreamSession {
  schemaVersion: number;
  sourceEpoch: number | null;
  seq: number;
  emittedAt: number;
  duelId: string | null;
  duelKey: string | null;
  phase: StreamingPhase | null;
  phaseVersion: number | null;
  cycle: StreamingCycle;
  leaderboard: LeaderboardEntry[];
  cameraTarget: string | null;
  playback: CanonicalStreamPlayback | null;
  rendererHealth: RendererHealthInfo | null;
  sourceRuntime: SourceRuntimeInfo | null;
  deliveryHealth: CanonicalStreamHealth | null;
  channel: StreamChannelState | null;
  publicReadiness: StreamPublicReadiness | null;
  canonicalDestination: StreamDestinationState | null;
  fallbackDestination: StreamDestinationState | null;
  rendererMetrics: RendererMetricsInfo | null;
  delivery: StreamDeliveryInfo | null;
  authorityHealth: CanonicalStreamHealth;
  status: CanonicalStreamStatus;
}
