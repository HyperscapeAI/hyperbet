/**
 * Generic time-keyed bounded snapshot buffer.
 *
 * The aligned selector (C3c) selects the newest snapshot from each
 * rail whose source timestamp is less than or equal to
 * `viewerSourceNowMs`. That requires a buffer keyed by source-time
 * rather than arrival order. This module provides that buffer in
 * pure form — no hooks, no timers, no rail-specific knowledge.
 *
 * Invariants:
 *   - Entries are held sorted by `sourceEmittedAtMs` ascending.
 *   - `push` tolerates out-of-order arrivals (SSE rarely reorders,
 *     but can; PRD §P0 "Raw/historical rail buffers" mandates
 *     timestamp-order selection, not arrival-order).
 *   - The buffer self-prunes on each push: first by time retention,
 *     then by max sample count. Oldest-first.
 *   - `pickAtOrBefore(t)` uses binary search; O(log n). Returns
 *     null when no entry is at or before `t`.
 *   - `entries()` is readonly — callers must not mutate.
 */

export interface SnapshotBufferEntry<T> {
  snapshot: T;
  sourceEmittedAtMs: number;
  receivedAtMs: number;
}

export interface SnapshotBufferOptions {
  /** Maximum entries retained. Default 64. */
  maxSamples?: number;
  /**
   * Time-based retention in milliseconds. Entries older than
   * `max(entry.sourceEmittedAt) - retentionMs` are pruned on push.
   * Default 60_000 (60s covers desktop HLS variance during soak
   * per PRD §P0 "Raw/historical rail buffers" retention note).
   */
  retentionMs?: number;
}

export interface SnapshotBuffer<T> {
  /**
   * Insert a snapshot keyed by its source-emission timestamp. If an
   * entry with the same `sourceEmittedAtMs` already exists it is
   * replaced (last write wins — protects against duplicate frames
   * being re-emitted by an SSE replay).
   */
  push(
    snapshot: T,
    sourceEmittedAtMs: number,
    receivedAtMs?: number,
  ): void;
  /**
   * Return the newest entry with `sourceEmittedAtMs <=
   * sourceTimeMs`, or null if no such entry exists.
   */
  pickAtOrBefore(sourceTimeMs: number): SnapshotBufferEntry<T> | null;
  /** Current entry count. */
  size(): number;
  /** Drop all entries. */
  clear(): void;
  /** Readonly ordered snapshot of the current window (oldest first). */
  entries(): readonly SnapshotBufferEntry<T>[];
}

const DEFAULT_MAX_SAMPLES = 64;
const DEFAULT_RETENTION_MS = 60_000;

/**
 * Lower-bound binary search. Returns the largest index `i` such
 * that `sortedEntries[i].sourceEmittedAtMs <= target`. Returns -1
 * when no such index exists (target is before every entry).
 */
function findIndexAtOrBefore<T>(
  sortedEntries: readonly SnapshotBufferEntry<T>[],
  target: number,
): number {
  let lo = 0;
  let hi = sortedEntries.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedEntries[mid].sourceEmittedAtMs <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Binary-search insertion index (strictly ascending). An entry with
 * the same `sourceEmittedAtMs` resolves to the index of the existing
 * entry (we special-case duplicates in `push`).
 */
function findInsertionIndex<T>(
  sortedEntries: readonly SnapshotBufferEntry<T>[],
  sourceEmittedAtMs: number,
): number {
  let lo = 0;
  let hi = sortedEntries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedEntries[mid].sourceEmittedAtMs < sourceEmittedAtMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function createSnapshotBuffer<T>(
  options: SnapshotBufferOptions = {},
): SnapshotBuffer<T> {
  const maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  const retentionMs = Math.max(
    0,
    options.retentionMs ?? DEFAULT_RETENTION_MS,
  );

  const store: SnapshotBufferEntry<T>[] = [];

  function prune(): void {
    if (store.length === 0) return;
    // Time retention: anything older than `newest - retentionMs` is
    // dropped. Newest is always at the end of the ascending array.
    const newest = store[store.length - 1].sourceEmittedAtMs;
    const cutoff = newest - retentionMs;
    while (store.length > 0 && store[0].sourceEmittedAtMs < cutoff) {
      store.shift();
    }
    // Size retention: keep only the newest `maxSamples` entries.
    while (store.length > maxSamples) {
      store.shift();
    }
  }

  function push(
    snapshot: T,
    sourceEmittedAtMs: number,
    receivedAtMs?: number,
  ): void {
    if (!Number.isFinite(sourceEmittedAtMs)) {
      return;
    }
    const entry: SnapshotBufferEntry<T> = {
      snapshot,
      sourceEmittedAtMs,
      receivedAtMs: receivedAtMs ?? Date.now(),
    };

    const insertIndex = findInsertionIndex(store, sourceEmittedAtMs);
    // Duplicate key: last write wins. A replay/retransmit of the
    // same frame must not expand the window or degrade pruning.
    if (
      insertIndex < store.length &&
      store[insertIndex].sourceEmittedAtMs === sourceEmittedAtMs
    ) {
      store[insertIndex] = entry;
    } else {
      store.splice(insertIndex, 0, entry);
    }
    prune();
  }

  function pickAtOrBefore(
    sourceTimeMs: number,
  ): SnapshotBufferEntry<T> | null {
    if (store.length === 0 || !Number.isFinite(sourceTimeMs)) return null;
    const idx = findIndexAtOrBefore(store, sourceTimeMs);
    return idx >= 0 ? store[idx] : null;
  }

  function size(): number {
    return store.length;
  }

  function clear(): void {
    store.length = 0;
  }

  function entries(): readonly SnapshotBufferEntry<T>[] {
    // Return a live readonly view. Callers that need stable
    // snapshots may `.slice()`; this avoids an allocation on every
    // diagnostics read.
    return store;
  }

  return { push, pickAtOrBefore, size, clear, entries };
}
