import { useEffect, useRef, useState } from "react";
import { CONFIG } from "../lib/config";

export type DuelInventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

export type DuelMonologue = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

export type DuelAgentContext = {
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
  inventory: DuelInventoryItem[];
  monologues: DuelMonologue[];
};

export type DuelContextState = {
  type: string;
  cycle: {
    agent1: DuelAgentContext | null;
    agent2: DuelAgentContext | null;
    cycleId?: string;
    duelId?: string | null;
    duelKeyHex?: string | null;
    broadcastTimeline?: {
      phase?: string | null;
      betOpenTime?: number | null;
      betCloseTime?: number | null;
      fightStartTime?: number | null;
      duelEndTime?: number | null;
      presentationDelayMs?: number;
      updatedAt?: number | null;
    } | null;
    sourceTimeline?: {
      phase?: string | null;
      betOpenTime?: number | null;
      betCloseTime?: number | null;
      fightStartTime?: number | null;
      duelEndTime?: number | null;
      updatedAt?: number | null;
    } | null;
    betOpenTime?: number | null;
    betCloseTime?: number | null;
    fightStartTime?: number | null;
    duelEndTime?: number | null;
    phase?: string;
    winnerId?: string | null;
    winnerName?: string | null;
    winReason?: string | null;
    seed?: string | null;
    replayHash?: string | null;
  };
  leaderboard: unknown[];
  cameraTarget: string | null;
  /**
   * Source-time emission anchor for this context response — the upstream
   * `streamState.emittedAt` of the frame we last observed. The viewer-clock
   * selector (commit 3) keys duel-context history off this field.
   * Nullable for backward compatibility with keeper builds that predate
   * the commit-2 contract.
   */
  sourceEmittedAt?: number | null;
  /**
   * Server-clock timestamp at which the keeper emitted this response.
   * Staleness / max-age budgets key off this field.
   */
  serverEmittedAt?: number | null;
  /**
   * Legacy top-level wall-clock stamp (equal to `sourceEmittedAt` on
   * keeper builds that carry it). Kept for backwards compatibility.
   */
  updatedAt?: number | null;
};

const POLL_INTERVAL_MS = 3000;
const API_URL = CONFIG.gameApiUrl.replace(/\/$/, "");
const DUEL_CONTEXT_URL = `${API_URL}/api/streaming/duel-context`;

function normalizeDuelAgent(raw: unknown): DuelAgentContext | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    id: typeof a.id === "string" ? a.id : "unknown",
    name: typeof a.name === "string" ? a.name : "Agent",
    provider: typeof a.provider === "string" ? a.provider : "AI",
    model: typeof a.model === "string" ? a.model : "v1",
    hp: typeof a.hp === "number" ? a.hp : 100,
    maxHp: typeof a.maxHp === "number" ? a.maxHp : 100,
    combatLevel: typeof a.combatLevel === "number" ? a.combatLevel : 1,
    wins: typeof a.wins === "number" ? a.wins : 0,
    losses: typeof a.losses === "number" ? a.losses : 0,
    damageDealtThisFight:
      typeof a.damageDealtThisFight === "number" ? a.damageDealtThisFight : 0,
    inventory: Array.isArray(a.inventory)
      ? (a.inventory as DuelInventoryItem[])
      : [],
    monologues: Array.isArray(a.monologues)
      ? (a.monologues as DuelMonologue[])
      : [],
  };
}

