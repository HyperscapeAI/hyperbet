import React, { useEffect, useState } from "react";
import type { MockAgentContext } from "../lib/useMockStreamingEngine";
import type { StreamingPhase } from "../spectator/types";
import { GAME_API_URL } from "../lib/solanaConfig";
import { resolveUiLocale, getUiCopy } from "../i18n";

interface FightOverlayProps {
  phase: StreamingPhase;
  agent1: MockAgentContext;
  agent2: MockAgentContext;
  countdown: number | null;
  timeRemaining: number;
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
}

interface ManifestItemRecord {
  id: string;
  iconPath?: string | null;
}

const ITEM_MANIFEST_FILES = [
  "weapons.json",
  "ammunition.json",
  "resources.json",
  "tools.json",
  "misc.json",
  "armor.json",
  "runes.json",
  "food.json",
] as const;

const INVENTORY_FALLBACK_ICONS = [
  "🗡️",
  "🪓",
  "🛡️",
  "🏹",
  "🧪",
  "💎",
  "🪙",
  "📜",
  "🪄",
  "🧿",
] as const;

let cachedItemIconMap: Record<string, string> | null = null;
let itemIconMapPromise: Promise<Record<string, string>> | null = null;

function resolveManifestIconPath(iconPath: string): string {
  const base = GAME_API_URL.replace(/\/$/, "");
  if (iconPath.startsWith("asset://")) {
    const relativePath = iconPath.replace("asset://", "");
    return `${base}/game-assets/${relativePath}`;
  }
  if (iconPath.startsWith("/")) return `${base}${iconPath}`;
  return `${base}/${iconPath}`;
}

async function loadItemIconMap(): Promise<Record<string, string>> {
  if (cachedItemIconMap) return cachedItemIconMap;
  if (itemIconMapPromise) return itemIconMapPromise;

  itemIconMapPromise = (async () => {
    const responses = await Promise.all(
      ITEM_MANIFEST_FILES.map(async (fileName) => {
        const response = await fetch(
          `${GAME_API_URL}/game-assets/manifests/items/${fileName}`,
          { cache: "force-cache" },
        );
        if (!response.ok) return [] as ManifestItemRecord[];
        return (await response.json()) as ManifestItemRecord[];
      }),
    ).catch(() => [] as ManifestItemRecord[][]);

    const items = responses.flat();
    const iconMap: Record<string, string> = {};
    for (const item of items) {
      if (!item.id || !item.iconPath) continue;
      iconMap[item.id] = resolveManifestIconPath(item.iconPath);
    }

    cachedItemIconMap = iconMap;
    return iconMap;
  })();

  return itemIconMapPromise;
}

