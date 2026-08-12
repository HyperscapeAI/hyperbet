#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "[hyperia-duel] missing required env: $name" >&2
    exit 1
  fi
}

require_env HYPERIA_ROOT
require_env BUN_BIN
require_env NODE_BIN
require_env GAME_HTTP_URL
require_env GAME_WS_URL
require_env GAME_CLIENT_URL

export PATH="$(dirname "$NODE_BIN"):$(dirname "$BUN_BIN"):$PATH"

cd "$HYPERIA_ROOT"

ensure_hyperia_physx_dist() {
  local physx_pkg_dir="$HYPERIA_ROOT/packages/physx-js-webidl"
  local dist_dir="$physx_pkg_dir/dist"
  local js_path="$dist_dir/physx-js-webidl.js"
  local wasm_path="$dist_dir/physx-js-webidl.wasm"
  local dts_path="$dist_dir/physx-js-webidl.d.ts"
  local type_source="$physx_pkg_dir/types/physx-js-webidl.d.ts"
  local source_dir=""
  local candidate=""
  local -a candidates=(
    "$HYPERIA_ROOT/packages/client/public/web"
    "$HYPERIA_ROOT/packages/server/public/web"
    "$HYPERIA_ROOT/packages/client/public"
    "$HYPERIA_ROOT/packages/server/public"
  )

  if [[ -f "$js_path" && -f "$wasm_path" ]]; then
    return 0
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate/physx-js-webidl.js" && -f "$candidate/physx-js-webidl.wasm" ]]; then
      source_dir="$candidate"
      break
    fi
  done

  if [[ -z "$source_dir" ]]; then
    echo "[hyperia-duel] unable to bootstrap PhysX dist; no checked-in PhysX assets found in $HYPERIA_ROOT" >&2
    return 1
  fi

  mkdir -p "$dist_dir"
  cp "$source_dir/physx-js-webidl.js" "$js_path"
  cp "$source_dir/physx-js-webidl.wasm" "$wasm_path"
  if [[ -f "$type_source" ]]; then
    cp "$type_source" "$dts_path"
  fi
  echo "[hyperia-duel] bootstrapped Hyperia PhysX dist from $source_dir"
}

ensure_hyperia_client_build_deps() {
  local impostor_build="$HYPERIA_ROOT/packages/impostors/dist/index.js"
  local decimation_build="$HYPERIA_ROOT/packages/decimation/dist/index.js"
  local procgen_build="$HYPERIA_ROOT/packages/procgen/dist/index.js"
  local shared_build_dir="$HYPERIA_ROOT/packages/shared/build"
  local shared_client_build="$shared_build_dir/framework.client.js"
  local shared_full_build="$shared_build_dir/framework.js"

  if [[ "${HYPERIA_DUEL_FRESH:-false}" != "true" \
    && -f "$impostor_build" \
    && -f "$decimation_build" \
    && -f "$procgen_build" \
    && -f "$shared_client_build" \
    && -f "$shared_full_build" ]]; then
    return 0
  fi

  echo "[hyperia-duel] building Hyperia client dependency artifacts"
  "$BUN_BIN" run --cwd packages/impostors build
  "$BUN_BIN" run --cwd packages/decimation build
  "$BUN_BIN" run --cwd packages/procgen build
  "$BUN_BIN" run --cwd packages/shared build
}

ensure_hyperia_physx_dist
ensure_hyperia_client_build_deps

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

if [[ "${HYPERIA_SKIP_CHAIN_SETUP:-true}" == "true" ]]; then
  duel_args+=(--skip-chain-setup)
fi
if [[ "${HYPERIA_DUEL_FRESH:-false}" == "true" ]]; then
  duel_args+=(--fresh)
fi

if [[ -n "${STREAMING_ANNOUNCEMENT_MS:-}" ]]; then
  STREAMING_ANNOUNCEMENT_MS="$STREAMING_ANNOUNCEMENT_MS"
elif [[ "${HYPERIA_DUEL_FRESH:-false}" == "true" ]]; then
  STREAMING_ANNOUNCEMENT_MS="420000"
else
  STREAMING_ANNOUNCEMENT_MS="180000"
fi

exec env \
  DUEL_WITH_HYPERBET=false \
  PORT="${GAME_PORT:-5555}" \
  DUEL_NODE_ENV="${HYPERIA_DUEL_NODE_ENV:-development}" \
  DUEL_USE_PRODUCTION_CLIENT="${HYPERIA_USE_PRODUCTION_CLIENT:-true}" \
  DUEL_REUSE_EXISTING_CLIENT="${HYPERIA_REUSE_EXISTING_CLIENT:-false}" \
  DUEL_DATABASE_URL="${HYPERIA_DUEL_DATABASE_URL:-}" \
  DUEL_ALLOW_FRAME_EMBED="${DUEL_ALLOW_FRAME_EMBED:-true}" \
  DUEL_SERVER_NODE_BIN="${NODE_BIN:-$(command -v node)}" \
  DUEL_CLIENT_NODE_BIN="${DUEL_CLIENT_NODE_BIN:-${NODE_BIN:-$(command -v node)}}" \
  JWT_SECRET="${HYPERIA_JWT_SECRET:-local-dev-secret}" \
  PUBLIC_CDN_URL="${HYPERIA_PUBLIC_CDN_URL:-}" \
  STREAMING_ANNOUNCEMENT_MS="$STREAMING_ANNOUNCEMENT_MS" \
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
