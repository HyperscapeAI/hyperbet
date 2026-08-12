import { useRef, useState } from "react";
import { useMockStreamingEngine } from "@hyperbet/ui/lib/useMockStreamingEngine";
import { PredictionMarketPanel } from "@hyperbet/ui/components/PredictionMarketPanel";
import { AgentStats } from "@hyperbet/ui/components/AgentStats";
import { FightOverlay } from "@hyperbet/ui/components/FightOverlay";

type BetSide = "YES" | "NO";

export function StreamUIApp() {
  const mock = useMockStreamingEngine();
  const appRootRef = useRef<HTMLDivElement | null>(null);

  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("100");
  const [selectedAgentForStats, setSelectedAgentForStats] = useState<
    typeof mock.agent1Context | null
  >(null);
  const [isShowingStats, setIsShowingStats] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const handleAgentClick = (agentSide: BetSide) => {
    const agent = agentSide === "YES" ? mock.agent1Context : mock.agent2Context;
    setSelectedAgentForStats(agent);
    setIsShowingStats(true);
  };

  const handlePlaceBet = () => {
    /* no-op in mock mode */
  };

  const phase = mock.streamState.cycle.phase;
  const countdownText =
    mock.streamState.cycle.timeRemaining > 0
      ? `${Math.floor(mock.streamState.cycle.timeRemaining / 60)
          .toString()
          .padStart(
            2,
            "0",
          )}:${(mock.streamState.cycle.timeRemaining % 60).toString().padStart(2, "0")}`
      : "";

  return (
    <div className="app-root" ref={appRootRef}>
      {/* Animated gradient background */}
      <div
        className="stream-bg"
        style={{
          pointerEvents: "none",
          background:
            "linear-gradient(135deg, #080808 0%, #1d150d 24%, #2a2112 48%, #111920 72%, #080808 100%)",
          backgroundSize: "400% 400%",
          animation: "streamUIBgShift 20s ease infinite",
        }}
      />

      {/* Dev mode badge */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            background: "rgba(234,179,8,0.2)",
            border: "1px solid rgba(234,179,8,0.4)",
            color: "#eab308",
            padding: "4px 10px",
            borderRadius: 6,
          }}
        >
          DUEL ARENA DEV
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: 0.5,
          }}
        >
          Mock duel feed &middot; HMR active
        </span>
      </div>

      {/* Fighting game HP bars + countdown + victory overlay */}
      <FightOverlay
        phase={phase}
        agent1={mock.agent1Context}
        agent2={mock.agent2Context}
        countdown={mock.streamState.cycle.countdown}
        timeRemaining={mock.streamState.cycle.timeRemaining}
        winnerId={mock.streamState.cycle.winnerId}
        winnerName={mock.streamState.cycle.winnerName}
        winReason={mock.streamState.cycle.winReason}
      />

      {/* Agent Stats Modal */}
      {isShowingStats && selectedAgentForStats && (
        <div
          className="agent-stats-modal-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
          onClick={() => setIsShowingStats(false)}
        >
          <div
            style={{
              background: "#111",
              padding: "24px",
              borderRadius: "16px",
              border: "1px solid rgba(255,255,255,0.1)",
              width: "320px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "8px",
              }}
            >
              <button
                onClick={() => setIsShowingStats(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "16px",
                }}
              >
                ✕
              </button>
            </div>
            <AgentStats
              agent={selectedAgentForStats}
              side={selectedAgentForStats.id === "agent-1" ? "left" : "right"}
            />
          </div>
        </div>
      )}

      {/* Bottom-docked Betting Panel */}
      <div className="betting-dock">
        <div className="betting-dock-inner">
          {/* Header row: LIVE status + wallets + collapse */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 14px",
                borderRadius: 10,
                background: `linear-gradient(180deg, ${
                  mock.statusColor === "#22c55e"
                    ? "rgba(34,197,94,0.15)"
                    : mock.statusColor === "#ef4444"
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(234,179,8,0.12)"
                } 0%, rgba(0,0,0,0.2) 100%)`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 2px rgba(0,0,0,0.15), 0 2px 8px ${
                  mock.statusColor === "#22c55e"
                    ? "rgba(34,197,94,0.12)"
                    : mock.statusColor === "#ef4444"
                      ? "rgba(239,68,68,0.12)"
                      : "rgba(234,179,8,0.1)"
                }`,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: mock.statusColor,
                  boxShadow: `0 0 8px ${mock.statusColor}, 0 0 3px ${mock.statusColor}`,
                  animation: "statusPulse 1.5s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  color: mock.statusColor,
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  fontFamily: "'Orbitron', 'Inter', system-ui, sans-serif",
                  textShadow: `0 0 10px ${mock.statusColor}40, 0 1px 2px rgba(0,0,0,0.4)`,
                }}
              >
                {mock.status}
              </span>
              {countdownText && (
                <span
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "monospace",
                  }}
                >
                  {countdownText}
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="wallet-connect-btn"
                style={{ opacity: 0.5, cursor: "default" }}
              >
                Mock Wallet
              </button>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 12px",
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.04)",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#eab308",
                  }}
                />
                42,069 PTS
              </div>

              {/* Collapse / Expand button */}
              <button
                onClick={() => setIsPanelCollapsed((p) => !p)}
                title={isPanelCollapsed ? "Expand panel" : "Collapse panel"}
                style={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  padding: 0,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  style={{
                    transform: isPanelCollapsed
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                >
                  <path
                    d="M4 6L8 10L12 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Collapsible content */}
          {!isPanelCollapsed && (
            <div style={{ marginTop: 12 }}>
              <PredictionMarketPanel
                yesPercent={mock.yesPercent}
                noPercent={mock.noPercent}
                yesPool={mock.yesPot}
                noPool={mock.noPot}
                side={side}
                setSide={setSide}
                amountInput={amountInput}
                setAmountInput={setAmountInput}
                onPlaceBet={handlePlaceBet}
                isWalletReady={true}
                programsReady={true}
                agent1Name={mock.matchAgent1Name}
                agent2Name={mock.matchAgent2Name}
                chartData={mock.chartData}
                bids={mock.bids}
                asks={mock.asks}
                recentTrades={mock.recentTrades}
                onViewAgent1={() => handleAgentClick("YES")}
                onViewAgent2={() => handleAgentClick("NO")}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes streamUIBgShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
