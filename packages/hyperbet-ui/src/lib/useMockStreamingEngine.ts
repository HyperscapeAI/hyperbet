import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StreamingPhase,
  AgentInfo,
  LeaderboardEntry,
  StreamingStateUpdate,
  StreamingCycle,
  StreamingAgentContext,
  StreamingInventoryItem,
  StreamingMonologue,
} from "../spectator/types";
import type { ChartDataPoint } from "../components/PredictionMarketPanel";
import type { Trade } from "../components/RecentTrades";
import type { OrderLevel } from "../components/OrderBook";

export type MockAgentContext = StreamingAgentContext & {
  inventory: StreamingInventoryItem[];
  monologues: StreamingMonologue[];
  equipment: Record<string, string>;
  rank: number;
  headToHeadWins: number;
  headToHeadLosses: number;
};

export interface MockStreamingState {
  streamState: StreamingStateUpdate;
  agent1Context: MockAgentContext;
  agent2Context: MockAgentContext;
  yesPot: number;
  noPot: number;
  yesPercent: number;
  noPercent: number;
  chartData: ChartDataPoint[];
  bids: OrderLevel[];
  asks: OrderLevel[];
  recentTrades: Trade[];
  matchAgent1Name: string;
  matchAgent2Name: string;
  status: string;
  statusColor: string;
}

const PHASE_DURATIONS: Record<StreamingPhase, number> = {
  IDLE: 2000,
  ANNOUNCEMENT: 3000,
  COUNTDOWN: 5000,
  FIGHTING: 15000,
  RESOLUTION: 5000,
};

const PHASE_ORDER: StreamingPhase[] = [
  "IDLE",
  "ANNOUNCEMENT",
  "COUNTDOWN",
  "FIGHTING",
  "RESOLUTION",
];

const AGENT_POOL = [
  {
    name: "GoblinSlayer",
    provider: "OpenAI",
    model: "gpt-4o",
    combatLevel: 78,
  },
  {
    name: "DragonBorn",
    provider: "Anthropic",
    model: "claude-3.5",
    combatLevel: 85,
  },
  {
    name: "ShadowMage",
    provider: "Google",
    model: "gemini-pro",
    combatLevel: 62,
  },
  { name: "IronClad", provider: "Meta", model: "llama-3", combatLevel: 71 },
  {
    name: "StormBringer",
    provider: "Mistral",
    model: "mixtral-8x7b",
    combatLevel: 90,
  },
  {
    name: "FrostWarden",
    provider: "Cohere",
    model: "command-r+",
    combatLevel: 55,
  },
  {
    name: "BlazeFury",
    provider: "OpenAI",
    model: "gpt-4-turbo",
    combatLevel: 82,
  },
  {
    name: "VoidWalker",
    provider: "Anthropic",
    model: "claude-3-opus",
    combatLevel: 95,
  },
  { name: "RuneKeeper", provider: "xAI", model: "grok-2", combatLevel: 68 },
  { name: "TitanForge", provider: "DeepSeek", model: "v3", combatLevel: 74 },
];

const MONOLOGUE_ACTIONS = [
  "Lunges forward with a devastating slash!",
  "Parries the incoming attack and counters!",
  "Casts a protective ward around themselves.",
  "Drinks a health potion mid-combat.",
  "Dodges to the left, narrowly avoiding damage.",
  "Unleashes a flurry of rapid strikes!",
  "Channels arcane energy into a powerful blast.",
  "Taunts their opponent with a battle cry.",
  "Uses terrain advantage to reposition.",
  "Activates their special ability!",
];

const MONOLOGUE_THOUGHTS = [
  "Their defense is weakening... time to strike.",
  "I need to conserve energy for the final push.",
  "That last hit was brutal. Must be more careful.",
  "If I can land this combo, it's over.",
  "They're predictable. I see the pattern now.",
  "My health is low but I can turn this around.",
  "Focus. One clean hit is all I need.",
  "They didn't expect that. Keep the pressure up.",
];

