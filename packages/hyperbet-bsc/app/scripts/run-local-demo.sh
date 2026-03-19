#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$(cd "$DEMO_DIR/../hyperbet-solana/anchor" && pwd)"
LEDGER_DIR="$ANCHOR_DIR/.local-demo-ledger"
VALIDATOR_LOG="$APP_DIR/.local-demo-validator.log"
PROGRAM_ORACLE_ID="B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo"
PROGRAM_MARKET_ID="EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT"
PROGRAM_CLOB_ID="DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf"
APP_PORT="${APP_PORT:-4179}"
RPC_URL="http://127.0.0.1:8899"

VALIDATOR_PID=""

resolve_wallet_path() {
  local candidates=()

  if [[ -n "${SOLANA_BOOTSTRAP_KEYPAIR:-}" ]]; then
    candidates+=("${SOLANA_BOOTSTRAP_KEYPAIR}")
  fi
  if [[ -n "${ANCHOR_WALLET:-}" ]]; then
    candidates+=("${ANCHOR_WALLET}")
  fi
  candidates+=(
    "$HOME/.config/solana/hyperscape-keys/deployer.json"
    "$HOME/.config/solana/id.json"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf '[local-demo] no bootstrap wallet found\n' >&2
  exit 1
}

cleanup() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"result":"ok"'; then
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
    echo "[local-demo] clearing existing listeners on :$port"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 1
  fi
}

kill_listeners "$APP_PORT"
kill_listeners 8899

echo "[local-demo] building anchor programs"
bun run --cwd "$ANCHOR_DIR" build >/tmp/hyperbet-bsc-local-build.log 2>&1

IDL_ORACLE_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/fight_oracle.json" 2>/dev/null || true)"
IDL_MARKET_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/gold_perps_market.json" 2>/dev/null || true)"
IDL_CLOB_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/gold_clob_market.json" 2>/dev/null || true)"
if [[ -n "$IDL_ORACLE_ID" && "$IDL_ORACLE_ID" != "null" ]]; then
  PROGRAM_ORACLE_ID="$IDL_ORACLE_ID"
fi
if [[ -n "$IDL_MARKET_ID" && "$IDL_MARKET_ID" != "null" ]]; then
  PROGRAM_MARKET_ID="$IDL_MARKET_ID"
fi
if [[ -n "$IDL_CLOB_ID" && "$IDL_CLOB_ID" != "null" ]]; then
  PROGRAM_CLOB_ID="$IDL_CLOB_ID"
fi

echo "[local-demo] starting local validator"
rm -rf "$LEDGER_DIR"
SOLANA_BOOTSTRAP_KEYPAIR="$(resolve_wallet_path)"
solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LEDGER_DIR" \
  --upgradeable-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_MARKET_ID" "$ANCHOR_DIR/target/deploy/gold_perps_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  --upgradeable-program "$PROGRAM_CLOB_ID" "$ANCHOR_DIR/target/deploy/gold_clob_market.so" "$SOLANA_BOOTSTRAP_KEYPAIR" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID="$!"

if ! wait_for_rpc; then
  echo "[local-demo] validator did not become ready"
  tail -n 120 "$VALIDATOR_LOG" || true
  exit 1
fi

echo "[local-demo] seeding local state + writing app/.env.e2e"
bun run "$APP_DIR/tests/e2e/setup-localnet.ts" >/tmp/hyperbet-bsc-local-seed.log

echo "[local-demo] starting app at http://127.0.0.1:$APP_PORT"
echo "[local-demo] validator log: $VALIDATOR_LOG"
VITE_HEADLESS_WALLET_AUTO_CONNECT=false \
  bun run --cwd "$APP_DIR" dev --mode e2e --port "$APP_PORT"
