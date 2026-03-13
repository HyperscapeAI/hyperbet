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
