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
HYPERSCAPES_ROOT="${HYPERSCAPES_ROOT:-$(cd "$WORKSPACE_ROOT/.." && pwd)/hyperscapes-mono}"

if [[ ! -d "$HYPERSCAPES_ROOT" ]]; then
  echo "[pm-local] hyperscapes repo not found at $HYPERSCAPES_ROOT" >&2
  exit 1
fi

ENV_FILES=(
  "$ROOT/.env.stage-a.testnet.local"
  "$ROOT/.env.testnet.local"
  "$ROOT/packages/hyperbet-evm/keeper/.env"
  "$ROOT/packages/hyperbet-evm/app/.env.local"
)

for env_file in "${ENV_FILES[@]}"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

GAME_HTTP_URL="${GAME_HTTP_URL:-http://127.0.0.1:5555}"
GAME_WS_URL="${GAME_WS_URL:-ws://127.0.0.1:5555/ws}"
GAME_CLIENT_URL="${GAME_CLIENT_URL:-http://127.0.0.1:3333}"
KEEPER_PORT="${KEEPER_PORT:-8080}"
APP_PORT="${APP_PORT:-4179}"
APP_MODE="${APP_MODE:-testnet}"
DUEL_BOTS="${DUEL_BOTS:-4}"
SOLANA_CLUSTER="${SOLANA_CLUSTER:-testnet}"
EVM_KEEPER_CHAINS="${EVM_KEEPER_CHAINS:-bsc,avax}"
HYPERSCAPES_SKIP_CHAIN_SETUP="${HYPERSCAPES_SKIP_CHAIN_SETUP:-true}"
HYPERSCAPES_DUEL_NODE_ENV="${HYPERSCAPES_DUEL_NODE_ENV:-development}"
HYPERSCAPES_JWT_SECRET="${HYPERSCAPES_JWT_SECRET:-local-dev-secret}"
STREAM_URL="${VITE_STREAM_URL:-${GAME_CLIENT_URL}/?page=stream}"
KEEPER_URL="http://127.0.0.1:${KEEPER_PORT}"
LOCAL_EVM_UI_KEY_FILE="${LOCAL_EVM_UI_KEY_FILE:-$ROOT/keys/local-smoke/evm-ui.privatekey}"
HYPERSCAPES_UI_URL="${HYPERSCAPES_UI_URL:-${GAME_CLIENT_URL}/stream.html}"
HYPERBET_UI_URL="${HYPERBET_UI_URL:-http://127.0.0.1:${APP_PORT}}"
OPEN_LOCAL_UI="${OPEN_LOCAL_UI:-true}"
CAPTURE_LOCAL_UI_FLOW="${CAPTURE_LOCAL_UI_FLOW:-true}"
WRITER_KEYS_READY="false"
KEEPER_BOT_DEFAULT="true"

DUEL_PID=""
KEEPER_PID=""
APP_PID=""
CAPTURE_PID=""

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

  if [[ -n "$KEEPER_PID" ]] && kill -0 "$KEEPER_PID" >/dev/null 2>&1; then
    kill "$KEEPER_PID" >/dev/null 2>&1 || true
    wait "$KEEPER_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$DUEL_PID" ]] && kill -0 "$DUEL_PID" >/dev/null 2>&1; then
    kill "$DUEL_PID" >/dev/null 2>&1 || true
    wait "$DUEL_PID" >/dev/null 2>&1 || true
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

warn_missing_writer_keys() {
  local reporter="${EVM_REPORTER_PRIVATE_KEY:-${TESTNET_REPORTER_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"
  local operator="${EVM_MARKET_OPERATOR_PRIVATE_KEY:-${TESTNET_MARKET_OPERATOR_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"
  local finalizer="${EVM_FINALIZER_PRIVATE_KEY:-${TESTNET_FINALIZER_PRIVATE_KEY:-${EVM_KEEPER_PRIVATE_KEY:-${PRIVATE_KEY:-}}}}"

  if [[ -z "$reporter" || -z "$operator" || -z "$finalizer" ]]; then
    cat >&2 <<'EOF'
[pm-local] warning: missing one or more local EVM writer keys.
[pm-local] local Hyperscapes -> keeper -> UI will still boot, but deployed BSC/AVAX
[pm-local] markets will not open/resolve from local duel events without existing
[pm-local] reporter/operator/finalizer authority.
EOF
    WRITER_KEYS_READY="false"
    KEEPER_BOT_DEFAULT="false"
    return
  fi

  WRITER_KEYS_READY="true"
}

if [[ -f "$LOCAL_EVM_UI_KEY_FILE" && -z "${VITE_HEADLESS_EVM_PRIVATE_KEY:-}" ]]; then
  export VITE_HEADLESS_EVM_PRIVATE_KEY
  VITE_HEADLESS_EVM_PRIVATE_KEY="$(tr -d '\n' < "$LOCAL_EVM_UI_KEY_FILE")"
