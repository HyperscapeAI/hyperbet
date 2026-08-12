#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEMO_DIR/../.." && pwd)"
ANCHOR_DIR="$DEMO_DIR/anchor"
KEEPER_DIR="$DEMO_DIR/keeper"
ANCHOR_BUILD_LOG="/tmp/hyperbet-solana-e2e-build.log"
STATE_PATH="$APP_DIR/tests/e2e/state.json"
CONTROL_PATH="$APP_DIR/tests/e2e/control.json"
VALIDATOR_LOG="$APP_DIR/.e2e-validator.log"
APP_LOG="$APP_DIR/.e2e-app.log"
SOLANA_PROXY_LOG="$APP_DIR/.e2e-solana-proxy.log"
KEEPER_LOG="$APP_DIR/.e2e-keeper.log"
DUEL_BOT_LOG="$APP_DIR/.e2e-duel-bot.log"
BET_SYNC_FEED_LOG="$APP_DIR/.e2e-bet-sync-feed.log"
APP_PID_FILE="$APP_DIR/.e2e-app.pid"
VALIDATOR_PID_FILE="$APP_DIR/.e2e-validator.pid"
SOLANA_PROXY_PID_FILE="$APP_DIR/.e2e-solana-proxy.pid"
KEEPER_PID_FILE="$APP_DIR/.e2e-keeper.pid"
DUEL_BOT_PID_FILE="$APP_DIR/.e2e-duel-bot.pid"
BET_SYNC_FEED_PID_FILE="$APP_DIR/.e2e-bet-sync-feed.pid"
HYPERIA_PID_FILE="$APP_DIR/.e2e-hyperia.pid"
HYPERIA_LOG="$APP_DIR/.e2e-hyperia.log"
HYPERIA_ENV_FILE="$APP_DIR/.e2e-hyperia.env"
SOLANA_PROXY_ENV_FILE="$APP_DIR/.e2e-solana-proxy.env"
SOLANA_PROXY_FAULT_CONTROL_PATH="$APP_DIR/.e2e-solana-rpc-fault.json"
KEEPER_ENV_FILE="$APP_DIR/.e2e-keeper.env"
DUEL_BOT_ENV_FILE="$APP_DIR/.e2e-duel-bot.env"
PROGRAM_ORACLE_ID="B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo"
PROGRAM_DUEL_MARKET_ID="DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf"
APP_PORT="${E2E_APP_PORT:-4181}"
GAME_API_PORT="${E2E_GAME_API_PORT:-5555}"
GAME_API_URL="http://127.0.0.1:${GAME_API_PORT}"
BET_SYNC_FEED_PORT="${E2E_BET_SYNC_FEED_PORT:-$((GAME_API_PORT + 1))}"
BET_SYNC_FEED_URL="http://127.0.0.1:${BET_SYNC_FEED_PORT}"
PW_HEADLESS="${PW_HEADLESS:-1}"
PW_WEBGPU_ARGS="${PW_WEBGPU_ARGS:---enable-unsafe-webgpu}"
if [[ "$(uname -s)" == "Darwin" && -z "${PW_BROWSER_CHANNEL:-}" ]]; then
  PW_BROWSER_CHANNEL="chrome"
fi
export PW_HEADLESS PW_WEBGPU_ARGS PW_BROWSER_CHANNEL
KEEPER_DB_PATH="${E2E_KEEPER_DB_PATH:-$APP_DIR/.e2e-keeper.sqlite}"
KEEPER_STATUS_DIR="$KEEPER_DIR/.status"
KEEPER_BOT_HEALTH_PATH="$KEEPER_STATUS_DIR/keeper-bot-health.json"
KEEPER_STREAM_STATE_PATH="$KEEPER_STATUS_DIR/stream-state.json"
SOLANA_RPC_PORT="${E2E_SOLANA_RPC_PORT:-18899}"
# solana-test-validator exposes websocket on rpc-port + 1; keep the harness
# aligned with that invariant so alternate RPC ports stay portable.
SOLANA_WS_PORT="$((SOLANA_RPC_PORT + 1))"
SOLANA_FAUCET_PORT="${E2E_SOLANA_FAUCET_PORT:-18901}"
SOLANA_GOSSIP_PORT="${E2E_SOLANA_GOSSIP_PORT:-18902}"
SOLANA_DYNAMIC_PORT_START="${E2E_SOLANA_DYNAMIC_PORT_START:-$((SOLANA_RPC_PORT + 100))}"
SOLANA_DYNAMIC_PORT_END="${E2E_SOLANA_DYNAMIC_PORT_END:-$((SOLANA_DYNAMIC_PORT_START + 99))}"
LEDGER_DIR="${E2E_SOLANA_LEDGER_DIR:-$APP_DIR/.e2e-ledger-${SOLANA_RPC_PORT}}"
SOLANA_RPC_URL="http://127.0.0.1:${SOLANA_RPC_PORT}"
SOLANA_WS_URL="ws://127.0.0.1:${SOLANA_WS_PORT}"
SOLANA_PROXY_PORT="${E2E_SOLANA_PROXY_PORT:-$((20000 + RANDOM % 10000))}"
SOLANA_PROXY_URL="http://127.0.0.1:${SOLANA_PROXY_PORT}"
SOLANA_PROXY_WS_URL="ws://127.0.0.1:${SOLANA_PROXY_PORT}"
E2E_ARENA_WRITE_KEY="${E2E_ARENA_WRITE_KEY:-hyperbet-e2e-local-write-key}"
E2E_DUEL_SOURCE="${E2E_DUEL_SOURCE:-synthetic_publish}"
case "$E2E_DUEL_SOURCE" in
  synthetic_publish|real_hyperia) ;;
  *)
    echo "[e2e] E2E_DUEL_SOURCE must be synthetic_publish or real_hyperia" >&2
    exit 1
    ;;
