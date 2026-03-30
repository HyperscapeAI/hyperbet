#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP_DIR/../../.." && pwd)"
export PATH="/Users/mac/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
BUN_BIN="${BUN_BIN:-/Users/mac/.bun/bin/bun}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT/.env.stage-a.testnet.local}"
STAGE_A_ENV_FILE="${STAGE_A_ENV_FILE:-$ROOT/keys/stage-a/export-stage-a.sh}"
E2E_HYPERSCAPES_ROOT_OVERRIDE="${E2E_HYPERSCAPES_ROOT:-${ACCEPTANCE_HYPERSCAPES_ROOT:-}}"
CLUSTER="${E2E_CLUSTER:-devnet}"
DUEL_SOURCE="${E2E_DUEL_SOURCE:-${ACCEPTANCE_DUEL_SOURCE:-synthetic_publish}}"
if [[ -n "${E2E_APP_PORT:-}" ]]; then
  APP_PORT="$E2E_APP_PORT"
elif [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
  APP_PORT="${E2E_REAL_DUEL_APP_PORT:-4190}"
else
  APP_PORT="4180"
fi
APP_LOG="$APP_DIR/.e2e-app-${CLUSTER}-${APP_PORT}.log"
FUNDING_PROFILE="${E2E_STAGE_A_FUNDING_PROFILE:-default}"
ACCEPTANCE_CHAINS="${E2E_ACCEPTANCE_CHAINS:-bsc}"
if [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
  LIVE_DUEL_TRADE_WINDOW_MS="${E2E_LIVE_DUEL_TRADE_WINDOW_MS:-240000}"
  LIVE_DUEL_MIN_WINDOW_MS="${E2E_LIVE_DUEL_MIN_WINDOW_MS:-300000}"
else
  LIVE_DUEL_TRADE_WINDOW_MS="${E2E_LIVE_DUEL_TRADE_WINDOW_MS:-175000}"
  LIVE_DUEL_MIN_WINDOW_MS="${E2E_LIVE_DUEL_MIN_WINDOW_MS:-160000}"
fi
PUBLIC_SETUP_SCOPE="${E2E_PUBLIC_SETUP_SCOPE:-default}"
STATE_SETUP_SCRIPT="$APP_DIR/tests/e2e/setup-public.ts"
API_SETUP_SCRIPT="$APP_DIR/tests/e2e/setup-api-local.ts"
API_SEED_SCRIPT="$APP_DIR/tests/e2e/seed-api-local.ts"
CONTROL_PATH="$APP_DIR/tests/e2e/control.json"
CONTROL_ENV_PATH="$APP_DIR/tests/e2e/.acceptance-evm-keeper.env"
EVM_KEEPER_URL="${HYPERBET_BSC_KEEPER_TESTNET_URL:-http://127.0.0.1:18080}"
KEEPER_PORT="${ACCEPTANCE_EVM_KEEPER_PORT:-18080}"
GAME_HTTP_URL="${E2E_GAME_HTTP_URL:-${GAME_HTTP_URL:-http://127.0.0.1:5555}}"
GAME_WS_URL="${E2E_GAME_WS_URL:-${GAME_WS_URL:-ws://127.0.0.1:5556/ws}}"
GAME_CLIENT_URL="${E2E_GAME_CLIENT_URL:-${GAME_CLIENT_URL:-http://127.0.0.1:3333}}"
ACCEPTANCE_SERVICE_DIR="$ROOT/.ci-artifacts/stage-a/acceptance-services"
EVM_PID_FILE="$ACCEPTANCE_SERVICE_DIR/evm-keeper.pid"
EVM_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/evm-keeper.log"
EVM_KEEPER_DB_PATH="$ACCEPTANCE_SERVICE_DIR/evm-keeper-${APP_PORT}-${KEEPER_PORT}.sqlite"
HYPERSCAPES_DUEL_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.pid"
HYPERSCAPES_DUEL_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.log"
HYPERSCAPES_DUEL_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.env"
HYPERSCAPES_CLIENT_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.pid"
HYPERSCAPES_CLIENT_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.log"
HYPERSCAPES_CLIENT_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.env"
PROCESS_CONTROL_SCRIPT="$ROOT/scripts/e2e-process-control.sh"

APP_PID=""
KEEPER_MANAGED="false"
REAL_DUEL_SERVICES_MANAGED="false"

source "$STAGE_A_ENV_FILE"
set -a
source "$LOCAL_ENV_FILE"
set +a

COMMON_GIT_DIR="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -n "$COMMON_GIT_DIR" && "$COMMON_GIT_DIR" != /* ]]; then
  COMMON_GIT_DIR="$ROOT/$COMMON_GIT_DIR"
fi
if [[ -n "$COMMON_GIT_DIR" && -d "$COMMON_GIT_DIR" ]]; then
  WORKSPACE_ROOT="$(cd "$COMMON_GIT_DIR/.." && pwd)"
else
  WORKSPACE_ROOT="$(cd "$ROOT/.." && pwd)"
fi

resolve_hyperscapes_root() {
  local -a candidates=()
  if [[ -n "$E2E_HYPERSCAPES_ROOT_OVERRIDE" ]]; then
    candidates+=("$E2E_HYPERSCAPES_ROOT_OVERRIDE")
  fi
  candidates+=(
    "$WORKSPACE_ROOT/.worktrees/hyperscapes-main-latest-e2e"
    "$WORKSPACE_ROOT/.worktrees/hyperscapes-main-acceptance"
    "$WORKSPACE_ROOT/.worktrees/hyperscapes-main-sync"
    "$WORKSPACE_ROOT/.worktrees/hyperscapes-stream-bet-sync"
    "$WORKSPACE_ROOT/hyperscapes-stream-bet-sync"
    "$WORKSPACE_ROOT/hyperscapes-mono"
    "$ROOT/../.worktrees/hyperscapes-main-latest-e2e"
    "$ROOT/../.worktrees/hyperscapes-main-acceptance"
    "$ROOT/../.worktrees/hyperscapes-main-sync"
    "$ROOT/../.worktrees/hyperscapes-stream-bet-sync"
    "$ROOT/../hyperscapes-stream-bet-sync"
    "$ROOT/../hyperscapes-mono"
  )
  if [[ -n "${HYPERSCAPES_ROOT:-}" ]]; then
    candidates+=("${HYPERSCAPES_ROOT}")
  fi

  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

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
    echo "[e2e] ${label} must use Node ${expected_major}.x for local Hyperscapes validation (got ${version:-unknown} via ${bin})" >&2
    exit 1
  fi
}

port_from_url_or_default() {
  local url="$1"
  local default_port="$2"
  python3 - "$url" "$default_port" <<'PY'
import sys
from urllib.parse import urlparse

url = sys.argv[1]
default_port = sys.argv[2]
parsed = urlparse(url)
print(parsed.port or default_port)
PY
}

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

cleanup() {
  if [[ "$KEEPER_MANAGED" == "true" ]]; then
    bash "$PROCESS_CONTROL_SCRIPT" stop "$CONTROL_PATH" keeper >/dev/null 2>&1 || true
  fi
  if [[ "$REAL_DUEL_SERVICES_MANAGED" == "true" ]]; then
    bash "$PROCESS_CONTROL_SCRIPT" stop "$CONTROL_PATH" hyperscapes >/dev/null 2>&1 || true
  fi
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_app() {
  local url="$1"
  for _ in {1..120}; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep_q "200"; then
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
    echo "[e2e] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
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

write_hyperscapes_service_envs() {
  local resolved_root="$(resolve_hyperscapes_root 2>/dev/null || true)"
  local resolved_node="${NODE_BIN:-$(resolve_node_bin "${NODE_BIN:-}" 2>/dev/null || true)}"
  local resolved_client_node="${DUEL_CLIENT_NODE_BIN:-${resolved_node}}"
  local game_port="${GAME_PORT:-$(port_from_url_or_default "$GAME_HTTP_URL" "5555")}"
  local client_port="${GAME_CLIENT_PORT:-$(port_from_url_or_default "$GAME_CLIENT_URL" "3333")}"
  local default_cdn_url="${GAME_HTTP_URL%/}/game-assets"
  local duel_fresh="${HYPERSCAPES_DUEL_FRESH:-true}"
  local streaming_announcement_ms="${STREAMING_ANNOUNCEMENT_MS:-}"
  local hyperscapes_local_postgres_user="${HYPERSCAPES_LOCAL_POSTGRES_USER:-${LOCAL_POSTGRES_USER:-${USER:-postgres}}}"
  local hyperscapes_local_postgres_port="${HYPERSCAPES_LOCAL_POSTGRES_PORT:-${LOCAL_POSTGRES_PORT:-5432}}"
  local hyperscapes_local_postgres_db="${HYPERSCAPES_LOCAL_POSTGRES_DB:-${POSTGRES_DB:-hyperscape}}"
  local hyperscapes_duel_database_url="${HYPERSCAPES_DUEL_DATABASE_URL:-postgresql://${hyperscapes_local_postgres_user}@127.0.0.1:${hyperscapes_local_postgres_port}/${hyperscapes_local_postgres_db}}"
  local hyperscapes_public_cdn_url="${HYPERSCAPES_PUBLIC_CDN_URL:-${PUBLIC_CDN_URL:-$default_cdn_url}}"

  if [[ -z "$resolved_root" || ! -d "$resolved_root" ]]; then
    echo "[e2e] unable to resolve HYPERSCAPES_ROOT for real_hyperscapes restart control" >&2
    exit 1
  fi
  echo "[e2e] using Hyperscapes root: $resolved_root"
  if [[ -z "$resolved_node" || ! -x "$resolved_node" ]]; then
    echo "[e2e] unable to resolve NODE_BIN for real_hyperscapes restart control" >&2
    exit 1
  fi
  if [[ -z "$resolved_client_node" || ! -x "$resolved_client_node" ]]; then
    echo "[e2e] unable to resolve DUEL_CLIENT_NODE_BIN for real_hyperscapes restart control" >&2
    exit 1
  fi

  require_node_major "$resolved_node" "NODE_BIN" "22"
  require_node_major "$resolved_client_node" "DUEL_CLIENT_NODE_BIN" "22"

  if [[ -z "$streaming_announcement_ms" ]]; then
    if [[ "$duel_fresh" == "true" ]]; then
      streaming_announcement_ms="420000"
    else
      streaming_announcement_ms="180000"
    fi
  fi

  mkdir -p "$ACCEPTANCE_SERVICE_DIR"

  write_shell_env_file \
    "$HYPERSCAPES_DUEL_ENV_FILE" \
    HYPERSCAPES_ROOT "$resolved_root" \
    BUN_BIN "$BUN_BIN" \
    NODE_BIN "$resolved_node" \
    DUEL_CLIENT_NODE_BIN "$resolved_client_node" \
    GAME_HTTP_URL "$GAME_HTTP_URL" \
    GAME_WS_URL "$GAME_WS_URL" \
    GAME_CLIENT_URL "$GAME_CLIENT_URL" \
    GAME_PORT "$game_port" \
    DUEL_BOTS "${DUEL_BOTS:-4}" \
    HYPERSCAPES_SKIP_CHAIN_SETUP "${HYPERSCAPES_SKIP_CHAIN_SETUP:-true}" \
    HYPERSCAPES_DUEL_NODE_ENV "${HYPERSCAPES_DUEL_NODE_ENV:-development}" \
    HYPERSCAPES_USE_PRODUCTION_CLIENT "${HYPERSCAPES_USE_PRODUCTION_CLIENT:-true}" \
    HYPERSCAPES_REUSE_EXISTING_CLIENT "${HYPERSCAPES_REUSE_EXISTING_CLIENT:-false}" \
    HYPERSCAPES_DUEL_FRESH "$duel_fresh" \
    HYPERSCAPES_DUEL_DATABASE_URL "$hyperscapes_duel_database_url" \
    DUEL_ALLOW_FRAME_EMBED "${DUEL_ALLOW_FRAME_EMBED:-true}" \
    HYPERSCAPES_JWT_SECRET "${HYPERSCAPES_JWT_SECRET:-local-dev-secret}" \
    HYPERSCAPES_PUBLIC_CDN_URL "$hyperscapes_public_cdn_url" \
    STREAMING_ANNOUNCEMENT_MS "$streaming_announcement_ms" \
    STREAMING_FIGHTING_MS "${STREAMING_FIGHTING_MS:-60000}" \
    STREAMING_END_WARNING_MS "${STREAMING_END_WARNING_MS:-5000}" \
    STREAMING_RESOLUTION_MS "${STREAMING_RESOLUTION_MS:-5000}" \
    STREAMING_COUNTDOWN_TICKS "${STREAMING_COUNTDOWN_TICKS:-3}" \
    STREAMING_VIEWER_ACCESS_TOKEN "${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}" \
    BETTING_FEED_ACCESS_TOKEN "${BETTING_FEED_ACCESS_TOKEN:-${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}}" \
    STREAM_CAPTURE_HEADLESS "${STREAM_CAPTURE_HEADLESS:-true}" \
    STREAM_CAPTURE_CHANNEL "${STREAM_CAPTURE_CHANNEL:-chromium}" \
    STREAM_CAPTURE_WIDTH "${STREAM_CAPTURE_WIDTH:-1280}" \
    STREAM_CAPTURE_HEIGHT "${STREAM_CAPTURE_HEIGHT:-720}"

  write_shell_env_file \
    "$HYPERSCAPES_CLIENT_ENV_FILE" \
    HYPERSCAPES_ROOT "$resolved_root" \
    GAME_HTTP_URL "$GAME_HTTP_URL" \
    GAME_WS_URL "$GAME_WS_URL" \
    HYPERSCAPES_PUBLIC_CDN_URL "$hyperscapes_public_cdn_url" \
    GAME_CLIENT_PORT "$client_port" \
    NODE_BIN "$resolved_node" \
    DUEL_CLIENT_NODE_BIN "$resolved_client_node"
}

seed_hyperscapes_agents() {
  if [[ "$DUEL_SOURCE" != "real_hyperscapes" ]]; then
    return 0
  fi

  local agents_url="${GAME_HTTP_URL%/}/api/embedded-agents"
  local node_bin="${NODE_BIN:-$(resolve_node_bin "${NODE_BIN:-}" 2>/dev/null || true)}"
  local desired_agents=(
    "pm-local-agent-a"
    "pm-local-agent-b"
  )
  local agents_response=""
  local current_agents=""

  if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
    echo "[e2e] unable to resolve NODE_BIN for Hyperscapes embedded-agent seeding" >&2
    exit 1
  fi

  for _ in $(seq 1 60); do
    agents_response="$(curl -fsSL "$agents_url" 2>/dev/null || true)"
    if [[ -n "$agents_response" ]]; then
      current_agents="$(
        printf '%s' "$agents_response" \
          | "$node_bin" -e '
              const fs = require("fs");
              const input = fs.readFileSync(0, "utf8").trim();
              if (!input) {
                process.stdout.write("[]");
                process.exit(0);
              }
              const data = JSON.parse(input);
              const agents = Array.isArray(data.agents) ? data.agents : [];
              process.stdout.write(JSON.stringify(agents.map((agent) => String(agent.characterId || agent.agentId || "")).filter(Boolean)));
            ' 2>/dev/null || true
      )"
      if [[ -n "$current_agents" ]]; then
        break
      fi
    fi
    sleep 1
  done

  if [[ -z "$current_agents" ]]; then
    echo "[e2e] timed out waiting for Hyperscapes embedded-agent api" >&2
    return 1
  fi

  local agent_id=""
  for agent_id in "${desired_agents[@]}"; do
    if printf '%s\n' "$current_agents" | grep -q -- "\"$agent_id\""; then
      echo "[e2e] Hyperscapes embedded agent present: $agent_id"
      continue
    fi

    echo "[e2e] creating Hyperscapes embedded agent $agent_id"
    curl -fsSL \
      -X POST \
      -H 'content-type: application/json' \
      --data "{\"characterId\":\"$agent_id\",\"autoStart\":true,\"scriptedRole\":\"combat\"}" \
      "$agents_url" >/dev/null
  done

  local stream_state=""
  local phase=""
  local duel_key=""
  for _ in $(seq 1 120); do
    stream_state="$(curl -fsSL "${GAME_HTTP_URL%/}/api/streaming/state" 2>/dev/null || true)"
    phase="$(printf '%s' "$stream_state" | jq -r '.cycle.phase // ""' 2>/dev/null || true)"
    duel_key="$(printf '%s' "$stream_state" | jq -r '.cycle.duelKeyHex // ""' 2>/dev/null || true)"
    if [[ "$phase" != "IDLE" && -n "$duel_key" ]]; then
      echo "[e2e] Hyperscapes duel seeded: phase=${phase} duelKey=${duel_key}"
      return 0
    fi
    sleep 1
  done

  echo "[e2e] timed out waiting for Hyperscapes duel to leave IDLE" >&2
  return 1
}

write_control_files() {
  local bsc_clob
  local avax_clob
  local enable_stream_publish="true"
  local enable_keeper_bot="false"
  local enable_evm_keeper_lifecycle_writes="true"
  local stream_state_source_url=""
  local bet_sync_source_events_url=""
  local bet_sync_source_state_url=""
  local bet_sync_source_bearer_token=""
  local extra_services=""
  bsc_clob="$(jq -r '.goldClobAddress' "$ROOT/packages/evm-contracts/deployments/bscTestnet.json")"
  avax_clob="$(jq -r '.goldClobAddress' "$ROOT/packages/evm-contracts/deployments/avaxFuji.json")"
  if [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
    enable_stream_publish="false"
    enable_keeper_bot="true"
    enable_evm_keeper_lifecycle_writes="false"
    stream_state_source_url="${GAME_HTTP_URL%/}/api/streaming/state"
    write_hyperscapes_service_envs
    extra_services=$(cat <<EOF
,
    "hyperscapes": {
      "pidFile": "$HYPERSCAPES_DUEL_PID_FILE",
      "envFile": "$HYPERSCAPES_DUEL_ENV_FILE",
      "logPath": "$HYPERSCAPES_DUEL_LOG_FILE",
      "cwd": "$ROOT",
      "healthUrl": "${GAME_HTTP_URL%/}/api/streaming/state",
      "streamStateUrl": "${GAME_HTTP_URL%/}/api/streaming/state",
      "startCommand": "bash '$ROOT/scripts/start-hyperscapes-duel-service.sh'"
    }
EOF
)
  fi

  write_shell_env_file \
    "$CONTROL_ENV_PATH" \
    PORT "$KEEPER_PORT" \
    ENABLE_KEEPER_BOT "$enable_keeper_bot" \
    EVM_KEEPER_ENABLE_LIFECYCLE_WRITES "$enable_evm_keeper_lifecycle_writes" \
    EVM_KEEPER_DEFER_FINALIZE "${EVM_KEEPER_DEFER_FINALIZE:-true}" \
    ENABLE_STREAM_PUBLISH "$enable_stream_publish" \
    STREAM_PUBLISH_KEY "${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}" \
    ARENA_EXTERNAL_BET_WRITE_KEY "${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}" \
    GAME_URL "$EVM_KEEPER_URL" \
    CORS_ORIGINS "http://127.0.0.1:4179,http://localhost:4179,http://127.0.0.1:$APP_PORT,http://localhost:$APP_PORT" \
    EVM_KEEPER_CHAINS "$ACCEPTANCE_CHAINS" \
    STREAM_STATE_SOURCE_URL "$stream_state_source_url" \
    BET_SYNC_SOURCE_EVENTS_URL "$bet_sync_source_events_url" \
    BET_SYNC_SOURCE_STATE_URL "$bet_sync_source_state_url" \
    BET_SYNC_SOURCE_BEARER_TOKEN "$bet_sync_source_bearer_token" \
    KEEPER_DB_PATH "$EVM_KEEPER_DB_PATH" \
    E2E_KEEPER_DB_PATH "$EVM_KEEPER_DB_PATH" \
    BSC_RPC_URL "$BSC_RPC_URL" \
    AVAX_RPC_URL "$AVAX_RPC_URL" \
    BSC_GOLD_CLOB_ADDRESS "$bsc_clob" \
    AVAX_GOLD_CLOB_ADDRESS "$avax_clob"

  cat >"$CONTROL_PATH" <<EOF
{
  "controlPath": "$CONTROL_PATH",
  "services": {
    "keeper": {
      "pidFile": "$EVM_PID_FILE",
      "envFile": "$CONTROL_ENV_PATH",
      "logPath": "$EVM_LOG_FILE",
      "cwd": "$ROOT/packages/hyperbet-evm",
      "healthUrl": "http://127.0.0.1:$KEEPER_PORT/status",
      "startCommand": "$BUN_BIN run keeper:service",
      "botHealthUrl": "$EVM_KEEPER_URL/api/keeper/bot-health"
    }$extra_services
  }
}
EOF
}

start_keeper() {
  echo "[e2e] starting keeper on :$KEEPER_PORT"
  bash "$PROCESS_CONTROL_SCRIPT" start "$CONTROL_PATH" keeper
  KEEPER_MANAGED="true"
}

start_real_duel_services() {
  if [[ "$DUEL_SOURCE" != "real_hyperscapes" ]]; then
    return 0
  fi
  echo "[e2e] starting real Hyperscapes duel services"
  bash "$PROCESS_CONTROL_SCRIPT" start "$CONTROL_PATH" hyperscapes
  seed_hyperscapes_agents
  REAL_DUEL_SERVICES_MANAGED="true"
}

case "$CLUSTER" in
  mainnet-beta|testnet|devnet) ;;
  *)
    echo "[e2e] unsupported E2E_CLUSTER=$CLUSTER (expected mainnet-beta, testnet, or devnet)"
    exit 1
    ;;
esac

case "$DUEL_SOURCE" in
  synthetic_publish|real_hyperscapes) ;;
  *)
    echo "[e2e] unsupported E2E_DUEL_SOURCE=$DUEL_SOURCE (expected synthetic_publish or real_hyperscapes)"
    exit 1
    ;;
