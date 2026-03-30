#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVM_PKG_DIR="$(cd "$APP_DIR/.." && pwd)"
KEEPER_DIR="$EVM_PKG_DIR/keeper"
CONTRACTS_DIR="$(cd "$EVM_PKG_DIR/../evm-contracts" && pwd)"
APP_PORT="${E2E_APP_PORT:-4181}"
GAME_API_PORT="${E2E_GAME_API_PORT:-5555}"
GAME_API_URL="http://127.0.0.1:${GAME_API_PORT}"
ANVIL_PORT="${E2E_EVM_PORT:-18545}"
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EVM_CHAIN_ID="${E2E_EVM_CHAIN_ID:-31337}"
KEEPER_DB_PATH="${E2E_KEEPER_DB_PATH:-$APP_DIR/.e2e-keeper.sqlite}"
ANVIL_LOG="$APP_DIR/.e2e-anvil.log"
KEEPER_LOG="$APP_DIR/.e2e-keeper.log"
APP_LOG="$APP_DIR/.e2e-app.log"
RUN_LOCK_DIR="$APP_DIR/.e2e-run.lock"
RUN_LOCK_PID_FILE="$RUN_LOCK_DIR/pid"

ANVIL_PID=""
KEEPER_PID=""
APP_PID=""

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
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | rg -q '"result"'; then
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
    if curl -s -o /dev/null -w "%{http_code}" "$url" | rg -q "200"; then
      return 0
    fi
    sleep 1
  done
  echo "[e2e] service did not become ready: $url" >&2
  tail -n 120 "$log_file" || true
  return 1
}

acquire_run_lock
kill_listeners "$APP_PORT"
kill_listeners "$GAME_API_PORT"
kill_listeners "$ANVIL_PORT"
rm -f "$KEEPER_DB_PATH"

echo "[e2e] compiling EVM contracts"
bun run --cwd "$CONTRACTS_DIR" compile >/tmp/hyperbet-evm-e2e-build.log 2>&1

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
  bun run "$APP_DIR/tests/e2e/setup-evm-local.ts" >/tmp/hyperbet-evm-e2e-seed.log

echo "[e2e] seeding local keeper data"
KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  bun run "$APP_DIR/tests/e2e/setup-api-local.ts" >/tmp/hyperbet-evm-e2e-api-seed.log

echo "[e2e] starting keeper on :$GAME_API_PORT"
STATE_JSON_PATH="$APP_DIR/tests/e2e/state.json"
PORT="$GAME_API_PORT" \
KEEPER_DB_PATH="$KEEPER_DB_PATH" \
BSC_RPC_URL="$ANVIL_RPC_URL" \
STATE_JSON_PATH="$STATE_JSON_PATH" \
BSC_GOLD_CLOB_ADDRESS="$(node -e 'const fs=require("fs"); const statePath=process.env.STATE_JSON_PATH; const state=JSON.parse(fs.readFileSync(statePath, "utf8")); process.stdout.write(String(state.evmGoldClobAddress || ""));')" \
  bun run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 &
KEEPER_PID="$!"

if ! wait_for_url "$GAME_API_URL/status" "$KEEPER_LOG"; then
  exit 1
fi

echo "[e2e] starting app on :$APP_PORT"
bun run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_url "http://127.0.0.1:$APP_PORT/" "$APP_LOG"; then
  exit 1
fi

echo "[e2e] ensuring playwright chromium is installed"
(
  cd "$APP_DIR"
  bunx playwright install chromium >/tmp/hyperbet-evm-playwright-install.log 2>&1
)

echo "[e2e] running canonical EVM smoke tests"
(
  cd "$APP_DIR"
  E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
  E2E_GAME_API_URL="$GAME_API_URL" \
    bunx playwright test --config "tests/e2e/playwright.config.ts" "tests/e2e/debug-page.e2e.ts" "$@"
)
