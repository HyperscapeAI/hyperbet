import React, { useEffect, useState, useCallback } from "react";
import {
  getLocaleTag,
  resolveUiLocale,
  type UiLocale,
} from "@hyperbet/ui/i18n";
import { GAME_API_URL } from "../lib/config";

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  totalPoints: number;
}

type TimeWindow = "alltime" | "daily" | "weekly" | "monthly";
type Scope = "linked" | "wallet";

type PointsLeaderboardProps = {
  defaultScope?: Scope;
  locale?: UiLocale;
};

function getLeaderboardCopy(locale: UiLocale) {
  if (locale === "zh") {
    return {
      title: "排行榜",
      loading: "加载中...",
      empty: "暂无积分数据。",
      unavailable: (status: number) => `排行榜不可用（${status}）`,
      failedToLoad: "排行榜加载失败",
      wallet: "钱包",
      points: "积分",
      prev: "上一页",
      next: "下一页",
      page: (page: number) => `第 ${page} 页`,
      windows: {
        alltime: "总榜",
        daily: "今日",
        weekly: "本周",
        monthly: "本月",
      },
      scopes: {
        linked: "已关联",
        wallet: "单钱包",
      },
    };
  }

  return {
    title: "Leaderboard",
    loading: "Loading...",
    empty: "No points data yet.",
    unavailable: (status: number) => `Leaderboard unavailable (${status})`,
    failedToLoad: "Failed to load leaderboard",
    wallet: "Wallet",
    points: "Points",
    prev: "Prev",
    next: "Next",
    page: (page: number) => `Page ${page}`,
    windows: {
      alltime: "All Time",
      daily: "Today",
      weekly: "This Week",
      monthly: "This Month",
    },
    scopes: {
      linked: "Linked",
      wallet: "Wallet",
    },
  };
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

export function PointsLeaderboard({
  defaultScope = "linked",
  locale,
}: PointsLeaderboardProps = {}) {
  const resolvedLocale = resolveUiLocale(locale);
  const copy = getLeaderboardCopy(resolvedLocale);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("alltime");
  const [scope, setScope] = useState<Scope>(defaultScope);
  const pageSize = 20;

  const fetchLeaderboard = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
        scope,
        window: timeWindow,
      });
      const response = await fetch(
        `${GAME_API_URL}/api/arena/points/leaderboard?${params}`,
        { cache: "no-store" },
      );
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data.leaderboard ?? []);
      } else {
        setLeaderboard([]);
        setError(copy.unavailable(response.status));
      }
    } catch {
      setLeaderboard([]);
      setError(copy.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [copy, page, scope, timeWindow]);

  useEffect(() => {
    void fetchLeaderboard();
    const id = setInterval(() => void fetchLeaderboard(), 30_000);
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  useEffect(() => {
    setPage(0);
  }, [timeWindow, scope]);

  useEffect(() => {
    setScope(defaultScope);
  }, [defaultScope]);

  const filterBtnStyle = (isActive: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 6,
    border: isActive
      ? "1px solid rgba(242,208,138,0.35)"
      : "1px solid rgba(255,255,255,0.08)",
    background: isActive ? "rgba(242,208,138,0.12)" : "transparent",
    color: isActive ? "#f2d08a" : "rgba(255,255,255,0.4)",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 700,
    transition: "all 0.15s ease",
  });

  return (
    <div
      data-testid="points-leaderboard"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          {copy.title}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {(["linked", "wallet"] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`points-leaderboard-scope-${option}`}
              onClick={() => setScope(option)}
              style={filterBtnStyle(scope === option)}
            >
              {copy.scopes[option]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {(["alltime", "daily", "weekly", "monthly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`points-leaderboard-window-${option}`}
            onClick={() => setTimeWindow(option)}
            style={filterBtnStyle(timeWindow === option)}
          >
            {copy.windows[option]}
          </button>
        ))}
      </div>

      {loading && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.3)",
            padding: 16,
            textAlign: "center",
          }}
        >
          {copy.loading}
        </div>
      )}

      {!loading && leaderboard.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: error ? "#fca5a5" : "rgba(255,255,255,0.3)",
            padding: 24,
            textAlign: "center",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {error ?? copy.empty}
        </div>
      )}

      {leaderboard.length > 0 && (
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "10px 16px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "rgba(255,255,255,0.3)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ width: 36 }}>#</div>
            <div style={{ flex: 1 }}>{copy.wallet}</div>
            <div style={{ width: 100, textAlign: "right" }}>{copy.points}</div>
          </div>

          {leaderboard.map((entry) => (
            <div
              key={entry.wallet}
              data-testid={`points-leaderboard-row-${entry.rank}`}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 16px",
                fontSize: 13,
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "rgba(255,255,255,0.03)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = "transparent";
              }}
            >
              <div
                style={{
                  width: 36,
                  fontWeight: 800,
                  color:
                    entry.rank === 1
                      ? "#eab308"
                      : entry.rank === 2
                        ? "#a3a3a3"
                        : entry.rank === 3
                          ? "#cd7f32"
                          : "rgba(255,255,255,0.4)",
                  fontSize: entry.rank <= 3 ? 15 : 13,
                }}
              >
                {entry.rank <= 3
                  ? ["🥇", "🥈", "🥉"][entry.rank - 1]
                  : entry.rank}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: "var(--hm-font-mono)",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {truncateWallet(entry.wallet)}
              </div>
              <div
                style={{
                  width: 100,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#eab308",
                }}
              >
                {entry.totalPoints.toLocaleString(getLocaleTag(resolvedLocale))}
              </div>
            </div>
          ))}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  page === 0 ? "transparent" : "rgba(255,255,255,0.05)",
                color:
                  page === 0
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor: page === 0 ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {copy.prev}
            </button>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {copy.page(page + 1)}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={leaderboard.length < pageSize}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  leaderboard.length < pageSize
                    ? "transparent"
                    : "rgba(255,255,255,0.05)",
                color:
                  leaderboard.length < pageSize
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor:
                  leaderboard.length < pageSize ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {copy.next}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
