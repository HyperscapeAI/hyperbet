import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStreamingState } from "./useStreamingState";
import type {
  LeaderboardEntry,
  StreamingAgentContext,
  StreamingPhase,
  StreamingStateUpdate,
} from "./types";

interface SpectatorPanelProps {
  agentA?: StreamingAgentContext | null;
  agentB?: StreamingAgentContext | null;
  state?: StreamingStateUpdate | null;
  isConnected?: boolean;
}

const COMPACT_INVENTORY_SLOTS = 20;
const INVENTORY_COLUMNS = 10;

function phaseLabel(phase: StreamingPhase): string {
  switch (phase) {
    case "IDLE":
      return "Waiting";
    case "ANNOUNCEMENT":
      return "Next Match";
    case "COUNTDOWN":
      return "Starting";
    case "FIGHTING":
      return "LIVE";
    case "RESOLUTION":
      return "Result";
  }
}

function phaseColor(phase: StreamingPhase): string {
  switch (phase) {
    case "FIGHTING":
      return "#ef4444";
    case "COUNTDOWN":
      return "#eab308";
    case "ANNOUNCEMENT":
      return "#3b82f6";
    case "RESOLUTION":
      return "#22c55e";
    default:
      return "rgba(255,255,255,0.3)";
  }
}

function hpColor(pct: number): string {
  if (pct > 60) return "#22c55e";
  if (pct > 30) return "#eab308";
  return "#ef4444";
}

function winRate(agent: StreamingAgentContext): string {
  const total = agent.wins + agent.losses;
  if (total <= 0) return "0";
  return ((agent.wins / total) * 100).toFixed(0);
}

function MetricBadge({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        padding: "2px 5px",
        borderRadius: 5,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontSize: 9,
        fontWeight: 700,
        display: "inline-flex",
        gap: 3,
        alignItems: "center",
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.45)", letterSpacing: 0.3 }}>
        {label}
      </span>
      <span style={{ color: "#fff" }}>{value}</span>
    </div>
  );
}