esac

if [[ "$PUBLIC_SETUP_SCOPE" == "default" ]] && [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
  case " $* " in
    *"market-flows.e2e.ts"*)
      PUBLIC_SETUP_SCOPE="evm_write"
      ;;
  esac
fi

kill_listeners "$APP_PORT"

export E2E_CLUSTER="$CLUSTER"
export E2E_DUEL_SOURCE="$DUEL_SOURCE"
export E2E_ACCEPTANCE_CHAINS="$ACCEPTANCE_CHAINS"
export E2E_LIVE_DUEL_MIN_WINDOW_MS="$LIVE_DUEL_MIN_WINDOW_MS"
export E2E_LIVE_DUEL_TRADE_WINDOW_MS="$LIVE_DUEL_TRADE_WINDOW_MS"
export E2E_PUBLIC_SETUP_SCOPE="$PUBLIC_SETUP_SCOPE"
export E2E_GAME_API_URL="$EVM_KEEPER_URL"
export E2E_GAME_HTTP_URL="$GAME_HTTP_URL"
export E2E_GAME_WS_URL="$GAME_WS_URL"
export E2E_ARENA_WRITE_KEY="${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}"
export E2E_EXPECT_KEEPER_BOT="${E2E_EXPECT_KEEPER_BOT:-$([[ "$DUEL_SOURCE" == "real_hyperscapes" ]] && echo true || echo false)}"
export E2E_KEEPER_DB_PATH="$EVM_KEEPER_DB_PATH"
export ARENA_EXTERNAL_BET_WRITE_KEY="$E2E_ARENA_WRITE_KEY"