function normalizeDuelContext(raw: unknown): DuelContextState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.cycle || typeof r.cycle !== "object") return null;
  const cycle = r.cycle as Record<string, unknown>;
  const broadcastTimeline =
    cycle.broadcastTimeline && typeof cycle.broadcastTimeline === "object"
      ? (cycle.broadcastTimeline as Record<string, unknown>)
      : null;
  const sourceTimeline =
    cycle.sourceTimeline && typeof cycle.sourceTimeline === "object"
      ? (cycle.sourceTimeline as Record<string, unknown>)
      : null;
  return {
    type: typeof r.type === "string" ? r.type : "STREAMING_DUEL_CONTEXT",
    cycle: {
      agent1: normalizeDuelAgent(cycle.agent1),
      agent2: normalizeDuelAgent(cycle.agent2),
      cycleId: typeof cycle.cycleId === "string" ? cycle.cycleId : undefined,
      duelId:
        typeof cycle.duelId === "string" || cycle.duelId === null
          ? (cycle.duelId as string | null)
          : null,
      duelKeyHex:
        typeof cycle.duelKeyHex === "string" || cycle.duelKeyHex === null
          ? (cycle.duelKeyHex as string | null)
          : null,
      broadcastTimeline: broadcastTimeline
        ? {
            phase:
              typeof broadcastTimeline.phase === "string" ||
              broadcastTimeline.phase === null
                ? (broadcastTimeline.phase as string | null)
                : null,
            betOpenTime:
              typeof broadcastTimeline.betOpenTime === "number"
                ? broadcastTimeline.betOpenTime
                : null,
            betCloseTime:
              typeof broadcastTimeline.betCloseTime === "number"
                ? broadcastTimeline.betCloseTime
                : null,
            fightStartTime:
              typeof broadcastTimeline.fightStartTime === "number"
                ? broadcastTimeline.fightStartTime
                : null,
            duelEndTime:
              typeof broadcastTimeline.duelEndTime === "number"
                ? broadcastTimeline.duelEndTime
                : null,
            presentationDelayMs:
              typeof broadcastTimeline.presentationDelayMs === "number"
                ? broadcastTimeline.presentationDelayMs
                : 0,
            updatedAt:
              typeof broadcastTimeline.updatedAt === "number"
                ? broadcastTimeline.updatedAt
                : null,
          }
        : null,
      sourceTimeline: sourceTimeline
        ? {
            phase:
              typeof sourceTimeline.phase === "string" ||
              sourceTimeline.phase === null
                ? (sourceTimeline.phase as string | null)
                : null,
            betOpenTime:
              typeof sourceTimeline.betOpenTime === "number"
                ? sourceTimeline.betOpenTime
                : null,
            betCloseTime:
              typeof sourceTimeline.betCloseTime === "number"
                ? sourceTimeline.betCloseTime
                : null,
            fightStartTime:
              typeof sourceTimeline.fightStartTime === "number"
                ? sourceTimeline.fightStartTime
                : null,
            duelEndTime:
              typeof sourceTimeline.duelEndTime === "number"
                ? sourceTimeline.duelEndTime
                : null,
            updatedAt:
              typeof sourceTimeline.updatedAt === "number"
                ? sourceTimeline.updatedAt
                : null,
          }
        : null,
      betOpenTime:
        typeof broadcastTimeline?.betOpenTime === "number"
          ? broadcastTimeline.betOpenTime
          : typeof cycle.betOpenTime === "number"
            ? cycle.betOpenTime
            : null,
      betCloseTime:
        typeof broadcastTimeline?.betCloseTime === "number"
          ? broadcastTimeline.betCloseTime
          : typeof cycle.betCloseTime === "number"
            ? cycle.betCloseTime
            : null,
      fightStartTime:
        typeof broadcastTimeline?.fightStartTime === "number"
          ? broadcastTimeline.fightStartTime
          : typeof cycle.fightStartTime === "number"
            ? cycle.fightStartTime
            : null,
      duelEndTime:
        typeof broadcastTimeline?.duelEndTime === "number"
          ? broadcastTimeline.duelEndTime
          : typeof cycle.duelEndTime === "number"
            ? cycle.duelEndTime
            : null,
      phase:
        typeof broadcastTimeline?.phase === "string"
          ? broadcastTimeline.phase
          : typeof cycle.phase === "string"
            ? cycle.phase
            : undefined,
      winnerId:
        typeof cycle.winnerId === "string" || cycle.winnerId === null
          ? (cycle.winnerId as string | null)
          : null,
      winnerName:
        typeof cycle.winnerName === "string" || cycle.winnerName === null
          ? (cycle.winnerName as string | null)
          : null,
      winReason:
        typeof cycle.winReason === "string" || cycle.winReason === null
          ? (cycle.winReason as string | null)
          : null,
      seed:
        typeof cycle.seed === "string" || cycle.seed === null
          ? (cycle.seed as string | null)
          : null,
      replayHash:
        typeof cycle.replayHash === "string" || cycle.replayHash === null
          ? (cycle.replayHash as string | null)
          : null,
    },
    leaderboard: Array.isArray(r.leaderboard) ? r.leaderboard : [],
    cameraTarget:
      typeof r.cameraTarget === "string" || r.cameraTarget === null
        ? (r.cameraTarget as string | null)
        : null,
    // Commit-2 contract fields. Backfill source → updatedAt when the
    // keeper predates the contract so the selector always has an anchor.
    sourceEmittedAt:
      typeof r.sourceEmittedAt === "number"
        ? r.sourceEmittedAt
        : typeof r.updatedAt === "number"
          ? r.updatedAt
          : null,
    serverEmittedAt:
      typeof r.serverEmittedAt === "number"
        ? r.serverEmittedAt
        : typeof r.updatedAt === "number"
          ? r.updatedAt
          : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : null,
  };
}

export function useDuelContext(options: { disabled?: boolean } = {}) {
  const { disabled = false } = options;
  const [context, setContext] = useState<DuelContextState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (disabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      return;
    }

    const doFetch = async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(DUEL_CONTEXT_URL, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (res.ok) {
          const data = normalizeDuelContext(await res.json());
          if (data) setContext(data);
        }
      } catch {
        // unavailable — streaming mode not active, silently ignore
      }
    };

    void doFetch();
    timerRef.current = setInterval(() => void doFetch(), POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [disabled]);

  return { context };
}
