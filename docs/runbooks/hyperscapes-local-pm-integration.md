# Hyperscapes Local PM Integration

This is the local integration path for prediction markets against the real
Hyperscapes duel stack. It does **not** seed synthetic markets and it does
**not** treat the game server as the Hyperbet API.

For this local runner, skipping Hyperscapes local MUD chain bootstrap is
intentional. Hyperbet consumes the duel telemetry API from Hyperscapes, not the
sibling repo's local anvil world. The runner also defaults the duel server to
development mode so local smoke does not fail on production-only JWT boot
requirements.

## Architecture

1. Hyperscapes is the duel event source.
   - local game/server stack serves `GET /api/streaming/state`
   - duel lifecycle comes from the running game

2. Hyperbet keeper is the bridge layer.
   - polls the Hyperscapes streaming endpoint
   - optionally runs the keeper bot internally
   - exposes:
     - `/status`
     - `/api/streaming/state`
     - `/api/streaming/state/events`
     - `/api/arena/prediction-markets/active`

3. Hyperbet UI points at the keeper service, not directly at the game server.
   - `VITE_GAME_API_URL=http://127.0.0.1:8080`
   - `VITE_GAME_WS_URL=ws://127.0.0.1:5555/ws`

This split is required because the Hyperscapes server provides duel telemetry,
while the keeper service provides prediction-market state.

## Scope

The truthful local integrated lifecycle today is:

- open
- lock
- resolve

The current game client and generic EVM keeper path do **not** yet model local
duel cancellation as a first-class path.

## Local Duel Preconditions

The local Hyperscapes server can be healthy and still remain in `IDLE` forever
if it has no duel agents available. That is the default state on a fresh local
database.

The minimum viable local duel setup is:

1. Start Hyperscapes in local integration mode:

```bash
bash scripts/run-hyperscapes-pm-local.sh
```

2. If `/api/streaming/state` stays `IDLE`, create two local agent characters in
   the sibling Hyperscapes repo:

```bash
curl http://127.0.0.1:5555/api/characters/db \
  -X POST \
  -H 'content-type: application/json' \
  --data '{"accountId":"local-agent-account-a","name":"Local Agent A","isAgent":true}'

curl http://127.0.0.1:5555/api/characters/db \
  -X POST \
  -H 'content-type: application/json' \
  --data '{"accountId":"local-agent-account-b","name":"Local Agent B","isAgent":true}'
```

3. Start those agents through the sibling repo's intended embedded-agent route:

```bash
curl http://127.0.0.1:5555/api/agents/<agent-id>/start -X POST
curl http://127.0.0.1:5555/api/agents/<agent-id>/start -X POST
```

4. Confirm the duel has left `IDLE`:

```bash
curl http://127.0.0.1:5555/api/streaming/state
curl http://127.0.0.1:8080/api/streaming/state
curl http://127.0.0.1:8080/api/arena/prediction-markets/active
```

If you already have model-provider keys configured in Hyperscapes, model-agent
spawning can also satisfy this requirement. The important point is simpler: the
streaming duel scheduler needs at least two available agents, or no duel cycle
will ever start.

## Authority Model

There are two separate wallet classes:

1. Local smoke trader wallets
   - used by the UI for order placement and claims
   - private keys stay local under `keys/local-smoke/`
   - public addresses are tracked in
     [local-smoke-wallets.json](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/docs/release/evidence/local-smoke-wallets.json)
   - GitHub can fund them through
     [fund-local-smoke-wallets.yml](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/.github/workflows/fund-local-smoke-wallets.yml)

2. Keeper writer wallets
   - required for deployed testnet market automation
   - EVM requires existing `REPORTER`, `MARKET_OPERATOR`, and `FINALIZER`
     authority
   - new post-deploy EVM writer wallets cannot be granted those roles because
     the contracts freeze the governance surface after deployment
   - therefore local duel -> deployed market automation requires the existing
     writer keys to be available locally, or a separate remote writer service

