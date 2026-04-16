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

export interface StreamingCycle {
  cycleId: string;
  phase: StreamingPhase;
  phaseVersion?: number | null;
  rawCycle?: Record<string, unknown> | null;
  broadcastTimeline?: BroadcastTimeline | null;
  cycleStartTime: number;
  phaseStartTime: number;
  phaseEndTime: number;
  timeRemaining: number;
  agent1: AgentInfo | null;
  agent2: AgentInfo | null;
  duelId?: string | null;
  duelKeyHex?: string | null;
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

export interface SourceRuntimeInfo {
  ready: boolean;
  statusSource: "external_worker" | "in_process_bridge" | "none";
  captureMode: "cdp" | "webcodecs" | "mediarecorder" | "none";
  degradedReason: string | null;
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

export interface StreamPublicReadiness {
  ready: boolean;
  reason: string | null;
  updatedAt: number | null;
}

export interface CanonicalAuthorityInfo {
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
}

export interface StreamDestinationState {
  id: string;
  name: string;
  role: "canonical" | "fallback" | "mirror";
  provider:
    | "cloudflare_stream"
    | "self_hls"
    | "twitch"
    | "kick"
    | "youtube"
    | "custom";
  transport: "llhls" | "hls" | "rtmps" | "srt" | "unknown";
  playbackUrl: string | null;
  ingestUrl: string | null;
  connected: boolean;
  transportHealthy: boolean;
  playbackReady: boolean;
  manifestStatus: "ok" | "stale" | "missing" | "unknown";
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

export interface BroadcastTimeline {
  phase: StreamingPhase | null;
  betOpenTime: number | null;
  betCloseTime: number | null;
  fightStartTime: number | null;
  duelEndTime: number | null;
  presentationDelayMs: number;
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
  sourceRuntime: SourceRuntimeInfo | null;
  delivery: StreamDeliveryInfo | null;
  deliveryHealth: CanonicalStreamHealth;
}

export interface CanonicalStreamSession {
  schemaVersion: number;
  sourceEpoch: number | null;
  seq: number;
  emittedAt: number;
  duelId: string | null;
  duelKey: string | null;
  phase: StreamingPhase;
  phaseVersion: number | null;
  cycle: StreamingCycle;
  leaderboard: LeaderboardEntry[];
  cameraTarget: string | null;
  playback: CanonicalStreamPlayback | null;
  rendererHealth: RendererHealthInfo | null;
  sourceRuntime: SourceRuntimeInfo | null;
  deliveryHealth: CanonicalStreamHealth;
  channel: StreamChannelState | null;
  publicReadiness: StreamPublicReadiness | null;
  canonicalDestination: StreamDestinationState | null;
  fallbackDestination: StreamDestinationState | null;
  canonicalAuthority: CanonicalAuthorityInfo | null;
  rendererMetrics: RendererMetricsInfo | null;
  delivery: StreamDeliveryInfo | null;
  authorityHealth: CanonicalStreamHealth;
  marketParity: import("../lib/marketParity").MarketParityInfo | null;
  status: CanonicalStreamStatus;
}

export type StreamingInventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

export type StreamingMonologue = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

export interface StreamingAgentContext extends AgentInfo {
  inventory?: StreamingInventoryItem[] | null;
  monologues?: StreamingMonologue[] | null;
}
