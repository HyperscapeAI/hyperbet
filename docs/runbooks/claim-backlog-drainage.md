# Claim Backlog Drainage

## Symptoms

- resolved or cancelled markets accumulate claimable state without clearing
- users report `Nothing claimable yet` after valid settlement
- backlog grows after a restart or outage recovery

## Detection

```bash
curl -fsSL "$KEEPER_URL/api/arena/prediction-markets/active" | jq
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
curl -fsSL "$KEEPER_URL/status" | jq
psql "$MM_DATABASE_URL" -c "select backlog_key, chain_key, duel_key, market_key, status, attempts, next_attempt_at, last_error from claim_backlog where status <> 'RESOLVED' order by next_attempt_at asc limit 50;"
psql "$MM_DATABASE_URL" -c "select id, topic, status, attempts, available_at, last_error from outbox order by available_at asc limit 50;"
psql "$MM_DATABASE_URL" -c "select order_key, chain_key, duel_key, status, quarantine_reason from orders where status in ('OPEN','QUARANTINED','ORPHANED') order by placed_at desc limit 50;"
```

Use chain/runtime verification where needed:

```bash
bun run --cwd packages/market-maker-bot verify:chains
bun run --cwd packages/simulation-dashboard scenario history
```

## Immediate Containment

1. Pause quote traffic on markets that are already settled.
2. Avoid additional admin restarts until claim state is inspected.
3. Keep any ambiguous markets quarantined or reduce-only until the backlog is drained or intentionally deferred with backoff.

## Recovery Steps

1. Confirm the market is actually `RESOLVED` or `CANCELLED` in canonical lifecycle state.
2. Confirm the durable store is healthy and schema is current:
   ```bash
   bun run --cwd packages/market-maker-bot storage:migrate
   psql "$MM_DATABASE_URL" -c "select backlog_key, status, attempts, next_attempt_at, last_attempt_at, last_error from claim_backlog where status <> 'RESOLVED' order by next_attempt_at asc limit 50;"
   ```
3. Confirm on-chain position state still exists for affected users and compare it with persisted `claim_backlog` payloads plus any `orders` rows left `OPEN`, `ORPHANED`, or `QUARANTINED`.
4. Restart the keeper if claimability is missing only in the backend surface, then restart the MM only after boot logs show reconciliation completed and the backlog sweep resumed.
5. Inspect retry behavior:
   - `attempts` must advance
   - `next_attempt_at` must back off instead of hot-looping
   - `last_error` must stabilize or clear after a successful drain
6. Drain claims only after verifying that repeated claims are rejected, cleanup occurs, and the backlog count trends down across successive snapshots.

## Success Criteria

- claimable markets become visible again
- successful claims clear user exposure or refundable balances
- repeated claims are rejected
- backlog count stops increasing
- unresolved backlog is zero or explicitly bounded with scheduled retries
- settled markets stay quarantined or reduce-only until the backlog clears

## Escalation

Escalate if:

- claims remain blocked after backend recovery
- losing or refunded positions do not clear
- the same backlog item keeps failing without advancing `next_attempt_at`
- a protocol-level settlement invariant appears broken

## Evidence To Capture

- affected market refs and duel keys
- before/after lifecycle payloads
- user-facing claim errors
- on-chain tx refs or failed receipts
- SQL snapshots for `claim_backlog`, `outbox`, and affected `orders`
- logs showing backlog sweep attempts, backoff decisions, and final resolution
- backlog-drain drill artifact set with timestamps for first detection, first retry, and final drain
