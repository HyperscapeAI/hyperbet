import React, { useEffect, useState, useCallback } from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { GAME_API_URL } from "../lib/config";

interface PointsDisplayProps {
  walletAddress: string | null;
  compact?: boolean;
  locale?: UiLocale;
  scope?: "wallet" | "linked";
}

interface PointsData {
  wallet: string;
  pointsScope?: "WALLET" | "LINKED";
  identityWalletCount?: number;
  totalPoints: number;
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
  multiplier: number;
  goldBalance: string | null;
  goldHoldDays: number;
}

interface RankData {
  wallet: string;
  rank: number;
  totalPoints: number;
}

interface MultiplierData {
  wallet: string;
  multiplier: number;
  tier: "NONE" | "BRONZE" | "SILVER" | "GOLD" | "DIAMOND";
  nextTierThreshold: number | null;
  goldBalance: string;
  goldHoldDays: number;
}

const TIER_COLORS: Record<string, string> = {
  BRONZE: "#cd7f32",
  SILVER: "#a3a3a3",
  GOLD: "#eab308",
  DIAMOND: "#60a5fa",
};

const TIER_NAMES: Record<UiLocale, Record<MultiplierData["tier"], string>> = {
  en: {
    NONE: "None",
    BRONZE: "Bronze",
    SILVER: "Silver",
    GOLD: "Gold",
    DIAMOND: "Diamond",
  },
  zh: {
    NONE: "无",
    BRONZE: "青铜",
    SILVER: "白银",
    GOLD: "黄金",
    DIAMOND: "钻石",
  },
  ko: {
    NONE: "없음",
    BRONZE: "브론즈",
    SILVER: "실버",
    GOLD: "골드",
    DIAMOND: "다이아몬드",
  },
  pt: {
    NONE: "Nenhum",
    BRONZE: "Bronze",
    SILVER: "Prata",
    GOLD: "Ouro",
    DIAMOND: "Diamante",
  },
  es: {
    NONE: "Ninguno",
    BRONZE: "Bronce",
    SILVER: "Plata",
    GOLD: "Oro",
    DIAMOND: "Diamante",
  },
};

function getPointsDisplayCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      connectWallet: "连接钱包以查看积分",
      loadingPoints: "正在加载积分...",
      points: "积分",
      rank: (value: number) => `排名 #${value}`,
      breakdown: "自/胜/邀/质",
      gold: "GOLD",
      tier: "等级",
      boost: (value: number) => `${value}× 加成`,
      boostTitle: "GOLD 积分加成",
      yourTier: "当前等级",
      nextTier: (value: number) =>
        `下一级门槛 ${value.toLocaleString(getLocaleTag(locale))} GOLD`,
      heldGoldBoost: "持有或质押 GOLD 可提高积分倍数。",
      buyGold: "购买 GOLD",
      tierRows: [
        { emoji: "🟤", label: "1K+ GOLD", multiplier: "1×", color: "#a16207" },
        { emoji: "🥈", label: "100K+ GOLD", multiplier: "2×", color: "#a3a3a3" },
        { emoji: "🥇", label: "1M+ GOLD", multiplier: "3×", color: "#eab308" },
        { emoji: "💎", label: "持有 10+ 天", multiplier: "+1×", color: "#60a5fa" },
      ],
    };
  }

  if (locale === "ko") {
    return {
      connectWallet: "포인트를 보려면 지갑을 연결하세요",
      loadingPoints: "포인트 로딩 중...",
      points: "포인트",
      rank: (value: number) => `순위 #${value}`,
      breakdown: "자/승/추/스",
      gold: "GOLD",
      tier: "등급",
      boost: (value: number) => `${value}× 부스트`,
      boostTitle: "GOLD 포인트 부스트",
      yourTier: "현재 등급",
      nextTier: (value: number) =>
        `다음 등급: ${value.toLocaleString(getLocaleTag(locale))} GOLD`,
      heldGoldBoost: "GOLD를 보유하거나 스테이킹하면 배율이 올라갑니다.",
      buyGold: "GOLD 구매",
      tierRows: [
        { emoji: "🟤", label: "1K+ GOLD", multiplier: "1×", color: "#a16207" },
        { emoji: "🥈", label: "100K+ GOLD", multiplier: "2×", color: "#a3a3a3" },
        { emoji: "🥇", label: "1M+ GOLD", multiplier: "3×", color: "#eab308" },
        { emoji: "💎", label: "10일+ 보유", multiplier: "+1×", color: "#60a5fa" },
      ],
    };
  }

  if (locale === "pt") {
    return {
      connectWallet: "Conecte a carteira para ver os pontos",
      loadingPoints: "Carregando pontos...",
      points: "PONTOS",
      rank: (value: number) => `POSIÇÃO #${value}`,
      breakdown: "P/V/I/S",
      gold: "GOLD",
      tier: "NÍVEL",
      boost: (value: number) => `${value}× BÔNUS`,
      boostTitle: "BÔNUS DE PONTOS GOLD",
      yourTier: "Seu Nível",
      nextTier: (value: number) =>
        `Próximo nível em ${value.toLocaleString(getLocaleTag(locale))} GOLD`,
      heldGoldBoost: "GOLD mantido ou staked aumenta seu multiplicador.",
      buyGold: "Comprar GOLD",
      tierRows: [
        { emoji: "🟤", label: "1K+ GOLD", multiplier: "1×", color: "#a16207" },
        { emoji: "🥈", label: "100K+ GOLD", multiplier: "2×", color: "#a3a3a3" },
        { emoji: "🥇", label: "1M+ GOLD", multiplier: "3×", color: "#eab308" },
        { emoji: "💎", label: "10+ dias mantido", multiplier: "+1×", color: "#60a5fa" },
      ],
    };
  }

  if (locale === "es") {
    return {
      connectWallet: "Conecta la billetera para ver los puntos",
      loadingPoints: "Cargando puntos...",
      points: "PUNTOS",
      rank: (value: number) => `RANGO #${value}`,
      breakdown: "P/V/R/S",
      gold: "GOLD",
      tier: "NIVEL",
      boost: (value: number) => `${value}× BONO`,
      boostTitle: "BONO DE PUNTOS GOLD",
      yourTier: "Tu Nivel",
      nextTier: (value: number) =>
        `Siguiente nivel en ${value.toLocaleString(getLocaleTag(locale))} GOLD`,
      heldGoldBoost: "GOLD mantenido o staked aumenta tu multiplicador.",
      buyGold: "Comprar GOLD",
      tierRows: [
        { emoji: "🟤", label: "1K+ GOLD", multiplier: "1×", color: "#a16207" },
        { emoji: "🥈", label: "100K+ GOLD", multiplier: "2×", color: "#a3a3a3" },
        { emoji: "🥇", label: "1M+ GOLD", multiplier: "3×", color: "#eab308" },
        { emoji: "💎", label: "10+ días mantenido", multiplier: "+1×", color: "#60a5fa" },
      ],
    };
  }

  return {
    connectWallet: "Connect wallet to view points",
    loadingPoints: "Loading points...",
    points: "POINTS",
    rank: (value: number) => `RANK #${value}`,
    breakdown: "S/W/R/S",
    gold: "GOLD",
    tier: "TIER",
    boost: (value: number) => `${value}× BOOST`,
    boostTitle: "GOLD POINTS BOOST",
    yourTier: "Your Tier",
    nextTier: (value: number) =>
      `Next tier at ${value.toLocaleString(getLocaleTag(locale))} GOLD`,
    heldGoldBoost: "Held or staked GOLD increases your multiplier.",
    buyGold: "Buy GOLD",
    tierRows: [
      { emoji: "🟤", label: "1K+ GOLD", multiplier: "1×", color: "#a16207" },
      { emoji: "🥈", label: "100K+ GOLD", multiplier: "2×", color: "#a3a3a3" },
      { emoji: "🥇", label: "1M+ GOLD", multiplier: "3×", color: "#eab308" },
      { emoji: "💎", label: "+ held 10+ days", multiplier: "+1×", color: "#60a5fa" },
    ],
  };
}

