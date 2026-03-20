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
HYPERSCAPES_ROOT="${HYPERSCAPES_ROOT:-$WORKSPACE_ROOT/.worktrees/hyperscapes-stream-bet-sync}"
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
if [[ -z "$BUN_BIN" && -x "/Users/mac/.bun/bin/bun" ]]; then
  BUN_BIN="/Users/mac/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" ]]; then
  echo "[pm-local] bun binary not found; set BUN_BIN or install bun" >&2
  exit 1
fi
export PATH="$(dirname "$BUN_BIN"):$PATH"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
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
GAME_WS_URL="${GAME_WS_URL:-ws://127.0.0.1:5555/ws}"
GAME_CLIENT_URL="${GAME_CLIENT_URL:-http://127.0.0.1:3333}"
GAME_PORT="${GAME_PORT:-5555}"
KEEPER_PORT="${KEEPER_PORT:-8080}"
APP_PORT="${APP_PORT:-4179}"
APP_MODE="${APP_MODE:-testnet}"
if [[ "$PM_LOCAL_EVM_MODE" == "anvil" && "$APP_MODE" == "testnet" ]]; then
  APP_MODE="e2e"
fi
DUEL_BOTS="${DUEL_BOTS:-4}"
SOLANA_CLUSTER="${SOLANA_CLUSTER:-testnet}"
EVM_KEEPER_CHAINS="${EVM_KEEPER_CHAINS:-bsc,avax}"
HYPERSCAPES_SKIP_CHAIN_SETUP="${HYPERSCAPES_SKIP_CHAIN_SETUP:-true}"
HYPERSCAPES_DUEL_NODE_ENV="${HYPERSCAPES_DUEL_NODE_ENV:-development}"
HYPERSCAPES_JWT_SECRET="${HYPERSCAPES_JWT_SECRET:-local-dev-secret}"
STREAMING_VIEWER_ACCESS_TOKEN="${STREAMING_VIEWER_ACCESS_TOKEN:-pm-local-stream-viewer-token}"
KEEPER_URL="http://127.0.0.1:${KEEPER_PORT}"
LOCAL_EVM_UI_KEY_FILE="${LOCAL_EVM_UI_KEY_FILE:-$ROOT/keys/local-smoke/evm-ui.privatekey}"
DEFAULT_STREAM_URL="${GAME_CLIENT_URL}/stream.html?disableBridgeCapture=1&streamToken=${STREAMING_VIEWER_ACCESS_TOKEN}"
STREAM_URL="${VITE_STREAM_URL:-${DEFAULT_STREAM_URL}}"
HYPERSCAPES_UI_URL="${HYPERSCAPES_UI_URL:-${DEFAULT_STREAM_URL}}"
HYPERBET_UI_URL="${HYPERBET_UI_URL:-http://127.0.0.1:${APP_PORT}/?debug}"
OPEN_LOCAL_UI="${OPEN_LOCAL_UI:-true}"
CAPTURE_LOCAL_UI_FLOW="${CAPTURE_LOCAL_UI_FLOW:-true}"
LOCAL_CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:3333,http://localhost:3333,http://127.0.0.1:4179,http://localhost:4179}"
WRITER_KEYS_READY="false"
KEEPER_BOT_DEFAULT="true"
EVM_KEEPER_DEFER_FINALIZE="${EVM_KEEPER_DEFER_FINALIZE:-true}"
LOCAL_STREAM_DUEL_KEY_HEX=""
LOCAL_STREAM_DUEL_ID=""
LOCAL_STREAM_PHASE=""
LOCAL_STREAM_BET_OPEN_TIME_MS=""
LOCAL_STREAM_BET_CLOSE_TIME_MS=""
LOCAL_STREAM_FIGHT_START_TIME_MS=""
LOCAL_EVM_ADMIN_PRIVATE_KEY="${LOCAL_EVM_ADMIN_PRIVATE_KEY:-0xac0974bec39a17e36ba4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
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

DUEL_PID=""
LOCAL_BSC_ANVIL_PID=""
LOCAL_AVAX_ANVIL_PID=""
KEEPER_PID=""
APP_PID=""
CAPTURE_PID=""
EVM_SEED_FOLLOW_PID=""

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