fi

warn_missing_writer_keys
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

echo "[pm-local] starting Hyperscapes duel stack from $HYPERSCAPES_ROOT"
(
  cd "$HYPERSCAPES_ROOT"
  duel_args=(
    run
    duel
    --skip-betting
    --skip-keeper
    "--bots=${DUEL_BOTS}"
  )
  if [[ "$HYPERSCAPES_SKIP_CHAIN_SETUP" == "true" ]]; then
    duel_args+=(--skip-chain-setup)
  fi
  DUEL_WITH_HYPERBET=false \
    DUEL_NODE_ENV="$HYPERSCAPES_DUEL_NODE_ENV" \
    JWT_SECRET="$HYPERSCAPES_JWT_SECRET" \
    bun "${duel_args[@]}"
) &
DUEL_PID=$!

wait_for_http "${GAME_HTTP_URL}/api/streaming/state" "Hyperscapes streaming state"

echo "[pm-local] starting Hyperbet EVM keeper service on :$KEEPER_PORT"
(
  cd "$ROOT"
  STREAM_STATE_SOURCE_URL="${GAME_HTTP_URL}/api/streaming/state" \
    PORT="$KEEPER_PORT" \
    GAME_URL="$KEEPER_URL" \
    SOLANA_CLUSTER="$SOLANA_CLUSTER" \
    EVM_KEEPER_CHAINS="$EVM_KEEPER_CHAINS" \
    ENABLE_KEEPER_BOT="$ENABLE_KEEPER_BOT" \
    bun run --cwd packages/hyperbet-evm keeper:service
) &
KEEPER_PID=$!

wait_for_http "${KEEPER_URL}/status" "Hyperbet keeper service"

echo "[pm-local] starting Hyperbet EVM app on :$APP_PORT"
(
  cd "$ROOT"
  VITE_GAME_API_URL="$KEEPER_URL" \
    VITE_GAME_WS_URL="$GAME_WS_URL" \
    VITE_WS_URL="$GAME_WS_URL" \
    VITE_STREAM_URL="$STREAM_URL" \
    VITE_SOLANA_CLUSTER="$SOLANA_CLUSTER" \
    bun run --cwd packages/hyperbet-evm/app dev \
      --mode "$APP_MODE" \
      --host \
      --port "$APP_PORT"
) &
APP_PID=$!

wait_for_http "http://127.0.0.1:${APP_PORT}" "Hyperbet EVM app"

if [[ "$OPEN_LOCAL_UI" == "true" ]]; then
  echo "[pm-local] opening Hyperscapes UI at ${HYPERSCAPES_UI_URL}"
  open_url "$HYPERSCAPES_UI_URL"
  echo "[pm-local] opening Hyperbet UI at ${HYPERBET_UI_URL}"
  open_url "$HYPERBET_UI_URL"
fi

if [[ "$CAPTURE_LOCAL_UI_FLOW" == "true" ]]; then
  echo "[pm-local] starting local UI flow capture"
  (
    cd "$ROOT"
    HYPERSCAPES_UI_URL="$HYPERSCAPES_UI_URL" \
      HYPERBET_UI_URL="$HYPERBET_UI_URL" \
      STREAM_STATE_URL="${KEEPER_URL}/api/streaming/state" \
      ACTIVE_MARKETS_URL="${KEEPER_URL}/api/arena/prediction-markets/active" \
      node --import tsx scripts/capture-hyperscapes-pm-local-flow.ts
  ) &
  CAPTURE_PID=$!
fi

cat <<EOF
[pm-local] integrated local stack is up
  hyperscapes: ${GAME_HTTP_URL}
  keeper:      ${KEEPER_URL}
  app:         http://127.0.0.1:${APP_PORT}
  stream:      ${STREAM_URL}
  hyperscapes-ui: ${HYPERSCAPES_UI_URL}
  hyperbet-ui:    ${HYPERBET_UI_URL}
  writer-bot:  ${ENABLE_KEEPER_BOT}
  write-keys:  ${WRITER_KEYS_READY}

[pm-local] notes:
  - Hyperscapes remains the duel event source.
  - Hyperbet keeper polls ${GAME_HTTP_URL}/api/streaming/state and exposes
    /api/arena/prediction-markets/active for the UI.
  - Current local game lifecycle supports open -> lock -> resolve, not cancel.
  - This local runner defaults to skipping Hyperscapes MUD chain bootstrap and
    running the duel server in development mode because Hyperbet consumes the
    duel telemetry API, not the sibling repo's local anvil world.
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
  sleep 2
done
