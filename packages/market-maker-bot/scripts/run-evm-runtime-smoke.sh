#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAIN="${1:-bsc}"
ANVIL_PORT="${ANVIL_PORT:-18545}"
ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:${ANVIL_PORT}}"
ANVIL_CHAIN_ID="${ANVIL_CHAIN_ID:-31337}"
ANVIL_LOG="${ANVIL_LOG:-/tmp/hyperbet-mm-runtime-anvil.log}"
ANVIL_PID=""
STARTED_ANVIL="false"

cleanup() {
  if [[ "$STARTED_ANVIL" == "true" ]] && [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_rpc() {
  for _ in {1..60}; do
    local response
    response="$(curl -s -X POST "$ANVIL_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' || true)"
    if [[ "$response" == *'"result"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_for_rpc; then
  echo "[mm-runtime-smoke] starting anvil on $ANVIL_RPC_URL"
  anvil \
    --silent \
    --host 127.0.0.1 \
    --port "$ANVIL_PORT" \
    --chain-id "$ANVIL_CHAIN_ID" \
    >"$ANVIL_LOG" 2>&1 &
  ANVIL_PID="$!"
  STARTED_ANVIL="true"

  if ! wait_for_rpc; then
    echo "[mm-runtime-smoke] anvil did not become ready" >&2
    tail -n 80 "$ANVIL_LOG" >&2 || true
    exit 1
  fi
fi

cd "$ROOT_DIR"
exec tsx src/runtime-smoke.ts --chain "$CHAIN" --rpc-url "$ANVIL_RPC_URL"