write_control_files
start_real_duel_services

if [[ "${E2E_SKIP_PUBLIC_SETUP:-false}" == "true" ]]; then
  echo "[e2e] reusing existing public state + .env.e2e (cluster=$CLUSTER duelSource=$DUEL_SOURCE)"
else
  echo "[e2e] preparing public state + writing .env.e2e (cluster=$CLUSTER duelSource=$DUEL_SOURCE setupScope=$PUBLIC_SETUP_SCOPE)"
  node --import tsx "$ROOT/scripts/fund-stage-a-evm-wallets.ts" --chain bsc --profile "$FUNDING_PROFILE"
  "$BUN_BIN" run "$STATE_SETUP_SCRIPT" --cluster "$CLUSTER"
fi

echo "[e2e] seeding keeper db fixtures"
"$BUN_BIN" run "$API_SETUP_SCRIPT"

start_keeper

echo "[e2e] seeding keeper api fixtures"
"$BUN_BIN" run "$API_SEED_SCRIPT"

echo "[e2e] starting app on :$APP_PORT"
VITE_GAME_WS_URL="$GAME_WS_URL" \
VITE_WS_URL="$GAME_WS_URL" \
VITE_STREAM_URL="${VITE_STREAM_URL:-${GAME_CLIENT_URL%/}/stream.html}" \
"$BUN_BIN" run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" --strictPort >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e] app did not become ready"
  tail -n 120 "$APP_LOG" || true
  exit 1
fi

echo "[e2e] ensuring playwright chromium is installed"
(
  cd "$APP_DIR"
  ./node_modules/.bin/playwright install chromium >/tmp/hyperbet-bsc-playwright-install.log 2>&1
)

echo "[e2e] running playwright tests (cluster=$CLUSTER)"
(
  cd "$APP_DIR"
  E2E_CLUSTER="$CLUSTER" \
  E2E_DUEL_SOURCE="$DUEL_SOURCE" \
  E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
  E2E_GAME_API_URL="$E2E_GAME_API_URL" \
  E2E_EXPECT_KEEPER_BOT="$E2E_EXPECT_KEEPER_BOT" \
  E2E_ARENA_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
    ./node_modules/.bin/playwright test --config "$APP_DIR/tests/e2e/playwright.config.ts" "$@"
)
