# Quote Disablement And Safe Restart

## Symptoms

- MM quotes are stale, crossed, or obviously out of line with duel state
- `/api/keeper/bot-health` shows repeated failures, drawdown halts, or persistent restart loops
- `/status` is healthy but quote state is not converging

## Detection

```bash
curl -fsSL "$KEEPER_URL/status" | jq
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
curl -fsSL "$KEEPER_URL/api/arena/prediction-markets/active" | jq
bun run --cwd packages/market-maker-bot verify:chains
psql "$MM_DATABASE_URL" -c "select status, count(*) from orders group by 1 order by 1;"
psql "$MM_DATABASE_URL" -c "select cursor_key, cursor_value, updated_at from reconciliation_cursors order by updated_at desc limit 10;"
psql "$MM_DATABASE_URL" -c "select backlog_key, status, attempts, next_attempt_at, last_error from claim_backlog where status <> 'RESOLVED' order by next_attempt_at asc limit 20;"
```

## Immediate Containment

1. Stop the external MM bot process for the affected chain set.
2. If the keeper bot is contributing bad liquidity, restart the keeper with bot execution disabled or paused by env/config.
3. Do not reopen quote traffic until `/api/keeper/bot-health` reports coherent market state and no active recovery reason.
4. Preserve the current `orders`, `reconciliation_cursors`, `claim_backlog`, and `outbox` rows before any restart drill or manual cleanup.

## Recovery Steps

1. Verify RPC and chain reachability with `verify:chains`.
2. Confirm the durable store is reachable and bootstrapped:
   ```bash
   bun run --cwd packages/market-maker-bot storage:migrate
   psql "$MM_DATABASE_URL" -c "select order_key, chain_key, duel_key, status, last_seen_on_chain_at, last_reconciled_at from orders order by placed_at desc limit 20;"
   psql "$MM_DATABASE_URL" -c "select id, topic, status, attempts, available_at, last_error from outbox order by available_at asc limit 20;"
   ```
3. Confirm canonical lifecycle state on `/api/arena/prediction-markets/active` and capture the on-chain open-order snapshot for the affected markets.
4. Restart the keeper service and wait for:
   - `/status.ok == true`
   - `/api/keeper/bot-health.ok == true`
   - market records present for the affected chain
   - logs show startup reconciliation completed or quarantined the mismatched markets
5. Restart the external MM bot only after keeper health is stable, the store snapshot matches chain truth, and any ambiguous markets are still quarantined or reduce-only.
6. Re-check that quote state, persisted order state, and lifecycle state agree:
   ```bash
   curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
   psql "$MM_DATABASE_URL" -c "select status, count(*) from orders group by 1 order by 1;"
   psql "$MM_DATABASE_URL" -c "select backlog_key, status, attempts, last_error from claim_backlog where status <> 'RESOLVED' order by next_attempt_at asc limit 20;"
   ```

## Success Criteria

- `/status` is healthy
- `/api/keeper/bot-health` shows coherent market state with no unresolved recovery reason
- canonical prediction-market records are present and not regressing
- quotes resume only on open markets
- persisted `orders` rows reflect the post-reconciliation chain truth
- orphan orders are cancelled or explicitly quarantined before quote resume
- unresolved claim backlog is zero or intentionally bounded with visible retry state

## Escalation

Escalate if:

- repeated restart loops continue after quote disablement
- the keeper recreates or duplicates market state
- claimability or lifecycle status diverges after restart
- store rows cannot be reconciled with on-chain open orders or positions
- quote resume would require bypassing quarantine or reduce-only protections

## Evidence To Capture

- `/status` payload
- `/api/keeper/bot-health` payload
- `/api/arena/prediction-markets/active` payload
- SQL snapshots for `orders`, `reconciliation_cursors`, `claim_backlog`, and `outbox`
- MM boot logs showing durable-store bootstrap plus reconciliation decisions
- before/after open-order snapshots for each affected chain
- restart-drill artifact bundle with timestamps for stop, restart, reconciliation complete, and quote resume
- MM bot logs
- keeper logs
