import React, {
  createContext,
  useContext,
  type ReactNode,
  createElement,
} from "react";
import { useMockStreamingEngine } from "@hyperbet/ui/lib/useMockStreamingEngine";
import type { StreamingStateUpdate } from "@hyperbet/ui/spectator/types";
import type { HmChartPoint } from "@hyperbet/ui/components/HmChart";


export interface MockAgentSnapshot {
  name: string;
  hp: number;
  maxHp: number;
  wins: number;
  losses: number;
  combatLevel: number;
  provider: string;
  model: string;
  damageDealtThisFight: number;
}

export interface MockLeaderboardEntry {
  rank: number;
  agentName: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface MockStreamingStateBridge {
  state: {
    cycle: {
      phase: string;
      agent1: MockAgentSnapshot;
      agent2: MockAgentSnapshot;
      leaderboard: MockLeaderboardEntry[];
      winnerName: string | null;
    };
  } | null;
}

export interface MockOrderLevel {
  price: number;
  size: number;
}

export interface MockTrade {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface MockAvaxStreamData {
  chartData: HmChartPoint[];
  /** null during IDLE tick before agents are assigned. */
  streamingState: MockStreamingStateBridge;
  mockEvmAddress: `0x${string}`;
  yesPct: number;
  totalPot: number;
  bids: MockOrderLevel[];
  asks: MockOrderLevel[];
  recentTrades: MockTrade[];
  leaderboard: MockLeaderboardEntry[];
}


const MOCK_EVM_ADDRESS: `0x${string}` =
  '0xMock000000000000000000000000000000001234' as `0x${string}`;

function toMockOrderLevels(
  levels: Array<{ price: number; amount: number; total: number }>,
): MockOrderLevel[] {
  return levels.map((l) => ({ price: l.price, size: l.amount }));
}

function toMockTrades(
  trades: Array<{ id: string; side: 'YES' | 'NO'; amount: number; price?: number; time: number }>,
): MockTrade[] {
  return trades.map((t) => ({
    price: t.price ?? 0.5,
    size: t.amount,
    side: t.side === 'YES' ? 'buy' : 'sell',
    timestamp: t.time,
  }));
}

function buildStreamingStateBridge(
  raw: StreamingStateUpdate,
): MockStreamingStateBridge {
  const { cycle, leaderboard } = raw;

  if (!cycle.agent1 || !cycle.agent2) {
    return { state: null };
  }

  const agent1: MockAgentSnapshot = {
    name: cycle.agent1.name,
    hp: cycle.agent1.hp,
    maxHp: cycle.agent1.maxHp,
    wins: cycle.agent1.wins,
    losses: cycle.agent1.losses,
    combatLevel: cycle.agent1.combatLevel,
    provider: cycle.agent1.provider,
    model: cycle.agent1.model,
    damageDealtThisFight: cycle.agent1.damageDealtThisFight,
  };

  const agent2: MockAgentSnapshot = {
    name: cycle.agent2.name,
    hp: cycle.agent2.hp,
    maxHp: cycle.agent2.maxHp,
    wins: cycle.agent2.wins,
    losses: cycle.agent2.losses,
    combatLevel: cycle.agent2.combatLevel,
    provider: cycle.agent2.provider,
    model: cycle.agent2.model,
    damageDealtThisFight: cycle.agent2.damageDealtThisFight,
  };

  const mappedLeaderboard: MockLeaderboardEntry[] = leaderboard.map((e) => ({
    rank: e.rank,
    agentName: e.name,
    provider: e.provider,
    model: e.model,
    wins: e.wins,
    losses: e.losses,
    winRate: e.winRate,
    currentStreak: e.currentStreak,
  }));

  return {
    state: {
      cycle: {
        phase: cycle.phase,
        agent1,
        agent2,
        leaderboard: mappedLeaderboard,
        winnerName: cycle.winnerName,
      },
    },
  };
}


const MockDataContext = createContext<MockAvaxStreamData | null>(null);


interface MockDataProviderProps {
  children: ReactNode;
}

export function MockDataProvider({ children }: MockDataProviderProps): React.ReactElement {
  const engine = useMockStreamingEngine();

  const totalPot = engine.yesPot + engine.noPot;

  // HmChart.toUTC converts time/1000 → UTCTimestamp (seconds).
  // Engine emits ms timestamps; two updates in the same second produce
  // duplicate UTCTimestamps which lightweight-charts rejects.
  // Deduplicate by grouping on the second boundary, keep last pct per second,
  // then output representative ms timestamps spaced 1 s apart within each second.
  const chartData: HmChartPoint[] = (() => {
    const seen = new Map<number, number>(); // sec → pct
    for (const p of engine.chartData) {
      seen.set(Math.floor(p.time / 1000), p.pct);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sec, pct]) => ({ time: sec * 1000, pct })); // back to ms for HmChart.toUTC
  })();

  const streamingStateBridge = buildStreamingStateBridge(engine.streamState);

  const leaderboard: MockLeaderboardEntry[] =
    streamingStateBridge.state?.cycle.leaderboard ?? [];

  const value: MockAvaxStreamData = {
    chartData,
    streamingState: streamingStateBridge,
    mockEvmAddress: MOCK_EVM_ADDRESS,
    yesPct: engine.yesPercent,
    totalPot,
    bids: toMockOrderLevels(engine.bids),
    asks: toMockOrderLevels(engine.asks),
    recentTrades: toMockTrades(engine.recentTrades),
    leaderboard,
  };

  return createElement(MockDataContext.Provider, { value }, children);
}


/** Returns null outside a MockDataProvider (safe for live+mock dual rendering). */
export function useMockDataOptional(): MockAvaxStreamData | null {
  return useContext(MockDataContext);
}
