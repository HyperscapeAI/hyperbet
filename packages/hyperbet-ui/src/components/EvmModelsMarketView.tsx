import { useEffect, useMemo, useRef, useState } from "react";

import type { UiLocale } from "../i18n";
import {
  buildPerpsMarketsEndpoint,
  buildPerpsOracleHistoryEndpoint,
  sanitizePerpsOracleHistoryResponse,
  sanitizePerpsMarketsResponse,
  type EvmPerpsChainKey,
  type PerpsMarketDirectoryEntry,
  type PerpsOracleHistorySnapshot,
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
  chainKey?: EvmPerpsChainKey;
  chainLabel?: string;
  theme?: HyperbetThemeId;
}

type DisplayEntry = {
  chainKey: EvmPerpsChainKey;
  characterId: string;
  marketId: number;
  rank: number | null;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
  status: string;
  lastSeenAt: number;
  updatedAt: number;
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
    chainKey: market.chainKey as EvmPerpsChainKey,
    characterId: market.characterId,
    marketId: market.marketId,
    rank: market.rank,
    name: market.name,
    provider: market.provider,
    model: market.model,
    wins: market.wins,
    losses: market.losses,
    winRate: market.winRate,
    combatLevel: market.combatLevel,
    currentStreak: market.currentStreak,
    status: market.status,
    lastSeenAt: market.lastSeenAt,
    updatedAt: market.updatedAt,
  }));
}

