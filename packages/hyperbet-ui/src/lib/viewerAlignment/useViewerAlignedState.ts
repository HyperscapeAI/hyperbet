import { useEffect, useMemo, useRef, useState } from "react";

import { createClockOffsetEstimator } from "./clockOffset";
import type { ClockOffsetEstimator } from "./types";
import {
  DUEL_CONTEXT_MAX_AGE_MS,
  MARKET_MAX_AGE_MS,
} from "./maxAge";
import {
  createDuelContextSnapshotBuffer,
  createMarketSnapshotBuffer,
  createSessionSnapshotBuffer,
  extractDuelContextServerEmittedAt,
  extractDuelContextSourceEmittedAt,
  extractMarketServerEmittedAt,
  extractMarketSourceEmittedAt,
  extractSessionSourceEmittedAt,
  type DuelContextSnapshotBuffer,
  type MarketSnapshotBuffer,
  type SessionSnapshotBuffer,
} from "./railBuffers";
import {
  resolveTradeGate,
  selectAlignedRailSnapshot,
  type RailSelection,
  type TradeGate,
} from "./selector";
import {
  detectDivergence,
  type DivergenceEvent,
} from "./divergenceLog";
import type {
  StreamPlayerTelemetrySnapshot,
  ViewerClock,
  ViewerClockConfidence,
  ViewerClockLatencySource,
} from "./types";
import { resolveViewerClock } from "./viewerClock";

/**
 * The unified output of the aligned-state hook. Typed generically
 * over each rail's payload so the app-side wrapper in C4 can narrow
 * the types to whatever the hooks upstream actually return.
 *
 * When `enabled=false` the hook returns a passthrough shape —
 * `viewerClock` is null, rails pass through the latest payloads
 * directly, and `tradeGate.canDisplayOpen/canSubmitTrade` default
 * to `true` (the alignment layer is not blocking anything). This
 * is what keeps C3c inert until C4 flips the flag.
 */
export interface ViewerAlignedState<S, M, D> {
  enabled: boolean;
  viewerClock: ViewerClock | null;
  session: S | null;
  marketOverview: M | null;
  duelContext: D | null;
  tradeGate: TradeGate;
  diagnostics: {
    selectedSessionAgeMs: number | null;
    selectedMarketAgeMs: number | null;
    selectedDuelContextAgeMs: number | null;
    skewMs: number | null;
    confidence: ViewerClockConfidence;
    latencySource: ViewerClockLatencySource;
    frozen: boolean;
    staleRails: Array<"session" | "market" | "duelContext">;
    sessionBufferSize: number;
    marketBufferSize: number;
    duelContextBufferSize: number;
  };
}

export interface UseViewerAlignedStateInputs<S, M, D> {
  /**
   * Master flag. When false, the hook is inert — it does no buffer
   * pushes, runs no ticks, and returns a passthrough state with the
   * latest values from the props. Wired to
   * `VITE_ENABLE_VIEWER_ALIGNED_BET_STATE` in the app.
   */
  enabled: boolean;

  /** Latest canonical-session payload (from `useCanonicalStreamSession`). */
  latestSession: S | null;
  /** Latest market-overview payload (from `usePredictionMarketOverview`). */
  latestMarket: M | null;
  /** Latest duel-context payload (from `useDuelContext`). */
  latestDuelContext: D | null;

  /**
   * Session-rail `presentationDelayMs`, used as the pre-telemetry
   * bootstrap fallback for the viewer clock (PRD decision 2).
   */
  sessionPresentationDelayMs: number | null;

  /**
   * Latest `HLS_PLAYER_STATUS` telemetry + the wall-clock time we
   * received it. The selector uses the former for latency, the
   * latter for staleness.
   */
  playerStatus: StreamPlayerTelemetrySnapshot | null;
  playerStatusReceivedAtMs: number | null;

  /**
   * Wall-clock time at which the player's `currentTime` last
   * advanced. Used by `resolveViewerClock` for freeze detection.
   * When null, freeze detection is disabled.
   */
  lastAdvancingPlayerStatusAtMs: number | null;

