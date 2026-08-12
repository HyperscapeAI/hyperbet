#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON_GIT_DIR="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -n "$COMMON_GIT_DIR" && "$COMMON_GIT_DIR" != /* ]]; then
  COMMON_GIT_DIR="$ROOT/$COMMON_GIT_DIR"
fi
if [[ -n "$COMMON_GIT_DIR" && -d "$COMMON_GIT_DIR" ]]; then
  WORKSPACE_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"
else
  WORKSPACE_ROOT="$(cd "$ROOT/.." && pwd)"
fi

resolve_hyperia_root() {
  local -a candidates=()
  if [[ -n "${E2E_HYPERIA_ROOT:-}" ]]; then
    candidates+=("${E2E_HYPERIA_ROOT}")
  fi
  if [[ -n "${HYPERIA_ROOT:-}" ]]; then
    candidates+=("${HYPERIA_ROOT}")
  fi
  candidates+=(
    "$ROOT/../hyperia-implementation"
    "$WORKSPACE_ROOT/../hyperia-implementation"
    "$WORKSPACE_ROOT/.worktrees/hyperia-main-latest-e2e"
    "$WORKSPACE_ROOT/.worktrees/hyperia-main-acceptance"
    "$WORKSPACE_ROOT/.worktrees/hyperia-main-sync"
    "$WORKSPACE_ROOT/.worktrees/hyperia-stream-bet-sync"
    "$WORKSPACE_ROOT/hyperia-stream-bet-sync"
    "$WORKSPACE_ROOT/hyperia-mono"
    "$ROOT/../.worktrees/hyperia-main-latest-e2e"
    "$ROOT/../.worktrees/hyperia-main-acceptance"
    "$ROOT/../.worktrees/hyperia-main-sync"
    "$ROOT/../.worktrees/hyperia-stream-bet-sync"
    "$ROOT/../hyperia-stream-bet-sync"
    "$ROOT/../hyperia-mono"
  )

  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

HYPERIA_ROOT="${HYPERIA_ROOT:-$(resolve_hyperia_root 2>/dev/null || true)}"
PM_LOCAL_EVM_MODE="${PM_LOCAL_EVM_MODE:-anvil}"
ANVIL_BIN="${ANVIL_BIN:-$(command -v anvil 2>/dev/null || true)}"
if [[ -z "$ANVIL_BIN" && -x "/opt/homebrew/bin/anvil" ]]; then
  ANVIL_BIN="/opt/homebrew/bin/anvil"
fi
if [[ -z "$ANVIL_BIN" ]]; then
  echo "[pm-local] anvil binary not found; set ANVIL_BIN or install foundry" >&2
  exit 1
fi
BUN_BIN="${BUN_BIN:-$(command -v bun 2>/dev/null || true)}"
if [[ -z "$BUN_BIN" && -x "$HOME/.bun/bin/bun" ]]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" ]]; then
  echo "[pm-local] bun binary not found; set BUN_BIN or install bun" >&2
  exit 1
fi
export PATH="$(dirname "$BUN_BIN"):$PATH"

resolve_node_bin() {
  local candidate="${1:-}"
  local path_candidate=""
  local version=""
  local major=""

  if [[ -n "$candidate" && -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  if [[ -n "${NVM_BIN:-}" && -x "${NVM_BIN}/node" ]]; then
    printf '%s\n' "${NVM_BIN}/node"
    return 0
  fi

  for path_candidate in "$HOME"/.nvm/versions/node/v22*/bin/node; do
    if [[ -x "$path_candidate" ]]; then
      printf '%s\n' "$path_candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    path_candidate="$(command -v node)"
    version="$("$path_candidate" -p 'process.versions.node' 2>/dev/null || true)"
    major="${version%%.*}"
    if [[ "$major" == "22" ]]; then
      printf '%s\n' "$path_candidate"
      return 0
    fi
  fi

  for path_candidate in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [[ ! -x "$path_candidate" ]]; then
      continue
    fi
    version="$("$path_candidate" -p 'process.versions.node' 2>/dev/null || true)"
    major="${version%%.*}"
    if [[ "$major" == "22" ]]; then
      printf '%s\n' "$path_candidate"
      return 0
    fi
  done

  if [[ -n "$path_candidate" && -x "$path_candidate" ]]; then
    printf '%s\n' "$path_candidate"
    return 0
  fi

  if [[ -x "/usr/local/bin/node" ]]; then
    printf '%s\n' "/usr/local/bin/node"
    return 0
  fi
  if [[ -x "/opt/homebrew/bin/node" ]]; then
    printf '%s\n' "/opt/homebrew/bin/node"
    return 0
  fi
  return 1
}

require_node_major() {
  local bin="$1"
  local label="$2"
  local expected_major="$3"
  local version=""
  local major=""

  version="$("$bin" -p 'process.versions.node' 2>/dev/null || true)"
  major="${version%%.*}"
  if [[ -z "$version" || "$major" != "$expected_major" ]]; then
    echo "[pm-local] ${label} must use Node ${expected_major}.x for local Hyperia validation (got ${version:-unknown} via ${bin})" >&2
    exit 1
  fi
}

NODE_BIN="${NODE_BIN:-$(resolve_node_bin "" 2>/dev/null || true)}"
if [[ -z "$NODE_BIN" && -x "/usr/local/bin/node" ]]; then
  NODE_BIN="/usr/local/bin/node"
fi
if [[ -z "$NODE_BIN" && -x "/opt/homebrew/bin/node" ]]; then
  NODE_BIN="/opt/homebrew/bin/node"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "[pm-local] node binary not found; set NODE_BIN or install node" >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
require_node_major "$NODE_BIN" "NODE_BIN" "22"
DUEL_CLIENT_NODE_BIN="${DUEL_CLIENT_NODE_BIN:-$NODE_BIN}"
if [[ -z "$DUEL_CLIENT_NODE_BIN" ]]; then
  echo "[pm-local] duel client node binary not found; set DUEL_CLIENT_NODE_BIN or install node" >&2
  exit 1
fi
require_node_major "$DUEL_CLIENT_NODE_BIN" "DUEL_CLIENT_NODE_BIN" "22"

if [[ ! -d "$HYPERIA_ROOT" ]]; then
  echo "[pm-local] Hyperia repo not found; set HYPERIA_ROOT to the canonical local checkout" >&2
  exit 1
fi

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
    echo "[pm-local] unable to bootstrap PhysX dist; no checked-in PhysX assets found in $HYPERIA_ROOT" >&2
    return 1
  fi

  mkdir -p "$dist_dir"
  cp "$source_dir/physx-js-webidl.js" "$js_path"
  cp "$source_dir/physx-js-webidl.wasm" "$wasm_path"
  if [[ -f "$type_source" ]]; then
    cp "$type_source" "$dts_path"
  fi
  echo "[pm-local] bootstrapped Hyperia PhysX dist from $source_dir"
}

ENV_FILES=(
  "$ROOT/.env.stage-a.testnet.local"
  "$ROOT/.env.testnet.local"
  "$ROOT/packages/hyperbet-evm/keeper/.env"
  "$ROOT/packages/hyperbet-evm/app/.env.local"
)

PRESET_ENV_NAMES="$(env | cut -d= -f1)"

env_name_was_preset() {
  local name="$1"
  printf '%s\n' "$PRESET_ENV_NAMES" | grep -Fx -- "$name" >/dev/null 2>&1
}

source_env_file_preserving_invocation_env() {
  local env_file="$1"
  local line=""
  local key=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue

    if [[ "$line" =~ ^[[:space:]]*export[[:space:]]+ ]]; then
      line="${line#export }"
      line="${line#${line%%[![:space:]]*}}"
    fi

    key="${line%%=*}"
    key="${key//[[:space:]]/}"

    if [[ -z "$key" ]]; then
      continue
    fi

    if env_name_was_preset "$key"; then
      continue
    fi

    eval "export $line"
  done < "$env_file"
}

for env_file in "${ENV_FILES[@]}"; do
  if [[ -f "$env_file" ]]; then
    source_env_file_preserving_invocation_env "$env_file"
  fi
done

GAME_HTTP_URL="${GAME_HTTP_URL:-http://127.0.0.1:5555}"
GAME_WS_URL="${GAME_WS_URL:-ws://127.0.0.1:5556/ws}"
GAME_CLIENT_URL="${GAME_CLIENT_URL:-http://127.0.0.1:3333}"
GAME_PORT="${GAME_PORT:-5555}"
GAME_CLIENT_PORT="${GAME_CLIENT_PORT:-3333}"
KEEPER_PORT="${KEEPER_PORT:-8080}"
APP_PORT="${APP_PORT:-4179}"

resolve_hyperia_assets_root() {
  local -a candidates=()
  if [[ -n "${HYPERIA_ASSETS_SOURCE_ROOT:-}" ]]; then
    candidates+=("${HYPERIA_ASSETS_SOURCE_ROOT}")
  fi
  candidates+=(
    "$ROOT/../hyperia-implementation/packages/server/world/assets"
    "$WORKSPACE_ROOT/../hyperia-implementation/packages/server/world/assets"
    "$WORKSPACE_ROOT/hyperia-mono/packages/server/world/assets"
    "$ROOT/../hyperia-mono/packages/server/world/assets"
    "$WORKSPACE_ROOT/.worktrees/hyperia-stream-bet-sync/packages/server/world/assets"
    "$ROOT/../.worktrees/hyperia-stream-bet-sync/packages/server/world/assets"
  )

  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" || "$candidate" == "$HYPERIA_ROOT/packages/server/world/assets" ]]; then
      continue
    fi
    if [[ -f "$candidate/avatars/avatar-male-01.vrm" && -f "$candidate/manifests/npcs.json" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

ensure_hyperia_local_assets() {
  local source_root=""

  if [[ -f "$HYPERIA_ASSETS_ROOT/avatars/avatar-male-01.vrm" && -f "$HYPERIA_ASSETS_ROOT/manifests/npcs.json" ]]; then
    return 0
  fi

  source_root="$(resolve_hyperia_assets_root 2>/dev/null || true)"
  if [[ -z "$source_root" ]]; then
    return 0
  fi

  mkdir -p "$HYPERIA_ASSETS_ROOT"
  rsync -a --ignore-existing "$source_root/" "$HYPERIA_ASSETS_ROOT/"
  echo "[pm-local] seeded Hyperia local assets from $source_root"
}

HYPERIA_ASSETS_ROOT="${HYPERIA_ASSETS_ROOT:-$HYPERIA_ROOT/packages/server/world/assets}"
ensure_hyperia_local_assets
DEFAULT_HYPERIA_PUBLIC_CDN_URL="${GAME_HTTP_URL}/game-assets"
if [[ ! -f "$HYPERIA_ASSETS_ROOT/avatars/avatar-male-01.vrm" ]]; then
  DEFAULT_HYPERIA_PUBLIC_CDN_URL="https://assets.hyperia.club"
  echo "[pm-local] local Hyperia avatar assets missing; using public CDN ${DEFAULT_HYPERIA_PUBLIC_CDN_URL}"
fi
HYPERIA_PUBLIC_CDN_URL="${PUBLIC_CDN_URL:-$DEFAULT_HYPERIA_PUBLIC_CDN_URL}"
APP_MODE="${APP_MODE:-testnet}"
if [[ "$PM_LOCAL_EVM_MODE" == "anvil" && "$APP_MODE" == "testnet" ]]; then
  APP_MODE="e2e"
fi
DUEL_BOTS="${DUEL_BOTS:-4}"
SOLANA_CLUSTER="${SOLANA_CLUSTER:-testnet}"
EVM_KEEPER_CHAINS="${EVM_KEEPER_CHAINS:-bsc,avax}"
HYPERIA_SKIP_CHAIN_SETUP="${HYPERIA_SKIP_CHAIN_SETUP:-true}"
HYPERIA_DUEL_NODE_ENV="${HYPERIA_DUEL_NODE_ENV:-development}"
HYPERIA_USE_PRODUCTION_CLIENT="${HYPERIA_USE_PRODUCTION_CLIENT:-true}"
HYPERIA_REUSE_EXISTING_CLIENT="${HYPERIA_REUSE_EXISTING_CLIENT:-false}"
HYPERIA_DUEL_FRESH="${HYPERIA_DUEL_FRESH:-false}"
if [[ -n "${STREAMING_ANNOUNCEMENT_MS:-}" ]]; then
  STREAMING_ANNOUNCEMENT_MS="$STREAMING_ANNOUNCEMENT_MS"
elif [[ "$HYPERIA_DUEL_FRESH" == "true" ]]; then
  STREAMING_ANNOUNCEMENT_MS="420000"
else
  STREAMING_ANNOUNCEMENT_MS="180000"
fi
STREAMING_FIGHTING_MS="${STREAMING_FIGHTING_MS:-60000}"
STREAMING_END_WARNING_MS="${STREAMING_END_WARNING_MS:-5000}"
STREAMING_RESOLUTION_MS="${STREAMING_RESOLUTION_MS:-5000}"
STREAMING_COUNTDOWN_TICKS="${STREAMING_COUNTDOWN_TICKS:-3}"
DUEL_ALLOW_FRAME_EMBED="${DUEL_ALLOW_FRAME_EMBED:-true}"
HYPERIA_JWT_SECRET="${HYPERIA_JWT_SECRET:-local-dev-secret}"
HYPERIA_LOCAL_POSTGRES_USER="${HYPERIA_LOCAL_POSTGRES_USER:-${LOCAL_POSTGRES_USER:-${USER:-postgres}}}"
HYPERIA_LOCAL_POSTGRES_PORT="${HYPERIA_LOCAL_POSTGRES_PORT:-${LOCAL_POSTGRES_PORT:-5432}}"
HYPERIA_LOCAL_POSTGRES_DB="${HYPERIA_LOCAL_POSTGRES_DB:-${POSTGRES_DB:-hyperia}}"
HYPERIA_DUEL_DATABASE_URL="${HYPERIA_DUEL_DATABASE_URL:-postgresql://${HYPERIA_LOCAL_POSTGRES_USER}@127.0.0.1:${HYPERIA_LOCAL_POSTGRES_PORT}/${HYPERIA_LOCAL_POSTGRES_DB}}"
STREAMING_VIEWER_ACCESS_TOKEN="${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}"
BETTING_FEED_ACCESS_TOKEN="${BETTING_FEED_ACCESS_TOKEN:-$STREAMING_VIEWER_ACCESS_TOKEN}"
LOCAL_STREAM_PUBLISH_KEY="${LOCAL_STREAM_PUBLISH_KEY:-${STREAM_PUBLISH_KEY:-${ARENA_EXTERNAL_BET_WRITE_KEY:-hyperbet-e2e-local-write-key}}}"
KEEPER_URL="http://127.0.0.1:${KEEPER_PORT}"
LOCAL_EVM_UI_KEY_FILE="${LOCAL_EVM_UI_KEY_FILE:-$ROOT/keys/local-smoke/evm-ui.privatekey}"
DEFAULT_STREAM_URL="${GAME_CLIENT_URL}/stream.html?disableBridgeCapture=1&streamToken=${STREAMING_VIEWER_ACCESS_TOKEN}"
STREAM_URL="${VITE_STREAM_URL:-${DEFAULT_STREAM_URL}}"
HYPERIA_UI_URL="${HYPERIA_UI_URL:-${DEFAULT_STREAM_URL}}"
HYPERBET_UI_DEBUG="${HYPERBET_UI_DEBUG:-false}"
DEFAULT_HYPERBET_UI_URL="http://127.0.0.1:${APP_PORT}/"
if [[ "$HYPERBET_UI_DEBUG" == "true" ]]; then
  DEFAULT_HYPERBET_UI_URL="${DEFAULT_HYPERBET_UI_URL}?debug=1"
fi
HYPERBET_UI_URL="${HYPERBET_UI_URL:-${DEFAULT_HYPERBET_UI_URL}}"
OPEN_LOCAL_UI="${OPEN_LOCAL_UI:-false}"
CAPTURE_LOCAL_UI_FLOW="${CAPTURE_LOCAL_UI_FLOW:-false}"
PM_E2E_MONITOR="${PM_E2E_MONITOR:-$CAPTURE_LOCAL_UI_FLOW}"
PM_E2E_FULL_SOAK="${PM_E2E_FULL_SOAK:-false}"
PM_SOAK_LOCAL_DURATION_MIN="${PM_SOAK_LOCAL_DURATION_MIN:-25}"
PM_SOAK_POLL_MS="${PM_SOAK_POLL_MS:-5000}"
PM_E2E_HARNESS_DURATION_MIN="${PM_E2E_HARNESS_DURATION_MIN:-$PM_SOAK_LOCAL_DURATION_MIN}"
PM_E2E_HARNESS_GAME_URL="${PM_E2E_HARNESS_GAME_URL:-${GAME_HTTP_URL}}"
PM_E2E_HARNESS_BSC_RPC_URL="${PM_E2E_HARNESS_BSC_RPC_URL:-${LOCAL_BSC_RPC_URL:-http://127.0.0.1:${LOCAL_BSC_ANVIL_PORT:-18545}}}"

normalize_bool_env() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) echo "true" ;;
    0|false|FALSE|no|NO|off|OFF) echo "false" ;;
    *) echo "$2" ;;
  esac
}

PW_HEADLESS="${PW_HEADLESS:-1}"
PW_WEBGPU_ARGS="${PW_WEBGPU_ARGS:---enable-unsafe-webgpu}"
PW_BROWSER_CHANNEL="${PW_BROWSER_CHANNEL:-}"
if [[ "$(uname -s)" == "Darwin" && -z "$PW_BROWSER_CHANNEL" ]]; then
  PW_BROWSER_CHANNEL="chrome"
fi
PW_HEADLESS="$(normalize_bool_env "$PW_HEADLESS" "true")"
PM_SOAK_HEADLESS="${PM_SOAK_HEADLESS:-$PW_HEADLESS}"
PM_SOAK_BROWSER_CHANNEL="${PM_SOAK_BROWSER_CHANNEL:-$PW_BROWSER_CHANNEL}"
PM_SOAK_WEBGPU_ARGS="${PM_SOAK_WEBGPU_ARGS:-$PW_WEBGPU_ARGS}"
PM_SOAK_SCREENSHOT_WIDTH="${PM_SOAK_SCREENSHOT_WIDTH:-1280}"
PM_SOAK_SCREENSHOT_HEIGHT="${PM_SOAK_SCREENSHOT_HEIGHT:-720}"
STREAM_CAPTURE_HEADLESS="${STREAM_CAPTURE_HEADLESS:-$PW_HEADLESS}"
STREAM_CAPTURE_CHANNEL="${STREAM_CAPTURE_CHANNEL:-}"
STREAM_CAPTURE_WIDTH="${STREAM_CAPTURE_WIDTH:-$PM_SOAK_SCREENSHOT_WIDTH}"
STREAM_CAPTURE_HEIGHT="${STREAM_CAPTURE_HEIGHT:-$PM_SOAK_SCREENSHOT_HEIGHT}"
PM_SOAK_HEADLESS="$(normalize_bool_env "$PM_SOAK_HEADLESS" "$PW_HEADLESS")"
STREAM_CAPTURE_HEADLESS="$(normalize_bool_env "$STREAM_CAPTURE_HEADLESS" "$PW_HEADLESS")"
if [[ -z "$STREAM_CAPTURE_CHANNEL" ]]; then
  if [[ "$(uname -s)" == "Darwin" && "$STREAM_CAPTURE_HEADLESS" == "true" ]]; then
    STREAM_CAPTURE_CHANNEL="chromium"
  else
    STREAM_CAPTURE_CHANNEL="$PW_BROWSER_CHANNEL"
  fi
fi
export PW_HEADLESS
export PW_WEBGPU_ARGS
export PW_BROWSER_CHANNEL
export PM_SOAK_HEADLESS
export PM_SOAK_BROWSER_CHANNEL
export PM_SOAK_WEBGPU_ARGS
export PM_SOAK_SCREENSHOT_WIDTH
export PM_SOAK_SCREENSHOT_HEIGHT
export STREAM_CAPTURE_HEADLESS
export STREAM_CAPTURE_CHANNEL
export STREAM_CAPTURE_WIDTH
export STREAM_CAPTURE_HEIGHT
LOCAL_CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:3333,http://localhost:3333,http://127.0.0.1:4179,http://localhost:4179}"
WRITER_KEYS_READY="false"
KEEPER_BOT_DEFAULT="true"
EVM_KEEPER_DEFER_FINALIZE="${EVM_KEEPER_DEFER_FINALIZE:-true}"
RESEED_LOCAL_EVM_ON_DUEL_CHANGE="${RESEED_LOCAL_EVM_ON_DUEL_CHANGE:-true}"
if [[ "$PM_E2E_FULL_SOAK" == "true" ]] && ! env_name_was_preset "RESEED_LOCAL_EVM_ON_DUEL_CHANGE"; then
  RESEED_LOCAL_EVM_ON_DUEL_CHANGE="false"
fi
LOCAL_STREAM_DUEL_KEY_HEX=""
LOCAL_STREAM_DUEL_ID=""
LOCAL_STREAM_PHASE=""
LOCAL_STREAM_BET_OPEN_TIME_MS=""
LOCAL_STREAM_BET_CLOSE_TIME_MS=""
LOCAL_STREAM_FIGHT_START_TIME_MS=""
LOCAL_STREAM_AGENT1_ID=""
LOCAL_STREAM_AGENT2_ID=""
LOCAL_EVM_ADMIN_PRIVATE_KEY="${LOCAL_EVM_ADMIN_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
LOCAL_BSC_CHAIN_ID="${LOCAL_BSC_CHAIN_ID:-97}"
LOCAL_AVAX_CHAIN_ID="${LOCAL_AVAX_CHAIN_ID:-43113}"
LOCAL_BSC_ANVIL_PORT="${LOCAL_BSC_ANVIL_PORT:-18545}"
LOCAL_AVAX_ANVIL_PORT="${LOCAL_AVAX_ANVIL_PORT:-18546}"
LOCAL_BSC_RPC_URL="${LOCAL_BSC_RPC_URL:-http://127.0.0.1:${LOCAL_BSC_ANVIL_PORT}}"
LOCAL_AVAX_RPC_URL="${LOCAL_AVAX_RPC_URL:-http://127.0.0.1:${LOCAL_AVAX_ANVIL_PORT}}"
LOCAL_BSC_STATE_PATH="$ROOT/packages/hyperbet-bsc/app/tests/e2e/state.json"
LOCAL_AVAX_STATE_PATH="$ROOT/packages/hyperbet-avax/app/tests/e2e/state.json"
LOCAL_BSC_SETUP_SCRIPT="$ROOT/packages/hyperbet-bsc/app/tests/e2e/setup-evm-local.ts"
LOCAL_AVAX_SETUP_SCRIPT="$ROOT/packages/hyperbet-avax/app/tests/e2e/setup-evm-local.ts"
LOCAL_BSC_ENV_PATH="$ROOT/packages/hyperbet-bsc/app/.env.e2e"
LOCAL_AVAX_ENV_PATH="$ROOT/packages/hyperbet-avax/app/.env.e2e"
LOCAL_EVM_BUILD_LOG="/tmp/hyperbet-pm-local-evm-build.log"
ACCEPTANCE_SERVICE_DIR="${ACCEPTANCE_SERVICE_DIR:-$ROOT/.ci-artifacts/stage-a/acceptance-services}"
HYPERIA_DUEL_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia.pid"
HYPERIA_DUEL_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia.log"
HYPERIA_DUEL_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia.env"
HYPERIA_CLIENT_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia-client.pid"
HYPERIA_CLIENT_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia-client.log"
HYPERIA_CLIENT_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperia-client.env"

mkdir -p "$ACCEPTANCE_SERVICE_DIR"

DUEL_PID=""
LOCAL_BSC_ANVIL_PID=""
LOCAL_AVAX_ANVIL_PID=""
KEEPER_PID=""
APP_PID=""
CAPTURE_PID=""
HYPERIA_CLIENT_PID=""
EVM_SEED_FOLLOW_PID=""
PM_E2E_HARNESS_PID=""
CAPTURE_EXIT_CODE=""
PM_E2E_HARNESS_EXIT_CODE=""

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "$CAPTURE_PID" ]] && kill -0 "$CAPTURE_PID" >/dev/null 2>&1; then
    kill "$CAPTURE_PID" >/dev/null 2>&1 || true
    wait "$CAPTURE_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$HYPERIA_CLIENT_PID" ]] && kill -0 "$HYPERIA_CLIENT_PID" >/dev/null 2>&1; then
    kill "$HYPERIA_CLIENT_PID" >/dev/null 2>&1 || true
    wait "$HYPERIA_CLIENT_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$HYPERIA_CLIENT_PID_FILE"

  if [[ -n "$KEEPER_PID" ]] && kill -0 "$KEEPER_PID" >/dev/null 2>&1; then
    kill "$KEEPER_PID" >/dev/null 2>&1 || true
    wait "$KEEPER_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$DUEL_PID" ]] && kill -0 "$DUEL_PID" >/dev/null 2>&1; then
    kill "$DUEL_PID" >/dev/null 2>&1 || true
    wait "$DUEL_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$HYPERIA_DUEL_PID_FILE"

  if [[ -n "$LOCAL_AVAX_ANVIL_PID" ]] && kill -0 "$LOCAL_AVAX_ANVIL_PID" >/dev/null 2>&1; then
    kill "$LOCAL_AVAX_ANVIL_PID" >/dev/null 2>&1 || true
    wait "$LOCAL_AVAX_ANVIL_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$LOCAL_BSC_ANVIL_PID" ]] && kill -0 "$LOCAL_BSC_ANVIL_PID" >/dev/null 2>&1; then
    kill "$LOCAL_BSC_ANVIL_PID" >/dev/null 2>&1 || true
    wait "$LOCAL_BSC_ANVIL_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$EVM_SEED_FOLLOW_PID" ]] && kill -0 "$EVM_SEED_FOLLOW_PID" >/dev/null 2>&1; then
    kill "$EVM_SEED_FOLLOW_PID" >/dev/null 2>&1 || true
    wait "$EVM_SEED_FOLLOW_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$PM_E2E_HARNESS_PID" ]] && kill -0 "$PM_E2E_HARNESS_PID" >/dev/null 2>&1; then
    kill "$PM_E2E_HARNESS_PID" >/dev/null 2>&1 || true
    wait "$PM_E2E_HARNESS_PID" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-120}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsSL "$url" >/dev/null 2>&1; then
      echo "[pm-local] $label ready at $url"
      return 0
    fi
    sleep 1
  done

  echo "[pm-local] timed out waiting for $label at $url" >&2
  return 1
}