const ITEM_IDS = [
  "bronze_sword",
  "health_potion",
  "mithril_shield",
  "rune_essence",
  "lobster",
  "dragon_bones",
  "abyssal_whip",
  "prayer_potion",
  "sharks",
  "super_combat_potion",
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateInventory(): StreamingInventoryItem[] {
  const count = randInt(3, 10);
  const slots = new Set<number>();
  const items: StreamingInventoryItem[] = [];
  while (slots.size < count) {
    const slot = randInt(0, 14);
    if (!slots.has(slot)) {
      slots.add(slot);
      items.push({
        slot,
        itemId: pickRandom(ITEM_IDS),
        quantity: Math.random() > 0.6 ? randInt(2, 25) : 1,
      });
    }
  }
  return items;
}

function buildLeaderboard(): LeaderboardEntry[] {
  return AGENT_POOL.map((a, i) => {
    const wins = randInt(5, 40);
    const losses = randInt(2, 20);
    return {
      rank: i + 1,
      name: a.name,
      provider: a.provider,
      model: a.model,
      wins,
      losses,
      winRate: (wins / (wins + losses)) * 100,
      currentStreak: Math.random() > 0.5 ? randInt(1, 8) : 0,
    };
  })
    .sort((a, b) => b.winRate - a.winRate)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

function pickTwoAgents(): [
  (typeof AGENT_POOL)[number],
  (typeof AGENT_POOL)[number],
] {
  const shuffled = [...AGENT_POOL].sort(() => Math.random() - 0.5);
  return [shuffled[0]!, shuffled[1]!];
}

const EMPTY_STATE: MockStreamingState = {
  streamState: {
    type: "STREAMING_STATE_UPDATE",
    cycle: {
      cycleId: "disabled",
      phase: "IDLE",
      cycleStartTime: 0,
      phaseStartTime: 0,
      phaseEndTime: 0,
      timeRemaining: 0,
      agent1: null,
      agent2: null,
      countdown: null,
      winnerId: null,
      winnerName: null,
      winReason: null,
    },
    leaderboard: [],
    cameraTarget: null,
  },
  agent1Context: {
    id: "",
    name: "",
    provider: "",
    model: "",
    hp: 0,
    maxHp: 0,
    combatLevel: 0,
    wins: 0,
    losses: 0,
    damageDealtThisFight: 0,
    inventory: [],
    monologues: [],
    equipment: {},
    rank: 0,
    headToHeadWins: 0,
    headToHeadLosses: 0,
  },
  agent2Context: {
    id: "",
    name: "",
    provider: "",
    model: "",
    hp: 0,
    maxHp: 0,
    combatLevel: 0,
    wins: 0,
    losses: 0,
    damageDealtThisFight: 0,
    inventory: [],
    monologues: [],
    equipment: {},
    rank: 0,
    headToHeadWins: 0,
    headToHeadLosses: 0,
  },
  yesPot: 0,
  noPot: 0,
  yesPercent: 50,
  noPercent: 50,
  chartData: [],
  bids: [],
  asks: [],
  recentTrades: [],
  matchAgent1Name: "",
  matchAgent2Name: "",
  status: "",
  statusColor: "rgba(255,255,255,0.78)",
};

export function useMockStreamingEngine(
  options: { disabled?: boolean } = {},
): MockStreamingState {
  const { disabled = false } = options;
  const seqRef = useRef(0);
  const cycleCountRef = useRef(0);
  const phaseStartRef = useRef(Date.now());
  const leaderboardRef = useRef<LeaderboardEntry[]>(buildLeaderboard());

  const [pair] = useState(() => pickTwoAgents());

  const [agent1, setAgent1] = useState<MockAgentContext>(() => ({
    id: "agent-1",
    name: pair[0].name,
    provider: pair[0].provider,
    model: pair[0].model,
    hp: 100,
    maxHp: 100,
    combatLevel: pair[0].combatLevel,
    wins: randInt(5, 25),
    losses: randInt(2, 15),
    damageDealtThisFight: 0,
    inventory: generateInventory(),
    monologues: [],
    equipment: {
      weapon: "bronze_sword",
      shield: "mithril_shield",
      helm: "rune_helm",
    },
    rank: randInt(1, 10),
    headToHeadWins: randInt(0, 5),
    headToHeadLosses: randInt(0, 5),
  }));

  const [agent2, setAgent2] = useState<MockAgentContext>(() => ({
    id: "agent-2",
    name: pair[1].name,
    provider: pair[1].provider,
    model: pair[1].model,
    hp: 100,
    maxHp: 100,
    combatLevel: pair[1].combatLevel,
    wins: randInt(5, 25),
    losses: randInt(2, 15),
    damageDealtThisFight: 0,
    inventory: generateInventory(),
    monologues: [],
    equipment: { weapon: "abyssal_whip", shield: "dragon_shield" },
    rank: randInt(1, 10),
    headToHeadWins: randInt(0, 5),
    headToHeadLosses: randInt(0, 5),
  }));

  const [phase, setPhase] = useState<StreamingPhase>("ANNOUNCEMENT");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [winnerName, setWinnerName] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);

  const [yesPot, setYesPot] = useState(500_000_000);
  const [noPot, setNoPot] = useState(500_000_000);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([
    { time: Date.now(), pct: 50 },
  ]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [status, setStatus] = useState("Mock mode - Fight starting soon");

  const transitionToPhase = useCallback((nextPhase: StreamingPhase) => {
    phaseStartRef.current = Date.now();
    setPhase(nextPhase);

    if (nextPhase === "COUNTDOWN") {
      setCountdown(5);
      setStatus("Fight starting in 5...");
    } else if (nextPhase === "ANNOUNCEMENT") {
      setCountdown(null);
      setWinnerId(null);
      setWinnerName(null);
      setWinReason(null);

      const [a, b] = pickTwoAgents();
      const newAgent1: MockAgentContext = {
        id: "agent-1",
        name: a.name,
        provider: a.provider,
        model: a.model,
        hp: 100,
        maxHp: 100,
        combatLevel: a.combatLevel,
        wins: randInt(5, 25),
        losses: randInt(2, 15),
        damageDealtThisFight: 0,
        inventory: generateInventory(),
        monologues: [],
        equipment: {
          weapon: "bronze_sword",
          shield: "mithril_shield",
          helm: "rune_helm",
        },
        rank: randInt(1, 10),
        headToHeadWins: randInt(0, 5),
        headToHeadLosses: randInt(0, 5),
      };
      const newAgent2: MockAgentContext = {
        id: "agent-2",
        name: b.name,
        provider: b.provider,
        model: b.model,
        hp: 100,
        maxHp: 100,
        combatLevel: b.combatLevel,
        wins: randInt(5, 25),
        losses: randInt(2, 15),
        damageDealtThisFight: 0,
        inventory: generateInventory(),
        monologues: [],
        equipment: { weapon: "abyssal_whip", shield: "dragon_shield" },
        rank: randInt(1, 10),
        headToHeadWins: randInt(0, 5),
        headToHeadLosses: randInt(0, 5),
      };
      setAgent1(newAgent1);
      setAgent2(newAgent2);
      setYesPot(500_000_000);
      setNoPot(500_000_000);
      setChartData([{ time: Date.now(), pct: 50 }]);
      setRecentTrades([]);
      setStatus(`Next fight: ${a.name} vs ${b.name}`);
      cycleCountRef.current += 1;
    } else if (nextPhase === "FIGHTING") {
      setCountdown(null);
      setStatus("LIVE - Fight in progress!");
    } else if (nextPhase === "RESOLUTION") {
      setCountdown(null);
    } else if (nextPhase === "IDLE") {
      setCountdown(null);
      setStatus("Waiting for next match...");
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - phaseStartRef.current;
      const duration = PHASE_DURATIONS[phase];

      if (phase === "COUNTDOWN") {
        const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
        setCountdown(remaining);
        setStatus(`Fight starting in ${remaining}...`);
      }

      if (elapsed >= duration) {
        const currentIdx = PHASE_ORDER.indexOf(phase);
        const nextIdx = (currentIdx + 1) % PHASE_ORDER.length;
        transitionToPhase(PHASE_ORDER[nextIdx]!);
        return;
      }

      if (phase === "FIGHTING") {
        setAgent1((prev) => {
          const dmg = randInt(1, 12);
          const newHp = Math.max(0, prev.hp - dmg);
          const mono: StreamingMonologue | null =
            Math.random() > 0.6
              ? {
                  id: `mono-1-${Date.now()}`,
                  type: Math.random() > 0.4 ? "action" : "thought",
                  content:
                    Math.random() > 0.4
                      ? pickRandom(MONOLOGUE_ACTIONS)
                      : pickRandom(MONOLOGUE_THOUGHTS),
                  timestamp: Date.now(),
                }
              : null;

          return {
            ...prev,
            hp: newHp,
            damageDealtThisFight: prev.damageDealtThisFight + randInt(2, 15),
            monologues: mono
              ? [mono, ...prev.monologues].slice(0, 5)
              : prev.monologues,
          };
        });

        setAgent2((prev) => {
          const dmg = randInt(1, 14);
          const newHp = Math.max(0, prev.hp - dmg);
          const mono: StreamingMonologue | null =
            Math.random() > 0.6
              ? {
                  id: `mono-2-${Date.now()}`,
                  type: Math.random() > 0.4 ? "action" : "thought",
                  content:
                    Math.random() > 0.4
                      ? pickRandom(MONOLOGUE_ACTIONS)
                      : pickRandom(MONOLOGUE_THOUGHTS),
                  timestamp: Date.now(),
                }
              : null;

          return {
            ...prev,
            hp: newHp,
            damageDealtThisFight: prev.damageDealtThisFight + randInt(2, 15),
            monologues: mono
              ? [mono, ...prev.monologues].slice(0, 5)
              : prev.monologues,
          };
        });

        const tradeAmount = randInt(100_000, 5_000_000);
        const tradeSide: "YES" | "NO" = Math.random() > 0.5 ? "YES" : "NO";
        if (tradeSide === "YES") {
          setYesPot((p) => p + tradeAmount);
        } else {
          setNoPot((p) => p + tradeAmount);
        }

        setRecentTrades((prev) => {
          const newTrade: Trade = {
            id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            side: tradeSide,
            amount: tradeAmount,
            price: 0.45 + Math.random() * 0.1,
            time: Date.now(),
          };
          return [newTrade, ...prev].slice(0, 50);
        });
      }

      if (phase === "RESOLUTION" && elapsed < 500) {
        setAgent1((prev) => {
          if (winnerId) return prev;
          return prev;
        });

        setAgent2((prev) => {
          if (winnerId) return prev;
          return prev;
        });

        if (!winnerId) {
          const a1Hp = agent1.hp;
          const a2Hp = agent2.hp;
          let winner: MockAgentContext;
          let reason: string;
          if (a1Hp <= 0 && a2Hp <= 0) {
            winner = Math.random() > 0.5 ? agent1 : agent2;
            reason = "Last hit wins in a double KO!";
          } else if (a1Hp <= 0) {
            winner = agent2;
            reason = `${agent1.name} was knocked out!`;
          } else if (a2Hp <= 0) {
            winner = agent1;
            reason = `${agent2.name} was knocked out!`;
          } else {
            winner = a1Hp >= a2Hp ? agent1 : agent2;
            reason = `${winner.name} wins by HP advantage (${Math.max(a1Hp, a2Hp)} HP remaining)`;
          }
          setWinnerId(winner.id);
          setWinnerName(winner.name);
          setWinReason(reason);
          setStatus(`${winner.name} wins! ${reason}`);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    phase,
    transitionToPhase,
    winnerId,
    agent1.hp,
    agent2.hp,
    agent1.name,
    agent2.name,
    agent1.id,
    agent2.id,
  ]);

  useEffect(() => {
    const now = Date.now();
    const totalPot = yesPot + noPot;
    const pct = totalPot > 0 ? Math.round((yesPot / totalPot) * 100) : 50;
    setChartData((prev) => {
      const next = [...prev, { time: now, pct }];
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
  }, [yesPot, noPot]);

  if (disabled) return EMPTY_STATE;

  const totalPot = yesPot + noPot;
  const yesPercent = totalPot > 0 ? Math.round((yesPot / totalPot) * 100) : 50;
  const noPercent = 100 - yesPercent;

  const bids: OrderLevel[] = [
    { price: yesPercent / 100, amount: yesPot, total: yesPot },
    {
      price: Math.max(0.01, yesPercent / 100 - 0.02),
      amount: Math.floor(yesPot * 0.3),
      total: Math.floor(yesPot * 1.3),
    },
  ];

  const asks: OrderLevel[] = [
    {
      price: Math.max(0.01, 1 - yesPercent / 100),
      amount: noPot,
      total: noPot,
    },
    {
      price: Math.min(0.99, 1 - yesPercent / 100 + 0.02),
      amount: Math.floor(noPot * 0.3),
      total: Math.floor(noPot * 1.3),
    },
  ];

  seqRef.current += 1;
  const now = Date.now();
  const phaseStart = phaseStartRef.current;
  const phaseDuration = PHASE_DURATIONS[phase];
  const timeRemaining = Math.max(0, phaseDuration - (now - phaseStart));

  const agent1Info: AgentInfo = {
    id: agent1.id,
    name: agent1.name,
    provider: agent1.provider,
    model: agent1.model,
    hp: agent1.hp,
    maxHp: agent1.maxHp,
    combatLevel: agent1.combatLevel,
    wins: agent1.wins,
    losses: agent1.losses,
    damageDealtThisFight: agent1.damageDealtThisFight,
  };

  const agent2Info: AgentInfo = {
    id: agent2.id,
    name: agent2.name,
    provider: agent2.provider,
    model: agent2.model,
    hp: agent2.hp,
    maxHp: agent2.maxHp,
    combatLevel: agent2.combatLevel,
    wins: agent2.wins,
    losses: agent2.losses,
    damageDealtThisFight: agent2.damageDealtThisFight,
  };

  const cycle: StreamingCycle = {
    cycleId: `mock-cycle-${cycleCountRef.current}`,
    phase,
    cycleStartTime: phaseStart,
    phaseStartTime: phaseStart,
    phaseEndTime: phaseStart + phaseDuration,
    timeRemaining: Math.ceil(timeRemaining / 1000),
    agent1: agent1Info,
    agent2: agent2Info,
    countdown,
    winnerId,
    winnerName,
    winReason,
  };

  const streamState: StreamingStateUpdate = {
    type: "STREAMING_STATE_UPDATE",
    cycle,
    leaderboard: leaderboardRef.current,
    cameraTarget: null,
    seq: seqRef.current,
    emittedAt: now,
  };

  const statusColor = /wins|complete/i.test(status)
    ? "#86efac"
    : /starting|progress|live/i.test(status)
      ? "#fde68a"
      : "rgba(255,255,255,0.78)";

  return {
    streamState,
    agent1Context: agent1,
    agent2Context: agent2,
    yesPot,
    noPot,
    yesPercent,
    noPercent,
    chartData,
    bids,
    asks,
    recentTrades,
    matchAgent1Name: agent1.name,
    matchAgent2Name: agent2.name,
    status,
    statusColor,
  };
}
