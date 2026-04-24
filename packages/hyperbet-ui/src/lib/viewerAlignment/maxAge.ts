/**
 * Max-age budgets and staleness helpers for rail snapshots.
 *
 * The aligned selector (C3c) refuses to drive authoritative-looking
 * open/locked/phase UI off a snapshot whose `serverEmittedAt` is
 * older than its rail's budget. Per PRD decision 3 and the explicit
 * `hyperbet-ui` budgets in commit 3's scope:
 *
 *   - market         → 10s
 *   - duel-context   → 10s
 *
 * Session has no built-in max-age at this layer — the clock module
 * already owns telemetry-staleness rules; session freshness is
 * derived from the viewer clock's confidence/frozen flags.
 */

/** Market overview/lifecycle max-age budget. See PRD decision 3. */
export const MARKET_MAX_AGE_MS = 10_000;

/**
 * Duel-context max-age budget.
 *
 * Kept equal to market at 10s rather than tighter:
 * the rail is still client-polled at 3s, and in practice the viewer
 * clock often sits ~5-6s behind live on staging. An 8s budget makes a
 * healthy startup selection flap stale simply because
 * `viewerLatency + one poll gap > 8s`. 10s preserves the "one missed
 * poll + normal viewer delay" envelope without masking genuinely old
 * context.
 */
export const DUEL_CONTEXT_MAX_AGE_MS = 10_000;

/**
 * Returns true when the given snapshot server-emission timestamp is
 * older than `budgetMs` relative to the current viewer server time.
 *
 * Null budget or null emission disables the check (returns false) —
 * the caller is then responsible for downgrading confidence /
 * changing copy on its own signals.
 *
 * Staleness uses **server-emission time** (not source-emission), per
 * PRD §P0 "Raw/historical rail buffers" timestamp-contract rule:
 *   "selector key for session/market/duel-context should be
 *    source-aligned time. The staleness key should be
 *    server-emission time."
 */
export function isStaleByServerEmission(
  snapshotServerEmittedAtMs: number | null | undefined,
  viewerServerNowMs: number,
  budgetMs: number | null | undefined,
): boolean {
  if (budgetMs == null || budgetMs <= 0) return false;
  if (snapshotServerEmittedAtMs == null) return false;
  if (!Number.isFinite(snapshotServerEmittedAtMs)) return false;
  const age = viewerServerNowMs - snapshotServerEmittedAtMs;
  return age > budgetMs;
}

/**
 * Returns the numerical age in ms for diagnostics, or null if it
 * cannot be computed. Unlike `isStaleByServerEmission` this does not
 * clamp or short-circuit — useful for structured shadow-log emission
 * and operator dashboards.
 */
export function ageByServerEmission(
  snapshotServerEmittedAtMs: number | null | undefined,
  viewerServerNowMs: number,
): number | null {
  if (
    snapshotServerEmittedAtMs == null ||
    !Number.isFinite(snapshotServerEmittedAtMs)
  ) {
    return null;
  }
  return viewerServerNowMs - snapshotServerEmittedAtMs;
}
