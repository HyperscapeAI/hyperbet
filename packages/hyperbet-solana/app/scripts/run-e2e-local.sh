#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$(cd "$APP_DIR/.." && pwd)"
ANCHOR_DIR="$DEMO_DIR/anchor"
KEEPER_DIR="$DEMO_DIR/keeper"
ANCHOR_BUILD_LOG="/tmp/hyperbet-solana-e2e-build.log"
STATE_PATH="$APP_DIR/tests/e2e/state.json"
CONTROL_PATH="$APP_DIR/tests/e2e/control.json"
VALIDATOR_LOG="$APP_DIR/.e2e-validator.log"
APP_LOG="$APP_DIR/.e2e-app.log"
SOLANA_PROXY_LOG="$APP_DIR/.e2e-solana-proxy.log"
KEEPER_LOG="$APP_DIR/.e2e-keeper.log"
APP_PID_FILE="$APP_DIR/.e2e-app.pid"
VALIDATOR_PID_FILE="$APP_DIR/.e2e-validator.pid"
SOLANA_PROXY_PID_FILE="$APP_DIR/.e2e-solana-proxy.pid"
KEEPER_PID_FILE="$APP_DIR/.e2e-keeper.pid"
SOLANA_PROXY_ENV_FILE="$APP_DIR/.e2e-solana-proxy.env"
KEEPER_ENV_FILE="$APP_DIR/.e2e-keeper.env"
PROGRAM_ORACLE_ID="B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo"
PROGRAM_MARKET_ID="EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT"
PROGRAM_CLOB_ID="DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf"
APP_PORT="${E2E_APP_PORT:-4181}"
GAME_API_PORT="${E2E_GAME_API_PORT:-5555}"
GAME_API_URL="http://127.0.0.1:${GAME_API_PORT}"
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
KEEPER_BOT_FLAG="${E2E_ENABLE_KEEPER_BOT:-true}"
E2E_ARENA_WRITE_KEY="${E2E_ARENA_WRITE_KEY:-hyperbet-e2e-local-write-key}"

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
resolve_localnet_wallet_path() {
  local candidates=()

  if [[ -n "${E2E_SOLANA_BOOTSTRAP_KEYPAIR:-}" ]]; then
    candidates+=("${E2E_SOLANA_BOOTSTRAP_KEYPAIR}")
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
    --arg solanaProxyPidFile "$SOLANA_PROXY_PID_FILE" \
    --arg solanaProxyLog "$SOLANA_PROXY_LOG" \
    --arg solanaProxyEnv "$SOLANA_PROXY_ENV_FILE" \
    --arg solanaProxyRpcUrl "$SOLANA_PROXY_URL" \
    --arg validatorPidFile "$VALIDATOR_PID_FILE" \
    --arg validatorLog "$VALIDATOR_LOG" \
    --arg solanaRpcUrl "$SOLANA_RPC_URL" \
    --arg solanaWsUrl "$SOLANA_WS_URL" \
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
      services: {
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
        solanaProxy: {
          pidFile: $solanaProxyPidFile,
          logPath: $solanaProxyLog,
          envFile: $solanaProxyEnv,
          rpcUrl: $solanaProxyRpcUrl
        },
        validator: {
          pidFile: $validatorPidFile,
          logPath: $validatorLog,
          rpcUrl: $solanaRpcUrl
        }
      }
    }' >"$CONTROL_PATH"
}

VALIDATOR_PID=""
APP_PID=""
SOLANA_PROXY_PID=""
KEEPER_PID=""

