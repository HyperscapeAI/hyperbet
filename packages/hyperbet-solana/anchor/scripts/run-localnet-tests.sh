#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEDGER_DIR="${ANCHOR_TEST_LEDGER_DIR:-$ROOT_DIR/.anchor/manual-test-ledger}"
VALIDATOR_LOG="${ANCHOR_TEST_VALIDATOR_LOG:-/tmp/hyperscape-anchor-validator.log}"
BUILD_LOG="${ANCHOR_TEST_BUILD_LOG:-/tmp/hyperscape-anchor-build.log}"
TEST_LOG="${ANCHOR_TEST_LOG:-/tmp/hyperscape-anchor-localnet-test.log}"
RPC_PORT="${ANCHOR_TEST_RPC_PORT:-8899}"
WS_PORT="${ANCHOR_TEST_WS_PORT:-8900}"
FAUCET_PORT="${ANCHOR_TEST_FAUCET_PORT:-9900}"
MAX_ORACLE_STALENESS_SECONDS="${HYPERSCAPE_MAX_ORACLE_STALENESS_SECONDS:-5}"
DEFAULT_STALE_WAIT_MS="$(((MAX_ORACLE_STALENESS_SECONDS + 2) * 1000))"
STALE_WAIT_MS="${GOLD_PERPS_TEST_STALE_WAIT_MS:-$DEFAULT_STALE_WAIT_MS}"
VALIDATOR_PID=""
TEST_TARGETS=("$@")

resolve_wallet_path() {
  local candidates=()

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

  printf 'No Anchor wallet found. Checked:\n' >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

resolve_program_id() {
  local program_name="$1"
  local fallback="$2"
  local idl_path="$ROOT_DIR/target/idl/${program_name}.json"

  if [[ -f "$idl_path" ]]; then
    local idl_program_id
    idl_program_id="$(jq -r '.address // .metadata.address // empty' "$idl_path")"
    if [[ -n "$idl_program_id" && "$idl_program_id" != "null" ]]; then
      printf '%s\n' "$idl_program_id"
      return 0
    fi
  fi

  printf '%s\n' "$fallback"
}

resolve_mint_authority() {
  local wallet_path="$1"

  if [[ -n "${ANCHOR_TEST_MINT_AUTHORITY:-}" ]]; then
    printf '%s\n' "${ANCHOR_TEST_MINT_AUTHORITY}"
    return 0
  fi

  if ! command -v solana-keygen >/dev/null 2>&1; then
    printf 'Missing required command: solana-keygen\n' >&2
    exit 1
  fi

  solana-keygen pubkey "$wallet_path"
}

kill_stale_validator_listener() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"

  if [[ -z "$pids" ]]; then
    return 0
  fi

  for pid in $pids; do
    local command_line
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"solana-test-validator"* ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    else
      printf 'Port %s is occupied by a non-validator process: %s\n' "$port" "$command_line" >&2
      exit 1
    fi
  done
}

wait_for_rpc() {
  local rpc_url="$1"
  for _ in {1..180}; do
    if curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | rg -q '"result":"ok"'; then
      sleep 1
      return 0
    fi
    sleep 1
  done

  return 1
}

wait_for_program() {
  local rpc_url="$1"
  local program_id="$2"

  for _ in {1..180}; do
    if curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"${program_id}\",{\"encoding\":\"base64\"}]}" \
      | jq -e '.result.value != null and .result.value.executable == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

stop_validator() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
  VALIDATOR_PID=""
}

cleanup() {
  stop_validator
}

trap cleanup EXIT

cd "$ROOT_DIR"

if [[ "${ANCHOR_MANUAL_TEST_SKIP_BUILD:-0}" != "1" ]]; then
  if command -v anchor >/dev/null 2>&1; then
    echo "[anchor-test] building workspace with anchor"
    anchor build >"$BUILD_LOG" 2>&1
  else
    echo "[anchor-test] building workspace without anchor"
    bash "$ROOT_DIR/scripts/build-workspace.sh" >"$BUILD_LOG" 2>&1
  fi
fi