## Local Run

From the Hyperbet repo root:

```bash
bash scripts/run-hyperscapes-pm-local.sh
```

Defaults:

- Hyperscapes game/server: `http://127.0.0.1:5555`
- Hyperbet keeper service: `http://127.0.0.1:8080`
- Hyperbet EVM app: `http://127.0.0.1:4179`
- EVM keeper chain scope: `bsc,avax`
- Hyperscapes chain bootstrap: skipped
- Hyperscapes node env: `development`

The script:

1. starts the sibling Hyperscapes duel stack with Hyperbet disabled there
2. starts the local Hyperbet EVM keeper service against
   `http://127.0.0.1:5555/api/streaming/state`
3. starts the local Hyperbet EVM app pointed at the keeper service
4. opens both local UIs by default:
   - Hyperscapes stream UI: `http://127.0.0.1:3333/stream.html`
   - Hyperbet EVM UI: `http://127.0.0.1:4179`
5. starts a background capture helper that records JSON state plus paired UI
   screenshots into:
   - `output/playwright/hyperscapes-pm-local/<timestamp>/`

The capture helper records key incidences automatically:

- initial stack-up
- duel key change
- duel phase change
- first populated `markets[]`
- market-status changes
- final snapshot when the runner is stopped

## Optional Local Env

The runner auto-loads these gitignored local env files when present:

- `/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/.env.stage-a.testnet.local`
- `/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/.env.testnet.local`
- `/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/packages/hyperbet-evm/keeper/.env`
- `/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/packages/hyperbet-evm/app/.env.local`

Relevant writer env names:

- `EVM_REPORTER_PRIVATE_KEY`
- `EVM_MARKET_OPERATOR_PRIVATE_KEY`
- `EVM_FINALIZER_PRIVATE_KEY`
- `TESTNET_REPORTER_PRIVATE_KEY`
- `TESTNET_MARKET_OPERATOR_PRIVATE_KEY`
- `TESTNET_FINALIZER_PRIVATE_KEY`
- fallback: `EVM_KEEPER_PRIVATE_KEY`

If these are missing, the integrated stack still boots, but local duel events
cannot open and resolve deployed BSC/AVAX markets. In that case the runner
defaults `ENABLE_KEEPER_BOT=false` so the read path stays clean.

Useful overrides:

```bash
ENABLE_KEEPER_BOT=true bash scripts/run-hyperscapes-pm-local.sh
HYPERSCAPES_SKIP_CHAIN_SETUP=false bash scripts/run-hyperscapes-pm-local.sh
HYPERSCAPES_DUEL_NODE_ENV=production JWT_SECRET=... bash scripts/run-hyperscapes-pm-local.sh
OPEN_LOCAL_UI=false bash scripts/run-hyperscapes-pm-local.sh
CAPTURE_LOCAL_UI_FLOW=false bash scripts/run-hyperscapes-pm-local.sh
```

## Acceptance

Minimum healthy local integrated state:

1. `GET http://127.0.0.1:5555/api/streaming/state` returns live duel state.
2. `GET http://127.0.0.1:8080/status` returns keeper health.
3. `GET http://127.0.0.1:8080/api/arena/prediction-markets/active` returns
   prediction-market state.
4. `http://127.0.0.1:4179` loads with duel telemetry from Hyperscapes and
   prediction markets from the keeper service.
5. With writer authority present locally, a live duel should drive:
   - market open
   - market lock
   - oracle proposal/finalization
   - claimable resolved state

6. If local writer authority is intentionally absent, the truthful expected
   state is:
   - live duel state visible in keeper and UI
   - empty `markets[]` on `/api/arena/prediction-markets/active`
   - `ENABLE_KEEPER_BOT=false`
7. The local evidence bundle contains paired Hyperscapes and Hyperbet UI
   screenshots plus the backing keeper/game JSON for each captured incidence.