function CompactAgentRow({
  agent,
  label,
  accentColor,
  isWinner,
}: {
  agent: StreamingAgentContext;
  label: string;
  accentColor: string;
  isWinner: boolean;
}) {
  const hpPct = agent.maxHp > 0 ? (agent.hp / agent.maxHp) * 100 : 0;
  const inventoryBySlot = new Map(
    (agent.inventory ?? [])
      .filter(
        (item) =>
          Number.isFinite(item.slot) &&
          item.slot >= 0 &&
          item.slot < COMPACT_INVENTORY_SLOTS,
      )
      .map((item) => [item.slot, item] as const),
  );

  return (
    <div
      style={{
        borderRadius: 10,
        padding: 10,
        background: isWinner
          ? "rgba(34,197,94,0.14)"
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${
          isWinner ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.1)"
        }`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              color: accentColor,
              marginBottom: 1,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: "#fff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.45)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.provider} / {agent.model}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            maxWidth: "100%",
          }}
        >
          <MetricBadge label="LVL" value={agent.combatLevel} />
          <MetricBadge label="HP" value={`${agent.hp}/${agent.maxHp}`} />
          <MetricBadge label="DMG" value={agent.damageDealtThisFight} />
          <MetricBadge label="W-L" value={`${agent.wins}-${agent.losses}`} />
          <MetricBadge label="WIN" value={`${winRate(agent)}%`} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          style={{
            height: 5,
            borderRadius: 4,
            overflow: "hidden",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, hpPct))}%`,
              height: "100%",
              background: hpColor(hpPct),
              transition: "width 0.25s ease",
            }}
          />
        </div>
        <span
          style={{
            fontSize: 9,
            color: "rgba(255,255,255,0.6)",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          HP {agent.hp}/{agent.maxHp}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${INVENTORY_COLUMNS}, minmax(0, 1fr))`,
          gap: 2,
          width: "100%",
        }}
      >
        {Array.from({ length: COMPACT_INVENTORY_SLOTS }).map((_, slot) => {
          const item = inventoryBySlot.get(slot);
          return (
            <div
              key={slot}
              style={{
                borderRadius: 3,
                border: "1px solid rgba(255,255,255,0.08)",
                background: item ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.28)",
                position: "relative",
                aspectRatio: "1 / 1",
                minHeight: 11,
              }}
              title={
                item
                  ? `${item.itemId}${item.quantity > 1 ? ` x${item.quantity}` : ""}`
                  : "Empty"
              }
            >
              {item && item.quantity > 1 && (
                <span
                  style={{
                    position: "absolute",
                    right: 1,
                    bottom: 0,
                    fontSize: 7,
                    lineHeight: 1,
                    color: "#fff",
                    fontWeight: 700,
                    textShadow: "0 1px 2px rgba(0,0,0,0.85)",
                  }}
                >
                  {item.quantity}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchupCard({
  leftAgent,
  rightAgent,
  leftWon,
  rightWon,
}: {
  leftAgent: StreamingAgentContext;
  rightAgent: StreamingAgentContext;
  leftWon: boolean;
  rightWon: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          alignSelf: "center",
          fontSize: 10,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          fontWeight: 800,
        }}
      >
        Agent A vs Agent B
      </div>
      <CompactAgentRow
        agent={leftAgent}
        label="Agent A"
        accentColor="#60a5fa"
        isWinner={leftWon}
      />
      <CompactAgentRow
        agent={rightAgent}
        label="Agent B"
        accentColor="#f87171"
        isWinner={rightWon}
      />
    </div>
  );
}

function LeaderboardModal({
  entries,
  modalId,
  onClose,
}: {
  entries: LeaderboardEntry[];
  modalId: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
        padding: "clamp(12px, 3vw, 24px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        id={modalId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        style={{
          width: "min(780px, calc(100vw - 24px))",
          maxHeight: "80vh",
          overflow: "auto",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(10,10,10,0.95)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1.3,
                color: "rgba(255,255,255,0.45)",
                fontWeight: 700,
              }}
            >
              Leaderboard
            </div>
            <div
              id={`${modalId}-title`}
              style={{ fontSize: 19, fontWeight: 800 }}
            >
              All Agents ({entries.length})
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              padding: "7px 10px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 16,
              color: "rgba(255,255,255,0.6)",
              fontSize: 13,
            }}
          >
            No leaderboard data yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((entry) => (
              <div
                key={`${entry.rank}-${entry.name}`}
                style={{
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 12px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  #{entry.rank}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#fff",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.45)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.provider} / {entry.model}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.65)",
                    fontWeight: 700,
                  }}
                >
                  {entry.wins}W-{entry.losses}L
                </div>
                <div
                  style={{ fontSize: 12, color: "#22c55e", fontWeight: 800 }}
                >
                  {entry.winRate.toFixed(0)}%
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      entry.currentStreak > 1
                        ? "#eab308"
                        : "rgba(255,255,255,0.4)",
                    fontWeight: 700,
                    minWidth: 52,
                  }}
                >
                  {entry.currentStreak > 1
                    ? `${entry.currentStreak} streak`
                    : "-"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SpectatorPanel({
  agentA = null,
  agentB = null,
  state: providedState = null,
  isConnected: providedIsConnected,
}: SpectatorPanelProps) {
  const hookState = useStreamingState({
    disabled: providedState !== null || providedIsConnected !== undefined,
  });
  const state = providedState ?? hookState.state;
  const isConnected = providedIsConnected ?? hookState.isConnected;
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const leaderboardModalId = useId();

  const cycle = state?.cycle;
  const phase = cycle?.phase ?? "IDLE";
  const leftAgent = agentA ?? cycle?.agent1 ?? null;
  const rightAgent = agentB ?? cycle?.agent2 ?? null;
  const leaderboard = state?.leaderboard ?? [];

  useEffect(() => {
    if (!isLeaderboardOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isLeaderboardOpen]);

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.65)",
        borderRadius: 16,
        padding: 24,
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
        color: "#fff",
        fontFamily: "var(--hm-font-body)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            <span style={{ color: phaseColor(phase) }}>Match</span>{" "}
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Stream</span>
          </h2>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              background: phaseColor(phase),
              color: "#000",
              borderRadius: 4,
              padding: "2px 6px",
              fontWeight: 800,
            }}
          >
            {phaseLabel(phase)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setIsLeaderboardOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isLeaderboardOpen}
            aria-controls={leaderboardModalId}
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.9,
              color: "#fff",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 7,
              padding: "6px 8px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Leaderboard ({leaderboard.length})
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isConnected ? "#22c55e" : "#ef4444",
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.4)",
                fontWeight: 600,
              }}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {cycle?.countdown != null && phase === "COUNTDOWN" && (
        <div
          style={{
            textAlign: "center",
            fontSize: "clamp(40px, 9vw, 64px)",
            fontWeight: 900,
            color: "#eab308",
            margin: "10px 0",
          }}
        >
          {cycle.countdown}
        </div>
      )}

      {leftAgent && rightAgent ? (
        <MatchupCard
          leftAgent={leftAgent}
          rightAgent={rightAgent}
          leftWon={phase === "RESOLUTION" && cycle?.winnerId === leftAgent.id}
          rightWon={phase === "RESOLUTION" && cycle?.winnerId === rightAgent.id}
        />
      ) : (
        <div
          style={{
            textAlign: "center",
            padding: "32px 0",
            color: "rgba(255,255,255,0.3)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Waiting for agents...
        </div>
      )}

      {phase === "RESOLUTION" && cycle?.winnerName && (
        <div
          style={{
            textAlign: "center",
            padding: 12,
            background: "rgba(34,197,94,0.15)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 12,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 800, color: "#22c55e" }}>
            {cycle.winnerName} wins!
          </span>
          {cycle.winReason && (
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                marginTop: 4,
              }}
            >
              {cycle.winReason}
            </div>
          )}
        </div>
      )}
      {isLeaderboardOpen &&
        createPortal(
          <LeaderboardModal
            entries={leaderboard}
            modalId={leaderboardModalId}
            onClose={() => setIsLeaderboardOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