esac
HYPERIA_ROOT="${E2E_HYPERIA_ROOT:-$REPO_ROOT/../hyperia-implementation}"
HYPERIA_API_PORT="${E2E_HYPERIA_API_PORT:-15555}"
HYPERIA_URL="http://127.0.0.1:${HYPERIA_API_PORT}"
HYPERIA_BET_SYNC_STATE_URL="$HYPERIA_URL/api/internal/bet-sync/state"
HYPERIA_BET_SYNC_TOKEN="${E2E_HYPERIA_BET_SYNC_TOKEN:-hyperia-sol-e2e-bet-sync-token}"
HYPERIA_POSTGRES_CONTAINER="hyperia-sol-e2e-${SOLANA_RPC_PORT}-$$"
HYPERIA_POSTGRES_USER="hyperia_sol_e2e"
HYPERIA_POSTGRES_PASSWORD="hyperia-sol-e2e-password"
HYPERIA_POSTGRES_DB="hyperia_sol_e2e"
HYPERIA_ANNOUNCEMENT_MS="${E2E_HYPERIA_ANNOUNCEMENT_MS:-1800000}"
HYPERIA_RESOLUTION_MS="${E2E_HYPERIA_RESOLUTION_MS:-10000}"
REAL_HYPERIA_MIN_OPEN_WINDOW_MS="${E2E_REAL_HYPERIA_MIN_OPEN_WINDOW_MS:-600000}"
for duration_name in HYPERIA_ANNOUNCEMENT_MS HYPERIA_RESOLUTION_MS REAL_HYPERIA_MIN_OPEN_WINDOW_MS; do
  duration_value="${!duration_name}"
  if [[ ! "$duration_value" =~ ^[1-9][0-9]*$ ]]; then
    echo "[e2e] ${duration_name} must be a positive integer" >&2
    exit 1
  fi
done
if (( HYPERIA_ANNOUNCEMENT_MS < 60000 )); then
  echo "[e2e] E2E_HYPERIA_ANNOUNCEMENT_MS must be at least 60000" >&2
  exit 1
fi
if (( HYPERIA_RESOLUTION_MS < 10000 )); then
  echo "[e2e] E2E_HYPERIA_RESOLUTION_MS must be at least 10000" >&2
  exit 1
fi
if (( REAL_HYPERIA_MIN_OPEN_WINDOW_MS < 60000 )); then
  echo "[e2e] E2E_REAL_HYPERIA_MIN_OPEN_WINDOW_MS must be at least 60000" >&2
  exit 1
fi
if (( REAL_HYPERIA_MIN_OPEN_WINDOW_MS >= HYPERIA_ANNOUNCEMENT_MS )); then
  echo "[e2e] E2E_REAL_HYPERIA_MIN_OPEN_WINDOW_MS must be below E2E_HYPERIA_ANNOUNCEMENT_MS" >&2
  exit 1
fi
E2E_ORACLE_DISPUTE_WINDOW_SECS="${E2E_SOLANA_ORACLE_DISPUTE_WINDOW_SECS:-60}"
if [[ ! "$E2E_ORACLE_DISPUTE_WINDOW_SECS" =~ ^[1-9][0-9]*$ ]] || (( E2E_ORACLE_DISPUTE_WINDOW_SECS < 60 )); then
  echo "[e2e] E2E_SOLANA_ORACLE_DISPUTE_WINDOW_SECS must be an integer >= 60" >&2
  exit 1
fi
if [[ "$E2E_DUEL_SOURCE" == "real_hyperia" && ! -f "$HYPERIA_ROOT/packages/server/scripts/run-agent-duel-bet-sync-service.ts" ]]; then
  echo "[e2e] modern Hyperia SOL betting source is missing at $HYPERIA_ROOT" >&2
  exit 1
fi

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

resolve_vite_bin() {
  local candidate
  for candidate in \
    "$APP_DIR/node_modules/.bin/vite" \
    "$DEMO_DIR/node_modules/.bin/vite" \
    "$REPO_ROOT/node_modules/.bin/vite"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "[e2e] unable to resolve Vite from app, package, or workspace node_modules" >&2
  return 1
}

