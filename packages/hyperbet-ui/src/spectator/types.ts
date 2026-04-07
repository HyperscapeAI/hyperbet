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
  cycleStartTime: number;
  phaseStartTime: number;
  phaseEndTime: number;
  phaseVersion?: number | null;
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

export interface CanonicalStreamPlayback {
  url: string | null;
  kind: string | null;
  renderSessionId: string | null;
  presentationDelayMs: number;
}

export interface CanonicalStreamStatus {
  authority: CanonicalStreamHealth;
  renderer: RendererHealthInfo | null;
  delivery: StreamDeliveryInfo | null;
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
  rendererMetrics: RendererMetricsInfo | null;
  delivery: StreamDeliveryInfo | null;
  authorityHealth: CanonicalStreamHealth;
  status: CanonicalStreamStatus;
}