close_existing_anvil_listeners() {
  local port="$1"
  local listeners=""

  listeners="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    echo "[pm-local] closing existing listeners on port $port: $listeners"
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      kill "$pid" >/dev/null 2>&1 || true
    done <<< "$listeners"
    sleep 2
  fi
}

wait_for_json_rpc() {
  local url="$1"
  local label="$2"
  local attempts="${3:-120}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsSL "$url" \
      -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      >/dev/null 2>&1; then
      echo "[pm-local] $label ready at $url"
      return 0
    fi
    sleep 1
  done

  echo "[pm-local] timed out waiting for $label at $url" >&2
  return 1
}

json_path_from_stdin() {
  local path_expr="$1"
  "$NODE_BIN" -e '
    const fs = require("fs");
    const pathExpr = process.argv[1].split(".").filter(Boolean);
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    let current = data;
    for (const key of pathExpr) {
      if (current == null || !Object.prototype.hasOwnProperty.call(current, key)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (current == null) {
      process.stdout.write("");
    } else {
      process.stdout.write(String(current));
    }
  ' "$path_expr"
}

json_field() {
  local path="$1"
  local field="$2"
  "$NODE_BIN" -e 'const fs=require("fs"); const file=process.argv[1]; const key=process.argv[2]; const data=JSON.parse(fs.readFileSync(file,"utf8")); process.stdout.write(String(data[key] ?? ""));' "$path" "$field"
}

write_shell_env_file() {
  local output_path="$1"
  shift
  : >"$output_path"
  while (($#)); do
    local key="$1"
    local value="$2"
    shift 2
    printf '%s=%q\n' "$key" "$value" >>"$output_path"
  done
}

write_hyperia_service_envs() {
  write_shell_env_file \
    "$HYPERIA_DUEL_ENV_FILE" \
    HYPERIA_ROOT "$HYPERIA_ROOT" \
    BUN_BIN "$BUN_BIN" \
    NODE_BIN "$NODE_BIN" \
    DUEL_CLIENT_NODE_BIN "$DUEL_CLIENT_NODE_BIN" \
    GAME_HTTP_URL "$GAME_HTTP_URL" \
    GAME_WS_URL "$GAME_WS_URL" \
    GAME_CLIENT_URL "$GAME_CLIENT_URL" \
    GAME_PORT "$GAME_PORT" \
    DUEL_BOTS "$DUEL_BOTS" \
    HYPERIA_SKIP_CHAIN_SETUP "$HYPERIA_SKIP_CHAIN_SETUP" \
    HYPERIA_DUEL_NODE_ENV "$HYPERIA_DUEL_NODE_ENV" \
    HYPERIA_USE_PRODUCTION_CLIENT "$HYPERIA_USE_PRODUCTION_CLIENT" \
    HYPERIA_REUSE_EXISTING_CLIENT "$HYPERIA_REUSE_EXISTING_CLIENT" \
    HYPERIA_DUEL_FRESH "$HYPERIA_DUEL_FRESH" \
    HYPERIA_DUEL_DATABASE_URL "$HYPERIA_DUEL_DATABASE_URL" \
    DUEL_ALLOW_FRAME_EMBED "$DUEL_ALLOW_FRAME_EMBED" \
    HYPERIA_JWT_SECRET "$HYPERIA_JWT_SECRET" \
    HYPERIA_PUBLIC_CDN_URL "$HYPERIA_PUBLIC_CDN_URL" \
    STREAMING_ANNOUNCEMENT_MS "$STREAMING_ANNOUNCEMENT_MS" \
    STREAMING_FIGHTING_MS "$STREAMING_FIGHTING_MS" \
    STREAMING_END_WARNING_MS "$STREAMING_END_WARNING_MS" \
    STREAMING_RESOLUTION_MS "$STREAMING_RESOLUTION_MS" \
    STREAMING_COUNTDOWN_TICKS "$STREAMING_COUNTDOWN_TICKS" \
    STREAMING_VIEWER_ACCESS_TOKEN "$STREAMING_VIEWER_ACCESS_TOKEN" \
    BETTING_FEED_ACCESS_TOKEN "$BETTING_FEED_ACCESS_TOKEN" \
    STREAM_CAPTURE_HEADLESS "$STREAM_CAPTURE_HEADLESS" \
    STREAM_CAPTURE_CHANNEL "$STREAM_CAPTURE_CHANNEL" \
    STREAM_CAPTURE_WIDTH "$STREAM_CAPTURE_WIDTH" \
    STREAM_CAPTURE_HEIGHT "$STREAM_CAPTURE_HEIGHT"

  write_shell_env_file \
    "$HYPERIA_CLIENT_ENV_FILE" \
    HYPERIA_ROOT "$HYPERIA_ROOT" \
    GAME_HTTP_URL "$GAME_HTTP_URL" \
    GAME_WS_URL "$GAME_WS_URL" \
    HYPERIA_PUBLIC_CDN_URL "$HYPERIA_PUBLIC_CDN_URL" \
    GAME_CLIENT_PORT "$GAME_CLIENT_PORT" \
    NODE_BIN "$NODE_BIN" \
    DUEL_CLIENT_NODE_BIN "$DUEL_CLIENT_NODE_BIN"
}

write_hyperia_service_envs

seed_hyperia_agents() {
  local agents_url="${GAME_HTTP_URL}/api/embedded-agents"
  local desired_agents=(
    "pm-local-agent-a"
    "pm-local-agent-b"
  )
  local current_agents=""

  current_agents="$(
    curl -fsSL "$agents_url" 2>/dev/null \
      | "$NODE_BIN" -e '
          const fs = require("fs");
          const data = JSON.parse(fs.readFileSync(0, "utf8"));
          const agents = Array.isArray(data.agents) ? data.agents : [];
          process.stdout.write(JSON.stringify(agents.map((agent) => String(agent.characterId || agent.agentId || "")).filter(Boolean)));
        '
  )"

  for agent_id in "${desired_agents[@]}"; do
    if printf '%s\n' "$current_agents" | grep -q -- "\"$agent_id\""; then
      echo "[pm-local] Hyperia embedded agent present: $agent_id"
      continue
    fi

    echo "[pm-local] creating Hyperia embedded agent $agent_id"
    curl -fsSL \
      -X POST \
      -H 'content-type: application/json' \
      --data "{\"characterId\":\"$agent_id\",\"autoStart\":true,\"scriptedRole\":\"combat\"}" \
      "$agents_url" >/dev/null
  done

  for _ in $(seq 1 120); do
    local phase
    local duel_key
    refresh_live_duel_seed_state || true
    phase="$LOCAL_STREAM_PHASE"
    duel_key="$LOCAL_STREAM_DUEL_KEY_HEX"
    if [[ "$phase" != "IDLE" && -n "$duel_key" ]]; then
      echo "[pm-local] Hyperia duel seeded: phase=${phase} duelKey=${duel_key}"
      return 0
    fi
    sleep 1
  done

  echo "[pm-local] timed out waiting for Hyperia duel to leave IDLE" >&2
  return 1
}

refresh_live_duel_seed_state() {
  local stream_state
  stream_state="$(curl -fsSL "${GAME_HTTP_URL}/api/streaming/state")" || return 1

  LOCAL_STREAM_PHASE="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.phase")"
  LOCAL_STREAM_DUEL_KEY_HEX="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.duelKeyHex")"
  LOCAL_STREAM_DUEL_ID="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.duelId")"
  LOCAL_STREAM_BET_OPEN_TIME_MS="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.betOpenTime")"
  LOCAL_STREAM_BET_CLOSE_TIME_MS="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.betCloseTime")"
  LOCAL_STREAM_FIGHT_START_TIME_MS="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.fightStartTime")"
  LOCAL_STREAM_AGENT1_ID="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.agent1.id")"
  LOCAL_STREAM_AGENT2_ID="$(printf '%s' "$stream_state" | json_path_from_stdin "cycle.agent2.id")"
}