export function PointsDisplay({
  walletAddress,
  compact = false,
  locale,
  scope = "linked",
}: PointsDisplayProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getPointsDisplayCopy(resolvedLocale);
  const [points, setPoints] = useState<PointsData | null>(null);
  const [rank, setRank] = useState<RankData | null>(null);
  const [multiplierDetail, setMultiplierDetail] =
    useState<MultiplierData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const fetchPoints = useCallback(async () => {
    if (!walletAddress) {
      setPoints(null);
      setRank(null);
      setMultiplierDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const [pointsRes, rankRes, multiplierRes] = await Promise.all([
        fetch(
          `${GAME_API_URL}/api/arena/points/${walletAddress}?scope=${scope}`,
          { cache: "no-store" },
        ),
        fetch(`${GAME_API_URL}/api/arena/points/rank/${walletAddress}?scope=${scope}`, {
          cache: "no-store",
        }).catch(() => null),
        fetch(`${GAME_API_URL}/api/arena/points/multiplier/${walletAddress}?scope=${scope}`, {
          cache: "no-store",
        }).catch(() => null),
      ]);

      if (pointsRes.ok) {
        setPoints(await pointsRes.json());
        setError(null);
      } else {
        setPoints(null);
        setError(
          resolvedLocale === "zh"
            ? `积分接口不可用（${pointsRes.status}）`
            : `Points API unavailable (${pointsRes.status})`,
        );
      }

      if (rankRes?.ok) {
        setRank(await rankRes.json());
      }

      if (multiplierRes?.ok) {
        setMultiplierDetail(await multiplierRes.json());
      }
    } catch (err) {
      console.error("Failed to load points API:", err);
      setPoints(null);
      setError(resolvedLocale === "zh" ? "积分加载失败" : "Failed to load points");
    } finally {
      setLoading(false);
    }
  }, [resolvedLocale, scope, walletAddress]);

  useEffect(() => {
    void fetchPoints();
    const id = setInterval(() => void fetchPoints(), 15_000);
    return () => clearInterval(id);
  }, [fetchPoints]);

  const placeholderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: compact ? "0 12px" : "10px 14px",
    height: compact ? 38 : undefined,
    minHeight: compact ? 38 : undefined,
    borderRadius: 12,
    border: "1px solid var(--hm-border-subtle, rgba(255,255,255,0.08))",
    background: "var(--hm-panel-card-bg, linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%))",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    fontSize: 11,
    color: "var(--hm-text-dim, rgba(255,255,255,0.5))",
    fontFamily: "var(--hm-font-body)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  };

  if (!walletAddress) {
    return (
      <div data-testid="points-display-placeholder" style={placeholderStyle}>
        {copy.connectWallet}
      </div>
    );
  }

  if (loading && !points) {
    return (
      <div data-testid="points-display-loading" style={placeholderStyle}>
        {copy.loadingPoints}
      </div>
    );
  }

  const multiplier = points?.multiplier ?? 0;
  const totalPoints = points?.totalPoints ?? 0;

  return (
    <div
      data-testid={compact ? "points-display-compact" : "points-display"}
      className={compact ? "points-pill points-pill-compact" : "points-pill"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 10,
        padding: compact ? "0 12px" : "8px 14px",
        height: compact ? 38 : undefined,
        minHeight: compact ? 38 : undefined,
        background:
          "var(--hm-points-pill-bg, linear-gradient(95deg, rgba(232,65,66,0.08) 0%, rgba(10,10,18,0.6) 50%, rgba(10,10,18,0.5) 100%))",
        borderRadius: 4,
        border: "1px solid var(--hm-chip-border, rgba(232,65,66,0.15))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        position: "relative",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px var(--hm-chip-shadow, rgba(0,0,0,0.2))",
        overflow: "hidden",
      }}
    >
      {/* Top edge glow */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background:
            "linear-gradient(90deg, transparent 10%, var(--hm-chip-highlight, rgba(232,65,66,0.3)) 50%, transparent 90%)",
        }}
      />

      <div
        style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8 }}
      >
        <span
          style={{
            fontSize: compact ? 12 : 18,
            filter: "drop-shadow(0 0 6px var(--hm-chip-highlight, rgba(232,65,66,0.5)))",
            lineHeight: 1,
          }}
        >
          ⭐
        </span>
        <div>
          <div
            data-testid="points-display-total"
            style={{
              fontSize: compact ? 13 : 20,
              fontWeight: 900,
              color: "var(--hm-accent-gold)",
              lineHeight: 1,
              fontFamily: "var(--hm-font-display)",
              letterSpacing: 1,
              textShadow: "0 0 8px var(--hm-chip-highlight, rgba(232,65,66,0.3))",
            }}
          >
            {totalPoints.toLocaleString(getLocaleTag(resolvedLocale))}
          </div>
          {!compact && (
            <div
              style={{
                fontSize: 8,
                color: "var(--hm-text-muted, rgba(232,65,66,0.45))",
                textTransform: "uppercase",
                letterSpacing: 1.5,
                fontWeight: 800,
                fontFamily: "var(--hm-font-display)",
              }}
            >
              {rank && rank.rank > 0 ? copy.rank(rank.rank) : copy.points}
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div
          style={{
            width: 1,
            height: 16,
            flexShrink: 0,
            background:
              "linear-gradient(180deg, transparent, var(--hm-chip-highlight, rgba(232,65,66,0.2)), transparent)",
          }}
        />
      )}

      {!compact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 9,
            fontWeight: 700,
            color: "var(--hm-text-muted, rgba(255,255,255,0.35))",
            textTransform: "uppercase",
            fontFamily: "var(--hm-font-body)",
            letterSpacing: 0.5,
          }}
        >
          <span>
            {copy.breakdown}:{" "}
            <span style={{ color: "rgba(255,255,255,0.7)" }}>
              {points?.selfPoints ?? 0}/{points?.winPoints ?? 0}/
              {points?.referralPoints ?? 0}/{points?.stakingPoints ?? 0}
            </span>
          </span>
          <span>
            {copy.gold}:{" "}
            <span
              data-testid="points-display-gold"
              style={{ color: "var(--hm-accent-gold)" }}
            >
              {points?.goldBalance ?? "0"}
            </span>
          </span>
          {multiplierDetail && multiplierDetail.tier !== "NONE" && (
            <span data-testid="points-display-tier">
              {copy.tier}:{" "}
              <span style={{ color: TIER_COLORS[multiplierDetail.tier] }}>
                {TIER_NAMES[resolvedLocale][multiplierDetail.tier]}
              </span>
            </span>
          )}
        </div>
      )}

      {multiplier > 1 && (
        <button
          type="button"
          data-testid="points-display-boost"
          onClick={() => setShowPopup((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: compact ? "3px 8px" : "4px 10px",
            background:
              "var(--hm-chip-bg, linear-gradient(135deg, rgba(232,65,66,0.15) 0%, rgba(232,65,66,0.05) 100%))",
            border: "1px solid var(--hm-chip-border, rgba(232,65,66,0.25))",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 800,
            color: "var(--hm-accent-gold)",
            fontFamily: "var(--hm-font-display)",
            letterSpacing: 1,
            textTransform: "uppercase",
            transition: "all 0.15s ease",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "inset 0 1px 0 var(--hm-chip-highlight, rgba(232,65,66,0.08))",
            flexShrink: 0,
          }}
        >
          {copy.boost(multiplier)}
        </button>
      )}

      {error ? (
        compact ? (
          <div
            aria-label={error}
            title={error}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              borderRadius: 999,
              border: "1px solid rgba(255,100,100,0.3)",
              background: "rgba(255,100,100,0.08)",
              color: "rgba(255,140,140,0.9)",
              fontSize: 10,
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            !
          </div>
        ) : (
          <div
            style={{
              fontSize: 9,
              color: "rgba(255,100,100,0.7)",
              flexShrink: 0,
            }}
          >
            {error}
          </div>
        )
      ) : null}

      {showPopup && (
        <GoldBonusPopupInline
          onClose={() => setShowPopup(false)}
          detail={multiplierDetail}
          locale={resolvedLocale}
        />
      )}
    </div>
  );
}

