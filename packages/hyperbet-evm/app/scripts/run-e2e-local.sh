#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVM_PKG_DIR="$(cd "$APP_DIR/.." && pwd)"
KEEPER_DIR="$EVM_PKG_DIR/keeper"
CONTRACTS_DIR="$(cd "$EVM_PKG_DIR/../evm-contracts" && pwd)"
SOLANA_APP_DIR="$(cd "$EVM_PKG_DIR/../hyperbet-solana/app" && pwd)"
SOLANA_ANCHOR_DIR="$(cd "$EVM_PKG_DIR/../hyperbet-solana/anchor" && pwd)"
BUN_BIN="${BUN_BIN:-}"
BUNX_BIN="${BUNX_BIN:-}"
APP_PORT="${E2E_APP_PORT:-4181}"
GAME_API_PORT="${E2E_GAME_API_PORT:-5555}"
GAME_API_URL="http://127.0.0.1:${GAME_API_PORT}"
ANVIL_PORT="${E2E_EVM_PORT:-18545}"
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EVM_CHAIN_ID="${E2E_EVM_CHAIN_ID:-31337}"
E2E_ARENA_WRITE_KEY="${E2E_ARENA_WRITE_KEY:-hyperbet-e2e-local-write-key}"
KEEPER_DB_PATH="${E2E_KEEPER_DB_PATH:-$APP_DIR/.e2e-keeper.sqlite}"
ANVIL_LOG="$APP_DIR/.e2e-anvil.log"
KEEPER_LOG="$APP_DIR/.e2e-keeper.log"
APP_LOG="$APP_DIR/.e2e-app.log"
VALIDATOR_LOG="$APP_DIR/.e2e-solana-validator.log"
SOLANA_PROXY_LOG="$APP_DIR/.e2e-solana-proxy.log"
RUN_LOCK_DIR="$APP_DIR/.e2e-run.lock"
RUN_LOCK_PID_FILE="$RUN_LOCK_DIR/pid"
SOLANA_RPC_PORT="${E2E_SOLANA_RPC_PORT:-19899}"
SOLANA_WS_PORT="$((SOLANA_RPC_PORT + 1))"
SOLANA_FAUCET_PORT="${E2E_SOLANA_FAUCET_PORT:-$((SOLANA_RPC_PORT + 2))}"
SOLANA_GOSSIP_PORT="${E2E_SOLANA_GOSSIP_PORT:-$((SOLANA_RPC_PORT + 3))}"
SOLANA_DYNAMIC_PORT_START="${E2E_SOLANA_DYNAMIC_PORT_START:-$((SOLANA_RPC_PORT + 100))}"
SOLANA_DYNAMIC_PORT_END="${E2E_SOLANA_DYNAMIC_PORT_END:-$((SOLANA_DYNAMIC_PORT_START + 99))}"
SOLANA_LEDGER_DIR="${E2E_SOLANA_LEDGER_DIR:-$APP_DIR/.e2e-solana-ledger-${SOLANA_RPC_PORT}}"
SOLANA_RPC_URL="http://127.0.0.1:${SOLANA_RPC_PORT}"
SOLANA_WS_URL="ws://127.0.0.1:${SOLANA_WS_PORT}"
SOLANA_PROXY_PORT="${E2E_SOLANA_PROXY_PORT:-21899}"
SOLANA_PROXY_URL="http://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_PROXY_WS_URL="ws://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_BOOTSTRAP_KEYPAIR="${E2E_SOLANA_BOOTSTRAP_KEYPAIR:-}"
PROGRAM_ORACLE_ID="B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo"
PROGRAM_MARKET_ID="6YjWiway8kaSjwtAinJxqWPvV3DqBVapDWAsSEZjjmbP"
PROGRAM_CLOB_ID="DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf"

ANVIL_PID=""
KEEPER_PID=""
APP_PID=""
VALIDATOR_PID=""
SOLANA_PROXY_PID=""

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

grep_q() {
  local pattern="$1"
  if has_cmd rg; then
    rg -q "$pattern"
  else
    grep -q "$pattern"
  fi
}

resolve_localnet_wallet_path() {
  local candidates=()
  if [[ -n "$SOLANA_BOOTSTRAP_KEYPAIR" ]]; then
    candidates+=("$SOLANA_BOOTSTRAP_KEYPAIR")
  fi
  candidates+=(
    "$HOME/.config/solana/hyperscape-keys/deployer.json"
    "$HOME/.config/solana/id.json"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      SOLANA_BOOTSTRAP_KEYPAIR="$candidate"
      return 0
    fi
  done
  echo "[e2e] no local Solana bootstrap keypair found" >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

wait_for_solana_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}' | grep_q '"blockhash"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_ws() {
  for _ in {1..90}; do
    if (exec 3<>"/dev/tcp/127.0.0.1/${SOLANA_WS_PORT}") >/dev/null 2>&1; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep 1
  done
  return 1
}

read_solana_slot() {
  curl -s -X POST "$SOLANA_RPC_URL" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}' \
    | jq -r '.result // empty'
}

