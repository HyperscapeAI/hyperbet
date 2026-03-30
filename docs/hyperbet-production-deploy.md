# Hyperbet Production Deploy (Cloudflare + Railway)

> **TL;DR:** This is the production and staged topology for the phase-1 launch product. Launch-blocking chains are `Solana`, `BSC`, and `AVAX`; `Base` remains a non-blocking add-chain lane. The deployment topology is in place, but as of 2026-03-25 real staged proof and soak remain blocked because GitHub does not yet have a provisioned `staging` environment or the required `HYPERBET_*_STAGING_*` vars and secrets.

This is the recommended production topology for the Hyperbet stack in this repo.

Operator runbooks are in [docs/runbooks/README.md](runbooks/README.md).

- Primary frontend (`packages/hyperbet-solana/app`): Cloudflare Pages (`hyperbet.win`)
- Secondary frontends (`packages/hyperbet-bsc/app`, `packages/hyperbet-avax/app`): dedicated Pages project or subdomain per chain
- Primary betting API (`packages/hyperbet-solana/keeper`): Railway
- Secondary betting APIs (`packages/hyperbet-bsc/keeper`, `packages/hyperbet-avax/keeper`): dedicated Railway services if you split by chain
- Live duel/stream source (`packages/server` or Vast duel stack): separate upstream that the keeper polls
- DDoS/WAF/edge cache: Cloudflare proxy in front of the betting API
- Contracts/state: Solana + EVM (configured by env vars below, proxied server-side)

Production rollout is still blocked until canonical launch-chain deployment
truth exists in the shared chain registry for `Solana`, `BSC`, and `AVAX`,
staged proof artifacts are captured for the target environment, and the real
governance and operator wallets are provisioned.

## Staging Rail

The repo also supports a manual staging rail for Solana, BSC, and AVAX without
changing the production topology:

- staged Solana Pages + staged Solana keeper
- staged BSC Pages + staged BSC keeper
- staged AVAX Pages + staged AVAX keeper
- external staged duel/stream source

Manual staging deploys use the same workflows as production through
`workflow_dispatch`:

- `Deploy Hyperbet Solana Pages`
- `Deploy Hyperbet Solana Keeper`
- `Deploy Hyperbet BSC Pages`
- `Deploy Hyperbet BSC Keeper`
- `Deploy Hyperbet AVAX Pages`
- `Deploy Hyperbet AVAX Keeper`

Select `environment=staging` when dispatching the relevant workflow.

Current audited GitHub state:

- repo-level deploy and testnet secrets exist
- no GitHub `staging` environment exists yet
- no `HYPERBET_*_STAGING_*` vars or secrets are provisioned yet
- BSC/AVAX auto-deploy flags can now be split per surface with `HYPERBET_*_PAGES_DEPLOY_ENABLED` and `HYPERBET_*_KEEPER_DEPLOY_ENABLED`; the older shared `HYPERBET_*_DEPLOY_ENABLED` vars remain as a fallback

That means the code path is ready, but staged proof and staged soak remain
operationally blocked until staging is provisioned.

Required staging vars are:

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
- `HYPERBET_AVAX_STAGING_CHAIN_ID`
- `HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS`

Required staged proof vars/secrets used by the launch-scope proof rail:

- `HYPERBET_STAGED_PROOF_DUEL_ID`
- `HYPERBET_STAGED_PROOF_DUEL_KEY`
- `HYPERBET_SOLANA_STAGING_CLUSTER`
- `HYPERBET_SOLANA_STAGING_RPC_URL`
- `HYPERBET_SOLANA_STAGING_GOLD_CLOB_PROGRAM_ID`
- `HYPERBET_SOLANA_STAGING_GOLD_AMM_PROGRAM_ID`
- `HYPERBET_SOLANA_STAGING_GOLD_PERPS_PROGRAM_ID`
- `HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY`
- `HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR`
- `HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR`
- `HYPERBET_BSC_STAGING_RPC_URL`
- `HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY`
- `HYPERBET_BSC_STAGING_CANARY_PRIVATE_KEY`
- `HYPERBET_BSC_STAGING_ADMIN_PRIVATE_KEY`
- `HYPERBET_BSC_STAGING_MARKET_OPERATOR_PRIVATE_KEY`
- `HYPERBET_BSC_STAGING_DUEL_ORACLE_ADDRESS`
- `HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS`
- `HYPERBET_BSC_STAGING_GOLD_AMM_ROUTER_ADDRESS`
- `HYPERBET_BSC_STAGING_MUSD_TOKEN_ADDRESS`
- `HYPERBET_BSC_STAGING_GOLD_TOKEN_ADDRESS`
- `HYPERBET_BSC_STAGING_SKILL_ORACLE_ADDRESS`
- `HYPERBET_BSC_STAGING_PERP_ENGINE_ADDRESS`
- `HYPERBET_BSC_STAGING_STREAM_PUBLISH_KEY`
- `HYPERBET_AVAX_STAGING_RPC_URL`
- `HYPERBET_AVAX_STAGING_REPORTER_PRIVATE_KEY`
- `HYPERBET_AVAX_STAGING_CANARY_PRIVATE_KEY`
- `HYPERBET_AVAX_STAGING_ADMIN_PRIVATE_KEY`
- `HYPERBET_AVAX_STAGING_MARKET_OPERATOR_PRIVATE_KEY`
- `HYPERBET_AVAX_STAGING_DUEL_ORACLE_ADDRESS`
- `HYPERBET_AVAX_STAGING_GOLD_CLOB_ADDRESS`
- `HYPERBET_AVAX_STAGING_GOLD_AMM_ROUTER_ADDRESS`
- `HYPERBET_AVAX_STAGING_MUSD_TOKEN_ADDRESS`
- `HYPERBET_AVAX_STAGING_GOLD_TOKEN_ADDRESS`
- `HYPERBET_AVAX_STAGING_SKILL_ORACLE_ADDRESS`
- `HYPERBET_AVAX_STAGING_PERP_ENGINE_ADDRESS`
- `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY`
- `HYPERBET_AVAX_RAILWAY_STAGING_PROJECT_ID`
- `HYPERBET_AVAX_RAILWAY_STAGING_ENVIRONMENT_ID`
- `HYPERBET_AVAX_RAILWAY_STAGING_KEEPER_SERVICE_ID`

AVAX rollout remains blocked until canonical deployment truth exists in the shared chain registry and the effective AVAX wallet/signer set is in place. The staging/prod rail is present so proof and release packaging can use one consistent contract once those addresses are committed.

## 1) Deploy the keeper to Railway

From repo root, deploy the keeper service path:

```bash
railway up packages/hyperbet-solana --path-as-root -s gold-betting-keeper
```

Use `packages/hyperbet-solana/railway.json`.

Set these Railway variables at minimum:

- `NODE_ENV=production`
- `PORT=8080` (or let Railway inject its port if you proxy through the service domain)
- `STREAM_STATE_SOURCE_URL=https://your-stream-source.example/api/streaming/state`
- `STREAM_STATE_SOURCE_BEARER_TOKEN=...` if the upstream streaming state is protected
- `ARENA_EXTERNAL_BET_WRITE_KEY=...`
- `STREAM_PUBLISH_KEY=...` if you use `/api/streaming/state/publish`
- `SOLANA_CLUSTER=mainnet-beta`
- `SOLANA_RPC_URL=...`
- `BSC_RPC_URL=...`
- `BSC_GOLD_CLOB_ADDRESS=...`
- `BASE_RPC_URL=...`
- `BASE_GOLD_CLOB_ADDRESS=...`
- `AVAX_RPC_URL=...` for AVAX keeper/runtime support after canonical registry values exist
- `BIRDEYE_API_KEY=...` if token-price proxying is enabled

Persistence:

- The keeper defaults to a local SQLite file (`KEEPER_DB_PATH=./keeper.sqlite`).
- On Railway that file is ephemeral unless you attach a persistent volume or move the keeper state to an external database.
- Do not treat points history, referrals, or oracle history as durable unless persistence is configured explicitly.

Notes:

- The keeper serves the Pages app's read/write betting APIs. It is not the same process as the Hyperscape duel server.
- The keeper also proxies Solana and EVM JSON-RPC for the public app. Keep provider-keyed RPC URLs on Railway, not in Cloudflare Pages build vars.
- The keeper now keeps a short in-memory cache for read-only RPC and Birdeye proxy traffic. Tune it with `RPC_PROXY_CACHE_MAX_ENTRIES`, `RPC_PROXY_CACHE_MAX_PAYLOAD_BYTES`, and `BIRDEYE_PRICE_CACHE_TTL_MS` if needed.
- The keeper will return boot fallback duel data until `STREAM_STATE_SOURCE_URL` is set and the upstream duel server responds.
- The autonomous keeper bot also needs a funded signer wallet on Solana to create/resolve markets in production.

## 2) Deploy the live duel server / stream source