grep_q() {
  local pattern="$1"
  if has_cmd rg; then
    rg -q "$pattern"
  else
    grep -q "$pattern"
  fi
}
resolve_localnet_wallet_path() {
  local candidates=()

  if [[ -n "${E2E_SOLANA_BOOTSTRAP_KEYPAIR:-}" ]]; then
    candidates+=("${E2E_SOLANA_BOOTSTRAP_KEYPAIR}")
  fi
  candidates+=(
    "$HOME/.config/solana/hyperia-keys/deployer.json"
    "$HOME/.config/solana/id.json"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf 'No local E2E bootstrap wallet found. Checked:\n' >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

resolve_localnet_mint_authority() {
  local wallet_path="$1"

  if [[ -n "${E2E_SOLANA_MINT_AUTHORITY:-}" ]]; then
    printf '%s\n' "${E2E_SOLANA_MINT_AUTHORITY}"
    return 0
  fi

  solana-keygen pubkey "$wallet_path"
}

BOOTSTRAP_WALLET_PATH="$(resolve_localnet_wallet_path)"
SOLANA_MINT_AUTHORITY="$(resolve_localnet_mint_authority "$BOOTSTRAP_WALLET_PATH")"
VITE_BIN="$(resolve_vite_bin)"

write_pid_file() {
  local pid_file="$1"
  local pid="$2"
  printf '%s\n' "$pid" >"$pid_file"
}

kill_pid_file_process() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
}

write_env_file() {
  local env_file="$1"
  shift
  : >"$env_file"
  while (( "$#" )); do
    local key="$1"
    local value="$2"
    shift 2
    printf '%s=%q\n' "$key" "$value" >>"$env_file"
  done
}

write_control_file() {
  jq -n \
    --arg appDir "$APP_DIR" \
    --arg chainKey "solana" \
    --arg statePath "$STATE_PATH" \
    --arg controlPath "$CONTROL_PATH" \
    --arg appPidFile "$APP_PID_FILE" \
    --arg appUrl "http://127.0.0.1:${APP_PORT}/" \
    --arg keeperPidFile "$KEEPER_PID_FILE" \
    --arg keeperLog "$KEEPER_LOG" \
    --arg keeperEnv "$KEEPER_ENV_FILE" \
    --arg keeperCwd "$KEEPER_DIR" \
    --arg keeperHealthUrl "$GAME_API_URL/status" \
    --arg keeperBotHealthUrl "$GAME_API_URL/api/keeper/bot-health" \
    --arg duelBotPidFile "$DUEL_BOT_PID_FILE" \
    --arg duelBotLog "$DUEL_BOT_LOG" \
    --arg duelBotEnv "$DUEL_BOT_ENV_FILE" \
    --arg solanaProxyPidFile "$SOLANA_PROXY_PID_FILE" \
    --arg solanaProxyLog "$SOLANA_PROXY_LOG" \
    --arg solanaProxyEnv "$SOLANA_PROXY_ENV_FILE" \
    --arg solanaProxyFaultControlPath "$SOLANA_PROXY_FAULT_CONTROL_PATH" \
    --arg solanaProxyRpcUrl "$SOLANA_PROXY_URL" \
    --arg validatorPidFile "$VALIDATOR_PID_FILE" \
    --arg validatorLog "$VALIDATOR_LOG" \
    --arg solanaRpcUrl "$SOLANA_RPC_URL" \
    --arg solanaWsUrl "$SOLANA_WS_URL" \
    --arg duelSource "$E2E_DUEL_SOURCE" \
    --arg hyperiaPidFile "$HYPERIA_PID_FILE" \
    --arg hyperiaLog "$HYPERIA_LOG" \
    --arg hyperiaEnv "$HYPERIA_ENV_FILE" \
    --arg hyperiaCwd "$HYPERIA_ROOT/packages/server" \
    --arg hyperiaHealthUrl "$HYPERIA_URL/health" \
    --arg hyperiaStreamStateUrl "$HYPERIA_URL/api/streaming/state" \
    '{
      version: 1,
      chainKey: $chainKey,
      appDir: $appDir,
      statePath: $statePath,
      controlPath: $controlPath,
      rpc: {
        solanaRpcUrl: $solanaRpcUrl,
        solanaWsUrl: $solanaWsUrl
      },
      services: ({
        app: {
          pidFile: $appPidFile,
          url: $appUrl
        },
        keeper: {
          pidFile: $keeperPidFile,
          logPath: $keeperLog,
          envFile: $keeperEnv,
          cwd: $keeperCwd,
          healthUrl: $keeperHealthUrl,
          botHealthUrl: $keeperBotHealthUrl
        },
        keeperBot: {
          pidFile: $duelBotPidFile,
          logPath: $duelBotLog,
          envFile: $duelBotEnv,
          cwd: $keeperCwd,
          healthUrl: $keeperBotHealthUrl,
          startCommand: "bun run duel-bot",
          restartSignal: "SIGKILL"
        },
        solanaProxy: {
          pidFile: $solanaProxyPidFile,
          logPath: $solanaProxyLog,
          envFile: $solanaProxyEnv,
          rpcUrl: $solanaProxyRpcUrl,
          faultControlPath: $solanaProxyFaultControlPath
        },
        validator: {
          pidFile: $validatorPidFile,
          logPath: $validatorLog,
          rpcUrl: $solanaRpcUrl
        }
      } + (if $duelSource == "real_hyperia" then {
        hyperia: {
          pidFile: $hyperiaPidFile,
          logPath: $hyperiaLog,
          envFile: $hyperiaEnv,
          cwd: $hyperiaCwd,
          healthUrl: $hyperiaHealthUrl,
          streamStateUrl: $hyperiaStreamStateUrl,
          startCommand: "bun run service:agent-duel-bet-sync-e2e",
          restartSignal: "SIGKILL"
        }
      } else {} end))
    }' >"$CONTROL_PATH"
}

