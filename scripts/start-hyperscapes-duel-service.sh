#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "[hyperscapes-duel] missing required env: $name" >&2
    exit 1
  fi
}

require_env HYPERSCAPES_ROOT
require_env BUN_BIN
require_env GAME_HTTP_URL
require_env GAME_WS_URL
require_env GAME_CLIENT_URL

cd "$HYPERSCAPES_ROOT"

duel_args=(
  run
  duel
  --skip-betting
  --skip-keeper
  "--bots=${DUEL_BOTS:-4}"
  "--server-url=${GAME_HTTP_URL}"
  "--ws-url=${GAME_WS_URL}"
  "--client-url=${GAME_CLIENT_URL}"
)

if [[ "${HYPERSCAPES_SKIP_CHAIN_SETUP:-true}" == "true" ]]; then
  duel_args+=(--skip-chain-setup)
fi
if [[ "${HYPERSCAPES_DUEL_FRESH:-false}" == "true" ]]; then
  duel_args+=(--fresh)
fi

exec env \
  DUEL_WITH_HYPERBET=false \
  PORT="${GAME_PORT:-5555}" \
  DUEL_NODE_ENV="${HYPERSCAPES_DUEL_NODE_ENV:-development}" \
  DUEL_USE_PRODUCTION_CLIENT="${HYPERSCAPES_USE_PRODUCTION_CLIENT:-true}" \
  DUEL_REUSE_EXISTING_CLIENT="${HYPERSCAPES_REUSE_EXISTING_CLIENT:-false}" \
  DUEL_DATABASE_URL="${HYPERSCAPES_DUEL_DATABASE_URL:-}" \
  DUEL_ALLOW_FRAME_EMBED="${DUEL_ALLOW_FRAME_EMBED:-true}" \
  DUEL_SERVER_NODE_BIN="${NODE_BIN:-$(command -v node)}" \
  DUEL_CLIENT_NODE_BIN="${DUEL_CLIENT_NODE_BIN:-${NODE_BIN:-$(command -v node)}}" \
  JWT_SECRET="${HYPERSCAPES_JWT_SECRET:-local-dev-secret}" \
  PUBLIC_CDN_URL="${HYPERSCAPES_PUBLIC_CDN_URL:-}" \
  STREAMING_ANNOUNCEMENT_MS="${STREAMING_ANNOUNCEMENT_MS:-180000}" \
  STREAMING_FIGHTING_MS="${STREAMING_FIGHTING_MS:-60000}" \
  STREAMING_END_WARNING_MS="${STREAMING_END_WARNING_MS:-5000}" \
  STREAMING_RESOLUTION_MS="${STREAMING_RESOLUTION_MS:-5000}" \
  STREAMING_COUNTDOWN_TICKS="${STREAMING_COUNTDOWN_TICKS:-3}" \
  STREAMING_VIEWER_ACCESS_TOKEN="${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}" \
  BETTING_FEED_ACCESS_TOKEN="${BETTING_FEED_ACCESS_TOKEN:-${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}}" \
  STREAM_CAPTURE_HEADLESS="${STREAM_CAPTURE_HEADLESS:-true}" \
  STREAM_CAPTURE_CHANNEL="${STREAM_CAPTURE_CHANNEL:-chromium}" \
  STREAM_CAPTURE_WIDTH="${STREAM_CAPTURE_WIDTH:-1280}" \
  STREAM_CAPTURE_HEIGHT="${STREAM_CAPTURE_HEIGHT:-720}" \
  "$BUN_BIN" "${duel_args[@]}"
