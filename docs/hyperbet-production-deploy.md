# Hyperbet Solana Deployment

This runbook covers the v1 Solana deployment only. Deployment is not approval to launch real-value wagering; legal, compliance, security-audit, incident-response, and operational sign-offs remain independent gates.

## Topology

- Cloudflare Pages serves `packages/hyperbet-solana/app`.
- Railway serves the read-only HTTP/streaming service from `packages/hyperbet-solana/keeper`.
- The separately operated `duel-bot` process consumes Hyperia's authenticated schema-v3 betting feed and performs authorized Solana lifecycle work.
- `deployments/solana-v1.json` is the canonical program registry.
- The only launch programs are `fight_oracle` and `duel_market`.

## Active workflows

- `deploy-solana-pages.yml`: builds, scans, deploys, and verifies Pages metadata.
- `deploy-solana-keeper.yml`: audits configuration, runs the launch keeper suite, proves retired routes return 404, stages only the Solana keeper workspace, deploys, and waits for `/ready`.
- `deploy-testnet-v3.yml`: manual, explicitly confirmed two-program devnet deployment and frozen configuration.

There is no automatic on-chain production deployment workflow.

## Pages configuration

Required GitHub variables depend on the selected environment:

- `HYPERBET_SOLANA_PAGES_PROJECT_NAME`
- `HYPERBET_SOLANA_PAGES_PRODUCTION_URL`
- `HYPERBET_SOLANA_KEEPER_URL`
- `HYPERBET_SOLANA_KEEPER_WS_URL`
- corresponding `*_STAGING_*` values for staging

Required secret:

- `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_WRANGLER_CONFIG_B64`

The build sets `VITE_SOLANA_CLUSTER=mainnet-beta` and routes RPC through the keeper. Provider credentials must never be placed in public build variables.

## Keeper configuration

Deployment routing requires the configured Railway project, environment, service, public URL, and `RAILWAY_TOKEN`. Runtime configuration is documented in [`packages/hyperbet-solana/keeper/.env.example`](../packages/hyperbet-solana/keeper/.env.example).

Production must provide:

- canonical HTTPS `STREAM_STATE_SOURCE_URL`
- Solana RPC/provider configuration
- explicit expected upgrade authorities for both programs
- lifecycle-index deployment start slot
- fail-closed readiness thresholds
- database persistence

The HTTP service must not receive any keeper/config private key. Automated writer keys belong only to the separately operated duel keeper and must use distinct identities for fee payer, reporter, finalizer, market operator, and liquidity provider. The challenger is public-only.

## On-chain configuration

Before any deployment or initialization:

```bash
bun run ci:gate:registry:launch
bun run ci:scope:solana
bun run --cwd packages/hyperbet-solana deploy:preflight:mainnet
```

Initialization requires explicit role public keys, approved economics, an approved dispute window, an expected upgrade authority, and explicit freeze approval. Mainnet refuses initialization without `--freeze`.

Required approval/configuration fields include:

- `SOLANA_LAUNCH_FEE_POLICY_APPROVED=true`
- `SOLANA_LAUNCH_CONFIG_FREEZE_APPROVED=true`
- `SOLANA_ORACLE_DISPUTE_WINDOW_SECS`
- `TRADE_TREASURY_FEE_BPS`
- `TRADE_MARKET_MAKER_FEE_BPS`
- `WINNINGS_MARKET_MAKER_FEE_BPS`
- every `SOLANA_PM_*_PUBKEY` role
- exact program upgrade-authority expectations

No production economics have a code default.

## Promotion checks

Do not promote until all of these pass on the exact release SHA:

```bash
bun run ci:env
bun run ci:scope:solana
bun run ci:gate:registry:launch
bun run ci:gate:solana:build
bun run ci:gate:solana
bun run ci:gate:e2e:solana
bun run ci:prepr
```

Then verify the deployed services:

- Pages `build-info.json` matches the release SHA.
- `/ready` returns HTTP 200 with `readiness.ready=true`.
- `/status` identifies the Solana backend.
- the canonical stream and active prediction-market endpoints agree on duel identity.
- bot health reports the Solana runtime and no recovery blockers.
- disabled product and alternate-runtime routes return HTTP 404.
- no source map or provider credential is present in the production bundle.

Rollback the app/service release if readiness, source freshness, parser freshness, program identity, database checks, market recovery, or lifecycle indexing becomes unsafe. Pause quoting and privileged writes before attempting state repair.
