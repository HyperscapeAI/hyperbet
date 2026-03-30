#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANVIL_PORT="${ANVIL_PORT:-18545}"
ANVIL_CHAIN_ID="${ANVIL_CHAIN_ID:-31337}"
ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:${ANVIL_PORT}}"
ANVIL_LOG="${ANVIL_LOG:-/tmp/hyperbet-evm-anvil.log}"
ANVIL_PID=""

cleanup() {
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_anvil_rpc() {
  for _ in {1..90}; do
    local response
    response="$(curl -s -X POST "$ANVIL_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' || true)"
    if [[ "$response" == *'"result"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

kill_stale_listener() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  for pid in $pids; do
    local command_line
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"anvil"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    else
      printf '[anvil-suite] port %s is occupied by a non-anvil process: %s\n' "$port" "$command_line" >&2
      exit 1
    fi
  done
}

kill_stale_listener "$ANVIL_PORT"

echo "[anvil-suite] starting anvil on $ANVIL_RPC_URL"
anvil \
  --silent \
  --accounts 20 \
  --host 127.0.0.1 \
  --port "$ANVIL_PORT" \
  --chain-id "$ANVIL_CHAIN_ID" \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"

if ! wait_for_anvil_rpc; then
  echo "[anvil-suite] anvil did not become ready" >&2
  tail -n 80 "$ANVIL_LOG" >&2 || true
  exit 1
fi

echo "[anvil-suite] running adversarial simulation against anvil"
ANVIL_RPC_URL="$ANVIL_RPC_URL" \
ANVIL_CHAIN_ID="$ANVIL_CHAIN_ID" \
  "$ROOT_DIR/node_modules/.bin/ts-node" --transpile-only scripts/simulate-adversarial-localnet.ts
