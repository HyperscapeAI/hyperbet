# Staged Live Proof

> **TL;DR:** Staged proof is the launch-scope off-mainnet signoff lane for `PM`, `perps`, and internal `AMM` across `Solana`, `BSC`, and `AVAX`. The proof codepaths are merged, but as of 2026-03-25 the GitHub `staging` environment and `HYPERBET_*_STAGING_*` vars and secrets are still not provisioned, so live staged proof remains blocked on environment setup rather than missing repo code.

Use this runbook to execute the manual staging proof rail for phase-1 release
signoff.

This runbook does **not** change production topology. It validates the staged
Solana, BSC, and AVAX rails using the same deployed shape as production:

- staged Solana Pages + staged Solana keeper
- staged BSC Pages + staged BSC keeper
- staged AVAX Pages + staged AVAX keeper
- external staged duel/stream source
- keeper-proxied RPC
- launch-scope canary writes for `PM`, `perps`, and internal `AMM`

## Symptoms

- You need to prove that the staged prediction-market stack is healthy before a
  reviewer or operator sign-off.
- You need machine-readable evidence for staged build, keeper, lifecycle,
  proxy, env-audit, and launch-scope canary write behavior.

## Detection And Verification

Read-only proof surfaces:

- `https://<solana-pages>/build-info.json`
- `https://<solana-keeper>/status`
- `https://<solana-keeper>/api/arena/prediction-markets/active`
- `https://<solana-keeper>/api/keeper/bot-health`
- `https://<solana-keeper>/api/streaming/state`
- `https://<solana-keeper>/api/streaming/duel-context`
- `https://<bsc-pages>/build-info.json`
- `https://<bsc-keeper>/status`
- `https://<bsc-keeper>/api/arena/prediction-markets/active`
- `https://<bsc-keeper>/api/keeper/bot-health`
- `https://<avax-pages>/build-info.json`
- `https://<avax-keeper>/status`
- `https://<avax-keeper>/api/arena/prediction-markets/active`
- `https://<avax-keeper>/api/keeper/bot-health`

Repo-backed staging proof entrypoints:

```bash
bun run staged:proof -- --mode=read-only --target=all
bun run staged:proof -- --mode=canary-write --target=solana
bun run staged:proof -- --mode=canary-write --target=bsc
bun run staged:proof -- --mode=canary-write --target=avax
```

Each `canary-write` artifact now emits one nested result per chain:

- `pm`: controlled duel publish, market open, place/cancel/sync/claim cleanup
- `perps`: oracle update, bounded open, bounded close, zeroed position check
- `amm`: headless internal MM market create/discover, bounded trade, reserve delta

GitHub manual workflow:

- workflow: `Staged Live Proof`
- inputs:
  - `mode=read-only|canary-write`
  - `target=all|solana|bsc|avax`

Current blocker:

- the workflow is ready, but a real GitHub `staging` environment and the
  required `HYPERBET_*_STAGING_*` vars and secrets still need to be provisioned

## Immediate Containment

- If read-only proof fails, do **not** run canary writes.
- If canary-write fails on one chain, stop there and do not continue to the
  other chain until the failure is understood.
- If AVAX staging env audit fails, stop there and fix the staging contract
  before attempting canary writes.
- Staged proof is an off-mainnet launch rehearsal. It does **not** require
  canonical mainnet registry truth to exist first.

## Exact Recovery Steps