cleanup() {
  kill_pid_file_process "$APP_PID_FILE"
  kill_pid_file_process "$KEEPER_PID_FILE"
  kill_pid_file_process "$SOLANA_PROXY_PID_FILE"
  kill_pid_file_process "$VALIDATOR_PID_FILE"
  rm -f \
    "$APP_PID_FILE" \
    "$VALIDATOR_PID_FILE" \
    "$SOLANA_PROXY_PID_FILE" \
    "$KEEPER_PID_FILE" \
    "$SOLANA_PROXY_ENV_FILE" \
    "$KEEPER_ENV_FILE" \
    "$CONTROL_PATH"
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
  "$SOLANA_PROXY_ENV_FILE" \
  "$KEEPER_ENV_FILE" \
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

echo "[e2e] starting local validator"
rm -rf "$LEDGER_DIR"
solana-test-validator \
  --reset \
  --quiet \
  --rpc-port "$SOLANA_RPC_PORT" \
  --faucet-port "$SOLANA_FAUCET_PORT" \
  --gossip-port "$SOLANA_GOSSIP_PORT" \
  --dynamic-port-range "${SOLANA_DYNAMIC_PORT_START}-${SOLANA_DYNAMIC_PORT_END}" \
  --mint "$SOLANA_MINT_AUTHORITY" \
  --ledger "$LEDGER_DIR" \
  --upgradeable-program "$PROGRAM_ORACLE_ID" "$ANCHOR_DIR/target/deploy/fight_oracle.so" "$BOOTSTRAP_WALLET_PATH" \
  --upgradeable-program "$PROGRAM_MARKET_ID" "$ANCHOR_DIR/target/deploy/gold_perps_market.so" "$BOOTSTRAP_WALLET_PATH" \
  --upgradeable-program "$PROGRAM_CLOB_ID" "$ANCHOR_DIR/target/deploy/gold_clob_market.so" "$BOOTSTRAP_WALLET_PATH" \
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
  SOLANA_PROXY_PORT "$SOLANA_PROXY_PORT"
env \
  SOLANA_RPC_TARGET="$SOLANA_RPC_URL" \
  SOLANA_WS_TARGET="$SOLANA_WS_URL" \
  SOLANA_PROXY_PORT="$SOLANA_PROXY_PORT" \
  node "$APP_DIR/scripts/solana-rpc-proxy.mjs" >"$SOLANA_PROXY_LOG" 2>&1 &
SOLANA_PROXY_PID="$!"
write_pid_file "$SOLANA_PROXY_PID_FILE" "$SOLANA_PROXY_PID"

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
    E2E_SOLANA_BOOTSTRAP_KEYPAIR="$SOLANA_BOOTSTRAP_KEYPAIR" \
    bun run "$APP_DIR/tests/e2e/setup-localnet.ts"

echo "[e2e] seeding keeper database"
env \
  KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  bun run "$APP_DIR/tests/e2e/setup-api-local.ts"

echo "[e2e] starting keeper api on :$GAME_API_PORT"
write_env_file \
  "$KEEPER_ENV_FILE" \
  PORT "$GAME_API_PORT" \
  KEEPER_DB_PATH "$KEEPER_DB_PATH" \
  SOLANA_CLUSTER "localnet" \
  SOLANA_RPC_URL "$SOLANA_RPC_URL" \
  ORACLE_AUTHORITY_KEYPAIR "$BOOTSTRAP_WALLET_PATH" \
  FIGHT_ORACLE_PROGRAM_ID "$PROGRAM_ORACLE_ID" \
  GOLD_CLOB_MARKET_PROGRAM_ID "$PROGRAM_CLOB_ID" \
  GOLD_PERPS_MARKET_PROGRAM_ID "$PROGRAM_MARKET_ID" \
  ARENA_EXTERNAL_BET_WRITE_KEY "$E2E_ARENA_WRITE_KEY" \
  STREAM_PUBLISH_KEY "$E2E_ARENA_WRITE_KEY" \
  ENABLE_KEEPER_BOT "$KEEPER_BOT_FLAG"
env \
  PORT="$GAME_API_PORT" \
  KEEPER_DB_PATH="$KEEPER_DB_PATH" \
  SOLANA_CLUSTER="localnet" \
  SOLANA_RPC_URL="$SOLANA_RPC_URL" \
  ORACLE_AUTHORITY_KEYPAIR="$BOOTSTRAP_WALLET_PATH" \
  FIGHT_ORACLE_PROGRAM_ID="$PROGRAM_ORACLE_ID" \
  GOLD_CLOB_MARKET_PROGRAM_ID="$PROGRAM_CLOB_ID" \
  GOLD_PERPS_MARKET_PROGRAM_ID="$PROGRAM_MARKET_ID" \
  ARENA_EXTERNAL_BET_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
  STREAM_PUBLISH_KEY="$E2E_ARENA_WRITE_KEY" \
  ENABLE_KEEPER_BOT="$KEEPER_BOT_FLAG" \
  bun run --cwd "$KEEPER_DIR" service >"$KEEPER_LOG" 2>&1 &
KEEPER_PID="$!"
write_pid_file "$KEEPER_PID_FILE" "$KEEPER_PID"

if ! wait_for_app "$GAME_API_URL/status"; then
  echo "[e2e] keeper api did not become ready"
  tail -n 80 "$KEEPER_LOG" || true
  exit 1
fi

echo "[e2e] seeding keeper live api state"
env \
  E2E_GAME_API_URL="$GAME_API_URL" \
  E2E_ARENA_WRITE_KEY="$E2E_ARENA_WRITE_KEY" \
  bun run "$APP_DIR/tests/e2e/seed-api-local.ts"

echo "[e2e] starting app on :$APP_PORT"
kill_listeners "$APP_PORT"
rm -rf "$APP_DIR/node_modules/.vite"
echo "[e2e] pre-bundling vite dependencies"
if ! (
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/vite optimize --force --mode e2e
) >/tmp/hyperbet-solana-e2e-vite-optimize.log 2>&1; then
  echo "[e2e] warning: vite optimize failed; continuing with dev server startup"
  tail -n 80 /tmp/hyperbet-solana-e2e-vite-optimize.log || true
fi
(
  cd "$APP_DIR"
  env \
    VITE_GAME_API_URL="$GAME_API_URL" \
    ./node_modules/.bin/vite --mode e2e --port "$APP_PORT" --strictPort
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
  bunx playwright test --config "$APP_DIR/tests/e2e/playwright.config.ts" "$@"
