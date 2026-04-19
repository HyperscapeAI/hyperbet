import type { SnapshotBuffer, SnapshotBufferEntry } from "./snapshotBuffer";
import type { ViewerClock } from "./types";
import { isStaleByServerEmission } from "./maxAge";

/**
 * Pure selector + gate policy for the viewer-aligned bet state.
 *
 * Splits naturally into three small concerns:
 *   - `pickSnapshotAtOrBefore` — thin wrapper over the buffer's
 *     binary selection that also extracts server-emission time for
 *     the staleness check
 *   - `selectAlignedRailSnapshot` — composes pick + stale check into
 *     a `RailSelection<T>` record with diagnostics
 *   - `resolveTradeGate` — pure policy: given the clock and per-rail
 *     selections, returns `{ canDisplayOpen, canSubmitTrade, reason }`
 *
 * Per PRD §P0 "Betting affordance gating":
 *   "Display state: viewer-aligned, so the phase/countdown matches
 *    video. Submission state: must also check the freshest
 *    authoritative market/chain state."
 * This module handles the display side. The submission side is the
 * caller's responsibility — `canSubmitTrade` here is a viewer-clock-
 * confidence gate, not an on-chain authority check.
 */

/**
 * Result of selecting a rail's most recent snapshot at or before the
 * viewer's source-time. Null snapshot means no eligible entry exists;
 * `stale: true` means a snapshot was found but its server-emission
 * age exceeds the rail's max-age budget.
 */
export interface RailSelection<T> {
  /** The selected snapshot, or null if none is eligible. */
  snapshot: T | null;
  /** Source-emission time of the selected entry (null if no entry). */
  sourceEmittedAtMs: number | null;
  /**
   * Server-emission time of the selected entry, for staleness
   * checks. Null if no entry or the rail's payload doesn't carry
   * one (legacy keepers).
   */
  serverEmittedAtMs: number | null;
  /** Age in ms (`viewerServerNowMs - serverEmittedAtMs`). */
  ageMs: number | null;
  /** True when `ageMs > maxAgeMs`. */
  stale: boolean;
}

export interface SelectAlignedRailSnapshotInputs<T> {
  buffer: SnapshotBuffer<T>;
  viewerSourceNowMs: number;
  viewerServerNowMs: number;
  /**
   * Extract the snapshot's server-emission timestamp. Called with
   * the found entry's payload; returns null when the payload
   * predates the C2 contract.
   */
  extractServerEmittedAt: (snapshot: T) => number | null;
  /** Max age in ms, or null to disable the staleness check. */
  maxAgeMs: number | null;
}

/**
 * Thin binary-select wrapper: returns the buffer's newest entry at
 * or before `sourceTimeMs`. Exposed as a named export so callers
 * that only want the raw pick (without the stale/age computation)
 * have a clean primitive.
 */
export function pickSnapshotAtOrBefore<T>(
  buffer: SnapshotBuffer<T>,
  sourceTimeMs: number,
): SnapshotBufferEntry<T> | null {
  return buffer.pickAtOrBefore(sourceTimeMs);
}

export function selectAlignedRailSnapshot<T>(
  inputs: SelectAlignedRailSnapshotInputs<T>,
): RailSelection<T> {
  const entry = pickSnapshotAtOrBefore(inputs.buffer, inputs.viewerSourceNowMs);
  if (!entry) {
    return {
      snapshot: null,
      sourceEmittedAtMs: null,
      serverEmittedAtMs: null,
      ageMs: null,
      stale: false,
    };
  }
  const serverEmittedAtMs = inputs.extractServerEmittedAt(entry.snapshot);
  const ageMs =
    serverEmittedAtMs != null
      ? inputs.viewerServerNowMs - serverEmittedAtMs
      : null;
  const stale = isStaleByServerEmission(
    serverEmittedAtMs,
    inputs.viewerServerNowMs,
    inputs.maxAgeMs,
  );
  return {
    snapshot: entry.snapshot,
    sourceEmittedAtMs: entry.sourceEmittedAtMs,
    serverEmittedAtMs,
    ageMs,
    stale,
  };
}

/** Trade-gate decision — display-open and submit-trade flags with reason. */
export interface TradeGate {
  /**
   * Whether the UI may render an "open / bet now" affordance. False
   * when the clock can't be trusted or the market snapshot is
   * stale/missing — the app should show a "syncing / verifying"
   * treatment instead of a confident open state.
   */
  canDisplayOpen: boolean;
  /**
   * Whether the UI may let the user attempt to SUBMIT a trade. This
   * is a viewer-clock-confidence gate ONLY — the caller is still
   * required to re-check the freshest authoritative market/chain
   * state before the actual write. (See PRD §P0 "Betting affordance
   * gating".)
   */
  canSubmitTrade: boolean;
  /**
   * Short machine-readable reason for the gate state — empty when
   * everything is healthy. Useful for structured shadow logs and
   * operator dashboards. Not a user-facing string.
   */
  reason: TradeGateReason | null;
}

export type TradeGateReason =
  | "clock-confidence-low"
  | "clock-frozen"
  | "market-stale"
  | "market-missing"
  | "session-missing";

export interface ResolveTradeGateInputs {
  clock: ViewerClock;
  session: RailSelection<unknown>;
  market: RailSelection<unknown>;
}

/**
 * Policy:
 *   - canSubmitTrade requires high OR medium clock confidence, NOT
 *     frozen, session selected, market selected AND fresh.
 *   - canDisplayOpen is looser — it can be true at medium confidence
 *     and even without duel-context (duel-context is advisory for
 *     display per PRD §P1 "Align or demote duel context"), but
 *     freeze and market-staleness still force it off because those
 *     mean the open/locked label would lie.
 *   - `reason` is the FIRST failing condition checked in the order
 *     below. When multiple conditions fail the most severe wins
 *     (clock issues before rail issues).
 */
export function resolveTradeGate(inputs: ResolveTradeGateInputs): TradeGate {
  const { clock, session, market } = inputs;

  // Severity order: clock issues first.
  if (clock.frozen) {
    return {
      canDisplayOpen: false,
      canSubmitTrade: false,
      reason: "clock-frozen",
    };
  }
  if (clock.confidence === "low") {
    return {
      canDisplayOpen: false,
      canSubmitTrade: false,
      reason: "clock-confidence-low",
    };
  }

  // Rail-level checks.
  if (session.snapshot == null) {
    return {
      canDisplayOpen: false,
      canSubmitTrade: false,
      reason: "session-missing",
    };
  }
  if (market.snapshot == null) {
    return {
      canDisplayOpen: false,
      canSubmitTrade: false,
      reason: "market-missing",
    };
  }
  if (market.stale) {
    return {
      canDisplayOpen: false,
      canSubmitTrade: false,
      reason: "market-stale",
    };
  }

  // All green. Submission requires high or medium confidence; at this
  // point we've already ruled out low/frozen, so submission is
  // allowed whenever display is allowed.
  return {
    canDisplayOpen: true,
    canSubmitTrade: true,
    reason: null,
  };
}