start_local_evm_chain() {
  local chain_key="$1"
  local chain_id="$2"
  local anvil_port="$3"
  local setup_script="$4"
  local state_path="$5"
  local rpc_url="http://127.0.0.1:${anvil_port}"
  local anvil_pid=""
  local anvil_log="/tmp/hyperbet-pm-local-${chain_key}-anvil.log"
  local seed_log="/tmp/hyperbet-pm-local-${chain_key}-seed.log"
  local code_size_limit="${LOCAL_EVM_ANVIL_CODE_SIZE_LIMIT:-49152}"
  local anvil_args=(
    --silent
    --host 127.0.0.1
    --port "$anvil_port"
    --chain-id "$chain_id"
  )

  if [[ -n "$code_size_limit" ]]; then
    anvil_args+=(--code-size-limit "$code_size_limit")
  fi

  echo "[pm-local] starting local ${chain_key} anvil on ${rpc_url}"
  close_existing_anvil_listeners "$anvil_port"
  "$ANVIL_BIN" "${anvil_args[@]}" >"$anvil_log" 2>&1 &
  anvil_pid=$!

  if ! wait_for_json_rpc "$rpc_url" "${chain_key} anvil"; then
    echo "[pm-local] ${chain_key} anvil did not become ready" >&2
    tail -n 120 "$anvil_log" || true
    return 1
  fi

  echo "[pm-local] building local EVM contracts for ${chain_key}"
  "$BUN_BIN" run --cwd "$ROOT/packages/evm-contracts" build:foundry:e2e >"$LOCAL_EVM_BUILD_LOG" 2>&1

  echo "[pm-local] seeding local ${chain_key} contracts"
  E2E_EVM_RPC_URL="$rpc_url" \
  E2E_EVM_CHAIN_ID="$chain_id" \
    "$NODE_BIN" --import tsx "$setup_script" >"$seed_log" 2>&1

  local chain_env_path=""
  case "$chain_key" in
    bsc) chain_env_path="$LOCAL_BSC_ENV_PATH" ;;
    avax) chain_env_path="$LOCAL_AVAX_ENV_PATH" ;;
  esac

  if [[ -f "$chain_env_path" ]]; then
    echo "[pm-local] sourcing ${chain_key} local EVM env from ${chain_env_path}"
    source_env_file_preserving_invocation_env "$chain_env_path"
  fi

  local oracle_address
  local clob_address
  local token_address
  oracle_address="$(json_field "$state_path" evmOracleAddress)"
  clob_address="$(json_field "$state_path" evmGoldClobAddress)"
  token_address="$(json_field "$state_path" evmGoldTokenAddress)"

  if [[ -z "$oracle_address" || -z "$clob_address" || -z "$token_address" ]]; then
    echo "[pm-local] failed to read seeded ${chain_key} contract addresses" >&2
    tail -n 120 "$seed_log" || true
    return 1
  fi

  case "$chain_key" in
    bsc)
      export BSC_RPC_URL="$rpc_url"
      export BSC_DUEL_ORACLE_ADDRESS="$oracle_address"
      export BSC_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_BSC_RPC_URL="$rpc_url"
      export VITE_BSC_CHAIN_ID="$chain_id"
      export VITE_BSC_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_BSC_GOLD_TOKEN_ADDRESS="$token_address"
      ;;
    avax)
      export AVAX_RPC_URL="$rpc_url"
      export AVAX_DUEL_ORACLE_ADDRESS="$oracle_address"
      export AVAX_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_AVAX_RPC_URL="$rpc_url"
      export VITE_AVAX_CHAIN_ID="$chain_id"
      export VITE_AVAX_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_AVAX_GOLD_TOKEN_ADDRESS="$token_address"
      ;;
    *)
      echo "[pm-local] unsupported local EVM chain: $chain_key" >&2
      return 1
      ;;
  esac

  echo "[pm-local] seeded ${chain_key} contracts:"
  echo "[pm-local]   oracle=${oracle_address}"
  echo "[pm-local]   clob=${clob_address}"
  echo "[pm-local]   token=${token_address}"

  case "$chain_key" in
    bsc) LOCAL_BSC_ANVIL_PID="$anvil_pid" ;;
    avax) LOCAL_AVAX_ANVIL_PID="$anvil_pid" ;;
  esac
}

