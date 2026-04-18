import type { StreamState as BetSyncStreamState } from "./betSync";

type StreamState = BetSyncStreamState;

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Policy predicate for `projectPublicStreamState`: should the mask
 * branch pass `cycle.phase`, `cycle.duelId`, `cycle.duelKey`,
 * `cycle.duelKeyHex`, the `channel`, `broadcastTimeline.phase`, and
 * the top-level `phase` through to the public projection even when
 * market parity hasn't confirmed yet?
 *
 * Rule: true if the source state reports `FIGHTING` or `RESOLUTION`
 * on either `cycle.phase` or top-level `phase`. During those phases
 * the stream viewport is already showing live combat and the on-chain
 * market-parity check trails the duel-api by 5-10 minutes while
 * Solana/BSC prediction markets settle — the bets UI needs the phase
 * and duel identifiers to label the fight correctly and to silence
 * the `streamDriftDetected` drift banner. Betting controls stay
 * disabled because `canTrade` is gated on the on-chain market being
 * in the `OPEN` lifecycle status, which it cannot be during FIGHTING
 * regardless of what the streaming envelope says. Outcome metadata
 * (winnerId, winnerName, winReason, seed, replayHash) and agent
 * identities remain masked in the mask branch of
 * `projectPublicStreamState` even when this predicate returns true,
 * so the outcome cannot leak before parity confirms.
 *
 * Pre-fight phases (`IDLE`, `ANNOUNCEMENT`, `COUNTDOWN`) always
 * return false — the existing parity gate stays active for them so
 * pre-match betting UI cannot surface before markets are open.
 */
export function sourceStatePhaseAllowsUnmaskedDuelIdentity(
  sourceState: StreamState,
): boolean {
  const cycleRecord = asJsonRecord(sourceState.cycle);
  const cyclePhase =
    typeof cycleRecord?.phase === "string" ? cycleRecord.phase : null;
  const topPhase =
    typeof sourceState.phase === "string" ? sourceState.phase : null;
  const phase = cyclePhase ?? topPhase ?? null;
  return phase === "FIGHTING" || phase === "RESOLUTION";
}
