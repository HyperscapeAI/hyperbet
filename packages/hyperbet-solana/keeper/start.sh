#!/usr/bin/env bash
# start.sh — launches keeper + market-maker-bot as co-processes
set -euo pipefail

KEEPER_PID=""
MM_PID=""

cleanup() {
  echo "[start] shutting down..."
  [ -n "$MM_PID" ] && kill "$MM_PID" 2>/dev/null || true
  [ -n "$KEEPER_PID" ] && kill "$KEEPER_PID" 2>/dev/null || true
  wait
  exit 0
}
trap cleanup SIGTERM SIGINT

# ── Start keeper (primary service) ──
echo "[start] launching keeper service"
bun --bun src/service.ts &
KEEPER_PID=$!

# ── Optionally start market maker bot ──
if [ "${ENABLE_MARKET_MAKER:-false}" = "true" ]; then
  # Wait briefly for keeper HTTP to be ready (MM bot reads duel state from it)
  echo "[start] waiting for keeper to be ready before starting market maker..."
  for i in $(seq 1 30); do
    if curl -fsSL http://127.0.0.1:${PORT:-8080}/status >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  # Point MM bot duel signal at local keeper
  export MM_DUEL_STATE_API_URL="${MM_DUEL_STATE_API_URL:-http://127.0.0.1:${PORT:-8080}/api/streaming/state}"
  # Reuse keeper's SOLANA_RPC_URL if MM bot doesn't have its own
  export SOLANA_RPC_URL="${SOLANA_RPC_URL:-}"

  echo "[start] launching market maker bot"
  cd /app/packages/market-maker-bot
  bun --bun src/index.ts &
  MM_PID=$!
  cd /app/packages/hyperbet-solana/keeper
else
  echo "[start] market maker disabled (set ENABLE_MARKET_MAKER=true to enable)"
fi

# Wait for primary process — if keeper exits, container exits
wait "$KEEPER_PID"