seed_local_evm_chain() {
  local chain_key="$1"
  local chain_id="$2"
  local setup_script="$3"
  local state_path="$4"
  local duel_key="$5"
  local rpc_url="$6"
  local duel_id="$7"
  local bet_open_time_ms="$8"
  local bet_close_time_ms="$9"
  local fight_start_time_ms="${10}"
  local seed_log="/tmp/hyperbet-pm-local-${chain_key}-reseed.log"

  echo "[pm-local] re-seeding local ${chain_key} contracts for duel ${duel_key}"
  E2E_EVM_RPC_URL="$rpc_url" \
  E2E_EVM_CHAIN_ID="$chain_id" \
  E2E_EVM_DUEL_KEY="$duel_key" \
  E2E_EVM_DUEL_ID="$duel_id" \
  E2E_EVM_BET_OPEN_TIME_MS="$bet_open_time_ms" \
  E2E_EVM_BET_CLOSE_TIME_MS="$bet_close_time_ms" \
  E2E_EVM_FIGHT_START_TIME_MS="$fight_start_time_ms" \
  E2E_EVM_REUSE_DEPLOYMENT="true" \
    "$NODE_BIN" --import tsx "$setup_script" >"$seed_log" 2>&1

  local chain_env_path=""
  case "$chain_key" in
    bsc) chain_env_path="$LOCAL_BSC_ENV_PATH" ;;
    avax) chain_env_path="$LOCAL_AVAX_ENV_PATH" ;;
  esac

  if [[ -f "$chain_env_path" ]]; then
    echo "[pm-local] sourcing ${chain_key} reseed env from ${chain_env_path}"
    source_env_file_preserving_invocation_env "$chain_env_path"
  fi

  local oracle_address
  local clob_address
  local token_address
  oracle_address="$(json_field "$state_path" evmOracleAddress)"
  clob_address="$(json_field "$state_path" evmGoldClobAddress)"
  token_address="$(json_field "$state_path" evmGoldTokenAddress)"

  if [[ -z "$oracle_address" || -z "$clob_address" || -z "$token_address" ]]; then
    echo "[pm-local] failed to read reseeded ${chain_key} contract addresses" >&2
    tail -n 120 "$seed_log" || true
    return 1
  fi

  case "$chain_key" in
    bsc)
      export BSC_RPC_URL="$rpc_url"
      export BSC_DUEL_ORACLE_ADDRESS="$oracle_address"
      export BSC_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_BSC_RPC_URL="$rpc_url"
      export VITE_BSC_CHAIN_ID="$chain_id"
      export VITE_BSC_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_BSC_GOLD_TOKEN_ADDRESS="$token_address"
      ;;
    avax)
      export AVAX_RPC_URL="$rpc_url"
      export AVAX_DUEL_ORACLE_ADDRESS="$oracle_address"
      export AVAX_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_AVAX_RPC_URL="$rpc_url"
      export VITE_AVAX_CHAIN_ID="$chain_id"
      export VITE_AVAX_GOLD_CLOB_ADDRESS="$clob_address"
      export VITE_AVAX_GOLD_TOKEN_ADDRESS="$token_address"
      ;;
    *)
      echo "[pm-local] unsupported local EVM chain for reseed: $chain_key" >&2
      return 1
      ;;
  esac

  echo "[pm-local] reseeded ${chain_key} contracts:"
  echo "[pm-local]   oracle=${oracle_address}"
  echo "[pm-local]   clob=${clob_address}"
  echo "[pm-local]   token=${token_address}"
}

