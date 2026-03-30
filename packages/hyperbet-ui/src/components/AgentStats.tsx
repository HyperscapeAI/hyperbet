import React from "react";
import { resolveUiLocale, type UiLocale } from "@hyperbet/ui/i18n";

type StreamingInventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

type StreamingMonologue = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

export type StreamingAgentContext = {
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
  inventory: StreamingInventoryItem[];
  monologues: StreamingMonologue[];
};

interface AgentStatsProps {
  agent: StreamingAgentContext | null;
  side?: "left" | "right";
  locale?: UiLocale;
}

function getAgentStatsCopy(locale: UiLocale) {
  return locale === "zh"
    ? {
        waiting: "正在等待代理数据...",
        level: (value: number, provider: string, model: string) =>
          `等级 ${value} • ${provider} ${model}`,
        record: "战绩",
        totalDamage: "总伤害",
        hpStatus: "生命值",
        inventory: "背包模组",
        feed: "神经流",
        winLoss: (wins: number, losses: number) => `${wins}胜 - ${losses}负`,
        monoType: (value: string) => (value === "action" ? "行动" : "思考"),
      }
    : {
        waiting: "Waiting for agent data...",
        level: (value: number, provider: string, model: string) =>
          `LVL ${value} • ${provider} ${model}`,
        record: "RECORD",
        totalDamage: "TOTAL DMG",
        hpStatus: "HP STATUS",
        inventory: "INVENTORY MODULE",
        feed: "NEURAL FEED",
        winLoss: (wins: number, losses: number) => `${wins}W - ${losses}L`,
        monoType: (value: string) => value,
      };
}

export function AgentStats({
  agent,
  side = "left",
  locale,
}: AgentStatsProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getAgentStatsCopy(resolvedLocale);
  if (!agent) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "32px 0",
          color: "rgba(255,255,255,0.3)",
          fontSize: 13,
          fontWeight: 900,
          fontFamily: "var(--hm-font-display)",
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        {copy.waiting}
      </div>
    );
  }

  const hpPercent = Math.max(0, Math.min(100, (agent.hp / agent.maxHp) * 100));
  const isLowHp = hpPercent < 25;
  const accentColor = side === "left" ? "#00ffcc" : "#ff0d3c";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "var(--hm-font-body)",
      }}
    >
      {/* Header Info */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 900,
            fontFamily: "var(--hm-font-display)",
            border: `1px solid ${accentColor}44`,
            boxShadow: `0 4px 16px ${accentColor}18, inset 0 1px 0 rgba(255,255,255,0.1)`,
            color: accentColor,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {agent.name.charAt(0)}
        </div>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: 1,
              fontFamily: "var(--hm-font-display)",
              textTransform: "uppercase",
              lineHeight: 1,
              color: "#fff",
            }}
          >
            {agent.name}
          </h2>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.4)",
              marginTop: 4,
              fontWeight: 800,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              fontFamily: "var(--hm-font-display)",
            }}
          >
            {copy.level(agent.combatLevel, agent.provider, agent.model)}
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatBox
          label={copy.record}
          value={copy.winLoss(agent.wins, agent.losses)}
        />
        <StatBox
          label={copy.totalDamage}
          value={agent.damageDealtThisFight.toString()}
          valueColor={accentColor}
        />
      </div>

      {/* Health Bar */}
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.1)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
            fontSize: 14,
            fontWeight: 900,
            textTransform: "uppercase",
            fontFamily: "var(--hm-font-display)",
            letterSpacing: 2,
          }}
        >
          <span style={{ color: "rgba(255,255,255,0.4)" }}>{copy.hpStatus}</span>
          <span style={{ color: isLowHp ? "#ff0d3c" : "#00ffcc" }}>
            {agent.hp} / {agent.maxHp}
          </span>
        </div>
        <div
          style={{
            height: 14,
            background: "rgba(0,0,0,0.4)",
            borderRadius: 7,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: 2,
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${hpPercent}%`,
              borderRadius: 5,
              background: isLowHp
                ? "linear-gradient(180deg, #ff3d5c 0%, #cc0a30 100%)"
                : "linear-gradient(180deg, #33ffdd 0%, #00d4aa 100%)",
              transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: `0 0 12px ${isLowHp ? "rgba(255,13,60,0.4)" : "rgba(0,255,204,0.4)"}, inset 0 1px 0 rgba(255,255,255,0.3)`,
            }}
          />
        </div>
      </div>

      {/* Inventory */}
      <div>
        <h3
          style={{
            fontSize: 14,
            fontWeight: 900,
            color: "rgba(255,255,255,0.3)",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 10,
            fontFamily: "var(--hm-font-display)",
          }}
        >
          {copy.inventory}
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 6,
          }}
        >
          {Array.from({ length: 15 }).map((_, i) => {
            const item = agent.inventory.find((inv) => inv.slot === i);
            return (
              <div
                key={i}
                style={{
                  aspectRatio: "1",
                  background: item
                    ? "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)"
                    : "rgba(0,0,0,0.2)",
                  border: item
                    ? `1px solid ${accentColor}33`
                    : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  color: "#fff",
                  fontSize: 10,
                  boxShadow: item
                    ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px ${accentColor}10`
                    : "inset 0 1px 0 rgba(255,255,255,0.03)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                {item ? <span style={{ fontSize: 18 }}>📦</span> : null}
                {item && item.quantity > 1 && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      right: 3,
                      fontSize: 9,
                      fontWeight: 900,
                      fontFamily: "var(--hm-font-mono)",
                      background: "rgba(0,0,0,0.6)",
                      padding: "0 3px",
                      borderRadius: 4,
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    x{item.quantity}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Thoughts/Monologues */}
      {agent.monologues && agent.monologues.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: "rgba(255,255,255,0.3)",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 10,
              fontFamily: "var(--hm-font-display)",
            }}
          >
            {copy.feed}
          </h3>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
              padding: 10,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.1)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {agent.monologues.slice(0, 3).map((mono) => (
              <div
                key={mono.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderLeft: `2px solid ${mono.type === "action" ? accentColor : "#f2d08a"}`,
                  padding: "8px 12px",
                  borderRadius: "0 10px 10px 0",
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.85)",
                  position: "relative",
                  zIndex: 2,
                  fontFamily: "var(--hm-font-body)",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: mono.type === "action" ? accentColor : "#f2d08a",
                    display: "block",
                    marginBottom: 2,
                    textTransform: "uppercase",
                    fontWeight: 900,
                    letterSpacing: 1,
                    fontFamily: "var(--hm-font-display)",
                  }}
                >
                  {copy.monoType(mono.type)}
                </span>
                {mono.content}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  valueColor = "#fff",
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "10px 14px",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.1)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.4)",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 2,
          fontFamily: "var(--hm-font-display)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: valueColor,
          fontFamily: "var(--hm-font-display)",
          lineHeight: 1,
          letterSpacing: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}
