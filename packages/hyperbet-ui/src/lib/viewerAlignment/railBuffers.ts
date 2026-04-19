/**
 * Per-rail wrappers over the generic `SnapshotBuffer<T>`.
 *
 * Each factory returns a buffer pre-configured for its rail's
 * payload shape. The normalization helpers extract a source-emission
 * timestamp from each payload, tolerating the legacy shapes emitted
 * by keepers that predate commit 2 (they carry only `updatedAt`).
 *
 * The buffers are created once per rail and pushed into by the
 * existing hooks in C3c. Until C3c wires this in, these factories
 * are entirely unused — C3b ships them inert.
 *
 * Rails:
 *   - session        → canonical stream session envelope (raw
 *                       `emittedAt` from hyperscape SSE frames)
 *   - market         → `/api/arena/prediction-markets/overview`
 *                       (envelope `sourceEmittedAt` / `serverEmittedAt`)
 *   - duelContext    → `/api/streaming/duel-context`
 *                       (top-level `sourceEmittedAt` / `serverEmittedAt`)
 */

import {
  createSnapshotBuffer,
  type SnapshotBuffer,
  type SnapshotBufferOptions,
} from "./snapshotBuffer";

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Extract a source-emission anchor from a canonical session
 * envelope. Reads raw `emittedAt` (hyperscape canonical rail), which
 * is the definition of "source time" on that rail. Returns null when
 * the payload genuinely lacks an emission timestamp — the caller
 * should NOT fabricate one, because silently stamping `Date.now()`
 * would lie about source-time and defeat the whole alignment layer.
 */
export function extractSessionSourceEmittedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { emittedAt?: unknown }).emittedAt;
  return asFiniteNumber(raw);
}

/**
 * Extract a source-emission anchor from a
 * `PredictionMarketsOverviewResponse`. Preference order:
 *   1. envelope `sourceEmittedAt` (C2 contract)
 *   2. max over per-surface `sourceEmittedAt` (C2 contract)
 *   3. envelope `updatedAt` (legacy fallback)
 * Returns null when none are available.
 */
export function extractMarketSourceEmittedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;

  const envelope = asFiniteNumber(candidate.sourceEmittedAt);
  if (envelope != null) return envelope;

  const live = candidate.live as { sourceEmittedAt?: unknown } | null;
  const recent = candidate.recentSettlement as
    | { sourceEmittedAt?: unknown }
    | null;
  const liveAnchor = live ? asFiniteNumber(live.sourceEmittedAt) : null;
  const recentAnchor = recent ? asFiniteNumber(recent.sourceEmittedAt) : null;
  if (liveAnchor != null && recentAnchor != null) {
    return Math.max(liveAnchor, recentAnchor);
  }
  if (liveAnchor != null) return liveAnchor;
  if (recentAnchor != null) return recentAnchor;

  const legacy = asFiniteNumber(candidate.updatedAt);
  return legacy;
}

/**
 * Extract a server-emission timestamp from a
 * `PredictionMarketsOverviewResponse`. Used for max-age staleness
 * checks (PRD §P0 "Raw/historical rail buffers" — staleness keys off
 * server-emission time). Falls back to envelope `updatedAt` for
 * legacy keepers.
 */
export function extractMarketServerEmittedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const envelope = asFiniteNumber(candidate.serverEmittedAt);
  if (envelope != null) return envelope;
  return asFiniteNumber(candidate.updatedAt);
}

/**
 * Extract a source-emission anchor from a duel-context response.
 * Reads top-level `sourceEmittedAt` (C2 contract) and falls back to
 * `updatedAt` on legacy keepers.
 */
export function extractDuelContextSourceEmittedAt(
  payload: unknown,
): number | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const source = asFiniteNumber(candidate.sourceEmittedAt);
  if (source != null) return source;
  return asFiniteNumber(candidate.updatedAt);
}

/**
 * Extract a server-emission timestamp from a duel-context response.
 */
export function extractDuelContextServerEmittedAt(
  payload: unknown,
): number | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const server = asFiniteNumber(candidate.serverEmittedAt);
  if (server != null) return server;
  return asFiniteNumber(candidate.updatedAt);
}

/**
 * Session snapshot buffer. The entry payload is deliberately typed
 * as `unknown` here — C3c will wrap this with the typed session
 * payload shape once the hook layer lands. Keeping it `unknown`
 * prevents C3b from coupling to the session normalizer's type (which
 * is still evolving during C3) and means this module stays stable.
 */
export type SessionSnapshotBuffer<T = unknown> = SnapshotBuffer<T>;

export function createSessionSnapshotBuffer<T = unknown>(
  options?: SnapshotBufferOptions,
): SessionSnapshotBuffer<T> {
  return createSnapshotBuffer<T>(options);
}

export type MarketSnapshotBuffer<T = unknown> = SnapshotBuffer<T>;

export function createMarketSnapshotBuffer<T = unknown>(
  options?: SnapshotBufferOptions,
): MarketSnapshotBuffer<T> {
  return createSnapshotBuffer<T>(options);
}

export type DuelContextSnapshotBuffer<T = unknown> = SnapshotBuffer<T>;

export function createDuelContextSnapshotBuffer<T = unknown>(
  options?: SnapshotBufferOptions,
): DuelContextSnapshotBuffer<T> {
  return createSnapshotBuffer<T>(options);
}