seed_hyperscapes_agents() {
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
      echo "[pm-local] Hyperscapes embedded agent present: $agent_id"
      continue
    fi

    echo "[pm-local] creating Hyperscapes embedded agent $agent_id"
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
      echo "[pm-local] Hyperscapes duel seeded: phase=${phase} duelKey=${duel_key}"
      return 0
    fi
    sleep 1
  done

  echo "[pm-local] timed out waiting for Hyperscapes duel to leave IDLE" >&2
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

  echo "[pm-local] starting local ${chain_key} anvil on ${rpc_url}"
  close_existing_anvil_listeners "$anvil_port"
  "$ANVIL_BIN" \
    --silent \
    --host 127.0.0.1 \
    --port "$anvil_port" \
    --chain-id "$chain_id" \
    >"$anvil_log" 2>&1 &
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
    PORT="$GAME_PORT" \
    DUEL_NODE_ENV="$HYPERSCAPES_DUEL_NODE_ENV" \
    JWT_SECRET="$HYPERSCAPES_JWT_SECRET" \
    STREAMING_VIEWER_ACCESS_TOKEN="$STREAMING_VIEWER_ACCESS_TOKEN" \
    "$BUN_BIN" "${duel_args[@]}"
) &
DUEL_PID=$!

wait_for_http "${GAME_HTTP_URL}/api/streaming/state" "Hyperscapes streaming state"
seed_hyperscapes_agents

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

  start_local_evm_chain "bsc" "$LOCAL_BSC_CHAIN_ID" "$LOCAL_BSC_ANVIL_PORT" "$LOCAL_BSC_SETUP_SCRIPT" "$LOCAL_BSC_STATE_PATH"
  start_local_evm_chain "avax" "$LOCAL_AVAX_CHAIN_ID" "$LOCAL_AVAX_ANVIL_PORT" "$LOCAL_AVAX_SETUP_SCRIPT" "$LOCAL_AVAX_STATE_PATH"

  follow_live_evm_duel_seed "$LOCAL_STREAM_DUEL_KEY_HEX" &
  EVM_SEED_FOLLOW_PID=$!
fi

echo "[pm-local] starting Hyperbet EVM keeper service on :$KEEPER_PORT"
(
  cd "$ROOT"
    keeper_env=(
      BET_SYNC_SOURCE_EVENTS_URL="${GAME_HTTP_URL}/api/internal/bet-sync/events"
      BET_SYNC_SOURCE_STATE_URL="${GAME_HTTP_URL}/api/internal/bet-sync/state"
      BET_SYNC_SOURCE_BEARER_TOKEN="$STREAMING_VIEWER_ACCESS_TOKEN"
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
(
  cd "$ROOT"
  app_env=(
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
  echo "[pm-local] starting local PM follow monitor"
  (
    cd "$ROOT"
      HYPERSCAPES_UI_URL="$HYPERSCAPES_UI_URL" \
      HYPERBET_UI_URL="$HYPERBET_UI_URL" \
      VITE_STREAM_URL="${VITE_STREAM_URL:-$HYPERSCAPES_UI_URL}" \
      SOURCE_STREAM_STATE_URL="${SOURCE_STREAM_STATE_URL:-${GAME_HTTP_URL}/api/streaming/state}" \
      STREAM_STATE_URL="${STREAM_STATE_URL:-${KEEPER_URL}/api/streaming/state}" \
      ACTIVE_MARKETS_URL="${KEEPER_URL}/api/arena/prediction-markets/active" \
      OVERVIEW_MARKETS_URL="${OVERVIEW_MARKETS_URL:-${KEEPER_URL}/api/arena/prediction-markets/overview}" \
      SYNC_STATUS_URL="${SYNC_STATUS_URL:-${KEEPER_URL}/api/sync/status}" \
      PM_SOAK_RECONCILE_PUBLISH_URL="${PM_SOAK_RECONCILE_PUBLISH_URL:-${KEEPER_URL}/api/streaming/state/publish}" \
      PM_SOAK_RECONCILE_PUBLISH_KEY="${PM_SOAK_RECONCILE_PUBLISH_KEY:-${STREAM_PUBLISH_KEY:-${ARENA_EXTERNAL_BET_WRITE_KEY:-${E2E_ARENA_WRITE_KEY:-}}}}" \
      PM_SOAK_SCREENSHOTS="${PM_SOAK_SCREENSHOTS:-true}" \
      BUN_BIN="$BUN_BIN" \
      "$NODE_BIN" --import tsx scripts/pm-soak-monitor.ts --mode=local --follow --duration-min="${PM_SOAK_LOCAL_DURATION_MIN:-25}" --poll-ms="${PM_SOAK_POLL_MS:-5000}"
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
  - Hyperbet keeper consumes ${GAME_HTTP_URL}/api/internal/bet-sync/events and exposes
    /api/arena/prediction-markets/overview for the UI.
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
  if [[ -n "$EVM_SEED_FOLLOW_PID" ]] && ! kill -0 "$EVM_SEED_FOLLOW_PID" >/dev/null 2>&1; then
    wait "$EVM_SEED_FOLLOW_PID"
    exit $?
  fi
  sleep 2
done
