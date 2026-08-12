import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { GAME_API_URL } from "../lib/solanaConfig";

export interface SolanaPointsDisplayProps {
  walletAddress: string | null;
  compact?: boolean;
  locale?: UiLocale;
}

type PointsData = {
  totalPoints: number;
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
};

type RankData = {
  rank: number;
};

function getCopy(locale: UiLocale) {
  const translations: Record<
    UiLocale,
    {
      connect: string;
      loading: string;
      unavailable: string;
      points: string;
      breakdown: string;
      rank: (value: number) => string;
    }
  > = {
    en: {
      connect: "Connect wallet to view points",
      loading: "Loading points...",
      unavailable: "Points unavailable",
      points: "Points",
      breakdown: "Earned / wins / referrals",
      rank: (value) => `Rank #${value}`,
    },
    zh: {
      connect: "连接钱包以查看积分",
      loading: "正在加载积分...",
      unavailable: "积分暂不可用",
      points: "积分",
      breakdown: "参与 / 胜场 / 邀请",
      rank: (value) => `排名 #${value}`,
    },
    ko: {
      connect: "포인트를 보려면 지갑을 연결하세요",
      loading: "포인트 불러오는 중...",
      unavailable: "포인트를 불러올 수 없습니다",
      points: "포인트",
      breakdown: "참여 / 승리 / 추천",
      rank: (value) => `순위 #${value}`,
    },
    pt: {
      connect: "Conecte a carteira para ver os pontos",
      loading: "Carregando pontos...",
      unavailable: "Pontos indisponíveis",
      points: "Pontos",
      breakdown: "Participação / vitórias / indicações",
      rank: (value) => `Posição #${value}`,
    },
    es: {
      connect: "Conecta la cartera para ver los puntos",
      loading: "Cargando puntos...",
      unavailable: "Puntos no disponibles",
      points: "Puntos",
      breakdown: "Participación / victorias / referidos",
      rank: (value) => `Puesto #${value}`,
    },
  };
  return translations[locale];
}

export function SolanaPointsDisplay({
  walletAddress,
  compact = false,
  locale,
}: SolanaPointsDisplayProps) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getCopy(resolvedLocale);
  const [points, setPoints] = useState<PointsData | null>(null);
  const [rank, setRank] = useState<RankData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!walletAddress) {
        setPoints(null);
        setRank(null);
        setLoading(false);
        setError(false);
        return;
      }

      setLoading(true);
      try {
        const [pointsResponse, rankResponse] = await Promise.all([
          fetch(
            `${GAME_API_URL}/api/arena/points/${walletAddress}?scope=wallet`,
            { cache: "no-store", signal },
          ),
          fetch(`${GAME_API_URL}/api/arena/points/rank/${walletAddress}`, {
            cache: "no-store",
            signal,
          }).catch(() => null),
        ]);
        if (!pointsResponse.ok) throw new Error("points unavailable");
        setPoints((await pointsResponse.json()) as PointsData);
        setRank(
          rankResponse?.ok ? ((await rankResponse.json()) as RankData) : null,
        );
        setError(false);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setPoints(null);
        setRank(null);
        setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [walletAddress],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const placeholderStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: compact ? "0 12px" : "10px 14px",
    height: compact ? 38 : undefined,
    minHeight: compact ? 38 : undefined,
    borderRadius: 8,
    border: "1px solid var(--hm-border-subtle, rgba(255,255,255,0.08))",
    background: "rgba(255,255,255,0.03)",
    color: "var(--hm-text-dim, rgba(255,255,255,0.5))",
    fontSize: 11,
  };

  if (!walletAddress) {
    return (
      <div data-testid="points-display-placeholder" style={placeholderStyle}>
        {copy.connect}
      </div>
    );
  }

  if (loading && !points) {
    return (
      <div data-testid="points-display-loading" style={placeholderStyle}>
        {copy.loading}
      </div>
    );
  }

  if (error || !points) {
    return (
      <div
        data-testid="points-display-error"
        role="status"
        style={placeholderStyle}
      >
        {copy.unavailable}
      </div>
    );
  }

  return (
    <div
      data-testid={compact ? "points-display-compact" : "points-display"}
      className={compact ? "points-pill points-pill-compact" : "points-pill"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 7 : 12,
        padding: compact ? "0 12px" : "9px 14px",
        minHeight: compact ? 38 : undefined,
        borderRadius: 8,
        border: "1px solid rgba(242,208,138,0.2)",
        background: "rgba(242,208,138,0.06)",
      }}
    >
      <span aria-hidden="true">⭐</span>
      <div>
        <div
          data-testid="points-display-total"
          style={{
            color: "#f2d08a",
            fontSize: compact ? 13 : 19,
            fontWeight: 900,
          }}
        >
          {points.totalPoints.toLocaleString(getLocaleTag(resolvedLocale))}
        </div>
        {!compact ? (
          <div style={{ color: "rgba(255,255,255,0.52)", fontSize: 9 }}>
            {rank?.rank ? copy.rank(rank.rank) : copy.points}
          </div>
        ) : null}
      </div>
      {!compact ? (
        <div style={{ color: "rgba(255,255,255,0.56)", fontSize: 10 }}>
          {copy.breakdown}: {points.selfPoints}/{points.winPoints}/
          {points.referralPoints}
        </div>
      ) : null}
    </div>
  );
}