VALIDATOR_PID=""
APP_PID=""
SOLANA_PROXY_PID=""
KEEPER_PID=""
DUEL_BOT_PID=""
BET_SYNC_FEED_PID=""
HYPERIA_PID=""

cleanup() {
  local exit_code=$?
  kill_pid_file_process "$APP_PID_FILE"
  kill_pid_file_process "$KEEPER_PID_FILE"
  kill_pid_file_process "$DUEL_BOT_PID_FILE"
  kill_pid_file_process "$BET_SYNC_FEED_PID_FILE"
  kill_pid_file_process "$HYPERIA_PID_FILE"
  kill_pid_file_process "$SOLANA_PROXY_PID_FILE"
  kill_pid_file_process "$VALIDATOR_PID_FILE"
  if [[ "$E2E_DUEL_SOURCE" == "real_hyperia" ]]; then
    docker rm -f "$HYPERIA_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -f \
    "$APP_PID_FILE" \
    "$VALIDATOR_PID_FILE" \
    "$SOLANA_PROXY_PID_FILE" \
    "$KEEPER_PID_FILE" \
    "$DUEL_BOT_PID_FILE" \
    "$BET_SYNC_FEED_PID_FILE" \
    "$HYPERIA_PID_FILE" \
    "$HYPERIA_ENV_FILE" \
    "$SOLANA_PROXY_ENV_FILE" \
    "$KEEPER_ENV_FILE" \
    "$DUEL_BOT_ENV_FILE" \
    "$SOLANA_PROXY_FAULT_CONTROL_PATH" \
    "$CONTROL_PATH"
  trap - EXIT
  exit "$exit_code"
}
trap cleanup EXIT

wait_for_solana_rpc() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_RPC_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}' | grep_q '"blockhash"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_ws() {
  for _ in {1..90}; do
    if (exec 3<>"/dev/tcp/127.0.0.1/${SOLANA_WS_PORT}") >/dev/null 2>&1; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep 1
  done
  return 1
}

read_solana_slot() {
  curl -s -X POST "$SOLANA_RPC_URL" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"confirmed"}]}' \
    | jq -r '.result // empty'
}

wait_for_solana_block_production() {
  local previous_slot=""
  for _ in {1..120}; do
    local current_slot
    if current_slot="$(read_solana_slot)"; then
      if [[ -n "$previous_slot" && "$current_slot" -gt "$previous_slot" ]]; then
        return 0
      fi
      previous_slot="$current_slot"
    fi
    sleep 1
  done
  return 1
}

