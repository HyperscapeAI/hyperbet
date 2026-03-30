#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
EVM_DIR="$(cd "$DEMO_DIR/../evm-contracts" && pwd)"
ANVIL_LOG="$APP_DIR/.local-demo-anvil.log"
APP_PORT="${APP_PORT:-4179}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EVM_CHAIN_ID="${EVM_CHAIN_ID:-43113}"

ANVIL_PID=""

cleanup() {
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_anvil() {
  for _ in {1..60}; do
    if curl -s -X POST "$ANVIL_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"result"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "[local-demo] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
}

kill_listeners "$APP_PORT"
kill_listeners "$ANVIL_PORT"

echo "[local-demo] compiling EVM contracts"
forge build --root "$EVM_DIR" >/tmp/hyperbet-avax-local-build.log 2>&1

echo "[local-demo] starting local Anvil (chain id $EVM_CHAIN_ID)"
anvil \
  --silent \
  --host 127.0.0.1 \
  --port "$ANVIL_PORT" \
  --chain-id "$EVM_CHAIN_ID" \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"

if ! wait_for_anvil; then
  echo "[local-demo] Anvil did not become ready"
  tail -n 120 "$ANVIL_LOG" || true
  exit 1
fi

echo "[local-demo] seeding EVM state + writing app/.env.e2e"
E2E_EVM_PORT="$ANVIL_PORT" E2E_EVM_CHAIN_ID="$EVM_CHAIN_ID" \
  bun run "$APP_DIR/tests/e2e/setup-evm-local.ts" >/tmp/hyperbet-avax-local-seed.log

echo "[local-demo] starting app at http://127.0.0.1:$APP_PORT"
echo "[local-demo] Anvil log: $ANVIL_LOG"
VITE_HEADLESS_WALLET_AUTO_CONNECT=false \
  bun run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT"