function toMockEntries(
  mockData: EvmModelsMarketMockData,
  chainKey: EvmPerpsChainKey,
): DisplayEntry[] {
  return mockData.leaderboard.map((entry) => ({
    chainKey,
    characterId: entry.agentName.trim().toLowerCase().replace(/\s+/g, "-"),
    marketId: entry.rank,
    rank: entry.rank,
    name: entry.agentName,
    provider: entry.provider,
    model: entry.model,
    wins: entry.wins,
    losses: entry.losses,
    winRate: entry.winRate,
    combatLevel: 0,
    currentStreak: entry.currentStreak,
    status: "ACTIVE",
    lastSeenAt: Date.now(),
    updatedAt: Date.now(),
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

function formatTimestamp(value: number | null): string {
  if (!value) return "Pending";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortRelative(value: number | null): string {
  if (!value) return "Pending";
  const ageMs = Math.max(0, Date.now() - value);
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes <= 0) return "moments ago";
  if (ageMinutes === 1) return "1 minute ago";
  if (ageMinutes < 60) return `${ageMinutes} minutes ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours === 1) return "1 hour ago";
  return `${ageHours} hours ago`;
}

function isEntryInCurrentMatch(
  entry: DisplayEntry,
  fightingAgentA: string,
  fightingAgentB: string,
): boolean {
  const normalized = entry.name.trim().toLowerCase();
  return (
    normalized === fightingAgentA.trim().toLowerCase() ||
    normalized === fightingAgentB.trim().toLowerCase()
  );
}

const DIRECTORY_POLL_INTERVAL_MS = 5_000;
const ORACLE_HISTORY_POLL_INTERVAL_MS = 15_000;

export function EvmModelsMarketView({
  fightingAgentA,
  fightingAgentB,
  gameApiUrl,
  mockData,
  collateralSymbol = "USDC",
  chainKey,
  chainLabel = "EVM",
  theme,
}: EvmModelsMarketViewProps) {
  const themeDefinition = useResolvedHyperbetTheme(theme);
  const [entries, setEntries] = useState<DisplayEntry[]>(() =>
    mockData && chainKey ? toMockEntries(mockData, chainKey) : [],
  );
  const [updatedAt, setUpdatedAt] = useState<number | null>(
    mockData ? Date.now() : null,
  );
  const [searchValue, setSearchValue] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  );
  const [oracleSnapshots, setOracleSnapshots] = useState<PerpsOracleHistorySnapshot[]>(
    [],
  );
  const [oracleUpdatedAt, setOracleUpdatedAt] = useState<number | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState("");
  const [loading, setLoading] = useState(!mockData);
  const [error, setError] = useState("");
  const resolvedChainKey = chainKey ?? null;
  const lastDirectoryWarningKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (mockData) {
      setEntries(chainKey ? toMockEntries(mockData, chainKey) : []);
      setUpdatedAt(Date.now());
      setLoading(false);
      setError("");
      return;
    }
    const activeChainKey = resolvedChainKey;
    if (!activeChainKey) {
      setEntries([]);
      setUpdatedAt(null);
      setLoading(false);
      setError("missing chain key");
      return;
    }

    const controller = new AbortController();
    let activePollController: AbortController | null = null;

    async function loadMarkets(signal?: AbortSignal) {
      try {
        setLoading(true);
        setError("");
        const endpoint = buildPerpsMarketsEndpoint(gameApiUrl, activeChainKey!);
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        const sanitized = sanitizePerpsMarketsResponse(json, activeChainKey);
        if (signal?.aborted) return;
        const warningKey =
          sanitized.markets.length === 0
            ? `empty:${activeChainKey}`
            : `ready:${activeChainKey}`;
        if (
          sanitized.markets.length === 0 &&
          typeof console !== "undefined" &&
          lastDirectoryWarningKeyRef.current !== warningKey
        ) {
          console.warn("[hyperbet] empty_model_directory", {
            chainKey: activeChainKey,
            chain: chainLabel,
            endpoint,
          });
        }
        lastDirectoryWarningKeyRef.current = warningKey;
        setEntries(toDisplayEntries(sanitized.markets));
        setUpdatedAt(sanitized.updatedAt);
      } catch (nextError) {
        if (signal?.aborted) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load model markets",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    }

    void loadMarkets(controller.signal);
    const intervalId = window.setInterval(() => {
      activePollController?.abort();
      activePollController = new AbortController();
      void loadMarkets(activePollController.signal);
    }, DIRECTORY_POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      activePollController?.abort();
      window.clearInterval(intervalId);
    };
  }, [chainKey, chainLabel, gameApiUrl, mockData, resolvedChainKey]);

  const matchup = useMemo(() => {
    const left = findEntry(entries, fightingAgentA);
    const right = findEntry(entries, fightingAgentB);
    return { left, right };
  }, [entries, fightingAgentA, fightingAgentB]);
  const filteredEntries = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const haystack = [
        entry.name,
        entry.provider,
        entry.model,
        entry.status,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, searchValue]);
  const selectedEntry = useMemo(() => {
    return (
      filteredEntries.find((entry) => entry.characterId === selectedCharacterId) ??
      matchup.left ??
      matchup.right ??
      filteredEntries[0] ??
      null
    );
  }, [filteredEntries, matchup.left, matchup.right, selectedCharacterId]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        acc.markets += 1;
        acc.totalWins += entry.wins;
        acc.totalLosses += entry.losses;
        if (entry.status === "ACTIVE") acc.active += 1;
        if (entry.rank != null) {
          acc.ranked += 1;
        }
        return acc;
      },
      { markets: 0, totalWins: 0, totalLosses: 0, active: 0, ranked: 0 },
    );
  }, [entries]);
  const currentMatchupLabel = useMemo(() => {
    const left = matchup.left?.name ?? fightingAgentA;
    const right = matchup.right?.name ?? fightingAgentB;
    if (!left && !right) return "Stand by";
    return `${left || "Agent A"} vs ${right || "Agent B"}`;
  }, [fightingAgentA, fightingAgentB, matchup.left?.name, matchup.right?.name]);

  useEffect(() => {
    if (!selectedEntry) {
      setSelectedCharacterId(null);
      return;
    }
    if (
      selectedCharacterId == null ||
      !filteredEntries.some((entry) => entry.characterId === selectedCharacterId)
    ) {
      setSelectedCharacterId(selectedEntry.characterId);
    }
  }, [filteredEntries, selectedCharacterId, selectedEntry]);

  useEffect(() => {
    if (!selectedEntry || mockData) {
      setOracleSnapshots([]);
      setOracleUpdatedAt(null);
      setOracleError("");
      setOracleLoading(false);
      return;
    }
    const activeChainKey = resolvedChainKey;
    if (!activeChainKey) {
      setOracleSnapshots([]);
      setOracleUpdatedAt(null);
      setOracleError("missing chain key");
      setOracleLoading(false);
      return;
    }

    const controller = new AbortController();
    let activePollController: AbortController | null = null;

    async function loadOracleHistory(signal?: AbortSignal) {
      try {
        setOracleLoading(true);
        setOracleError("");
        const endpoint = buildPerpsOracleHistoryEndpoint({
          gameApiUrl,
          chainKey: activeChainKey!,
          characterId: selectedEntry.characterId,
          limit: 24,
        });
        const response = await fetch(
          endpoint,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        const sanitized = sanitizePerpsOracleHistoryResponse(
          json,
          selectedEntry.characterId,
          activeChainKey,
        );
        if (signal?.aborted) return;
        setOracleSnapshots(sanitized.snapshots);
        setOracleUpdatedAt(sanitized.updatedAt);
      } catch (nextError) {
        if (signal?.aborted) return;
        setOracleError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load oracle history",
        );
      } finally {
        if (!signal?.aborted) {
          setOracleLoading(false);
        }
      }
    }

    void loadOracleHistory(controller.signal);
    const intervalId = window.setInterval(() => {
      activePollController?.abort();
      activePollController = new AbortController();
      void loadOracleHistory(activePollController.signal);
    }, ORACLE_HISTORY_POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      activePollController?.abort();
      window.clearInterval(intervalId);
    };
  }, [gameApiUrl, mockData, resolvedChainKey, selectedEntry]);

  const latestOracleSnapshot =
    oracleSnapshots.length > 0 ? oracleSnapshots[oracleSnapshots.length - 1] : null;
  const latestOracleBasis =
    latestOracleSnapshot != null
      ? latestOracleSnapshot.spotIndex.toFixed(2)
      : "Pending";
  const tradingAvailabilityMessage =
    chainLabel.toLowerCase().includes("bnb") || chainLabel.toLowerCase().includes("bsc")
      ? "Trading on BSC is still rolling out. This surface is keeper-backed and read-only for now."
      : `Trading on ${chainLabel} is still rolling out. This surface is keeper-backed and read-only for now.`;
  const emptyDirectoryMessage =
    searchValue.trim().length > 0
      ? "No models matched the current filter."
      : `No ${chainLabel} models are indexed yet.`;

  return (
    <section className="hm-perps-view">
      <header className="hm-perps-hero">
        <div className="hm-perps-hero-text">
          <p className="hm-perps-kicker" style={{ color: themeDefinition.accentColor }}>
            Keeper-backed directory
          </p>
          <h2 className="hm-perps-headline">Model Perps</h2>
          <p className="hm-perps-copy">
            Chain-aware model market coverage for {chainLabel}. The public shell now
            mirrors the Solana surface: searchable directory, live matchup context,
            selected model detail, and keeper-backed oracle snapshots.
          </p>
        </div>
        <div className="hm-perps-metrics">
          <div className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Tracked markets</span>
            <strong className="hm-perps-metric-value">
              {formatCompactNumber(totals.markets)}
            </strong>
            <span className="hm-perps-metric-sub">{totals.ranked} ranked</span>
          </div>
          <div className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Current matchup</span>
            <strong className="hm-perps-metric-value">
              {currentMatchupLabel}
            </strong>
            <span className="hm-perps-metric-sub">{totals.active} active listings</span>
          </div>
          <div className="hm-perps-metric-card">
            <span className="hm-perps-metric-label">Oracle basis</span>
            <strong className="hm-perps-metric-value">{latestOracleBasis}</strong>
            <span className="hm-perps-metric-sub">
              {oracleUpdatedAt ? `Updated ${formatTimestamp(oracleUpdatedAt)}` : `${collateralSymbol} collateral`}
            </span>
          </div>
        </div>
      </header>

      <div className="hm-perps-grid">
        <article className="hm-perps-card">
          <div className="hm-perps-card-header">
            <div>
              <h3 className="hm-perps-card-title">Models</h3>
              <p className="hm-perps-card-sub">
                Keeper-backed model directory for {chainLabel}, aligned to the live
                duel shell instead of a separate placeholder runtime.
              </p>
            </div>
            <div className="hm-perps-toolbar">
              <input
                className="hm-perps-search"
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search models"
                aria-label="Search models"
              />
              {updatedAt ? (
                <span className="hm-perps-updated">
                  Updated {formatTimestamp(updatedAt)}
                </span>
              ) : null}
            </div>
          </div>
          {loading ? (
            <div className="hm-perps-empty">Loading model markets…</div>
          ) : error ? (
            <div className="hm-perps-error">Directory unavailable: {error}</div>
          ) : filteredEntries.length === 0 ? (
            <div className="hm-perps-empty">{emptyDirectoryMessage}</div>
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
                  {filteredEntries.slice(0, 18).map((entry) => {
                    const isSelected = selectedEntry?.characterId === entry.characterId;
                    const isLive = isEntryInCurrentMatch(
                      entry,
                      fightingAgentA,
                      fightingAgentB,
                    );
                    return (
                      <tr
                        key={`${entry.characterId}-${entry.marketId}`}
                        className={`hm-perps-row${isSelected ? " hm-perps-row--selected" : ""}${isLive ? " hm-perps-row--live" : ""}`}
                        onClick={() => setSelectedCharacterId(entry.characterId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedCharacterId(entry.characterId);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSelected}
                      >
                        <td className="hm-perps-td hm-perps-td--mono">
                          {entry.rank ?? "—"}
                        </td>
                        <td className="hm-perps-td">
                          <div className="hm-perps-agent-cell">
                            <strong className="hm-perps-agent-name">
                              {entry.name}
                              {isLive ? (
                                <span className="hm-perps-live-badge">Live</span>
                              ) : null}
                            </strong>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <div style={{ display: "grid", gap: 16 }}>
          <article className="hm-perps-card">
            <div className="hm-perps-card-header">
              <div>
                <h3 className="hm-perps-card-title">Selected model</h3>
                <p className="hm-perps-card-sub">
                  Live matchup alignment, keeper market identity, and recent oracle
                  evidence.
                </p>
              </div>
              {selectedEntry?.rank != null ? (
                <span className="hm-perps-rank-chip">Rank #{selectedEntry.rank}</span>
              ) : (
                <span className="hm-perps-rank-chip hm-perps-rank-chip--stale">
                  Unranked
                </span>
              )}
            </div>
            {selectedEntry ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="hm-perps-detail-grid">
                  <div className="hm-perps-detail-item">
                    <span className="hm-perps-detail-label">Model</span>
                    <strong className="hm-perps-detail-value">{selectedEntry.name}</strong>
                    <span className="hm-perps-card-sub">
                      {selectedEntry.provider} · {selectedEntry.model}
                    </span>
                  </div>
                  <div className="hm-perps-detail-item">
                    <span className="hm-perps-detail-label">Current status</span>
                    <strong className="hm-perps-detail-value hm-perps-detail-value--gold">
                      {selectedEntry.status}
                    </strong>
                    <span className="hm-perps-card-sub">
                      Market #{selectedEntry.marketId}
                    </span>
                  </div>
                  <div className="hm-perps-detail-item">
                    <span className="hm-perps-detail-label">Record</span>
                    <strong className="hm-perps-detail-value hm-perps-detail-value--green">
                      {selectedEntry.wins}-{selectedEntry.losses}
                    </strong>
                    <span className="hm-perps-card-sub">
                      Win rate {selectedEntry.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="hm-perps-detail-item">
                    <span className="hm-perps-detail-label">Combat profile</span>
                    <strong className="hm-perps-detail-value">
                      Lv.{selectedEntry.combatLevel}
                    </strong>
                    <span className="hm-perps-card-sub">
                      Streak {selectedEntry.currentStreak}
                    </span>
                  </div>
                </div>

                <div className="hm-perps-history-card">
                  <div className="hm-perps-history-header">
                    <div>
                      <h4 className="hm-perps-section-title">Chain market summary</h4>
                      <p className="hm-perps-section-sub">
                        {currentMatchupLabel} · {chainLabel}
                      </p>
                    </div>
                    <span className="hm-perps-oracle-updated">
                      Seen {formatShortRelative(selectedEntry.lastSeenAt)}
                    </span>
                  </div>
                  <div className="hm-perps-detail-grid">
                    <div className="hm-perps-detail-item">
                      <span className="hm-perps-detail-label">Oracle basis</span>
                      <strong className="hm-perps-detail-value hm-perps-detail-value--gold">
                        {latestOracleBasis}
                      </strong>
                      <span className="hm-perps-card-sub">
                        {oracleUpdatedAt ? `Updated ${formatTimestamp(oracleUpdatedAt)}` : "Waiting for oracle snapshots"}
                      </span>
                    </div>
                    <div className="hm-perps-detail-item">
                      <span className="hm-perps-detail-label">Directory sync</span>
                      <strong className="hm-perps-detail-value">
                        {formatTimestamp(selectedEntry.updatedAt)}
                      </strong>
                      <span className="hm-perps-card-sub">
                        Last seen {formatShortRelative(selectedEntry.lastSeenAt)}
                      </span>
                    </div>
                  </div>
                  {oracleLoading ? (
                    <div className="hm-perps-empty">Loading oracle snapshots…</div>
                  ) : oracleError ? (
                    <div className="hm-perps-error">Oracle history unavailable: {oracleError}</div>
                  ) : oracleSnapshots.length === 0 ? (
                    <div className="hm-perps-empty">Waiting for keeper oracle snapshots.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {oracleSnapshots.slice(-5).reverse().map((snapshot) => (
                        <div key={`${snapshot.recordedAt}-${snapshot.marketId}`} className="hm-perps-detail-item">
                          <span className="hm-perps-detail-label">
                            {formatTimestamp(snapshot.recordedAt)}
                          </span>
                          <strong className="hm-perps-detail-value">
                            {snapshot.spotIndex.toFixed(2)}
                          </strong>
                          <span className="hm-perps-card-sub">
                            Conservative skill {snapshot.conservativeSkill.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="hm-perps-detail-empty">
                Select a model to inspect and compare against the current duel.
              </div>
            )}
          </article>

          <article className="hm-perps-card">
            <div className="hm-perps-card-header">
              <div>
                <h3 className="hm-perps-card-title">Trading status</h3>
                <p className="hm-perps-card-sub">
                  Product-shell parity is live now; chain-specific order entry can
                  follow without downgrading the models surface.
                </p>
              </div>
            </div>
            <div className="hm-perps-trade-card">
              <div className="hm-perps-trade-header">
                <div>
                  <h4 className="hm-perps-section-title">Read-only mode</h4>
                  <p className="hm-perps-section-sub">{tradingAvailabilityMessage}</p>
                </div>
                <span className="hm-perps-chain-badge">{chainLabel}</span>
              </div>
              <div className="hm-perps-detail-grid">
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Highlighted matchup</span>
                  <strong className="hm-perps-detail-value">{currentMatchupLabel}</strong>
                  <span className="hm-perps-card-sub">Public shell aligned with the live duel surface.</span>
                </div>
                <div className="hm-perps-detail-item">
                  <span className="hm-perps-detail-label">Directory health</span>
                  <strong className="hm-perps-detail-value">
                    {loading ? "Loading" : error ? "Degraded" : "Ready"}
                  </strong>
                  <span className="hm-perps-card-sub">
                    {error
                      ? `Index error: ${error}`
                      : `${totals.markets} keeper-indexed models available`}
                  </span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
