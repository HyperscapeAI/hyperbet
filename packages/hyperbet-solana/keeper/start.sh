#!/usr/bin/env bash
# start.sh — launches the SOL-only read/API service.
set -euo pipefail

KEEPER_PID=""

cleanup() {
  echo "[start] shutting down..."
  [ -n "$KEEPER_PID" ] && kill "$KEEPER_PID" 2>/dev/null || true
  wait
  exit 0
}
trap cleanup SIGTERM SIGINT

echo "[start] launching keeper service"
bun --bun src/service.ts &
KEEPER_PID=$!

wait "$KEEPER_PID"
