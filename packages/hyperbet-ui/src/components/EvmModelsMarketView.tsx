import { useEffect, useMemo, useState } from "react";

import type { UiLocale } from "../i18n";
import {
  sanitizePerpsMarketsResponse,
  type PerpsMarketDirectoryEntry,
} from "../lib/modelMarkets";
import {
  type HyperbetThemeId,
  useResolvedHyperbetTheme,
} from "../lib/theme";

export interface EvmMockLeaderboardEntry {
  rank: number;
  agentName: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface EvmModelsMarketMockData {
  leaderboard: EvmMockLeaderboardEntry[];
}

interface EvmModelsMarketViewProps {
  fightingAgentA: string;
  fightingAgentB: string;
  locale?: UiLocale;
  gameApiUrl: string;
  mockData?: EvmModelsMarketMockData | null;
  collateralSymbol?: string;
  chainLabel?: string;
  theme?: HyperbetThemeId;
}

type DisplayEntry = {
  rank: number | null;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  status: string;
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function toDisplayEntries(
  markets: PerpsMarketDirectoryEntry[],
): DisplayEntry[] {
  return markets.map((market) => ({
    rank: market.rank,
    name: market.name,
    provider: market.provider,
    model: market.model,
    wins: market.wins,
    losses: market.losses,
    winRate: market.winRate,
    currentStreak: market.currentStreak,
    status: market.status,
  }));
}

function toMockEntries(mockData: EvmModelsMarketMockData): DisplayEntry[] {
  return mockData.leaderboard.map((entry) => ({
    rank: entry.rank,
    name: entry.agentName,
    provider: entry.provider,
    model: entry.model,
    wins: entry.wins,
    losses: entry.losses,
    winRate: entry.winRate,
    currentStreak: entry.currentStreak,
    status: "ACTIVE",
  }));
}

function findEntry(entries: DisplayEntry[], agentName: string): DisplayEntry | null {
  if (!agentName) return null;
  const normalized = agentName.trim().toLowerCase();
  return (
    entries.find((entry) => entry.name.trim().toLowerCase() === normalized) ??
    null
  );
}

export function EvmModelsMarketView({
  fightingAgentA,
  fightingAgentB,
  gameApiUrl,
  mockData,
  collateralSymbol = "USDC",
  chainLabel = "EVM",
  theme,
}: EvmModelsMarketViewProps) {
  const themeDefinition = useResolvedHyperbetTheme(theme);
  const [entries, setEntries] = useState<DisplayEntry[]>(() =>
    mockData ? toMockEntries(mockData) : [],
  );
  const [updatedAt, setUpdatedAt] = useState<number | null>(
    mockData ? Date.now() : null,
  );
  const [loading, setLoading] = useState(!mockData);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mockData) {
      setEntries(toMockEntries(mockData));
      setUpdatedAt(Date.now());
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;

    async function loadMarkets() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(`${gameApiUrl}/api/perps/markets`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        const sanitized = sanitizePerpsMarketsResponse(json);
        if (cancelled) return;
        setEntries(toDisplayEntries(sanitized.markets));
        setUpdatedAt(sanitized.updatedAt);
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load model markets",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMarkets();

    return () => {
      cancelled = true;
    };
  }, [gameApiUrl, mockData]);

  const matchup = useMemo(() => {
    const left = findEntry(entries, fightingAgentA);
    const right = findEntry(entries, fightingAgentB);
    return { left, right };
  }, [entries, fightingAgentA, fightingAgentB]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        acc.markets += 1;
        acc.totalWins += entry.wins;
        acc.totalLosses += entry.losses;
        if (entry.status === "ACTIVE") acc.active += 1;
        return acc;
      },
      { markets: 0, totalWins: 0, totalLosses: 0, active: 0 },
    );
  }, [entries]);

  return (
    <section className="hm-perps-view">
      <header className="hm-perps-hero">
        <div className="hm-perps-hero-text">
          <p className="hm-perps-kicker" style={{ color: themeDefinition.accentColor }}>
            Canonical EVM Runtime
          </p>
          <h2 className="hm-perps-headline">Model markets on {chainLabel}</h2>
          <p className="hm-perps-copy">
            This additive view uses the current shared runtime and market directory
            surfaces. It keeps the sprint branch’s canonical lifecycle and deploy
            assumptions intact while surfacing the sweep branch’s EVM models
            market direction.
          </p>
        </div>
        <div className="hm-perps-metrics">
          <div className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Tracked markets</span>
            <strong className="hm-perps-metric-value">
              {formatCompactNumber(totals.markets)}
            </strong>
            <span className="hm-perps-metric-sub">{totals.active} active</span>
          </div>
          <div className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Recorded bouts</span>
            <strong className="hm-perps-metric-value">
              {formatCompactNumber(totals.totalWins + totals.totalLosses)}
            </strong>
            <span className="hm-perps-metric-sub">{collateralSymbol} collateral</span>
          </div>
        </div>
      </header>

      <div className="hm-perps-grid">
        <article className="hm-perps-card">
          <div className="hm-perps-card-header">
            <div>
              <h3 className="hm-perps-card-title">Current matchup</h3>
              <p className="hm-perps-card-sub">
                The active duel can be cross-checked against the current EVM model
                market directory.
              </p>
            </div>
            {updatedAt ? (
              <span className="hm-perps-updated">
                Updated {new Date(updatedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
          <div className="hm-perps-position-stats">
            {[matchup.left ?? { name: fightingAgentA, provider: "Unknown", model: "Unknown", wins: 0, losses: 0, winRate: 0, currentStreak: 0, rank: null, status: "PENDING" }, matchup.right ?? { name: fightingAgentB, provider: "Unknown", model: "Unknown", wins: 0, losses: 0, winRate: 0, currentStreak: 0, rank: null, status: "PENDING" }].map(
              (entry, index) => (
                <div key={`${entry.name}-${index}`} className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">
                    {index === 0 ? "Agent A" : "Agent B"}
                  </span>
                  <strong className="hm-perps-detail-value">{entry.name}</strong>
                  <span className="hm-perps-detail-sub">
                    {entry.provider} · {entry.model}
                  </span>
                  <span className="hm-perps-detail-sub">
                    WR {entry.winRate.toFixed(1)}% · {entry.wins}-{entry.losses}
                  </span>
                </div>
              ),
            )}
          </div>
        </article>

        <article className="hm-perps-card">
          <div className="hm-perps-card-header">
            <div>
              <h3 className="hm-perps-card-title">Market directory</h3>
              <p className="hm-perps-card-sub">
                Ranked model entries from the current keeper-backed market index.
              </p>
            </div>
          </div>
          {loading ? (
            <div className="hm-perps-empty">Loading model markets…</div>
          ) : error ? (
            <div className="hm-perps-error">Directory unavailable: {error}</div>
          ) : entries.length === 0 ? (
            <div className="hm-perps-empty">No EVM model markets are indexed yet.</div>
          ) : (
            <div className="hm-perps-table-wrap">
              <table className="hm-perps-table">
                <thead>
                  <tr className="hm-perps-thead-row">
                    <th className="hm-perps-th">Rank</th>
                    <th className="hm-perps-th">Agent</th>
                    <th className="hm-perps-th">W/L</th>
                    <th className="hm-perps-th">WR</th>
                    <th className="hm-perps-th">Streak</th>
                    <th className="hm-perps-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 16).map((entry) => (
                    <tr key={`${entry.name}-${entry.model}`} className="hm-perps-row">
                      <td className="hm-perps-td hm-perps-td--mono">
                        {entry.rank ?? "—"}
                      </td>
                      <td className="hm-perps-td">
                        <div className="hm-perps-agent-cell">
                          <strong className="hm-perps-agent-name">{entry.name}</strong>
                          <span className="hm-perps-agent-model">
                            {entry.provider} · {entry.model}
                          </span>
                        </div>
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono">
                        {entry.wins}-{entry.losses}
                      </td>
                      <td className="hm-perps-td hm-perps-td--gold">
                        {entry.winRate.toFixed(1)}%
                      </td>
                      <td className="hm-perps-td hm-perps-td--mono">
                        {entry.currentStreak}
                      </td>
                      <td className="hm-perps-td">
                        <span
                          className={`hm-perps-status-badge hm-perps-status-badge--${entry.status.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                        >
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