follow_live_evm_duel_seed() {
  local last_duel_key="$1"

  while true; do
    local current_duel_key=""
    refresh_live_duel_seed_state || true
    current_duel_key="$LOCAL_STREAM_DUEL_KEY_HEX"
    if [[ -n "$current_duel_key" && "$current_duel_key" != "$last_duel_key" ]]; then
      seed_local_evm_chain "bsc" "$LOCAL_BSC_CHAIN_ID" "$LOCAL_BSC_SETUP_SCRIPT" "$LOCAL_BSC_STATE_PATH" "$current_duel_key" "$LOCAL_BSC_RPC_URL" "$LOCAL_STREAM_DUEL_ID" "$LOCAL_STREAM_BET_OPEN_TIME_MS" "$LOCAL_STREAM_BET_CLOSE_TIME_MS" "$LOCAL_STREAM_FIGHT_START_TIME_MS" || return 1
      seed_local_evm_chain "avax" "$LOCAL_AVAX_CHAIN_ID" "$LOCAL_AVAX_SETUP_SCRIPT" "$LOCAL_AVAX_STATE_PATH" "$current_duel_key" "$LOCAL_AVAX_RPC_URL" "$LOCAL_STREAM_DUEL_ID" "$LOCAL_STREAM_BET_OPEN_TIME_MS" "$LOCAL_STREAM_BET_CLOSE_TIME_MS" "$LOCAL_STREAM_FIGHT_START_TIME_MS" || return 1
      last_duel_key="$current_duel_key"
      echo "[pm-local] local EVM markets re-anchored to duel ${current_duel_key}"
    fi
    sleep 5
  done
}