wait_for_solana_block_production() {
  local previous_slot=""
  for _ in {1..120}; do
    local current_slot=""
    if current_slot="$(read_solana_slot)"; then
      if [[ -n "$previous_slot" && "$current_slot" -gt "$previous_slot" ]]; then
        return 0
      fi
      previous_slot="$current_slot"
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_proxy() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_PROXY_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' | grep_q '"solana-core"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

resolve_bun_bin() {
  if [[ -n "$BUN_BIN" ]] && [[ -x "$BUN_BIN" ]]; then
    return 0
  fi
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    return 0
  fi
  if [[ -x "${HOME}/.bun/bin/bun" ]]; then
    BUN_BIN="${HOME}/.bun/bin/bun"
    return 0
  fi
  echo "[e2e] bun is required but was not found on PATH or at \$HOME/.bun/bin/bun" >&2
  exit 1
}

resolve_bunx_bin() {
  if [[ -n "$BUNX_BIN" ]] && [[ -x "$BUNX_BIN" ]]; then
    return 0
  fi
  if command -v bunx >/dev/null 2>&1; then
    BUNX_BIN="$(command -v bunx)"
    return 0
  fi
  if [[ -x "${HOME}/.bun/bin/bunx" ]]; then
    BUNX_BIN="${HOME}/.bun/bin/bunx"
    return 0
  fi
  echo "[e2e] bunx is required but was not found on PATH or at \$HOME/.bun/bin/bunx" >&2
  exit 1
}

cleanup() {
  if [[ -f "$RUN_LOCK_PID_FILE" ]] && [[ "$(cat "$RUN_LOCK_PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -rf "$RUN_LOCK_DIR"
  fi
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$KEEPER_PID" ]] && kill -0 "$KEEPER_PID" >/dev/null 2>&1; then
    kill "$KEEPER_PID" >/dev/null 2>&1 || true
    wait "$KEEPER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SOLANA_PROXY_PID" ]] && kill -0 "$SOLANA_PROXY_PID" >/dev/null 2>&1; then
    kill "$SOLANA_PROXY_PID" >/dev/null 2>&1 || true
    wait "$SOLANA_PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

acquire_run_lock() {
  if mkdir "$RUN_LOCK_DIR" >/dev/null 2>&1; then
    printf '%s\n' "$$" >"$RUN_LOCK_PID_FILE"
    return 0
  fi

  local existing_pid=""
  if [[ -f "$RUN_LOCK_PID_FILE" ]]; then
    existing_pid="$(cat "$RUN_LOCK_PID_FILE" 2>/dev/null || true)"
  fi

  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    echo "[e2e] another local run is active for $APP_DIR (pid $existing_pid)" >&2
    exit 1
  fi

  rm -rf "$RUN_LOCK_DIR"
  mkdir "$RUN_LOCK_DIR"
  printf '%s\n' "$$" >"$RUN_LOCK_PID_FILE"
}

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "[e2e] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
}

wait_for_anvil() {
  for _ in {1..90}; do
    if curl -s -X POST "$ANVIL_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | grep_q '"result"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_url() {
  local url="$1"
  local log_file="$2"
  for _ in {1..120}; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep_q "200"; then
      return 0
    fi
    sleep 1
  done
  echo "[e2e] service did not become ready: $url" >&2
  tail -n 120 "$log_file" || true
  return 1
}

acquire_run_lock
resolve_bun_bin
resolve_bunx_bin
resolve_localnet_wallet_path
kill_listeners "$APP_PORT"
kill_listeners "$GAME_API_PORT"
kill_listeners "$ANVIL_PORT"
kill_listeners "$SOLANA_RPC_PORT"
kill_listeners "$SOLANA_WS_PORT"
kill_listeners "$SOLANA_FAUCET_PORT"
kill_listeners "$SOLANA_GOSSIP_PORT"
kill_listeners "$SOLANA_PROXY_PORT"
rm -f "$KEEPER_DB_PATH"

echo "[e2e] compiling EVM contracts"
"$BUN_BIN" run --cwd "$CONTRACTS_DIR" compile >/tmp/hyperbet-evm-e2e-build.log 2>&1

echo "[e2e] starting Anvil on :$ANVIL_PORT"
anvil \
  --silent \
  --host 127.0.0.1 \
  --port "$ANVIL_PORT" \
  --chain-id "$EVM_CHAIN_ID" \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"

if ! wait_for_anvil; then
  echo "[e2e] anvil did not become ready"
  tail -n 120 "$ANVIL_LOG" || true
  exit 1
fi

echo "[e2e] seeding local EVM contracts"
E2E_EVM_RPC_URL="$ANVIL_RPC_URL" \
E2E_EVM_CHAIN_ID="$EVM_CHAIN_ID" \
  "$BUN_BIN" run "$APP_DIR/tests/e2e/setup-evm-local.ts" >/tmp/hyperbet-evm-e2e-seed.log

if [[ ! -f "$SOLANA_ANCHOR_DIR/target/deploy/fight_oracle.so" ]] || \
   [[ ! -f "$SOLANA_ANCHOR_DIR/target/deploy/gold_perps_market.so" ]] || \
   [[ ! -f "$SOLANA_ANCHOR_DIR/target/deploy/gold_clob_market.so" ]]; then
  echo "[e2e] missing Solana anchor deploy artifacts in $SOLANA_ANCHOR_DIR/target/deploy" >&2
  exit 1
fi

IDL_ORACLE_ID="$(jq -r '.address // .metadata.address // empty' "$SOLANA_ANCHOR_DIR/target/idl/fight_oracle.json" 2>/dev/null || true)"
IDL_MARKET_ID="$(jq -r '.address // .metadata.address // empty' "$SOLANA_ANCHOR_DIR/target/idl/gold_perps_market.json" 2>/dev/null || true)"
IDL_CLOB_ID="$(jq -r '.address // .metadata.address // empty' "$SOLANA_ANCHOR_DIR/target/idl/gold_clob_market.json" 2>/dev/null || true)"
if [[ -n "$IDL_ORACLE_ID" && "$IDL_ORACLE_ID" != "null" ]]; then
  PROGRAM_ORACLE_ID="$IDL_ORACLE_ID"
fi
if [[ -n "$IDL_MARKET_ID" && "$IDL_MARKET_ID" != "null" ]]; then
  PROGRAM_MARKET_ID="$IDL_MARKET_ID"
fi
if [[ -n "$IDL_CLOB_ID" && "$IDL_CLOB_ID" != "null" ]]; then
  PROGRAM_CLOB_ID="$IDL_CLOB_ID"
fi

SOLANA_MINT_AUTHORITY="$(solana-keygen pubkey "$SOLANA_BOOTSTRAP_KEYPAIR")"

echo "[e2e] starting local Solana validator on :$SOLANA_RPC_PORT"
rm -rf "$SOLANA_LEDGER_DIR"
solana-test-validator \
  --reset \
  --quiet \
  --rpc-port "$SOLANA_RPC_PORT" \
  --faucet-port "$SOLANA_FAUCET_PORT" \
  --gossip-port "$SOLANA_GOSSIP_PORT" \
  --dynamic-port-range "${SOLANA_DYNAMIC_PORT_START}-${SOLANA_DYNAMIC_PORT_END}" \
  --mint "$SOLANA_MINT_AUTHORITY" \
  --ledger "$SOLANA_LEDGER_DIR" \
  --upgradeable-program "$PROGRAM_ORACLE_ID" "$SOLANA_ANCHOR_DIR/target/deploy/fight_oracle.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_MARKET_ID" "$SOLANA_ANCHOR_DIR/target/deploy/gold_perps_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_CLOB_ID" "$SOLANA_ANCHOR_DIR/target/deploy/gold_clob_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID="$!"

if ! wait_for_solana_rpc; then
  echo "[e2e] Solana validator did not become ready" >&2
  tail -n 120 "$VALIDATOR_LOG" || true
  exit 1
fi
if ! wait_for_solana_ws; then
  echo "[e2e] Solana validator websocket did not become ready" >&2
  tail -n 120 "$VALIDATOR_LOG" || true
  exit 1
fi
if ! wait_for_solana_block_production; then
  echo "[e2e] Solana validator did not begin producing blocks" >&2
  tail -n 120 "$VALIDATOR_LOG" || true
  exit 1
fi

echo "[e2e] starting local Solana RPC proxy on :$SOLANA_PROXY_PORT"
env \
  SOLANA_RPC_TARGET="$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET="$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT="$SOLANA_PROXY_PORT" \
  node "$SOLANA_APP_DIR/scripts/solana-rpc-proxy.mjs" >"$SOLANA_PROXY_LOG" 2>&1 &
SOLANA_PROXY_PID="$!"

if ! wait_for_solana_proxy; then
  echo "[e2e] Solana proxy did not become ready" >&2
  tail -n 120 "$SOLANA_PROXY_LOG" || true
  exit 1
fi

SOLANA_FIXED_MATCH_ID="$("$BUN_BIN" -e 'import { readFileSync } from "node:fs"; const state = JSON.parse(readFileSync(process.argv[1], "utf8")); process.stdout.write(String(state.currentMatchId ?? ""));' "$APP_DIR/tests/e2e/state.json")"
SOLANA_FIXED_DUEL_KEY_HEX="$("$BUN_BIN" -e 'import { readFileSync } from "node:fs"; const state = JSON.parse(readFileSync(process.argv[1], "utf8")); process.stdout.write(String(state.currentDuelKeyHex ?? ""));' "$APP_DIR/tests/e2e/state.json")"

echo "[e2e] seeding local Solana state into unified env"
env \
  E2E_SOLANA_RPC_URL="$SOLANA_RPC_URL" \
  E2E_SOLANA_WS_URL="$SOLANA_WS_URL" \
  E2E_BROWSER_SOLANA_RPC_URL="$SOLANA_PROXY_URL" \
  E2E_BROWSER_SOLANA_WS_URL="$SOLANA_PROXY_WS_URL" \
  E2E_SOLANA_BOOTSTRAP_KEYPAIR="$SOLANA_BOOTSTRAP_KEYPAIR" \
  E2E_HEADLESS_WALLET_AUTO_CONNECT="false" \
  E2E_TARGET_APP_DIR="$APP_DIR" \
  E2E_TARGET_ENV_PATH="$APP_DIR/.env.e2e" \
  E2E_TARGET_STATE_PATH="$APP_DIR/tests/e2e/state.json" \
  E2E_FIXED_MATCH_ID="$SOLANA_FIXED_MATCH_ID" \
  E2E_FIXED_DUEL_KEY_HEX="$SOLANA_FIXED_DUEL_KEY_HEX" \
  "$BUN_BIN" run "$SOLANA_APP_DIR/tests/e2e/setup-localnet.ts" >/tmp/hyperbet-evm-e2e-solana-seed.log

echo "[e2e] seeding local keeper data"
KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  "$BUN_BIN" run "$APP_DIR/tests/e2e/setup-api-local.ts" >/tmp/hyperbet-evm-e2e-api-seed.log

echo "[e2e] starting keeper on :$GAME_API_PORT"
STATE_JSON_PATH="$APP_DIR/tests/e2e/state.json"
PORT="$GAME_API_PORT" \
KEEPER_DB_PATH="$KEEPER_DB_PATH" \
BSC_RPC_URL="$ANVIL_RPC_URL" \
SOLANA_CLUSTER="localnet" \
SOLANA_RPC_URL="$SOLANA_RPC_URL" \
ORACLE_AUTHORITY_KEYPAIR="$SOLANA_BOOTSTRAP_KEYPAIR" \
FIGHT_ORACLE_PROGRAM_ID="$PROGRAM_ORACLE_ID" \
GOLD_CLOB_MARKET_PROGRAM_ID="$PROGRAM_CLOB_ID" \
GOLD_PERPS_MARKET_PROGRAM_ID="$PROGRAM_MARKET_ID" \
ARENA_EXTERNAL_BET_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
STREAM_PUBLISH_KEY="$E2E_ARENA_WRITE_KEY" \
ENABLE_STREAM_PUBLISH="true" \
ENABLE_KEEPER_BOT="false" \
STATE_JSON_PATH="$STATE_JSON_PATH" \
BSC_GOLD_CLOB_ADDRESS="$("$BUN_BIN" -e 'import { readFileSync } from "node:fs"; const statePath = process.env.STATE_JSON_PATH; const state = JSON.parse(readFileSync(statePath, "utf8")); process.stdout.write(String(state.evmGoldClobAddress || ""));')" \
  "$BUN_BIN" run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 &
KEEPER_PID="$!"

if ! wait_for_url "$GAME_API_URL/status" "$KEEPER_LOG"; then
  exit 1
fi

echo "[e2e] seeding keeper API state"
E2E_GAME_API_URL="$GAME_API_URL" \
E2E_ARENA_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
  "$BUN_BIN" run "$APP_DIR/tests/e2e/seed-api-local.ts" >/tmp/hyperbet-evm-e2e-api-seed-live.log

echo "[e2e] starting app on :$APP_PORT"
"$BUN_BIN" run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_url "http://127.0.0.1:$APP_PORT/" "$APP_LOG"; then
  exit 1
fi

echo "[e2e] ensuring playwright chromium is installed"
(
  cd "$APP_DIR"
  "$BUNX_BIN" playwright install chromium >/tmp/hyperbet-evm-playwright-install.log 2>&1
)

echo "[e2e] running canonical EVM smoke tests"
(
  cd "$APP_DIR"
  E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
  E2E_GAME_API_URL="$GAME_API_URL" \
    "$BUNX_BIN" playwright test --config "tests/e2e/playwright.config.ts" "tests/e2e/debug-page.e2e.ts" "$@"
)
