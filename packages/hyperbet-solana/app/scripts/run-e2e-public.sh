#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="${E2E_CLUSTER:-devnet}"
APP_PORT="${E2E_APP_PORT:-4179}"
APP_LOG="$APP_DIR/.e2e-app-${CLUSTER}-${APP_PORT}.log"
STATE_SETUP_SCRIPT="$APP_DIR/tests/e2e/setup-public.ts"
APP_PID=""

BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "[e2e-public] bun is required" >&2
  exit 1
fi

case "$CLUSTER" in
  devnet|testnet) ;;
  *)
    echo "[e2e-public] read-only browser acceptance supports devnet or testnet; received $CLUSTER" >&2
    exit 1
    ;;
esac

if [[ -n "${SOLANA_ACCEPTANCE_ENV_FILE:-}" ]]; then
  if [[ ! -f "$SOLANA_ACCEPTANCE_ENV_FILE" ]]; then
    echo "[e2e-public] SOLANA_ACCEPTANCE_ENV_FILE does not exist" >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  source "$SOLANA_ACCEPTANCE_ENV_FILE"
  set +a
fi

E2E_GAME_API_URL="${E2E_GAME_API_URL:-${HYPERBET_SOLANA_KEEPER_TESTNET_URL:-}}"
if [[ -z "$E2E_GAME_API_URL" ]]; then
  echo "[e2e-public] E2E_GAME_API_URL must identify the Solana keeper" >&2
  exit 1
fi
if [[ -z "${SOLANA_RPC_URL:-}" ]]; then
  echo "[e2e-public] SOLANA_RPC_URL must be explicitly configured" >&2
  exit 1
fi

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_app() {
  local url="$1"
  for _ in {1..90}; do
    if [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if lsof -tiTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[e2e-public] app port $APP_PORT is already in use" >&2
  exit 1
fi

export E2E_CLUSTER="$CLUSTER"
export E2E_GAME_API_URL
export E2E_EXPECT_KEEPER_BOT="true"

echo "[e2e-public] validating live Solana state without chain writes"
"$BUN_BIN" run "$STATE_SETUP_SCRIPT" --cluster "$CLUSTER"

echo "[e2e-public] starting local acceptance UI on :$APP_PORT"
VITE_TERMS_URL="${VITE_TERMS_URL:-/terms}" \
VITE_PRIVACY_URL="${VITE_PRIVACY_URL:-/privacy}" \
  "$BUN_BIN" run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" --strictPort >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e-public] app did not become ready" >&2
  tail -n 120 "$APP_LOG" || true
  exit 1
fi

echo "[e2e-public] running read-only browser acceptance (cluster=$CLUSTER)"
E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
  "$BUN_BIN" x playwright test \
    --config "$APP_DIR/tests/e2e/playwright.config.ts" \
    "$APP_DIR/tests/e2e/app-tabs-and-apis.e2e.ts" \
    "$@"