warn_missing_writer_keys() {
  local reporter="${EVM_REPORTER_PRIVATE_KEY:-${TESTNET_REPORTER_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"
  local operator="${EVM_MARKET_OPERATOR_PRIVATE_KEY:-${TESTNET_MARKET_OPERATOR_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"
  local finalizer="${EVM_FINALIZER_PRIVATE_KEY:-${TESTNET_FINALIZER_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"

  if [[ -z "$reporter" || -z "$operator" || -z "$finalizer" ]]; then
    cat >&2 <<'EOF'
[pm-local] warning: missing one or more local EVM writer keys.
[pm-local] local Hyperia -> keeper -> UI will still boot, but deployed BSC/AVAX
[pm-local] markets will not open/resolve from local duel events without existing
[pm-local] reporter/operator/finalizer authority.
EOF
    WRITER_KEYS_READY="false"
    KEEPER_BOT_DEFAULT="false"
    return
  fi

  WRITER_KEYS_READY="true"
}

if [[ "$PM_LOCAL_EVM_MODE" == "anvil" ]]; then
  export EVM_KEEPER_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export EVM_REPORTER_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export EVM_MARKET_OPERATOR_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export EVM_FINALIZER_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export TESTNET_REPORTER_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export TESTNET_MARKET_OPERATOR_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
  export TESTNET_FINALIZER_PRIVATE_KEY="$LOCAL_EVM_ADMIN_PRIVATE_KEY"
fi

if [[ "$PM_LOCAL_EVM_MODE" != "anvil" ]] && ! env_name_was_preset "EVM_KEEPER_PRIVATE_KEY"; then
  export EVM_KEEPER_PRIVATE_KEY="${TESTNET_DEPLOYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
fi

if [[ -f "$LOCAL_EVM_UI_KEY_FILE" && -z "${VITE_HEADLESS_EVM_PRIVATE_KEY:-}" ]]; then
  export VITE_HEADLESS_EVM_PRIVATE_KEY
  VITE_HEADLESS_EVM_PRIVATE_KEY="$(tr -d '\n' < "$LOCAL_EVM_UI_KEY_FILE")"
fi

warn_missing_writer_keys
LOCAL_PM_SOLANA_KEEPER_KEYPAIR="${LOCAL_PM_SOLANA_KEEPER_KEYPAIR:-$ROOT/keys/local-pm/solana-keeper.json}"
LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR="${LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR:-$WORKSPACE_ROOT/.ci-artifacts/e2e-solana/solana-bootstrap-keypair.json}"
if [[ -z "${BOT_KEYPAIR:-}" && -z "${ORACLE_AUTHORITY_KEYPAIR:-}" && -z "${MARKET_MAKER_KEYPAIR:-}" ]]; then
  if [[ -f "$LOCAL_PM_SOLANA_KEEPER_KEYPAIR" ]]; then
    export BOT_KEYPAIR="$LOCAL_PM_SOLANA_KEEPER_KEYPAIR"
    export ORACLE_AUTHORITY_KEYPAIR="$LOCAL_PM_SOLANA_KEEPER_KEYPAIR"
    export MARKET_MAKER_KEYPAIR="$LOCAL_PM_SOLANA_KEEPER_KEYPAIR"
    echo "[pm-local] using local PM Solana keeper keypair: $LOCAL_PM_SOLANA_KEEPER_KEYPAIR"
  elif [[ -f "$LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR" ]]; then
    export BOT_KEYPAIR="$LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR"
    export ORACLE_AUTHORITY_KEYPAIR="$LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR"
    export MARKET_MAKER_KEYPAIR="$LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR"
    echo "[pm-local] using fallback Solana bootstrap keypair for local bot startup: $LOCAL_PM_SOLANA_BOOTSTRAP_KEYPAIR"
  else
    echo "[pm-local] local PM Solana keeper keypair not found at $LOCAL_PM_SOLANA_KEEPER_KEYPAIR; keeping local EVM keeper bot enabled and disabling only Solana writes"
  fi
fi
ENABLE_KEEPER_BOT="${ENABLE_KEEPER_BOT:-$KEEPER_BOT_DEFAULT}"

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

write_hyperia_client_runtime_env() {
  local client_dist="$1"

  echo "[pm-local] writing Hyperia runtime env for local preview"
  PUBLIC_API_URL="$GAME_HTTP_URL" \
  PUBLIC_WS_URL="$GAME_WS_URL" \
  PUBLIC_CDN_URL="$HYPERIA_PUBLIC_CDN_URL" \
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const distDir = process.argv[1];
    fs.mkdirSync(distDir, { recursive: true });
    const payload = {
      PUBLIC_API_URL: process.env.PUBLIC_API_URL,
      PUBLIC_WS_URL: process.env.PUBLIC_WS_URL,
      PUBLIC_CDN_URL: process.env.PUBLIC_CDN_URL,
    };
    const serialized = JSON.stringify(payload, null, 2)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    fs.writeFileSync(
      path.join(distDir, "env.js"),
      `// Generated by local PM runner\nwindow.env = ${serialized};\n`,
      "utf8",
    );
  ' "$client_dist"
}

ensure_hyperia_client_build_deps() {
  local impostor_build="$HYPERIA_ROOT/packages/impostors/dist/index.js"
  local decimation_build="$HYPERIA_ROOT/packages/decimation/dist/index.js"
  local procgen_build="$HYPERIA_ROOT/packages/procgen/dist/index.js"
  local shared_build_dir="$HYPERIA_ROOT/packages/shared/build"
  local shared_client_build="$shared_build_dir/framework.client.js"
  local shared_full_build="$shared_build_dir/framework.js"

  if [[ "$HYPERIA_DUEL_FRESH" != "true" \
    && -f "$impostor_build" \
    && -f "$decimation_build" \
    && -f "$procgen_build" \
    && -f "$shared_client_build" \
    && -f "$shared_full_build" ]]; then
    return 0
  fi

  echo "[pm-local] building Hyperia client dependency artifacts"
  (
    cd "$HYPERIA_ROOT"
    "$BUN_BIN" run --cwd packages/impostors build
    "$BUN_BIN" run --cwd packages/decimation build
    "$BUN_BIN" run --cwd packages/procgen build
    "$BUN_BIN" run --cwd packages/shared build
  )
}

start_hyperia_client_preview() {
  local client_dir="$HYPERIA_ROOT/packages/client"
  local client_dist="$client_dir/dist"

  if curl -fsSL "$GAME_CLIENT_URL" >/dev/null 2>&1; then
    echo "[pm-local] reusing existing Hyperia preview client at $GAME_CLIENT_URL"
    write_hyperia_client_runtime_env "$client_dist"
    return 0
  fi

  if [[ ! -f "$client_dist/stream.html" || "$HYPERIA_DUEL_FRESH" == "true" ]]; then
    ensure_hyperia_client_build_deps
    echo "[pm-local] building Hyperia production client preview assets"
    (
      cd "$HYPERIA_ROOT"
      PUBLIC_API_URL="$GAME_HTTP_URL" \
      PUBLIC_WS_URL="$GAME_WS_URL" \
      PUBLIC_CDN_URL="$HYPERIA_PUBLIC_CDN_URL" \
      "$BUN_BIN" run --cwd packages/client build:cf
    )
  fi

  write_hyperia_client_runtime_env "$client_dist"

  echo "[pm-local] starting Hyperia preview client at $GAME_CLIENT_URL"
  nohup bash -lc "set -a; source \"$HYPERIA_CLIENT_ENV_FILE\"; set +a; exec \"$ROOT/scripts/start-hyperia-client-preview.sh\"" \
    >>"$HYPERIA_CLIENT_LOG_FILE" 2>&1 < /dev/null &
  HYPERIA_CLIENT_PID=$!
  printf '%s\n' "$HYPERIA_CLIENT_PID" >"$HYPERIA_CLIENT_PID_FILE"

  wait_for_http "$GAME_CLIENT_URL" "Hyperia game client preview"
}

echo "[pm-local] starting Hyperia duel stack from $HYPERIA_ROOT"
echo "[pm-local] using local Hyperia database: $HYPERIA_DUEL_DATABASE_URL"
if [[ "$HYPERIA_REUSE_EXISTING_CLIENT" != "true" ]]; then
  close_existing_anvil_listeners "$GAME_CLIENT_PORT"
fi
if [[ "$HYPERIA_USE_PRODUCTION_CLIENT" == "true" ]]; then
  start_hyperia_client_preview
elif [[ "$HYPERIA_REUSE_EXISTING_CLIENT" == "true" ]]; then
  echo "[pm-local] reusing externally managed Hyperia client at $GAME_CLIENT_URL"
fi
ensure_hyperia_physx_dist
nohup bash -lc "set -a; source \"$HYPERIA_DUEL_ENV_FILE\"; set +a; exec \"$ROOT/scripts/start-hyperia-duel-service.sh\"" \
  >>"$HYPERIA_DUEL_LOG_FILE" 2>&1 < /dev/null &
DUEL_PID=$!
printf '%s\n' "$DUEL_PID" >"$HYPERIA_DUEL_PID_FILE"

wait_for_http "${GAME_HTTP_URL}/api/streaming/state" "Hyperia streaming state"
seed_hyperia_agents