  /**
   * The phase that the live (pre-alignment) UI would be about to
   * paint, used by the divergence detector to compare against the
   * aligned phase. Optional — when null, phase-mismatch detection
   * is skipped (other divergence reasons still fire).
   */
  currentDisplayPhase?: string | null;

  /**
   * How to extract a phase label from the aligned session snapshot,
   * used by the divergence detector to determine the aligned phase.
   * When not provided, phase-mismatch divergences are not emitted.
   */
  extractAlignedPhase?: (session: S | null) => string | null;

  /**
   * Optional shadow-log sink. Called with each emitted divergence
   * event (per PRD decision 3: "structured logs only" — the caller
   * decides whether to forward to console / analytics / remote
   * shipper).
   */
  onDivergence?: (event: DivergenceEvent) => void;

  /** Override max-age budgets (tests / operator tuning). */
  marketMaxAgeMs?: number;
  duelContextMaxAgeMs?: number;

  /**
   * Tick interval in ms. The viewer clock advances continuously;
   * the hook re-evaluates on each tick and on prop changes. Default
   * 250ms — fast enough for smooth countdowns, slow enough to avoid
   * excess renders.
   */
  tickIntervalMs?: number;
}

const DEFAULT_TICK_INTERVAL_MS = 250;

/**
 * Hook. Orchestrates offset estimation, buffer pushes, viewer-clock
 * derivation, selector execution, and divergence detection. Returns
 * the aligned view on each tick / prop change.
 *
 * Safe to mount with `enabled=false`: callers still receive the
 * passthrough state shape, but if an `onDivergence` sink is provided
 * the hook continues to buffer/select in shadow mode so staging can
 * collect `[viewer-align]` logs before the aligned state is promoted
 * to user-visible gating.
 */