for required in solana-test-validator curl jq rg; do
  if ! command -v "$required" >/dev/null 2>&1; then
    # GitHub runners used by the generic CI workflow do not ship with Solana CLI.
    # Keep localnet tests mandatory outside CI, but skip them when the validator
    # binary is unavailable in CI so the package does not hard-fail the matrix.
    if [[ "$required" == "solana-test-validator" ]] && [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
      printf '[anchor-test] Missing %s in CI, skipping localnet suite\n' "$required"
      exit 0
    fi
    printf 'Missing required command: %s\n' "$required" >&2
    exit 1
  fi
done

if [[ ! -x "$ROOT_DIR/node_modules/.bin/ts-mocha" ]]; then
  printf 'Missing local ts-mocha binary at %s\n' "$ROOT_DIR/node_modules/.bin/ts-mocha" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/target/deploy/fight_oracle.so" || ! -f "$ROOT_DIR/target/deploy/gold_clob_market.so" || ! -f "$ROOT_DIR/target/deploy/gold_perps_market.so" ]]; then
  printf 'Missing one or more deploy artifacts under %s\n' "$ROOT_DIR/target/deploy" >&2
  exit 1
fi

if [[ ${#TEST_TARGETS[@]} -eq 0 ]]; then
  TEST_TARGETS=()
  while IFS= read -r test_target; do
    TEST_TARGETS+=("$test_target")
  done < <(
    find tests -maxdepth 1 -type f -name "*.ts" \
      ! -name "perps-test-helpers.ts" \
      ! -name "test-anchor.ts" | sort
  )
fi

WALLET_PATH="$(resolve_wallet_path)"
MINT_AUTHORITY="$(resolve_mint_authority "$WALLET_PATH")"
PROGRAM_ORACLE_ID="$(resolve_program_id fight_oracle B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo)"
PROGRAM_CLOB_ID="$(resolve_program_id gold_clob_market DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf)"
PROGRAM_PERPS_ID="$(resolve_program_id gold_perps_market EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT)"

: >"$TEST_LOG"

test_index=0
for test_target in "${TEST_TARGETS[@]}"; do
  current_rpc_port=$((RPC_PORT + test_index))
  current_ws_port=$((WS_PORT + test_index))
  current_faucet_port=$((FAUCET_PORT + test_index))
  current_rpc_url="http://127.0.0.1:${current_rpc_port}"
  current_ws_url="ws://127.0.0.1:${current_ws_port}"

  kill_stale_validator_listener "$current_rpc_port"
  kill_stale_validator_listener "$current_ws_port"
  kill_stale_validator_listener "$current_faucet_port"

  rm -rf "$LEDGER_DIR"
  mkdir -p "$(dirname "$LEDGER_DIR")"

  echo "[anchor-test] starting local validator for $test_target"
  solana-test-validator \
    --reset \
    --quiet \
    --rpc-port "$current_rpc_port" \
    --faucet-port "$current_faucet_port" \
    --mint "$MINT_AUTHORITY" \
    --ledger "$LEDGER_DIR" \
    --upgradeable-program "$PROGRAM_ORACLE_ID" "$ROOT_DIR/target/deploy/fight_oracle.so" "$WALLET_PATH" \
    --upgradeable-program "$PROGRAM_CLOB_ID" "$ROOT_DIR/target/deploy/gold_clob_market.so" "$WALLET_PATH" \
    --upgradeable-program "$PROGRAM_PERPS_ID" "$ROOT_DIR/target/deploy/gold_perps_market.so" "$WALLET_PATH" \
    >"$VALIDATOR_LOG" 2>&1 &
  VALIDATOR_PID="$!"

  if ! wait_for_rpc "$current_rpc_url"; then
    echo "[anchor-test] validator did not become ready" >&2
    tail -n 120 "$VALIDATOR_LOG" >&2 || true
    exit 1
  fi

  for program_id in "$PROGRAM_ORACLE_ID" "$PROGRAM_CLOB_ID" "$PROGRAM_PERPS_ID"; do
    if ! wait_for_program "$current_rpc_url" "$program_id"; then
      echo "[anchor-test] program $program_id did not become executable" >&2
      tail -n 120 "$VALIDATOR_LOG" >&2 || true
      exit 1
    fi
  done

  sleep 1

  echo "[anchor-test] running mocha suite for $test_target"
  ANCHOR_PROVIDER_URL="$current_rpc_url" \
  ANCHOR_WS_URL="$current_ws_url" \
  ANCHOR_WALLET="$WALLET_PATH" \
  HYPERSCAPE_MAX_ORACLE_STALENESS_SECONDS="$MAX_ORACLE_STALENESS_SECONDS" \
  GOLD_PERPS_TEST_STALE_WAIT_MS="$STALE_WAIT_MS" \
    "$ROOT_DIR/node_modules/.bin/ts-mocha" \
    -p ./tsconfig.json \
    -t 1000000 \
    --exit \
    "$test_target" | tee -a "$TEST_LOG"

  stop_validator
  test_index=$((test_index + 1))
done