if [[ "$PM_LOCAL_EVM_MODE" == "anvil" ]]; then
  if [[ -z "$LOCAL_STREAM_DUEL_KEY_HEX" ]]; then
    echo "[pm-local] failed to capture live duel key before seeding EVM chains" >&2
    exit 1
  fi

  export E2E_EVM_DUEL_KEY="$LOCAL_STREAM_DUEL_KEY_HEX"
  export E2E_EVM_DUEL_ID="${LOCAL_STREAM_DUEL_ID:-${E2E_EVM_DUEL_ID:-1}}"
  export E2E_EVM_BET_OPEN_TIME_MS="${LOCAL_STREAM_BET_OPEN_TIME_MS:-}"
  export E2E_EVM_BET_CLOSE_TIME_MS="${LOCAL_STREAM_BET_CLOSE_TIME_MS:-}"
  export E2E_EVM_FIGHT_START_TIME_MS="${LOCAL_STREAM_FIGHT_START_TIME_MS:-}"
  export E2E_EVM_AGENT1_ID="${LOCAL_STREAM_AGENT1_ID:-}"
  export E2E_EVM_AGENT2_ID="${LOCAL_STREAM_AGENT2_ID:-}"

  start_local_evm_chain "bsc" "$LOCAL_BSC_CHAIN_ID" "$LOCAL_BSC_ANVIL_PORT" "$LOCAL_BSC_SETUP_SCRIPT" "$LOCAL_BSC_STATE_PATH"
  start_local_evm_chain "avax" "$LOCAL_AVAX_CHAIN_ID" "$LOCAL_AVAX_ANVIL_PORT" "$LOCAL_AVAX_SETUP_SCRIPT" "$LOCAL_AVAX_STATE_PATH"

  if [[ "$RESEED_LOCAL_EVM_ON_DUEL_CHANGE" == "true" ]]; then
    follow_live_evm_duel_seed "$LOCAL_STREAM_DUEL_KEY_HEX" &
    EVM_SEED_FOLLOW_PID=$!
  else
    echo "[pm-local] automatic local EVM reseeding disabled; keeping the first anchored duel for settlement validation"
  fi
fi

echo "[pm-local] starting Hyperbet EVM keeper service on :$KEEPER_PORT"
close_existing_anvil_listeners "$KEEPER_PORT"
(
  cd "$ROOT"
    keeper_env=(
      BET_SYNC_SOURCE_EVENTS_URL="${GAME_HTTP_URL}/api/internal/bet-sync/events"
      BET_SYNC_SOURCE_STATE_URL="${GAME_HTTP_URL}/api/internal/bet-sync/state"
      BET_SYNC_SOURCE_BEARER_TOKEN="$BETTING_FEED_ACCESS_TOKEN"
      STREAM_STATE_SOURCE_URL="${GAME_HTTP_URL}/api/streaming/state"
      PORT="$KEEPER_PORT"
      GAME_URL="$KEEPER_URL"
      CORS_ORIGINS="$LOCAL_CORS_ORIGINS"
      EVM_KEEPER_DEFER_FINALIZE="$EVM_KEEPER_DEFER_FINALIZE"
      SOLANA_KEEPER_WRITE_ENABLED="${SOLANA_KEEPER_WRITE_ENABLED:-false}"
      SOLANA_CLUSTER="$SOLANA_CLUSTER"
      EVM_KEEPER_CHAINS="$EVM_KEEPER_CHAINS"
      ENABLE_KEEPER_BOT="$ENABLE_KEEPER_BOT"
      ENABLE_STREAM_PUBLISH="true"
      ARENA_EXTERNAL_BET_WRITE_KEY="$LOCAL_STREAM_PUBLISH_KEY"
      STREAM_PUBLISH_KEY="$LOCAL_STREAM_PUBLISH_KEY"
    )
  if [[ -n "${BSC_RPC_URL:-}" ]]; then
    keeper_env+=(BSC_RPC_URL="$BSC_RPC_URL")
  fi
  if [[ -n "${BSC_DUEL_ORACLE_ADDRESS:-}" ]]; then
    keeper_env+=(BSC_DUEL_ORACLE_ADDRESS="$BSC_DUEL_ORACLE_ADDRESS")
  fi
  if [[ -n "${BSC_GOLD_CLOB_ADDRESS:-}" ]]; then
    keeper_env+=(BSC_GOLD_CLOB_ADDRESS="$BSC_GOLD_CLOB_ADDRESS")
  fi
  if [[ -n "${AVAX_RPC_URL:-}" ]]; then
    keeper_env+=(AVAX_RPC_URL="$AVAX_RPC_URL")
  fi
  if [[ -n "${AVAX_DUEL_ORACLE_ADDRESS:-}" ]]; then
    keeper_env+=(AVAX_DUEL_ORACLE_ADDRESS="$AVAX_DUEL_ORACLE_ADDRESS")
  fi
  if [[ -n "${AVAX_GOLD_CLOB_ADDRESS:-}" ]]; then
    keeper_env+=(AVAX_GOLD_CLOB_ADDRESS="$AVAX_GOLD_CLOB_ADDRESS")
  fi
  env "${keeper_env[@]}" "$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-evm/keeper/src/service.ts
) &
KEEPER_PID=$!

wait_for_http "${KEEPER_URL}/status" "Hyperbet keeper service"

echo "[pm-local] starting Hyperbet EVM app on :$APP_PORT"
close_existing_anvil_listeners "$APP_PORT"
(
  cd "$ROOT"
  app_env=(
    ACCEPTANCE_DUEL_SOURCE="real_hyperia"
    E2E_DUEL_SOURCE="real_hyperia"
    VITE_GAME_API_URL="$KEEPER_URL"
    VITE_GAME_WS_URL="$GAME_WS_URL"
    VITE_WS_URL="$GAME_WS_URL"
    VITE_STREAM_URL="$STREAM_URL"
    VITE_SOLANA_CLUSTER="$SOLANA_CLUSTER"
  )
  if [[ -n "${BSC_RPC_URL:-}" ]]; then
    app_env+=(BSC_RPC_URL="$BSC_RPC_URL" VITE_BSC_RPC_URL="$BSC_RPC_URL")
  fi
  if [[ -n "${AVAX_RPC_URL:-}" ]]; then
    app_env+=(AVAX_RPC_URL="$AVAX_RPC_URL" VITE_AVAX_RPC_URL="$AVAX_RPC_URL")
  fi
  if [[ -n "${BSC_GOLD_CLOB_ADDRESS:-}" ]]; then
    app_env+=(VITE_BSC_GOLD_CLOB_ADDRESS="$BSC_GOLD_CLOB_ADDRESS")
  fi
  if [[ -n "${AVAX_GOLD_CLOB_ADDRESS:-}" ]]; then
    app_env+=(VITE_AVAX_GOLD_CLOB_ADDRESS="$AVAX_GOLD_CLOB_ADDRESS")
  fi
  env "${app_env[@]}" "$BUN_BIN" run --cwd packages/hyperbet-evm/app dev \
    --mode "$APP_MODE" \
    --host \
    --strictPort \
    --port "$APP_PORT"
) &
APP_PID=$!

wait_for_http "http://127.0.0.1:${APP_PORT}" "Hyperbet EVM app"

if [[ "$OPEN_LOCAL_UI" == "true" ]]; then
  echo "[pm-local] opening Hyperia UI at ${HYPERIA_UI_URL}"
  open_url "$HYPERIA_UI_URL"
  echo "[pm-local] opening Hyperbet UI at ${HYPERBET_UI_URL}"
  open_url "$HYPERBET_UI_URL"
fi

