#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP_DIR/../../.." && pwd)"
export PATH="/Users/mac/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
BUN_BIN="${BUN_BIN:-/Users/mac/.bun/bin/bun}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT/.env.stage-a.testnet.local}"
STAGE_A_ENV_FILE="${STAGE_A_ENV_FILE:-$ROOT/keys/stage-a/export-stage-a.sh}"
CLUSTER="${E2E_CLUSTER:-devnet}"
DUEL_SOURCE="${E2E_DUEL_SOURCE:-${ACCEPTANCE_DUEL_SOURCE:-synthetic_publish}}"
APP_PORT="${E2E_APP_PORT:-4179}"
APP_LOG="$APP_DIR/.e2e-app-${CLUSTER}-${APP_PORT}.log"
STATE_SETUP_SCRIPT="$APP_DIR/tests/e2e/setup-public.ts"
API_SETUP_SCRIPT="$APP_DIR/tests/e2e/setup-api-local.ts"
API_SEED_SCRIPT="$APP_DIR/tests/e2e/seed-api-local.ts"
CONTROL_PATH="$APP_DIR/tests/e2e/control.json"
CONTROL_ENV_PATH="$APP_DIR/tests/e2e/.acceptance-solana-keeper.env"
SOLANA_KEEPER_URL="${HYPERBET_SOLANA_KEEPER_TESTNET_URL:-http://127.0.0.1:18081}"
KEEPER_PORT="${ACCEPTANCE_SOLANA_KEEPER_PORT:-18081}"
GAME_HTTP_URL="${E2E_GAME_HTTP_URL:-${GAME_HTTP_URL:-http://127.0.0.1:5555}}"
GAME_WS_URL="${E2E_GAME_WS_URL:-${GAME_WS_URL:-ws://127.0.0.1:5556/ws}}"
GAME_CLIENT_URL="${E2E_GAME_CLIENT_URL:-${GAME_CLIENT_URL:-http://127.0.0.1:3333}}"
ACCEPTANCE_SERVICE_DIR="$ROOT/.ci-artifacts/stage-a/acceptance-services"
SOLANA_PID_FILE="$ACCEPTANCE_SERVICE_DIR/solana-keeper.pid"
SOLANA_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/solana-keeper.log"
HYPERSCAPES_DUEL_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.pid"
HYPERSCAPES_DUEL_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.log"
HYPERSCAPES_DUEL_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes.env"
HYPERSCAPES_CLIENT_PID_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.pid"
HYPERSCAPES_CLIENT_LOG_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.log"
HYPERSCAPES_CLIENT_ENV_FILE="$ACCEPTANCE_SERVICE_DIR/hyperscapes-client.env"
PROCESS_CONTROL_SCRIPT="$ROOT/scripts/e2e-process-control.sh"

APP_PID=""
KEEPER_MANAGED="false"

source "$STAGE_A_ENV_FILE"
set -a
source "$LOCAL_ENV_FILE"
set +a

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

write_control_files() {
  local enable_stream_publish="true"
  local stream_state_source_url=""
  local extra_services=""
  if [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
    enable_stream_publish="false"
    stream_state_source_url="${GAME_HTTP_URL%/}/api/streaming/state"
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
    },
    "hyperscapesClient": {
      "pidFile": "$HYPERSCAPES_CLIENT_PID_FILE",
      "envFile": "$HYPERSCAPES_CLIENT_ENV_FILE",
      "logPath": "$HYPERSCAPES_CLIENT_LOG_FILE",
      "cwd": "$ROOT",
      "healthUrl": "$GAME_CLIENT_URL",
      "startCommand": "bash '$ROOT/scripts/start-hyperscapes-client-preview.sh'"
    }
EOF
)
  fi
  write_shell_env_file \
    "$CONTROL_ENV_PATH" \
    PORT "$KEEPER_PORT" \
    ENABLE_KEEPER_BOT "false" \
    ENABLE_STREAM_PUBLISH "$enable_stream_publish" \
    STREAM_PUBLISH_KEY "${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}" \
    ARENA_EXTERNAL_BET_WRITE_KEY "${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}" \
    STREAM_STATE_SOURCE_URL "$stream_state_source_url" \
    SOLANA_CLUSTER "${SOLANA_CLUSTER:-devnet}" \
    SOLANA_RPC_URL "$SOLANA_RPC_URL" \
    ORACLE_AUTHORITY_KEYPAIR "$ORACLE_AUTHORITY_KEYPAIR" \
    FIGHT_ORACLE_PROGRAM_ID "${STAGE_A_FIGHT_ORACLE_PROGRAM_ID:-$FIGHT_ORACLE_PROGRAM_ID}" \
    GOLD_CLOB_MARKET_PROGRAM_ID "${STAGE_A_GOLD_CLOB_MARKET_PROGRAM_ID:-$GOLD_CLOB_MARKET_PROGRAM_ID}" \
    GOLD_PERPS_MARKET_PROGRAM_ID "${STAGE_A_GOLD_PERPS_PROGRAM_ID:-$GOLD_PERPS_MARKET_PROGRAM_ID}"

  cat >"$CONTROL_PATH" <<EOF
{
  "controlPath": "$CONTROL_PATH",
  "services": {
    "keeper": {
      "pidFile": "$SOLANA_PID_FILE",
      "envFile": "$CONTROL_ENV_PATH",
      "logPath": "$SOLANA_LOG_FILE",
      "cwd": "$ROOT/packages/hyperbet-solana",
      "healthUrl": "http://127.0.0.1:$KEEPER_PORT/status",
      "startCommand": "$BUN_BIN run keeper:service",
      "botHealthUrl": "$SOLANA_KEEPER_URL/api/keeper/bot-health"
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

kill_listeners "$APP_PORT"

export E2E_CLUSTER="$CLUSTER"
export E2E_DUEL_SOURCE="$DUEL_SOURCE"
export E2E_GAME_API_URL="$SOLANA_KEEPER_URL"
export E2E_GAME_HTTP_URL="$GAME_HTTP_URL"
export E2E_GAME_WS_URL="$GAME_WS_URL"
export E2E_LIVE_DUEL_MIN_WINDOW_MS="${E2E_LIVE_DUEL_MIN_WINDOW_MS:-60000}"
export E2E_ARENA_WRITE_KEY="${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}"
export E2E_EXPECT_KEEPER_BOT="${E2E_EXPECT_KEEPER_BOT:-false}"
export ARENA_EXTERNAL_BET_WRITE_KEY="$E2E_ARENA_WRITE_KEY"

if [[ "${E2E_SKIP_PUBLIC_SETUP:-false}" == "true" ]]; then
  echo "[e2e] reusing existing public state + .env.e2e (cluster=$CLUSTER duelSource=$DUEL_SOURCE)"
else
  echo "[e2e] preparing public state + writing .env.e2e (cluster=$CLUSTER duelSource=$DUEL_SOURCE)"
  "$BUN_BIN" run "$STATE_SETUP_SCRIPT" --cluster "$CLUSTER"
fi

echo "[e2e] seeding keeper db fixtures"
"$BUN_BIN" run "$API_SETUP_SCRIPT"

write_control_files
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
  ./node_modules/.bin/playwright install chromium >/tmp/hyperbet-solana-playwright-install.log 2>&1
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