export function useViewerAlignedState<S, M, D>(
  inputs: UseViewerAlignedStateInputs<S, M, D>,
): ViewerAlignedState<S, M, D> {
  const {
    enabled,
    latestSession,
    latestMarket,
    latestDuelContext,
    sessionPresentationDelayMs,
    playerStatus,
    playerStatusReceivedAtMs,
    lastAdvancingPlayerStatusAtMs,
    currentDisplayPhase,
    extractAlignedPhase,
    onDivergence,
    marketMaxAgeMs,
    duelContextMaxAgeMs,
    tickIntervalMs,
  } = inputs;

  // Buffers + estimator are stored in refs so they persist across
  // renders without triggering re-allocation.
  const sessionBufferRef = useRef<SessionSnapshotBuffer<S> | null>(null);
  const marketBufferRef = useRef<MarketSnapshotBuffer<M> | null>(null);
  const duelContextBufferRef = useRef<DuelContextSnapshotBuffer<D> | null>(null);
  const offsetEstimatorRef = useRef<ClockOffsetEstimator | null>(null);
  const emitCountRef = useRef(0);
  const previousFrozenRef = useRef(false);
  const lastSessionSourceRef = useRef<number | null>(null);
  const lastMarketSourceRef = useRef<number | null>(null);
  const lastDuelContextSourceRef = useRef<number | null>(null);
  const shadowEnabled = enabled || typeof onDivergence === "function";

  if (sessionBufferRef.current == null) {
    sessionBufferRef.current = createSessionSnapshotBuffer<S>();
    marketBufferRef.current = createMarketSnapshotBuffer<M>();
    duelContextBufferRef.current = createDuelContextSnapshotBuffer<D>();
    offsetEstimatorRef.current = createClockOffsetEstimator();
  }

  // Use a tick counter in state to force re-render on the clock-tick
  // interval. We don't store the viewer clock itself in state
  // because that would cause unnecessary re-renders on prop changes
  // (the clock is recomputed from scratch on every render anyway).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!shadowEnabled) return;
    const intervalMs = tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    const handle = setInterval(() => {
      setTick((t) => (t + 1) & 0x3fffffff);
    }, intervalMs);
    return () => clearInterval(handle);
  }, [shadowEnabled, tickIntervalMs]);

  // ── Ingest: push new payloads into their rail buffers ────────────
  // We run these inline during render (React is fine with that for
  // ref updates; no state mutations here). They're guarded by
  // same-source-time deduplication so re-renders with stable props
  // don't double-push.
  if (shadowEnabled && sessionBufferRef.current && offsetEstimatorRef.current) {
    const sessionSource = extractSessionSourceEmittedAt(latestSession);
    if (
      sessionSource != null &&
      sessionSource !== lastSessionSourceRef.current
    ) {
      const receivedAt = Date.now();
      sessionBufferRef.current.push(
        latestSession as S,
        sessionSource,
        receivedAt,
      );
      // SSE-derived offset estimator: push the same source/received
      // pair so the rolling median stays in sync with incoming frames.
      offsetEstimatorRef.current.pushSample({
        emittedAt: sessionSource,
        receivedAt,
      });
      lastSessionSourceRef.current = sessionSource;
    }
  }
  if (shadowEnabled && marketBufferRef.current) {
    const marketSource = extractMarketSourceEmittedAt(latestMarket);
    if (
      marketSource != null &&
      marketSource !== lastMarketSourceRef.current
    ) {
      marketBufferRef.current.push(
        latestMarket as M,
        marketSource,
        Date.now(),
      );
      lastMarketSourceRef.current = marketSource;
    }
  }
  if (shadowEnabled && duelContextBufferRef.current) {
    const ctxSource = extractDuelContextSourceEmittedAt(latestDuelContext);
    if (
      ctxSource != null &&
      ctxSource !== lastDuelContextSourceRef.current
    ) {
      duelContextBufferRef.current.push(
        latestDuelContext as D,
        ctxSource,
        Date.now(),
      );
      lastDuelContextSourceRef.current = ctxSource;
    }
  }

  // ── Resolve ──────────────────────────────────────────────────────
  // Every render recomputes the clock + selection. `tick` is in the
  // dep array (via the re-render cycle) so the timer-driven ticks
  // cause the clock to advance even when props are stable.
  const result = useMemo(() => {
    if (!shadowEnabled) {
      return buildPassthroughState<S, M, D>(
        latestSession,
        latestMarket,
        latestDuelContext,
      );
    }
    const sessionBuffer = sessionBufferRef.current!;
    const marketBuffer = marketBufferRef.current!;
    const duelContextBuffer = duelContextBufferRef.current!;
    const offsetEstimator = offsetEstimatorRef.current!;

    const nowMs = Date.now();
    const clock = resolveViewerClock({
      nowMs,
      estimatedServerOffsetMs: offsetEstimator.getOffsetMs(),
      playerStatus,
      playerStatusReceivedAtMs,
      sessionPresentationDelayMs,
      lastAdvancingPlayerStatusAtMs,
    });

    const sessionSelection: RailSelection<S> = selectAlignedRailSnapshot<S>({
      buffer: sessionBuffer,
      viewerSourceNowMs: clock.sourceNowMs,
      viewerServerNowMs: clock.serverNowMs,
      // Session rail doesn't have an explicit server-emission stamp
      // distinct from its source time; treat them as equal so the
      // stale check is effectively disabled for the session rail
      // (session freshness is carried by clock confidence + frozen).
      extractServerEmittedAt: () => null,
      maxAgeMs: null,
    });
    const marketSelection: RailSelection<M> = selectAlignedRailSnapshot<M>({
      buffer: marketBuffer,
      viewerSourceNowMs: clock.sourceNowMs,
      viewerServerNowMs: clock.serverNowMs,
      extractServerEmittedAt: (m) => extractMarketServerEmittedAt(m),
      maxAgeMs: marketMaxAgeMs ?? MARKET_MAX_AGE_MS,
    });
    const duelContextSelection: RailSelection<D> =
      selectAlignedRailSnapshot<D>({
        buffer: duelContextBuffer,
        viewerSourceNowMs: clock.sourceNowMs,
        viewerServerNowMs: clock.serverNowMs,
        extractServerEmittedAt: (d) => extractDuelContextServerEmittedAt(d),
        maxAgeMs: duelContextMaxAgeMs ?? DUEL_CONTEXT_MAX_AGE_MS,
      });

    const tradeGate = resolveTradeGate({
      clock,
      session: sessionSelection as RailSelection<unknown>,
      market: marketSelection as RailSelection<unknown>,
    });

    // Divergence emission (PRD decision 3).
    const alignedPhase = extractAlignedPhase
      ? extractAlignedPhase(sessionSelection.snapshot)
      : null;
    emitCountRef.current += 1;
    const event = detectDivergence({
      clock,
      previousFrozen: previousFrozenRef.current,
      session: sessionSelection as RailSelection<unknown>,
      market: marketSelection as RailSelection<unknown>,
      duelContext: duelContextSelection as RailSelection<unknown>,
      currentDisplayPhase: currentDisplayPhase ?? null,
      alignedDisplayPhase: alignedPhase,
      tradeGate,
      emitCount: emitCountRef.current,
    });
    if (event && onDivergence) {
      onDivergence(event);
    }
    previousFrozenRef.current = clock.frozen;

    const staleRails: Array<"session" | "market" | "duelContext"> = [];
    if (marketSelection.stale) staleRails.push("market");
    if (duelContextSelection.stale) staleRails.push("duelContext");

    const alignedState = {
      enabled: true,
      viewerClock: clock,
      session: sessionSelection.snapshot,
      marketOverview: marketSelection.snapshot,
      duelContext: duelContextSelection.snapshot,
      tradeGate,
      diagnostics: {
        selectedSessionAgeMs: sessionSelection.ageMs,
        selectedMarketAgeMs: marketSelection.ageMs,
        selectedDuelContextAgeMs: duelContextSelection.ageMs,
        skewMs: event?.skewMs ?? null,
        confidence: clock.confidence,
        latencySource: clock.latencySource,
        frozen: clock.frozen,
        staleRails,
        sessionBufferSize: sessionBuffer.size(),
        marketBufferSize: marketBuffer.size(),
        duelContextBufferSize: duelContextBuffer.size(),
      },
    } satisfies ViewerAlignedState<S, M, D>;

    if (!enabled) {
      return buildPassthroughState<S, M, D>(
        latestSession,
        latestMarket,
        latestDuelContext,
      );
    }

    return alignedState;
    // `tick` is intentionally included to force a recompute on each
    // clock-tick interval. We don't read it inside the memo body —
    // it's a dep-only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    shadowEnabled,
    latestSession,
    latestMarket,
    latestDuelContext,
    sessionPresentationDelayMs,
    playerStatus,
    playerStatusReceivedAtMs,
    lastAdvancingPlayerStatusAtMs,
    currentDisplayPhase,
    marketMaxAgeMs,
    duelContextMaxAgeMs,
    tick,
  ]);

  return result;
}

/**
 * Build the inert "alignment disabled" state shape. Rails pass
 * through the latest values; trade gate is permissive; diagnostics
 * are all null / zero. Callers receive a stable shape regardless of
 * the flag.
 */
function buildPassthroughState<S, M, D>(
  session: S | null,
  market: M | null,
  duelContext: D | null,
): ViewerAlignedState<S, M, D> {
  return {
    enabled: false,
    viewerClock: null,
    session,
    marketOverview: market,
    duelContext,
    tradeGate: {
      canDisplayOpen: true,
      canSubmitTrade: true,
      reason: null,
    },
    diagnostics: {
      selectedSessionAgeMs: null,
      selectedMarketAgeMs: null,
      selectedDuelContextAgeMs: null,
      skewMs: null,
      confidence: "low",
      latencySource: "none",
      frozen: false,
      staleRails: [],
      sessionBufferSize: 0,
      marketBufferSize: 0,
      duelContextBufferSize: 0,
    },
  };
}