function getDeterministicFallbackIcon(itemKey: string, slot: number): string {
  const source = `${itemKey}:${slot}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return INVENTORY_FALLBACK_ICONS[hash % INVENTORY_FALLBACK_ICONS.length]!;
}

function AgentHPBar({
  agent,
  side,
}: {
  agent: MockAgentContext;
  side: "left" | "right";
}) {
  const hpPercent = Math.max(0, Math.min(100, (agent.hp / agent.maxHp) * 100));
  const isCritical = hpPercent < 20;
  const hpColor = isCritical ? "#ff0d3c" : "#00ffcc";
  const isRight = side === "right";
  const [itemIconMap, setItemIconMap] = useState<Record<string, string>>({});
  const hpOuterClipPath = isRight
    ? "polygon(2% 0, 100% 0, 98% 100%, 0 100%)"
    : "polygon(0 0, 98% 0, 100% 100%, 2% 100%)";
  const hpFillClipPath = isRight
    ? "polygon(10px 0, 100% 0, 100% 100%, 0 100%)"
    : "polygon(0 0, calc(100% - 10px) 0, 100% 100%, 0 100%)";
  const locale = resolveUiLocale();
  const copy = getUiCopy(locale);
  const inventoryBySlot = new Map(
    agent.inventory.map((item) => [item.slot, item]),
  );
  const equipmentSlotOrder = [
    "weapon",
    "shield",
    "helm",
    "helmet",
    "body",
    "legs",
    "boots",
    "gloves",
    "cape",
    "amulet",
    "ring",
  ] as const;
  const equippedItemIds: string[] = [];
  const seenEquipped = new Set<string>();
  for (const slot of equipmentSlotOrder) {
    const itemId = agent.equipment[slot];
    if (!itemId || seenEquipped.has(itemId)) continue;
    equippedItemIds.push(itemId);
    seenEquipped.add(itemId);
  }
  for (const itemId of Object.values(agent.equipment)) {
    if (!itemId || seenEquipped.has(itemId)) continue;
    equippedItemIds.push(itemId);
    seenEquipped.add(itemId);
  }
  const equippedSlotsVisible = 6;
  const equippedCells = [
    ...equippedItemIds.slice(0, equippedSlotsVisible),
    ...Array.from({
      length: Math.max(0, equippedSlotsVisible - equippedItemIds.length),
    }).map(() => null as string | null),
  ];

  useEffect(() => {
    let isMounted = true;
    void loadItemIconMap().then((iconMap) => {
      if (!isMounted) return;
      setItemIconMap(iconMap);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "clamp(140px, 38vw, 480px)",
        alignItems: isRight ? "flex-end" : "flex-start",
      }}
    >
      {/* Name + stats row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          width: "100%",
          padding: "0 6px",
          fontFamily: "var(--hm-font-display)",
          textTransform: "uppercase",
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexDirection: isRight ? "row-reverse" : "row",
          }}
        >
          <span
            style={{
              background: "#ff0d3c",
              color: "#fff",
              padding: "2px 8px",
              fontSize: "0.85rem",
              fontWeight: 900,
              transform: isRight ? "skew(15deg)" : "skew(-15deg)",
              border: "1px solid #fff",
              display: "inline-block",
            }}
          >
            #{agent.rank > 0 ? agent.rank : "-"}
          </span>
          <span
            style={{
              color: "#fff",
              fontSize: "clamp(1rem, 2vw, 1.4rem)",
              fontWeight: 900,
              letterSpacing: 1,
              textShadow: "2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000",
            }}
          >
            {agent.name}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexDirection: isRight ? "row-reverse" : "row",
            background: "rgba(0,0,0,0.7)",
            padding: "2px 10px",
            transform: isRight ? "skew(15deg)" : "skew(-15deg)",
            border: "1px solid rgba(255,255,255,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexDirection: "row",
            }}
          >
            <span
              style={{ color: "#aaa", fontSize: "0.65rem", fontWeight: 800 }}
            >
              {copy.overall}
            </span>
            <span
              style={{ color: "#f2d08a", fontSize: "0.9rem", fontWeight: 900 }}
            >
              {agent.wins}-{agent.losses}
            </span>
          </div>
          <span style={{ color: "#555", fontSize: "0.8rem", margin: "0 4px" }}>
            /
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexDirection: "row",
            }}
          >
            <span
              style={{ color: "#aaa", fontSize: "0.65rem", fontWeight: 800 }}
            >
              {copy.headToHead}
            </span>
            <span
              style={{ color: "#f2d08a", fontSize: "0.9rem", fontWeight: 900 }}
            >
              {agent.headToHeadWins}-{agent.headToHeadLosses}
            </span>
          </div>
        </div>
      </div>

      {/* HP bar - skewed fighting-game style frame + inset fill */}
      <div
        style={{
          width: "100%",
          height: 28,
          position: "relative",
          clipPath: hpOuterClipPath,
          background: "#fff",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 2,
            clipPath: hpOuterClipPath,
            background: "rgba(0,0,0,0.8)",
            overflow: "hidden",
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              ...(isRight ? { right: 0 } : { left: 0 }),
              width: `${hpPercent}%`,
              background: hpColor,
              clipPath: hpFillClipPath,
              transition: "width 0.15s ease-out, background 0.2s",
              boxShadow: isCritical
                ? "inset 0 0 8px rgba(255,13,60,0.45)"
                : "inset 0 0 8px rgba(0,255,204,0.35)",
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            ...(isRight ? { right: 32 } : { left: 32 }),
            color: "#fff",
            fontSize: "1.2rem",
            fontWeight: 900,
            fontFamily: "var(--hm-font-mono)",
            textShadow:
              "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          {agent.hp}
        </div>
      </div>

      {/* Bottom: DMG + equipment + inventory */}
      <div
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginTop: 4,
          padding: "0 6px",
          gap: 2,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            border: "2px solid #ff0d3c",
            padding: "5px 15px",
            transform: isRight ? "skew(15deg)" : "skew(-15deg)",
            minWidth: 82,
            boxShadow: "0 0 10px rgba(255,13,60,0.3)",
          }}
        >
          <div
            style={{
              color: "#ff0d3c",
              fontSize: "1.55rem",
              fontWeight: 900,
              lineHeight: 1,
              textShadow: "0 0 8px rgba(255,13,60,0.6)",
            }}
          >
            {agent.damageDealtThisFight}
          </div>
          <div
            style={{
              color: "#fff",
              fontSize: "0.65rem",
              fontWeight: 800,
              letterSpacing: 2,
              marginTop: 2,
            }}
          >
            {copy.damage}
          </div>
        </div>

        <div
          className="fight-inventory-grid"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: 1,
            minWidth: 0,
            gap: 6,
            background: "rgba(0,0,0,0.6)",
            padding: "3px 6px",
            minHeight: 56,
            border: "1px solid rgba(255,255,255,0.2)",
            transform: isRight ? "skew(15deg)" : "skew(-15deg)",
            flexDirection: isRight ? "row-reverse" : "row",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(17, minmax(0, 1fr))",
              gridTemplateRows: "repeat(2, minmax(0, 1fr))",
              gap: 2,
              flex: 1,
              minWidth: 0,
              width: "100%",
            }}
          >
            {(() => {
              const equippedSection = equippedCells.map((itemId, idx) => {
                const normalizedItemId =
                  itemId && itemId.endsWith("_noted")
                    ? itemId.replace(/_noted$/, "")
                    : itemId;
                const iconUrl = normalizedItemId
                  ? (itemIconMap[itemId ?? ""] ??
                    itemIconMap[normalizedItemId] ??
                    null)
                  : null;

                return (
                  <div
                    key={`equipped-${idx}-${itemId ?? "empty"}`}
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "1 / 1",
                      background: "rgba(255,255,255,0.05)",
                      border: itemId
                        ? "1px solid rgba(100,200,255,0.6)"
                        : "1px solid rgba(100,200,255,0.2)",
                      borderRadius: 2,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s",
                    }}
                  >
                    {itemId && iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={normalizedItemId ?? itemId}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                        style={{
                          width: "110%",
                          height: "110%",
                          objectFit: "cover",
                          display: "block",
                        }}
                        draggable={false}
                      />
                    ) : itemId ? (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1,
                          filter: "drop-shadow(0 0 2px rgba(0,0,0,0.6))",
                        }}
                      >
                        {getDeterministicFallbackIcon(
                          normalizedItemId || itemId,
                          idx,
                        )}
                      </span>
                    ) : null}
                  </div>
                );
              });

              const inventorySection = Array.from({ length: 28 }).map(
                (_, i) => {
                  const slotItem = inventoryBySlot.get(i);
                  const hasItem = Boolean(slotItem);
                  const itemId = slotItem?.itemId ?? "";
                  const normalizedItemId = itemId.endsWith("_noted")
                    ? itemId.replace(/_noted$/, "")
                    : itemId;
                  const iconUrl =
                    itemIconMap[itemId] ??
                    itemIconMap[normalizedItemId] ??
                    null;

                  return (
                    <div
                      key={`inv-${i}`}
                      style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "1 / 1",
                        background: "rgba(255,255,255,0.05)",
                        border: hasItem
                          ? "1px solid rgba(242,208,138,0.5)"
                          : "1px solid rgba(255,255,255,0.08)",
                        transition: "all 0.2s",
                        overflow: "hidden",
                        borderRadius: 2,
                      }}
                    >
                      {hasItem && iconUrl ? (
                        <img
                          src={iconUrl}
                          alt={normalizedItemId}
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                          style={{
                            width: "110%",
                            height: "110%",
                            objectFit: "cover",
                            display: "block",
                          }}
                          draggable={false}
                        />
                      ) : hasItem ? (
                        <span
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            lineHeight: 1,
                            filter: "drop-shadow(0 0 2px rgba(0,0,0,0.55))",
                          }}
                        >
                          {getDeterministicFallbackIcon(
                            normalizedItemId || "item",
                            i,
                          )}
                        </span>
                      ) : null}
                    </div>
                  );
                },
              );

              const rows = [];
              for (let row = 0; row < 2; row++) {
                const eqRow = equippedSection.slice(row * 3, row * 3 + 3);
                const invRow = inventorySection.slice(row * 14, row * 14 + 14);
                if (isRight) {
                  rows.push(...invRow, ...eqRow);
                } else {
                  rows.push(...eqRow, ...invRow);
                }
              }
              return rows;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function CountdownDisplay({ count }: { count: number }) {
  const locale = resolveUiLocale();
  const copy = getUiCopy(locale);
  const displayText = count === 0 ? copy.fight : count.toString();
  const isFight = count === 0;

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
      }}
    >
      <div
        key={count}
        style={{
          fontSize: "clamp(4rem, 12vw, 10rem)",
          fontWeight: "bold",
          fontFamily: "var(--hm-font-display)",
          letterSpacing: -5,
          color: isFight ? "#ff6b6b" : "#f2d08a",
          textShadow: isFight
            ? "0 0 40px rgba(255,107,107,0.8), 0 0 80px rgba(255,107,107,0.4)"
            : "0 0 40px rgba(242,208,138,0.8), 0 0 80px rgba(242,208,138,0.4)",
          animation: "fightCountPulse 0.5s ease-in-out",
        }}
      >
        {displayText}
      </div>
    </div>
  );
}

function VictoryDisplay({
  winner,
  winReason,
}: {
  winner: MockAgentContext;
  winReason: string;
}) {
  const locale = resolveUiLocale();
  const copy = getUiCopy(locale);
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
        animation: "fightSlideIn 0.5s ease-out",
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 100%)",
          border: "3px solid #f2d08a",
          borderRadius: 16,
          padding: "clamp(20px, 4vw, 40px) clamp(24px, 5vw, 60px)",
          textAlign: "center",
          animation: "fightGlow 2s ease-in-out infinite",
          maxWidth: "min(90vw, 500px)",
        }}
      >
        <div
          style={{
            color: "#f2d08a",
            fontSize: "1rem",
            fontWeight: "bold",
            letterSpacing: 8,
            marginBottom: 12,
          }}
        >
          {copy.victory}
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: "clamp(1.5rem, 4vw, 3rem)",
            fontWeight: "bold",
            marginBottom: 8,
            textShadow: "0 0 20px rgba(255,255,255,0.3)",
          }}
        >
          {winner.name}
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: "1.2rem",
            marginBottom: 24,
            fontStyle: "italic",
          }}
        >
          {winReason}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 24,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(242,208,138,0.2)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {winner.wins}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {copy.wins}
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 40,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {winner.losses}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {copy.losses}
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 40,
              background: "rgba(255,255,255,0.2)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{ color: "#fff", fontSize: "1.5rem", fontWeight: "bold" }}
            >
              {Math.round(
                (winner.wins / Math.max(1, winner.wins + winner.losses)) * 100,
              )}
              %
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {copy.winRate}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FightOverlay({
  phase,
  agent1,
  agent2,
  countdown,
  timeRemaining,
  winnerId,
  winnerName: _winnerName,
  winReason,
}: FightOverlayProps) {
  const showHPBars = phase === "FIGHTING" || phase === "COUNTDOWN";
  const winnerAgent =
    winnerId === agent1.id ? agent1 : winnerId === agent2.id ? agent2 : null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 45,
      }}
    >
      {/* HP Bars across the top */}
      {showHPBars && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            width: "min(1200px, calc(100vw - 40px))",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <AgentHPBar agent={agent1} side="left" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 42,
            }}
          >
            <div
              style={{
                minWidth: 164,
                height: 52,
                position: "relative",
                padding: 1,
                clipPath:
                  "polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.1) 100%)",
                boxShadow:
                  "0 10px 28px rgba(0,0,0,0.45), 0 0 14px rgba(96,165,250,0.14)",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(232,243,255,0.95)",
                  fontSize: "clamp(1.28rem, 2.7vw, 2rem)",
                  fontWeight: 900,
                  fontFamily: "var(--hm-font-mono)",
                  letterSpacing: 1.2,
                  textShadow: "0 0 12px rgba(96,165,250,0.25)",
                  background:
                    "linear-gradient(180deg, rgba(10,12,18,0.9) 0%, rgba(10,12,18,0.76) 100%)",
                  clipPath:
                    "polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)",
                  backdropFilter: "blur(14px) saturate(1.2)",
                  WebkitBackdropFilter: "blur(14px) saturate(1.2)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 12,
                    right: 12,
                    height: 1,
                    background:
                      "linear-gradient(90deg, transparent, rgba(191,219,254,0.45), transparent)",
                  }}
                />
                {formatTime(timeRemaining)}
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath:
                    "polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  clipPath:
                    "polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)",
                  boxShadow: "inset 0 -2px 6px rgba(0,0,0,0.22)",
                  pointerEvents: "none",
                }}
              ></div>
            </div>
          </div>
          <AgentHPBar agent={agent2} side="right" />
        </div>
      )}

      {/* Countdown */}
      {phase === "COUNTDOWN" && countdown !== null && (
        <CountdownDisplay count={countdown} />
      )}

      {/* Victory */}
      {phase === "RESOLUTION" && winnerAgent && (
        <VictoryDisplay
          winner={winnerAgent}
          winReason={winReason || "victory"}
        />
      )}

      <style>{`
        @keyframes fightCountPulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fightGlow {
          0%, 100% { box-shadow: 0 0 30px rgba(242,208,138,0.3); }
          50% { box-shadow: 0 0 60px rgba(242,208,138,0.6); }
        }
        @keyframes fightSlideIn {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @media (max-width: 480px) {
          .fight-inventory-grid { display: none !important; }
        }
      `}</style>
    </div>
  );
}
