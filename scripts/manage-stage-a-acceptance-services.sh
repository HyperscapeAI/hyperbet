#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT/.env.stage-a.testnet.local}"
STAGE_A_ENV_FILE="${STAGE_A_ENV_FILE:-$ROOT/keys/stage-a/export-stage-a.sh}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/.ci-artifacts/stage-a/acceptance-services}"
EVM_PID_FILE="$ARTIFACT_DIR/evm-keeper.pid"
SOLANA_PID_FILE="$ARTIFACT_DIR/solana-keeper.pid"
EVM_LOG_FILE="$ARTIFACT_DIR/evm-keeper.log"
SOLANA_LOG_FILE="$ARTIFACT_DIR/solana-keeper.log"

mkdir -p "$ARTIFACT_DIR"

if [[ ! -f "$STAGE_A_ENV_FILE" ]]; then
  echo "[stage-a-acceptance] missing stage-a env file: $STAGE_A_ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
  echo "[stage-a-acceptance] missing local acceptance env file: $LOCAL_ENV_FILE" >&2
  exit 1
fi

source "$STAGE_A_ENV_FILE"
set -a
source "$LOCAL_ENV_FILE"
set +a

BUN_BIN="${BUN_BIN:-$(command -v bun 2>/dev/null || true)}"
if [[ -z "$BUN_BIN" && -x "$HOME/.bun/bin/bun" ]]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" ]]; then
  echo "[stage-a-acceptance] bun not found" >&2
  exit 1
fi

DUEL_SOURCE="${ACCEPTANCE_DUEL_SOURCE:-${E2E_DUEL_SOURCE:-synthetic_publish}}"
case "$DUEL_SOURCE" in
  synthetic_publish|real_hyperscapes) ;;
  *)
    echo "[stage-a-acceptance] unsupported duel source: $DUEL_SOURCE" >&2
    exit 1
    ;;
esac

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "[stage-a-acceptance] missing required env: $name" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[stage-a-acceptance] $label ready at $url"
      return 0
    fi
    sleep 1
  done
  echo "[stage-a-acceptance] timed out waiting for $label at $url" >&2
  return 1
}

pid_is_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

