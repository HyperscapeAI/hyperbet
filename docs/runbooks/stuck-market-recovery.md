# Stuck Market Recovery

## Symptoms

- market remains open/locked after authoritative duel progression
- stream, active-market API, bot health, and on-chain state disagree
- expected claim/refund/cleanup is unavailable
- `/ready` reports market recovery, parser, index, or terminal-queue failure

## Contain

1. Stop the duel keeper to disable new quotes and privileged lifecycle writes.
2. Keep read and user-safe cleanup surfaces available when they remain trustworthy.
3. Preserve logs, readiness, bot health, feed checkpoint, lifecycle index, terminal queue, and on-chain accounts.

## Recover

1. Verify program identity and frozen configuration.
2. Verify canonical duel ID/key, timestamps, phase, and feed epoch/sequence.
3. Inspect the market, duel, vault, active orders, user balances, and terminal evidence on-chain.
4. Restart the keeper and require canonical discovery/replay to converge without creating a duplicate market or quote.
5. Use `terminal-ops list` and `terminal-ops inspect` for quarantined work. Requeue only an eligible record with the exact fingerprint, operator identity, and reason.
6. Never edit SQLite or synthesize a terminal result.
7. Re-run readiness and a bounded staged reproduction before restoring writes.

Success requires exact agreement across stream/feed, on-chain state, lifecycle index, terminal ledger, API, and UI with no duplicated value or side effect.