This can be the Railway `hyperscape` service or the Vast.ai duel stack. It must expose:

- `/api/streaming/state`
- `/api/streaming/duel-context`
- `/api/streaming/rtmp/status`
- `/live/stream.m3u8`

If you run the Vast.ai stack, verify it before pointing the keeper at it:

```bash
./scripts/check-streaming-status.sh http://127.0.0.1:5555
```

## 3) Put the betting API behind Cloudflare

1. Create `api.yourdomain.com` in Cloudflare DNS and point it to the keeper Railway target.
2. Enable Cloudflare proxy (orange cloud) for `api.yourdomain.com`.
3. Add WAF rate-limit rules:
- `POST /api/arena/bet/record-external`
- `POST /api/arena/deposit/ingest`
- `/api/arena/points/*`
4. Keep the direct Railway URL private if you introduce a public API domain.

## 4) Deploy frontend to Cloudflare Pages

Project root:

- `packages/hyperbet-solana/app`

Build/output:

- Build command: `bun install && bun run build --mode mainnet-beta`
- Output directory: `dist`

Frontend env vars (Cloudflare Pages):

- `VITE_GAME_API_URL=https://api.yourdomain.com`
- `VITE_GAME_WS_URL=wss://api.yourdomain.com/ws` if the keeper exposes websocket features you use
- `VITE_SOLANA_CLUSTER=mainnet-beta` (or testnet/devnet)
- `VITE_USE_GAME_RPC_PROXY=true`
- `VITE_USE_GAME_EVM_RPC_PROXY=true`
- `VITE_BSC_GOLD_CLOB_ADDRESS` / `VITE_BASE_GOLD_CLOB_ADDRESS`
- `VITE_BSC_GOLD_TOKEN_ADDRESS` / `VITE_BASE_GOLD_TOKEN_ADDRESS`
- `VITE_STREAM_SOURCES=https://your-hls-or-embed-source,...`

Do not set provider-keyed values in any `VITE_*RPC_URL` variable for production builds. The betting app build fails intentionally if a public RPC URL looks like a Helius / Alchemy / Infura / QuickNode / dRPC secret endpoint.

Do not treat `packages/hyperbet-avax/deployments/contracts.json` as production deployment truth. The shared chain registry is the canonical production source, and AVAX rollout must stay blocked until that registry is populated with real addresses.

Cloudflare Pages headers/SPA rules are already added in:

- `packages/hyperbet-solana/app/public/_headers`
- `packages/hyperbet-solana/app/public/_redirects`

Deployment metadata:

- `build-info.json` is emitted into `dist/` on every build and should be served with `Cache-Control: no-store`.
## 5) Verify production

Health:

- `https://api.yourdomain.com/status`
- `https://bet.yourdomain.com`
- `https://api.yourdomain.com/api/streaming/state`
- `https://api.yourdomain.com/api/streaming/duel-context`
- `https://api.yourdomain.com/api/perps/markets`
- `https://api.yourdomain.com/api/proxy/evm/rpc?chain=bsc` (POST JSON-RPC smoke test)
- `https://bet.yourdomain.com/build-info.json`

Repo-backed checks from repo root:

```bash
./scripts/check-streaming-status.sh https://your-stream-source.example
bun run --cwd packages/hyperbet-solana build:mainnet
```

## 6) Run staged live proof

Use the manual `Staged Live Proof` workflow or the repo wrapper:

```bash
bun run staged:proof -- --mode=read-only --target=all
bun run staged:proof -- --mode=canary-write --target=solana
bun run staged:proof -- --mode=canary-write --target=bsc
bun run staged:proof -- --mode=canary-write --target=avax
```

The proof wrapper captures:

- Pages `build-info.json`
- keeper `/status`
- `/api/arena/prediction-markets/active`
- `/api/keeper/bot-health`
- stream-state and duel-context payloads
- Solana and BSC proxy proof
- Solana, BSC, and AVAX canary tx hashes/signatures when `mode=canary-write`
- `verify:chains` output
- AVAX staging env-audit output

This is a manual operator proof rail. It should not be treated as complete
until a real staged run passes end to end and the artifacts are reviewed.

## 7) Security notes

- Do not expose `ARENA_EXTERNAL_BET_WRITE_KEY` in public frontend env vars.
- Do not ship provider-keyed RPC URLs in public frontend env vars. Keep them on Railway and let the keeper proxy them.
- Rotate all secrets before production if they were ever committed/shared.
- Keep `DISABLE_RATE_LIMIT` unset in production.