if [[ "$PM_E2E_MONITOR" == "true" ]]; then
  echo "[pm-local] starting local PM follow monitor"
  (
    cd "$ROOT"
      soak_args=(
        --mode=local
        --duration-min="${PM_SOAK_LOCAL_DURATION_MIN}"
        --poll-ms="${PM_SOAK_POLL_MS}"
      )
      soak_env=(
        HYPERIA_UI_URL="$HYPERIA_UI_URL"
        HYPERBET_UI_URL="$HYPERBET_UI_URL"
        ACCEPTANCE_DUEL_SOURCE="real_hyperia"
        E2E_DUEL_SOURCE="real_hyperia"
        VITE_STREAM_URL="${VITE_STREAM_URL:-$HYPERIA_UI_URL}"
        SOURCE_STREAM_STATE_URL="${SOURCE_STREAM_STATE_URL:-${GAME_HTTP_URL}/api/streaming/state}"
        SOURCE_BET_SYNC_STATE_URL="${SOURCE_BET_SYNC_STATE_URL:-${GAME_HTTP_URL}/api/internal/bet-sync/state}"
        SOURCE_BET_SYNC_BEARER_TOKEN="${SOURCE_BET_SYNC_BEARER_TOKEN:-$BETTING_FEED_ACCESS_TOKEN}"
        SOURCE_RTMP_STATUS_URL="${SOURCE_RTMP_STATUS_URL:-${GAME_HTTP_URL}/api/streaming/rtmp/status}"
        STREAM_STATE_URL="${STREAM_STATE_URL:-${KEEPER_URL}/api/streaming/state}"
        ACTIVE_MARKETS_URL="${KEEPER_URL}/api/arena/prediction-markets/active"
        OVERVIEW_MARKETS_URL="${OVERVIEW_MARKETS_URL:-${KEEPER_URL}/api/arena/prediction-markets/overview}"
        SYNC_STATUS_URL="${SYNC_STATUS_URL:-${KEEPER_URL}/api/sync/status}"
        PM_SOAK_SIGNOFF_MODE="${PM_SOAK_SIGNOFF_MODE:-false}"
        PM_SOAK_SCREENSHOTS="${PM_SOAK_SCREENSHOTS:-true}"
        PM_SOAK_HEADLESS="${PM_SOAK_HEADLESS}"
        PM_SOAK_BROWSER_CHANNEL="${PM_SOAK_BROWSER_CHANNEL}"
        PM_SOAK_WEBGPU_ARGS="${PM_SOAK_WEBGPU_ARGS}"
        PM_SOAK_SCREENSHOT_WIDTH="${PM_SOAK_SCREENSHOT_WIDTH}"
        PM_SOAK_SCREENSHOT_HEIGHT="${PM_SOAK_SCREENSHOT_HEIGHT}"
        RUN_SCOPE="LOCALNET"
        PERPS_MARKETS_URL="${KEEPER_URL}/api/perps/markets"
        PERPS_ORACLE_HISTORY_URL="${KEEPER_URL}/api/perps/oracle-history"
        BUN_BIN="$BUN_BIN"
      )
      if [[ "${PM_SOAK_SIGNOFF_MODE:-false}" != "true" ]]; then
        soak_args+=(--follow)
        soak_env+=(
          PM_SOAK_RECONCILE_PUBLISH_URL="${PM_SOAK_RECONCILE_PUBLISH_URL:-${KEEPER_URL}/api/streaming/state/publish}"
          PM_SOAK_RECONCILE_PUBLISH_KEY="${PM_SOAK_RECONCILE_PUBLISH_KEY:-$LOCAL_STREAM_PUBLISH_KEY}"
        )
      fi
      env "${soak_env[@]}" \
        "$NODE_BIN" --import tsx scripts/pm-soak-monitor.ts "${soak_args[@]}"
  ) &
  CAPTURE_PID=$!
fi

if [[ "$PM_E2E_FULL_SOAK" == "true" ]]; then
  if [[ "$PM_LOCAL_EVM_MODE" != "anvil" ]]; then
    echo "[pm-local] full e2e soak requested, but PM_LOCAL_EVM_MODE must be anvil" >&2
    exit 1
  fi

  echo "[pm-local] starting local PM-AMM + perps harness soak"
  (
    cd "$ROOT"
    SOURCE_BET_SYNC_STATE_URL="${SOURCE_BET_SYNC_STATE_URL:-${GAME_HTTP_URL}/api/internal/bet-sync/state}" \
    SOURCE_BET_SYNC_BEARER_TOKEN="${SOURCE_BET_SYNC_BEARER_TOKEN:-$BETTING_FEED_ACCESS_TOKEN}" \
    SYNC_STATUS_URL="${SYNC_STATUS_URL:-${KEEPER_URL}/api/sync/status}" \
    STREAM_STATE_URL="${STREAM_STATE_URL:-${KEEPER_URL}/api/streaming/state}" \
    ACCEPTANCE_DUEL_SOURCE="real_hyperia" \
    E2E_DUEL_SOURCE="real_hyperia" \
    "$BUN_BIN" run pm:soak:harness -- \
      --duration-min="$PM_E2E_HARNESS_DURATION_MIN" \
      --bsc-rpc="$PM_E2E_HARNESS_BSC_RPC_URL" \
      --game-url="$PM_E2E_HARNESS_GAME_URL"
  ) &
  PM_E2E_HARNESS_PID=$!
fi

cat <<EOF
[pm-local] integrated local stack is up
  hyperia-root: ${HYPERIA_ROOT}
  hyperia: ${GAME_HTTP_URL}
  keeper:      ${KEEPER_URL}
  app:         http://127.0.0.1:${APP_PORT}
  stream:      ${STREAM_URL}
  hyperia-ui: ${HYPERIA_UI_URL}
  hyperbet-ui:    ${HYPERBET_UI_URL}
  writer-bot:  ${ENABLE_KEEPER_BOT}
  write-keys:  ${WRITER_KEYS_READY}
  evm-defer-finalize: ${EVM_KEEPER_DEFER_FINALIZE}
  evm-auto-reseed:    ${RESEED_LOCAL_EVM_ON_DUEL_CHANGE}
  acceptance-duel-source: real_hyperia

[pm-local] notes:
  - Hyperia remains the duel event source.
  - Hyperbet keeper consumes ${GAME_HTTP_URL}/api/internal/bet-sync/events and exposes
    /api/arena/prediction-markets/overview for the UI.
  - Current local game lifecycle supports open -> lock -> resolve, not cancel.
  - This local runner defaults to skipping Hyperia MUD chain bootstrap and
    running the duel server in development mode because Hyperbet consumes the
    duel telemetry API, not the sibling repo's local anvil world.
  monitor:             ${PM_E2E_MONITOR}
  e2e-full-soak:        ${PM_E2E_FULL_SOAK}
  e2e-harness-duration: ${PM_E2E_HARNESS_DURATION_MIN}
  e2e-harness-game-url: ${PM_E2E_HARNESS_GAME_URL}
  e2e-harness-bsc-rpc:  ${PM_E2E_HARNESS_BSC_RPC_URL}
  headless:            ${PW_HEADLESS}
  browser-channel:     ${PW_BROWSER_CHANNEL:-chromium}
  screenshot-viewport: ${PM_SOAK_SCREENSHOT_WIDTH}x${PM_SOAK_SCREENSHOT_HEIGHT}
  stream-capture:      headless=${STREAM_CAPTURE_HEADLESS} channel=${STREAM_CAPTURE_CHANNEL:-chromium} viewport=${STREAM_CAPTURE_WIDTH}x${STREAM_CAPTURE_HEIGHT}
EOF

while true; do
  if [[ -n "$DUEL_PID" ]] && ! kill -0 "$DUEL_PID" >/dev/null 2>&1; then
    wait "$DUEL_PID"
    exit $?
  fi
  if [[ -n "$KEEPER_PID" ]] && ! kill -0 "$KEEPER_PID" >/dev/null 2>&1; then
    wait "$KEEPER_PID"
    exit $?
  fi
  if [[ -n "$APP_PID" ]] && ! kill -0 "$APP_PID" >/dev/null 2>&1; then
    wait "$APP_PID"
    exit $?
  fi
  if [[ -n "$PM_E2E_HARNESS_PID" ]] && ! kill -0 "$PM_E2E_HARNESS_PID" >/dev/null 2>&1; then
    if wait "$PM_E2E_HARNESS_PID"; then
      PM_E2E_HARNESS_EXIT_CODE="${PM_E2E_HARNESS_EXIT_CODE:-0}"
    else
      PM_E2E_HARNESS_EXIT_CODE="${PM_E2E_HARNESS_EXIT_CODE:-$?}"
    fi
    PM_E2E_HARNESS_PID=""
  fi
  if [[ -n "$EVM_SEED_FOLLOW_PID" ]] && ! kill -0 "$EVM_SEED_FOLLOW_PID" >/dev/null 2>&1; then
    wait "$EVM_SEED_FOLLOW_PID"
    exit $?
  fi
  if [[ -n "$CAPTURE_PID" ]] && ! kill -0 "$CAPTURE_PID" >/dev/null 2>&1; then
    if wait "$CAPTURE_PID"; then
      CAPTURE_EXIT_CODE="${CAPTURE_EXIT_CODE:-0}"
    else
      CAPTURE_EXIT_CODE="${CAPTURE_EXIT_CODE:-$?}"
    fi
    CAPTURE_PID=""
  fi
  if [[ "$PM_E2E_MONITOR" == "true" && "$PM_E2E_FULL_SOAK" == "true" ]]; then
    if [[ -z "$CAPTURE_PID" && -z "$PM_E2E_HARNESS_PID" ]]; then
      if [[ "${CAPTURE_EXIT_CODE:-0}" -ne 0 ]]; then
        exit "${CAPTURE_EXIT_CODE}"
      fi
      exit "${PM_E2E_HARNESS_EXIT_CODE:-0}"
    fi
  elif [[ "$PM_E2E_MONITOR" == "true" && -z "$CAPTURE_PID" ]]; then
    exit "${CAPTURE_EXIT_CODE:-0}"
  elif [[ "$PM_E2E_FULL_SOAK" == "true" && -z "$PM_E2E_HARNESS_PID" ]]; then
    exit "${PM_E2E_HARNESS_EXIT_CODE:-0}"
  fi
  sleep 2
done
