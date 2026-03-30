# AVAX Fuji Bootstrap Market Smoke

This runbook is for maintaining a fresh, tradable AVAX Fuji market for local and
testnet validation.

This workflow is Fuji-only sanity smoke and is not equivalent to production AVAX
canonicalization or launch proof completion.

## Scope

- validation of keeper/app/contract wiring on Fuji for the prediction-market path
- smoke workflow for a non-terminal open market and deterministic cleanup
- evidence bundle for proof-facing `avax-fuji-bootstrap` runs

## Preconditions

- funded Fuji wallets for:
  - reporter (`REPORTER_PRIVATE_KEY`)
  - market operator (`MARKET_OPERATOR_PRIVATE_KEY`)
  - canary trader (`CANARY_PRIVATE_KEY`)
  - matcher trader (`MATCHER_PRIVATE_KEY`, required for partial/full-match scenarios)
- reporter or operator key must hold `MARKET_OPERATOR_ROLE` on the Fuji GoldClob contract
- the script validates this role contract-side before creating markets
- keeper running at `http://127.0.0.1:5555`
- script is run from the repo root

## Required Environment Variables

- `AVAX_FUJI_RPC` or `AVAX_RPC_URL` (recommended: explicit override)
- `AVAX_DUEL_ORACLE_ADDRESS`
- `AVAX_GOLD_CLOB_ADDRESS`
- `KEEPER_URL` (default: `http://127.0.0.1:5555`, optional only when `--allow-defaults` is used)
- `REPORTER_PRIVATE_KEY`
- `MARKET_OPERATOR_PRIVATE_KEY`
- `CANARY_PRIVATE_KEY`
- `AVAX_FUJI_BOOTSTRAP_SCENARIO` (one of `unmatched-gtc`, `partial-match-gtc`, `full-match-gtc`, default: `unmatched-gtc`)
- `MATCHER_PRIVATE_KEY` or `AVAX_MATCHING_TRADER_PRIVATE_KEY` (required for partial/full match scenarios)
- `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY` (optional). When set, bootstrap uses keyed publishing and sends `x-arena-write-key`.

## Local-Only Defaults

For security posture, defaults are explicit-off by default. To run with baked-in test
defaults, pass either:

- `--allow-defaults`
- `AVAX_FUJI_ALLOW_DEFAULTS=1`

## Bootstrap Sequence

1. Start the AVAX keeper and required tooling.
2. From repo root, run:

```bash
cd "$(git rev-parse --show-toplevel)"
scenario=unmatched-gtc
AVAX_FUJI_RPC=https://avax-fuji.g.alchemy.com/... \
AVAX_DUEL_ORACLE_ADDRESS=0x... \
AVAX_GOLD_CLOB_ADDRESS=0x... \
AVAX_FUJI_BOOTSTRAP_SCENARIO=$scenario \
KEEPER_URL=http://127.0.0.1:5555 \
REPORTER_PRIVATE_KEY=0x... \
MARKET_OPERATOR_PRIVATE_KEY=0x... \
CANARY_PRIVATE_KEY=0x... \
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs | tee "./avax-fuji-bootstrap-${scenario}.json"
```

Use `.env` for optional publish key and scenario:

```bash
set -a
source /path/to/.env.avax-fuji-bootstrap
set +a
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs
```

3. If testing partial/full matching cleanup paths, set scenario keys explicitly:

```bash
scenario=partial-match-gtc
AVAX_FUJI_BOOTSTRAP_SCENARIO=partial-match-gtc \
MATCHER_PRIVATE_KEY=0x... \
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs | tee "./avax-fuji-bootstrap-${scenario}.json"

scenario=full-match-gtc
AVAX_FUJI_BOOTSTRAP_SCENARIO=full-match-gtc \
MATCHER_PRIVATE_KEY=0x... \
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs | tee "./avax-fuji-bootstrap-${scenario}.json"
```

4. Confirm output includes at least:
   - `publishMode=<keyed|unkeyed>`
   - `scenario=...`
   - `market is OPEN in keeper ...`
   - `orderId` in final JSON summary
   - `keeperLifecycle.open === "OPEN"`
   - `keeperLifecycle.cancelled === "CANCELLED"`
   - `finalState.order.active === false`
   - `finalState.position.hasResidual === false`
   - explicit `cancelOrderTx` when final active order is present
   - explicit `claimTx` when residual position was non-zero

## Acceptance Criteria

- script exits successfully with no exception.
- keeper sees the market `OPEN` after publish and `CANCELLED` after `syncMarketFromOracle`.
- final summary includes all required proof fields:
  - `upsertDuel`, `createMarketForDuel`, `placeOrder`
  - `cancelDuel`, `syncMarketFromOracle`, optional `cancelOrder`, optional `claim`
  - final `order` and `position` states
- `orderId` is captured and included.
- final order cleanup invariant:
  - `orders(...).active === false`
  - `positions(...): all fields === 0`
- claim is only skipped when both conditions are proven:
  - the placed order is no longer active
  - the canary position is already zero

## Scenario Matrix

- `unmatched-gtc`: only canary GTC order, then duel cancel + sync. Expect no filled exposure and no residual after cleanup.
- `partial-match-gtc`: place a 50% matching GTC maker order before cancel. Expect cancel handles residual order, then claim clears matched exposure.
- `full-match-gtc`: place full matching GTC order before cancel. Expect matched position remains, cancel step is optional, claim clears residual.
- `publish-mode`: set `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY` to confirm `publishMode=keyed`.

## Failure Drill

- if `openTs/closeTs` windows are invalid, rerun with a fresh `duelKey` (script generates new key automatically on each run)
- if publish mode fails unexpectedly, verify `HYPERBET_AVAX_STAGING_STREAM_PUBLISH_KEY` for keyed flow or rerun without the key for unkeyed flow
- if cleanup fails (`order active` or non-zero position), rerun after a fresh market cycle and verify role + balances for involved wallets

## Evidence Capture

- Save final stdout JSON for each scenario:
  - `avax-fuji-bootstrap-unmatched-gtc.json`
  - `avax-fuji-bootstrap-partial-match-gtc.json`
  - `avax-fuji-bootstrap-full-match-gtc.json`
- Keep proof packets with:
  - tx hashes for `upsertDuel`, `createMarketForDuel`, `placeOrder`, `cancelDuel`, `syncMarketFromOracle`, and optional `cancelOrder`/`claim`
  - lifecycle snapshots for `OPEN -> CANCELLED`
  - final `order`/`position` assertions proving cleanup