1. Confirm the staging deployments exist and point at the intended URLs.
   Required workflow inputs and vars:
   - `HYPERBET_SOLANA_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_SOLANA_PAGES_STAGING_URL`
   - `HYPERBET_SOLANA_KEEPER_STAGING_URL`
   - `HYPERBET_SOLANA_KEEPER_STAGING_WS_URL`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_SOLANA_RAILWAY_STAGING_KEEPER_SERVICE_ID`
   - `HYPERBET_BSC_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_BSC_PAGES_STAGING_URL`
   - `HYPERBET_BSC_KEEPER_STAGING_URL`
   - `HYPERBET_BSC_KEEPER_STAGING_WS_URL`
   - `HYPERBET_BSC_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_BSC_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_BSC_RAILWAY_STAGING_KEEPER_SERVICE_ID`
   - `HYPERBET_AVAX_PAGES_STAGING_PROJECT_NAME`
   - `HYPERBET_AVAX_PAGES_STAGING_URL`
   - `HYPERBET_AVAX_KEEPER_STAGING_URL`
   - `HYPERBET_AVAX_KEEPER_STAGING_WS_URL`
   - `HYPERBET_AVAX_RAILWAY_STAGING_PROJECT_ID`
   - `HYPERBET_AVAX_RAILWAY_STAGING_ENVIRONMENT_ID`
   - `HYPERBET_AVAX_RAILWAY_STAGING_KEEPER_SERVICE_ID`
2. Confirm proof vars and secrets are present in the staging environment:
   - `HYPERBET_SOLANA_STAGING_RPC_URL`
   - `HYPERBET_SOLANA_STAGING_CLUSTER` (default `devnet` if omitted)
   - `HYPERBET_SOLANA_STAGING_FIGHT_ORACLE_PROGRAM_ID` when staging does not use the canonical devnet oracle id
   - `HYPERBET_SOLANA_STAGING_GOLD_CLOB_PROGRAM_ID`
   - `HYPERBET_SOLANA_STAGING_GOLD_AMM_PROGRAM_ID`
   - `HYPERBET_SOLANA_STAGING_GOLD_PERPS_PROGRAM_ID`
   - `HYPERBET_BSC_STAGING_RPC_URL`
   - `HYPERBET_AVAX_STAGING_RPC_URL`
   - `HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_BSC_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY`
   - `HYPERBET_STAGED_PROOF_DUEL_ID`
   - `HYPERBET_STAGED_PROOF_DUEL_KEY`
   - `HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR`
   - `HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR`
   - `HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY`
   - `HYPERBET_BSC_STAGING_CANARY_PRIVATE_KEY`
   - `HYPERBET_BSC_STAGING_ADMIN_PRIVATE_KEY`
   - `HYPERBET_BSC_STAGING_MARKET_OPERATOR_PRIVATE_KEY` when distinct from the admin
   - `HYPERBET_BSC_STAGING_DUEL_ORACLE_ADDRESS`
   - `HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS`
   - `HYPERBET_BSC_STAGING_GOLD_AMM_ROUTER_ADDRESS`
   - `HYPERBET_BSC_STAGING_MUSD_TOKEN_ADDRESS`
   - `HYPERBET_BSC_STAGING_GOLD_TOKEN_ADDRESS`
   - `HYPERBET_BSC_STAGING_SKILL_ORACLE_ADDRESS`
   - `HYPERBET_BSC_STAGING_PERP_ENGINE_ADDRESS`
   - `HYPERBET_AVAX_STAGING_REPORTER_PRIVATE_KEY`
   - `HYPERBET_AVAX_STAGING_CANARY_PRIVATE_KEY`
   - `HYPERBET_AVAX_STAGING_ADMIN_PRIVATE_KEY`
   - `HYPERBET_AVAX_STAGING_MARKET_OPERATOR_PRIVATE_KEY` when distinct from the admin
   - `HYPERBET_AVAX_STAGING_DUEL_ORACLE_ADDRESS`
   - `HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS`
   - `HYPERBET_AVAX_STAGING_GOLD_AMM_ROUTER_ADDRESS`
   - `HYPERBET_AVAX_STAGING_MUSD_TOKEN_ADDRESS`
   - `HYPERBET_AVAX_STAGING_GOLD_TOKEN_ADDRESS`
   - `HYPERBET_AVAX_STAGING_SKILL_ORACLE_ADDRESS`
   - `HYPERBET_AVAX_STAGING_PERP_ENGINE_ADDRESS`
   - `HYPERBET_AVAX_STAGING_CHAIN_ID`
3. Pre-fund the canary wallets with native gas and the reused staging tokens they need:
   - Solana canary keypair needs SOL for PM/perps/AMM writes
   - BSC canary wallet needs native gas plus `mUSD` and the perps margin token
   - AVAX canary wallet needs native gas plus `mUSD` and the perps margin token
   - BSC/AVAX admin and market-operator wallets need native gas, and the admin wallet must hold enough `mUSD` to seed one AMM canary market
4. Run `read-only` proof first.
5. If read-only succeeds, run `canary-write` separately for Solana, BSC, and
   AVAX.
6. Inspect the generated artifact bundle:
   - `.ci-artifacts/staged-live-proof/summary.json`
   - `solana/*`
   - `bsc/*`
   - `avax/*`
   - `verify-chains.json`
7. If a chain fails:
   - collect the failing payloads and tx hashes/signatures
   - verify the staged duel source and keeper `/status`
   - verify the keeper proxy paths
   - verify the canary, admin, and operator wallet funds

## Success Criteria

- Solana read-only proof passes.
- BSC read-only proof passes.
- AVAX read-only proof passes.
- Solana canary write proof completes for `pm`, `perps`, and `amm`.
- BSC canary write proof completes for `pm`, `perps`, and `amm`.
- AVAX canary write proof completes for `pm`, `perps`, and `amm`.
- `verify:chains` passes for Solana, BSC, and AVAX.
- AVAX staging app and keeper env audits pass.

## Escalation Criteria

- `build-info.json` does not match the deployed commit.
- `/status` is not healthy on a staged keeper.
- `/api/arena/prediction-markets/active` or `/api/keeper/bot-health` is
  inconsistent with the expected staged duel.
- A `pm`, `perps`, or `amm` canary tx lands on chain but the expected runtime
  state transition never appears.
- Claim/refund does not clear PM state after controlled cancel/resolve.
- A perps canary position does not close back to zero.
- An AMM canary trade does not move reserves or mint inventory to the canary wallet.
- AVAX staging env audit fails or points at the wrong chain or contract.

## Evidence To Capture Before Escalation

- full `summary.json` artifact
- the per-chain JSON payloads under `solana/`, `bsc/`, and `avax/`
- the per-surface canary artifacts under `solana/canary.*.json`, `bsc/canary.*.json`, and `avax/canary.*.json`
- tx signatures/hashes for the canary writes
- `verify-chains.json`
- `avax/env-audit.json`
- staging deploy workflow run URLs
