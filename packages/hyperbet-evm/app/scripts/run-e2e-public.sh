#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$(cd "$DEMO_DIR/../hyperbet-solana/anchor" && pwd)"
APP_PORT="${E2E_APP_PORT:-4182}"
APP_LOG="$APP_DIR/.e2e-app-${E2E_CLUSTER:-mainnet-beta}.log"
CLUSTER="${E2E_CLUSTER:-mainnet-beta}"
ORACLE_KEYPAIR_PATH="$ANCHOR_DIR/target/deploy/fight_oracle-keypair.json"
CLOB_KEYPAIR_PATH="$ANCHOR_DIR/target/deploy/gold_clob_market-keypair.json"
PERPS_KEYPAIR_PATH="$ANCHOR_DIR/target/deploy/gold_perps_market-keypair.json"
PROGRAM_ORACLE_ID="$(solana-keygen pubkey "$ORACLE_KEYPAIR_PATH")"
PROGRAM_CLOB_ID="$(solana-keygen pubkey "$CLOB_KEYPAIR_PATH")"
PROGRAM_PERPS_ID="$(solana-keygen pubkey "$PERPS_KEYPAIR_PATH")"

APP_PID=""

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

account_exists() {
  local cluster="$1"
  local pubkey="$2"
  if solana account "$pubkey" --url "$cluster" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

deploy_testnet_programs_if_requested() {
  if [[ "$CLUSTER" != "testnet" ]]; then
    return 0
  fi
  if [[ "${E2E_DEPLOY_TESTNET_PROGRAMS:-false}" != "true" ]]; then
    return 0
  fi

  if account_exists testnet "$PROGRAM_ORACLE_ID" \
    && account_exists testnet "$PROGRAM_CLOB_ID" \
    && account_exists testnet "$PROGRAM_PERPS_ID"; then
    echo "[e2e] testnet programs already deployed"
    return 0
  fi

  echo "[e2e] testnet deploy requested, deploying all Solana betting programs"
  bash "$ANCHOR_DIR/scripts/deploy-programs.sh" testnet
}

case "$CLUSTER" in
  mainnet-beta|testnet) ;;
  *)
    echo "[e2e] unsupported E2E_CLUSTER=$CLUSTER (expected mainnet-beta or testnet)"
    exit 1
    ;;
esac

kill_listeners "$APP_PORT"
deploy_testnet_programs_if_requested

echo "[e2e] preparing public state + writing .env.e2e (cluster=$CLUSTER)"
bun run "$APP_DIR/tests/e2e/setup-public.ts" --cluster "$CLUSTER"

echo "[e2e] starting app on :$APP_PORT"
bun run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID="$!"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e] app did not become ready"
  tail -n 120 "$APP_LOG" || true
  exit 1
fi

echo "[e2e] ensuring playwright chromium is installed"
(
  cd "$APP_DIR"
  bunx playwright install chromium >/tmp/hyperbet-bsc-playwright-install.log 2>&1
)

echo "[e2e] running playwright tests (cluster=$CLUSTER)"
(
  cd "$APP_DIR"
  E2E_CLUSTER="$CLUSTER" \
  E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
    bunx playwright test --config "tests/e2e/playwright.config.ts" "$@"
)