listener_pid_on_port() {
  local port="$1"
  if [[ -z "$port" ]]; then
    return 0
  fi
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

sync_pid_file_to_listener() {
  local pid_file="$1"
  local port="$2"
  local listener_pid
  listener_pid="$(listener_pid_on_port "$port")"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$pid_file"
  fi
}

stop_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

stop_pid_file() {
  local pid_file="$1"
  local port="${2:-}"
  if pid_is_running "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    stop_pid "$pid"
  fi
  if [[ -n "$port" ]]; then
    local listener_pid
    listener_pid="$(listener_pid_on_port "$port")"
    if [[ -n "$listener_pid" ]]; then
      stop_pid "$listener_pid"
    fi
  fi
  rm -f "$pid_file"
}

resolve_json_field() {
  local file="$1"
  local jq_filter="$2"
  jq -r "$jq_filter" "$file"
}

resolve_bsc_clob() {
  resolve_json_field "$ROOT/packages/evm-contracts/deployments/bscTestnet.json" '.goldClobAddress'
}

resolve_avax_clob() {
  resolve_json_field "$ROOT/packages/evm-contracts/deployments/avaxFuji.json" '.goldClobAddress'
}

resolve_solana_fight_program() {
  resolve_json_field "$ROOT/.ci-artifacts/stage-a/solana-devnet.json" '.oracleProgramId'
}

resolve_solana_clob_program() {
  resolve_json_field "$ROOT/.ci-artifacts/stage-a/solana-devnet.json" '.goldClobProgramId'
}

resolve_solana_perps_program() {
  resolve_json_field "$ROOT/.ci-artifacts/stage-a/solana-devnet.json" '.perps.perpsProgramId'
}

start_evm_keeper() {
  require_env BSC_RPC_URL
  require_env AVAX_RPC_URL
  local bsc_clob="${BSC_GOLD_CLOB_ADDRESS:-$(resolve_bsc_clob)}"
  local avax_clob="${AVAX_GOLD_CLOB_ADDRESS:-$(resolve_avax_clob)}"
  local port="${ACCEPTANCE_EVM_KEEPER_PORT:-8080}"
  local publish_key="${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}"
  local enable_stream_publish="true"
  if [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
    enable_stream_publish="false"
  fi

  local listener_pid
  listener_pid="$(listener_pid_on_port "$port")"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$EVM_PID_FILE"
    echo "[stage-a-acceptance] EVM keeper already running"
    return 0
  fi

  env \
    PORT="$port" \
    ENABLE_KEEPER_BOT="${ENABLE_KEEPER_BOT:-false}" \
    ENABLE_STREAM_PUBLISH="$enable_stream_publish" \
    STREAM_PUBLISH_KEY="$publish_key" \
    ARENA_EXTERNAL_BET_WRITE_KEY="$publish_key" \
    CORS_ORIGINS="http://127.0.0.1:4179,http://127.0.0.1:4180,http://127.0.0.1:4181" \
    EVM_KEEPER_CHAINS="bsc,avax" \
    BSC_RPC_URL="$BSC_RPC_URL" \
    BSC_TESTNET_RPC="${BSC_TESTNET_RPC:-$BSC_RPC_URL}" \
    AVAX_RPC_URL="$AVAX_RPC_URL" \
    AVAX_FUJI_RPC="${AVAX_FUJI_RPC:-$AVAX_RPC_URL}" \
    BSC_GOLD_CLOB_ADDRESS="$bsc_clob" \
    AVAX_GOLD_CLOB_ADDRESS="$avax_clob" \
    nohup "$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-evm/keeper/src/service.ts \
      >"$EVM_LOG_FILE" 2>&1 &

  echo $! >"$EVM_PID_FILE"
  wait_for_http "http://127.0.0.1:${port}/status" "EVM keeper"
  sync_pid_file_to_listener "$EVM_PID_FILE" "$port"
}

start_solana_keeper() {
  require_env SOLANA_RPC_URL
  require_env ORACLE_AUTHORITY_KEYPAIR
  local port="${ACCEPTANCE_SOLANA_KEEPER_PORT:-8081}"
  local publish_key="${ACCEPTANCE_STREAM_PUBLISH_KEY:-hyperbet-stage-a-local-write-key}"
  local fight_program="${FIGHT_ORACLE_PROGRAM_ID:-$(resolve_solana_fight_program)}"
  local clob_program="${GOLD_CLOB_MARKET_PROGRAM_ID:-$(resolve_solana_clob_program)}"
  local perps_program="${GOLD_PERPS_MARKET_PROGRAM_ID:-$(resolve_solana_perps_program)}"
  local enable_stream_publish="true"
  if [[ "$DUEL_SOURCE" == "real_hyperscapes" ]]; then
    enable_stream_publish="false"
  fi

  local listener_pid
  listener_pid="$(listener_pid_on_port "$port")"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$SOLANA_PID_FILE"
    echo "[stage-a-acceptance] Solana keeper already running"
    return 0
  fi

  env \
    PORT="$port" \
    ENABLE_KEEPER_BOT="${ENABLE_KEEPER_BOT:-false}" \
    ENABLE_STREAM_PUBLISH="$enable_stream_publish" \
    STREAM_PUBLISH_KEY="$publish_key" \
    ARENA_EXTERNAL_BET_WRITE_KEY="$publish_key" \
    SOLANA_CLUSTER="${SOLANA_CLUSTER:-devnet}" \
    SOLANA_RPC_URL="$SOLANA_RPC_URL" \
    ORACLE_AUTHORITY_KEYPAIR="$ORACLE_AUTHORITY_KEYPAIR" \
    FIGHT_ORACLE_PROGRAM_ID="$fight_program" \
    GOLD_CLOB_MARKET_PROGRAM_ID="$clob_program" \
    GOLD_PERPS_MARKET_PROGRAM_ID="$perps_program" \
    nohup "$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-solana/keeper/src/service.ts \
      >"$SOLANA_LOG_FILE" 2>&1 &

  echo $! >"$SOLANA_PID_FILE"
  wait_for_http "http://127.0.0.1:${port}/status" "Solana keeper"
  sync_pid_file_to_listener "$SOLANA_PID_FILE" "$port"
}

status_services() {
  local evm_port="${ACCEPTANCE_EVM_KEEPER_PORT:-8080}"
  local solana_port="${ACCEPTANCE_SOLANA_KEEPER_PORT:-8081}"
  echo "evm_pid_file=$EVM_PID_FILE"
  if pid_is_running "$EVM_PID_FILE"; then
    echo "evm_running=true"
    curl -fsS "http://127.0.0.1:${evm_port}/status" || true
    echo
  else
    echo "evm_running=false"
  fi
  echo "solana_pid_file=$SOLANA_PID_FILE"
  if pid_is_running "$SOLANA_PID_FILE"; then
    echo "solana_running=true"
    curl -fsS "http://127.0.0.1:${solana_port}/status" || true
    echo
  else
    echo "solana_running=false"
  fi
}

case "${1:-start}" in
  start)
    start_evm_keeper
    start_solana_keeper
    status_services
    ;;
  stop)
    stop_pid_file "$EVM_PID_FILE" "${ACCEPTANCE_EVM_KEEPER_PORT:-8080}"
    stop_pid_file "$SOLANA_PID_FILE" "${ACCEPTANCE_SOLANA_KEEPER_PORT:-8081}"
    ;;
  status)
    status_services
    ;;
  restart)
    stop_pid_file "$EVM_PID_FILE" "${ACCEPTANCE_EVM_KEEPER_PORT:-8080}"
    stop_pid_file "$SOLANA_PID_FILE" "${ACCEPTANCE_SOLANA_KEEPER_PORT:-8081}"
    start_evm_keeper
    start_solana_keeper
    status_services
    ;;
  *)
    echo "usage: $(basename "$0") [start|stop|status|restart]" >&2
    exit 1
    ;;
esac
