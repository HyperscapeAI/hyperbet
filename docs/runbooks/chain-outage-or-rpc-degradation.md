# Chain Outage Or RPC Degradation

## Symptoms

- RPC proxy failures or repeated network errors
- keeper health remains up but market sync stalls
- bot health reports recovery or halt reasons tied to RPC lag

## Detection

```bash
curl -fsSL "$KEEPER_URL/status" | jq '.proxies'
curl -fsSL "$KEEPER_URL/api/keeper/bot-health" | jq
bun run --cwd packages/market-maker-bot verify:chains
```

## Immediate Containment

1. Disable quoting on the affected chain.
2. Keep unaffected chains running if health remains coherent.
3. Avoid restarts until you know whether the issue is provider-side or service-local.

## Recovery Steps

1. Verify chain reachability with `verify:chains`.
2. Switch to a healthy RPC provider if the configured one is degraded.
3. Restart the keeper after RPC configuration is corrected.
4. Confirm `/status`, `/api/keeper/bot-health`, and `/api/arena/prediction-markets/active` all reconcile.
5. Re-enable quoting only after the chain-specific health path is stable.

## Success Criteria

- RPC checks succeed
- keeper health clears the recovery reason
- lifecycle state and market refs return to canonical values

## Escalation

Escalate if:

- the outage spans multiple providers
- open orders cannot be reconciled after recovery
- duplicate claim or ensure behavior appears after restart

## Evidence To Capture

- chain verification output
- keeper logs
- bot-health recovery fields
- provider error responses