wait_for_solana_proxy() {
  for _ in {1..90}; do
    if curl -s -X POST "$SOLANA_PROXY_URL" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' | grep_q '"solana-core"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_app() {
  local url="$1"
  for _ in {1..90}; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep_q "200"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_hyperia_postgres() {
  for _ in {1..90}; do
    if docker exec "$HYPERIA_POSTGRES_CONTAINER" \
      pg_isready -U "$HYPERIA_POSTGRES_USER" -d "$HYPERIA_POSTGRES_DB" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_real_hyperia_source() {
  echo "[e2e] starting persisted Hyperia duel-authority source"
  docker run --rm -d \
    --name "$HYPERIA_POSTGRES_CONTAINER" \
    -e "POSTGRES_USER=$HYPERIA_POSTGRES_USER" \
    -e "POSTGRES_PASSWORD=$HYPERIA_POSTGRES_PASSWORD" \
    -e "POSTGRES_DB=$HYPERIA_POSTGRES_DB" \
    -p 127.0.0.1::5432 \
    postgres:16-alpine >/dev/null
  if ! wait_for_hyperia_postgres; then
    echo "[e2e] Hyperia PostgreSQL did not become ready" >&2
    docker logs "$HYPERIA_POSTGRES_CONTAINER" 2>&1 | tail -n 80 || true
    exit 1
  fi

  local postgres_port
  postgres_port="$(docker port "$HYPERIA_POSTGRES_CONTAINER" 5432/tcp | awk -F: 'END {print $NF}')"
  if [[ ! "$postgres_port" =~ ^[1-9][0-9]*$ ]]; then
    echo "[e2e] could not resolve Hyperia PostgreSQL port" >&2
    exit 1
  fi
  local database_url="postgresql://${HYPERIA_POSTGRES_USER}:${HYPERIA_POSTGRES_PASSWORD}@127.0.0.1:${postgres_port}/${HYPERIA_POSTGRES_DB}"

  write_env_file \
    "$HYPERIA_ENV_FILE" \
    NODE_ENV "development" \
    JWT_SECRET "hyperia-sol-e2e-jwt-secret" \
    SECRET_SALT "hyperia-sol-e2e-secret-salt" \
    AGENT_DUEL_BET_SYNC_DATABASE_URL "$database_url" \
    AGENT_DUEL_BET_SYNC_PORT "$HYPERIA_API_PORT" \
    BETTING_FEED_ACCESS_TOKEN "$HYPERIA_BET_SYNC_TOKEN" \
    STREAMING_DUEL_ENABLED "true" \
    STREAMING_DUEL_PREPARATION_MS "60000" \
    STREAMING_PERSIST_STATS "false" \
    STREAMING_AGENT_SKIP_DB_LOAD "false" \
    STREAMING_DUEL_COMBAT_AI_ENABLED "true" \
    EMBEDDED_AGENT_DUEL_PREPARATION_LLM "false" \
    STREAMING_ANNOUNCEMENT_MS "$HYPERIA_ANNOUNCEMENT_MS" \
    STREAMING_COUNTDOWN_TICKS "3" \
    STREAMING_FIGHTING_MS "150000" \
    STREAMING_RESOLUTION_MS "$HYPERIA_RESOLUTION_MS"

  (
    cd "$HYPERIA_ROOT/packages/server"
    set -a
    source "$HYPERIA_ENV_FILE"
    set +a
    exec bun run service:agent-duel-bet-sync-e2e
  ) >"$HYPERIA_LOG" 2>&1 &
  HYPERIA_PID="$!"
  write_pid_file "$HYPERIA_PID_FILE" "$HYPERIA_PID"
  if ! wait_for_app "$HYPERIA_URL/health"; then
    echo "[e2e] persisted Hyperia duel-authority source did not become ready" >&2
    tail -n 160 "$HYPERIA_LOG" || true
    exit 1
  fi
  if ! curl -fsS \
    -H "authorization: Bearer $HYPERIA_BET_SYNC_TOKEN" \
    "$HYPERIA_BET_SYNC_STATE_URL" \
    | jq -e '.schemaVersion == 3 and .competitiveSnapshot.persisted == true and .competitiveSnapshot.diagnostic == false' \
    >/dev/null; then
    echo "[e2e] Hyperia betting source did not expose non-diagnostic schema-v3 truth" >&2
    tail -n 160 "$HYPERIA_LOG" || true
    exit 1
  fi
}

run_with_retries() {
  local label="$1"
  local attempts="$2"
  shift 2

  local attempt=1
  while (( attempt <= attempts )); do
    if "$@"; then
      return 0
    fi

    if (( attempt == attempts )); then
      echo "[e2e] ${label} failed after ${attempts} attempts"
      return 1
    fi

    echo "[e2e] ${label} failed, retrying (${attempt}/${attempts})"
    sleep 2
    attempt=$((attempt + 1))
  done
}

kill_listeners() {
  local port="$1"
  local pids=""

  if has_cmd lsof; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  elif has_cmd netstat; then
    pids="$(netstat -ano 2>/dev/null | awk -v p=":${port}" '$1=="TCP" && $2 ~ (p"$") && $4=="LISTENING" { print $5 }' | sort -u)"
  fi

  if [[ -n "$pids" ]]; then
    echo "[e2e] clearing existing listeners on :$port"
    for pid in $pids; do
      if has_cmd taskkill; then
        taskkill //PID "$pid" //F >/dev/null 2>&1 || true
      else
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
    sleep 1
  fi
}

kill_listeners "$APP_PORT"
kill_listeners "$GAME_API_PORT"
kill_listeners "$BET_SYNC_FEED_PORT"
if [[ "$E2E_DUEL_SOURCE" == "real_hyperia" ]]; then
  kill_listeners "$HYPERIA_API_PORT"
  docker rm -f "$HYPERIA_POSTGRES_CONTAINER" >/dev/null 2>&1 || true
fi
kill_listeners "$SOLANA_RPC_PORT"
kill_listeners "$SOLANA_WS_PORT"
kill_listeners "$SOLANA_FAUCET_PORT"
kill_listeners "$SOLANA_GOSSIP_PORT"
pkill -f "packages/hyperbet-solana/app/scripts/solana-rpc-proxy.mjs" >/dev/null 2>&1 || true
kill_listeners "$SOLANA_PROXY_PORT"
rm -f "$KEEPER_DB_PATH" "${KEEPER_DB_PATH}-shm" "${KEEPER_DB_PATH}-wal"
rm -f "$KEEPER_BOT_HEALTH_PATH" "$KEEPER_STREAM_STATE_PATH"
rm -f \
  "$APP_PID_FILE" \
  "$VALIDATOR_PID_FILE" \
  "$SOLANA_PROXY_PID_FILE" \
  "$KEEPER_PID_FILE" \
  "$DUEL_BOT_PID_FILE" \
  "$BET_SYNC_FEED_PID_FILE" \
  "$HYPERIA_PID_FILE" \
  "$HYPERIA_ENV_FILE" \
  "$SOLANA_PROXY_ENV_FILE" \
  "$KEEPER_ENV_FILE" \
  "$DUEL_BOT_ENV_FILE" \
  "$SOLANA_PROXY_FAULT_CONTROL_PATH" \
  "$CONTROL_PATH"

if [[ "${E2E_SKIP_PREBUILD:-false}" != "true" ]]; then
  echo "[e2e] building anchor programs"
  if ! bun run --cwd "$ANCHOR_DIR" build >"$ANCHOR_BUILD_LOG" 2>&1; then
    echo "[e2e] anchor build failed"
    tail -n 200 "$ANCHOR_BUILD_LOG" || true
    exit 1
  fi
else
  echo "[e2e] skipping shared prebuild"
fi

if [[ "$E2E_DUEL_SOURCE" == "real_hyperia" ]]; then
  start_real_hyperia_source
fi

IDL_ORACLE_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/fight_oracle.json" 2>/dev/null || true)"
IDL_DUEL_MARKET_ID="$(jq -r '.address // .metadata.address // empty' "$ANCHOR_DIR/target/idl/duel_market.json" 2>/dev/null || true)"
if [[ -n "$IDL_ORACLE_ID" && "$IDL_ORACLE_ID" != "null" ]]; then
  PROGRAM_ORACLE_ID="$IDL_ORACLE_ID"
fi
if [[ -n "$IDL_DUEL_MARKET_ID" && "$IDL_DUEL_MARKET_ID" != "null" ]]; then
  PROGRAM_DUEL_MARKET_ID="$IDL_DUEL_MARKET_ID"
fi

echo "[e2e] starting local validator"
rm -rf "$LEDGER_DIR"
VALIDATOR_PROGRAM_ARGS=(
  --upgradeable-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" "$BOOTSTRAP_WALLET_PATH"
  --upgradeable-program "$PROGRAM_DUEL_MARKET_ID" "$ANCHOR_DIR/target/deploy/duel_market.so" "$BOOTSTRAP_WALLET_PATH"
)
solana-test-validator \
  --reset \
  --quiet \
  --rpc-port "$SOLANA_RPC_PORT" \
  --faucet-port "$SOLANA_FAUCET_PORT" \
  --gossip-port "$SOLANA_GOSSIP_PORT" \
  --dynamic-port-range "${SOLANA_DYNAMIC_PORT_START}-${SOLANA_DYNAMIC_PORT_END}" \
  --mint "$SOLANA_MINT_AUTHORITY" \
  --ledger "$LEDGER_DIR" \
  "${VALIDATOR_PROGRAM_ARGS[@]}" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID="$!"
write_pid_file "$VALIDATOR_PID_FILE" "$VALIDATOR_PID"

if ! wait_for_solana_rpc; then
  echo "[e2e] validator did not become ready"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
if ! wait_for_solana_ws; then
  echo "[e2e] validator websocket did not become ready"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
if ! wait_for_solana_block_production; then
  echo "[e2e] validator did not begin producing blocks"
  tail -n 80 "$VALIDATOR_LOG" || true
  exit 1
fi
sleep 5

echo "[e2e] starting local solana rpc proxy"
write_env_file \
  "$SOLANA_PROXY_ENV_FILE" \
  SOLANA_RPC_TARGET "$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET "$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT "$SOLANA_PROXY_PORT" \
  SOLANA_PROXY_E2E_FAULTS_ENABLED "true" \
  SOLANA_PROXY_E2E_FAULT_CONTROL_PATH "$SOLANA_PROXY_FAULT_CONTROL_PATH" \
  SOLANA_PROXY_E2E_FAULT_HOLD_MS "30000"
env \
  SOLANA_RPC_TARGET="$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET="$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT="$SOLANA_PROXY_PORT" \
  SOLANA_PROXY_E2E_FAULTS_ENABLED="true" \
  SOLANA_PROXY_E2E_FAULT_CONTROL_PATH="$SOLANA_PROXY_FAULT_CONTROL_PATH" \
  SOLANA_PROXY_E2E_FAULT_HOLD_MS="30000" \
  node "$APP_DIR/scripts/solana-rpc-proxy.mjs" >"$SOLANA_PROXY_LOG" 2>&1 &
SOLANA_PROXY_PID="$!"
write_pid_file "$SOLANA_PROXY_PID_FILE" "$SOLANA_PROXY_PID"
disown "$SOLANA_PROXY_PID" 2>/dev/null || true

if ! wait_for_solana_proxy; then
  echo "[e2e] solana proxy did not become ready"
  tail -n 80 "$SOLANA_PROXY_LOG" || true
  exit 1
fi

echo "[e2e] seeding local solana state + writing .env.e2e"
run_with_retries \
  "solana e2e setup" \
  3 \
  env \
    E2E_SOLANA_RPC_URL="$SOLANA_RPC_URL" \
    E2E_SOLANA_WS_URL="$SOLANA_WS_URL" \
    E2E_BROWSER_SOLANA_RPC_URL="$SOLANA_PROXY_URL" \
    E2E_BROWSER_SOLANA_WS_URL="$SOLANA_PROXY_WS_URL" \
    E2E_SOLANA_BOOTSTRAP_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
    E2E_DUEL_SOURCE="$E2E_DUEL_SOURCE" \
    E2E_HYPERIA_BET_SYNC_STATE_URL="$HYPERIA_BET_SYNC_STATE_URL" \
    E2E_HYPERIA_BET_SYNC_BEARER_TOKEN="$HYPERIA_BET_SYNC_TOKEN" \
    E2E_REAL_HYPERIA_MIN_OPEN_WINDOW_MS="$REAL_HYPERIA_MIN_OPEN_WINDOW_MS" \
    bun run "$APP_DIR/tests/e2e/setup-localnet.ts"

echo "[e2e] starting keeper api on :$GAME_API_PORT"
write_env_file \
  "$KEEPER_ENV_FILE" \
  PORT "$GAME_API_PORT" \
  KEEPER_DB_PATH "$KEEPER_DB_PATH" \
  SOLANA_CLUSTER "localnet" \
  SOLANA_RPC_URL "$SOLANA_RPC_URL" \
  FIGHT_ORACLE_PROGRAM_ID "$PROGRAM_ORACLE_ID" \
  DUEL_MARKET_PROGRAM_ID "$PROGRAM_DUEL_MARKET_ID" \
  ARENA_EXTERNAL_BET_WRITE_KEY "$E2E_ARENA_WRITE_KEY" \
  STREAM_PUBLISH_KEY "$E2E_ARENA_WRITE_KEY"
KEEPER_SERVICE_ENV=(
  PORT="$GAME_API_PORT"
  KEEPER_DB_PATH="$KEEPER_DB_PATH"
  SOLANA_CLUSTER="localnet"
  SOLANA_RPC_URL="$SOLANA_RPC_URL"
  FIGHT_ORACLE_PROGRAM_ID="$PROGRAM_ORACLE_ID"
  DUEL_MARKET_PROGRAM_ID="$PROGRAM_DUEL_MARKET_ID"
  ARENA_EXTERNAL_BET_WRITE_KEY="$E2E_ARENA_WRITE_KEY"
  STREAM_PUBLISH_KEY="$E2E_ARENA_WRITE_KEY"
)
if [[ "$E2E_DUEL_SOURCE" == "synthetic_publish" ]]; then
  printf 'STREAM_STATE_HEARTBEAT_MS=%q\n' "1000" >>"$KEEPER_ENV_FILE"
  KEEPER_SERVICE_ENV+=(STREAM_STATE_HEARTBEAT_MS=1000)
else
  printf 'STREAM_STATE_SOURCE_URL=%q\n' \
    "$HYPERIA_URL/api/streaming/state" >>"$KEEPER_ENV_FILE"
  KEEPER_SERVICE_ENV+=(
    STREAM_STATE_SOURCE_URL="$HYPERIA_URL/api/streaming/state"
  )
fi
env "${KEEPER_SERVICE_ENV[@]}" \
  bun run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 &
KEEPER_PID="$!"
write_pid_file "$KEEPER_PID_FILE" "$KEEPER_PID"

if ! wait_for_app "$GAME_API_URL/status"; then
  echo "[e2e] keeper api did not become ready"
  tail -n 80 "$KEEPER_LOG" || true
  exit 1
fi

if [[ "$E2E_DUEL_SOURCE" == "synthetic_publish" ]]; then
  echo "[e2e] seeding keeper live api state"
  env \
    E2E_GAME_API_URL="$GAME_API_URL" \
    E2E_ARENA_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
    E2E_DUEL_SOURCE="$E2E_DUEL_SOURCE" \
    bun run "$APP_DIR/tests/e2e/seed-api-local.ts"

  echo "[e2e] starting canonical bet-sync feed adapter"
  env \
    E2E_BET_SYNC_FEED_PORT="$BET_SYNC_FEED_PORT" \
    E2E_STREAM_STATE_URL="$GAME_API_URL/api/streaming/state" \
    bun "$APP_DIR/scripts/e2e-bet-sync-feed.mjs" >"$BET_SYNC_FEED_LOG" 2>&1 &
  BET_SYNC_FEED_PID="$!"
  write_pid_file "$BET_SYNC_FEED_PID_FILE" "$BET_SYNC_FEED_PID"
  if ! wait_for_app "$BET_SYNC_FEED_URL/api/internal/bet-sync/state"; then
    echo "[e2e] canonical bet-sync feed adapter did not become ready"
    tail -n 80 "$BET_SYNC_FEED_LOG" || true
    exit 1
  fi
else
  BET_SYNC_FEED_URL="$HYPERIA_URL"
fi

echo "[e2e] starting dedicated duel keeper"
BET_SYNC_SOURCE_TOKEN=""
if [[ "$E2E_DUEL_SOURCE" == "real_hyperia" ]]; then
  BET_SYNC_SOURCE_TOKEN="$HYPERIA_BET_SYNC_TOKEN"
fi
write_env_file \
  "$DUEL_BOT_ENV_FILE" \
  BOT_LOOP "true" \
  BOT_POLL_SECONDS "1" \
  GAME_URL "$BET_SYNC_FEED_URL" \
  BET_SYNC_SOURCE_BEARER_TOKEN "$BET_SYNC_SOURCE_TOKEN" \
  KEEPER_DB_PATH "$KEEPER_DB_PATH" \
  SOLANA_CLUSTER "localnet" \
  SOLANA_RPC_URL "$SOLANA_PROXY_URL" \
  SOLANA_RPC_WS_URL "$SOLANA_PROXY_WS_URL" \
  FIGHT_ORACLE_PROGRAM_ID "$PROGRAM_ORACLE_ID" \
  DUEL_MARKET_PROGRAM_ID "$PROGRAM_DUEL_MARKET_ID" \
  KEEPER_FEE_PAYER_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  ORACLE_REPORTER_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  ORACLE_FINALIZER_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  ORACLE_CHALLENGER_WALLET "$SOLANA_MINT_AUTHORITY" \
  CLOB_MARKET_OPERATOR_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  MARKET_MAKER_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  ORACLE_CONFIG_AUTHORITY_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  CLOB_CONFIG_AUTHORITY_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  SOLANA_ORACLE_DISPUTE_WINDOW_SECS "$E2E_ORACLE_DISPUTE_WINDOW_SECS" \
  TRADE_TREASURY_FEE_BPS "100" \
  TRADE_MARKET_MAKER_FEE_BPS "100" \
  WINNINGS_MARKET_MAKER_FEE_BPS "200" \
  TERMINAL_OPERATION_LEASE_MS "30000" \
  TERMINAL_RETRY_BASE_MS "1000" \
  TERMINAL_RETRY_MAX_MS "5000" \
  KEEPER_BOT_HEALTH_FILE "$KEEPER_BOT_HEALTH_PATH"
env \
  BOT_LOOP="true" \
  BOT_POLL_SECONDS="1" \
  GAME_URL="$BET_SYNC_FEED_URL" \
  BET_SYNC_SOURCE_BEARER_TOKEN="$BET_SYNC_SOURCE_TOKEN" \
  KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  SOLANA_CLUSTER="localnet" \
  SOLANA_RPC_URL="$SOLANA_PROXY_URL" \
  SOLANA_RPC_WS_URL="$SOLANA_PROXY_WS_URL" \
  FIGHT_ORACLE_PROGRAM_ID="$PROGRAM_ORACLE_ID" \
  DUEL_MARKET_PROGRAM_ID="$PROGRAM_DUEL_MARKET_ID" \
  KEEPER_FEE_PAYER_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  ORACLE_REPORTER_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  ORACLE_FINALIZER_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  ORACLE_CHALLENGER_WALLET="$SOLANA_MINT_AUTHORITY" \
  CLOB_MARKET_OPERATOR_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  MARKET_MAKER_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  ORACLE_CONFIG_AUTHORITY_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  CLOB_CONFIG_AUTHORITY_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  SOLANA_ORACLE_DISPUTE_WINDOW_SECS="$E2E_ORACLE_DISPUTE_WINDOW_SECS" \
  TRADE_TREASURY_FEE_BPS="100" \
  TRADE_MARKET_MAKER_FEE_BPS="100" \
  WINNINGS_MARKET_MAKER_FEE_BPS="200" \
  TERMINAL_OPERATION_LEASE_MS="30000" \
  TERMINAL_RETRY_BASE_MS="1000" \
  TERMINAL_RETRY_MAX_MS="5000" \
  KEEPER_BOT_HEALTH_FILE="$KEEPER_BOT_HEALTH_PATH" \
  bun run --cwd "$KEEPER_DIR" duel-bot >"$DUEL_BOT_LOG" 2>&1 &
DUEL_BOT_PID="$!"
write_pid_file "$DUEL_BOT_PID_FILE" "$DUEL_BOT_PID"
disown "$DUEL_BOT_PID" 2>/dev/null || true

if ! wait_for_app "$GAME_API_URL/api/keeper/bot-health"; then
  echo "[e2e] dedicated duel keeper did not become ready"
  curl -sS "$GAME_API_URL/api/keeper/bot-health" || true
  tail -n 120 "$DUEL_BOT_LOG" || true
  exit 1
fi

echo "[e2e] starting app on :$APP_PORT"
kill_listeners "$APP_PORT"
rm -rf "$APP_DIR/node_modules/.vite"
echo "[e2e] pre-bundling vite dependencies"
if ! (
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    VITE_TERMS_URL="${VITE_TERMS_URL:-/terms}" \
    VITE_PRIVACY_URL="${VITE_PRIVACY_URL:-/privacy}" \
    "$VITE_BIN" optimize --force --mode e2e
) >/tmp/hyperbet-solana-e2e-vite-optimize.log 2>&1; then
  echo "[e2e] warning: vite optimize failed; continuing with dev server startup"
  tail -n 80 /tmp/hyperbet-solana-e2e-vite-optimize.log || true
fi
(
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    VITE_TERMS_URL="${VITE_TERMS_URL:-/terms}" \
    VITE_PRIVACY_URL="${VITE_PRIVACY_URL:-/privacy}" \
    "$VITE_BIN" --mode e2e --port "$APP_PORT" --strictPort
) >"$APP_LOG" 2>&1 &
APP_PID="$!"
write_pid_file "$APP_PID_FILE" "$APP_PID"

if ! wait_for_app "http://127.0.0.1:$APP_PORT/"; then
  echo "[e2e] app did not become ready"
  tail -n 80 "$APP_LOG" || true
  exit 1
fi
sleep 2

write_control_file

echo "[e2e] running playwright tests"
E2E_BASE_URL="http://127.0.0.1:$APP_PORT" \
E2E_GAME_API_URL="$GAME_API_URL" \
E2E_ARENA_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
E2E_DUEL_SOURCE="$E2E_DUEL_SOURCE" \
E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM="${E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM:-true}" \
  "$APP_DIR/node_modules/.bin/playwright" test \
    --config "$APP_DIR/tests/e2e/playwright.config.ts" "$@"