function GoldBonusPopupInline({
  onClose,
  detail,
  locale,
}: {
  onClose: () => void;
  detail: MultiplierData | null;
  locale: UiLocale;
}) {
  const copy = getPointsDisplayCopy(locale);

  return (
    <div
      data-testid="points-display-boost-popup"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: "min(320px, calc(100vw - 34px))",
        padding: 20,
        background: "rgba(10, 12, 18, 0.85)",
        backdropFilter: "blur(32px) saturate(1.4)",
        WebkitBackdropFilter: "blur(32px) saturate(1.4)",
        borderRadius: 16,
        border: "1px solid rgba(242,208,138,0.2)",
        boxShadow:
          "0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.04)",
        zIndex: 100,
        color: "#fff",
      }}
    >
      {/* Top highlight */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(242,208,138,0.3), transparent)",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            fontFamily: "var(--hm-font-display)",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "#f2d08a",
            textShadow: "0 0 8px rgba(242,208,138,0.3)",
          }}
        >
          {copy.boostTitle}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            fontSize: 14,
            padding: "4px 8px",
            transition: "all 0.15s ease",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 14,
        }}
      >
        {copy.tierRows.map((row) => (
          <TierRow key={`${row.label}-${row.multiplier}`} {...row} />
        ))}
      </div>

      {detail && detail.tier !== "NONE" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
            marginBottom: 10,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            border: `1px solid ${TIER_COLORS[detail.tier] ?? "#fff"}30`,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {copy.yourTier}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: TIER_COLORS[detail.tier] ?? "#fff",
              fontFamily: "var(--hm-font-display)",
              letterSpacing: 1,
            }}
          >
            {TIER_NAMES[locale][detail.tier]} ({detail.multiplier}×)
          </span>
        </div>
      )}

      {detail?.nextTierThreshold != null && (
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 10,
            fontFamily: "var(--hm-font-body)",
          }}
        >
          {copy.nextTier(detail.nextTierThreshold)}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          marginBottom: 14,
          fontFamily: "var(--hm-font-body)",
        }}
      >
        {copy.heldGoldBoost}
      </div>

      <a
        href="https://pump.fun/DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          width: "100%",
          padding: "10px 0",
          background:
            "linear-gradient(180deg, rgba(242,208,138,0.9) 0%, rgba(196,154,58,0.9) 100%)",
          borderRadius: 10,
          border: "1px solid rgba(242,208,138,0.5)",
          color: "#0a0a0a",
          fontSize: 14,
          fontWeight: 900,
          fontFamily: "var(--hm-font-display)",
          letterSpacing: 2,
          textTransform: "uppercase",
          textAlign: "center",
          textDecoration: "none",
          cursor: "pointer",
          transition: "all 0.15s ease",
          boxShadow:
            "0 4px 20px rgba(242,208,138,0.2), inset 0 1px 0 rgba(255,255,255,0.4)",
          boxSizing: "border-box",
        }}
      >
        {copy.buyGold} →
      </a>
    </div>
  );
}

function TierRow({
  emoji,
  label,
  multiplier,
  color,
}: {
  emoji: string;
  label: string;
  multiplier: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 10px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        borderRadius: 8,
        border: `1px solid ${color}20`,
        backdropFilter: "blur(8px)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>{emoji}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "var(--hm-font-body)",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 900,
          color,
          fontFamily: "var(--hm-font-display)",
          letterSpacing: 1,
          textShadow: `0 0 8px ${color}40`,
        }}
      >
        {multiplier}
      </span>
    </div>
  );
}
