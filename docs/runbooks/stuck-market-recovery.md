# Stuck Market Recovery

## Symptoms

- market remains `OPEN`, `LOCKED`, or `UNKNOWN` after the authoritative duel has advanced
- claim UI is unavailable even though settlement should be final
- `/api/arena/prediction-markets/active` disagrees with on-chain state

## Detection

```bash
curl -fsSL "$KEEPER_URL/api/arena/prediction-markets/active" | jq
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
curl -fsSL "$KEEPER_URL/status" | jq
```

If the issue is ambiguous, run the closest simulation or runtime smoke for the affected chain:

```bash
bun run --cwd packages/simulation-dashboard scenario canonical <scenario-id>
bun run --cwd packages/market-maker-bot smoke:runtime -- --chain <bsc|base|avax>
```

## Immediate Containment

1. Disable quoting on the affected market.
2. Do not force user-facing settlement changes until chain state and keeper state are both inspected.

## Recovery Steps

1. Identify whether the failure is market ensure, sync, resolve, or claim cleanup.
2. Restart the keeper and confirm it rebuilds the canonical lifecycle record.
3. If the keeper remains stale, use the appropriate local or staging reproduction flow before touching production state.
4. Re-run health checks and confirm market state converges before restoring quote traffic.

## Success Criteria

- canonical lifecycle state matches authoritative chain state
- claimability becomes available when expected
- no duplicate market creation or settlement side effects appear

## Escalation

Escalate if:

- the keeper cannot reconcile after restart
- lifecycle records regress after briefly recovering
- manual intervention would require contract or program changes

## Evidence To Capture

- prediction-markets payload before and after restart
- bot-health snapshot
- relevant tx refs or signatures
- keeper logs around ensure/sync/resolve
