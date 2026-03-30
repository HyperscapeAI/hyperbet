#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
CONTROL_PATH="${2:-}"
SERVICE="${3:-}"

if [[ -z "$ACTION" || -z "$CONTROL_PATH" || -z "$SERVICE" ]]; then
  echo "usage: $0 <start|stop|restart|status|wait-ready> <control-path> <service>" >&2
  exit 1
fi

if [[ ! -f "$CONTROL_PATH" ]]; then
  echo "missing control file: $CONTROL_PATH" >&2
  exit 1
fi

service_json_path=".services[\"$SERVICE\"]"
service_exists="$(jq -r "${service_json_path} != null" "$CONTROL_PATH")"
if [[ "$service_exists" != "true" ]]; then
  echo "service \"$SERVICE\" is not defined in $CONTROL_PATH; skipping"
  exit 0
fi

read_service_field() {
  local field="$1"
  jq -r "${service_json_path}.${field} // empty" "$CONTROL_PATH"
}

pid_file="$(read_service_field "pidFile")"
env_file="$(read_service_field "envFile")"
log_path="$(read_service_field "logPath")"
cwd_path="$(read_service_field "cwd")"
health_url="$(read_service_field "healthUrl")"
rpc_url="$(read_service_field "rpcUrl")"
stream_state_url="$(read_service_field "streamStateUrl")"
app_dir="$(jq -r '.appDir // empty' "$CONTROL_PATH")"
start_command="$(read_service_field "startCommand")"

require_file() {
  local label="$1"
  local path="$2"
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "missing ${label}: ${path:-<empty>}" >&2
    exit 1
  fi
}

pid_from_file() {
  if [[ -f "$pid_file" ]]; then
    cat "$pid_file" 2>/dev/null || true
  fi
}

port_from_url() {
  local url="$1"
  if [[ -z "$url" ]]; then
    return 0
  fi
  python3 - "$url" <<'PY'
import sys
from urllib.parse import urlparse

url = sys.argv[1]
parsed = urlparse(url)
print(parsed.port or "")
PY
}

listener_pids_for_port() {
  local port="$1"
  if [[ -z "$port" ]]; then
    return 0
  fi
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

listener_pids_for_service() {
  local port=""
  case "$SERVICE" in
    keeper|hyperscapes|hyperscapesClient)
      port="$(port_from_url "$health_url")"
      ;;
    solanaProxy|anvil)
      port="$(port_from_url "$rpc_url")"
      ;;
  esac
  listener_pids_for_port "$port"
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
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  for _ in {1..5}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "failed to stop service \"$SERVICE\" (pid $pid)" >&2
  exit 1
}

stop_service() {
  local pid
  pid="$(pid_from_file)"
  stop_pid "$pid"

  local listener_pid
  local listener_pids
  listener_pids="$(listener_pids_for_service)"
  if [[ -n "$listener_pids" ]]; then
    while IFS= read -r listener_pid; do
      [[ -z "$listener_pid" || "$listener_pid" == "$pid" ]] && continue
      stop_pid "$listener_pid"
    done <<<"$listener_pids"
  fi

  rm -f "$pid_file"
}

wait_for_http_url() {
  local url="$1"
  for _ in {1..90}; do
    if [[ "$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_keeper() {
  wait_for_http_url "$health_url"
}

wait_for_solana_proxy() {
  for _ in {1..90}; do
    local response
    response="$(curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' || true)"
    if [[ "$response" == *'"solana-core"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_anvil() {
  for _ in {1..90}; do
    local response
    response="$(curl -s -X POST "$rpc_url" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' || true)"
    if [[ "$response" == *'"result"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_hyperscapes() {
  if ! wait_for_http_url "$health_url"; then
    return 1
  fi
  if [[ -z "$stream_state_url" ]]; then
    return 0
  fi
  for _ in {1..90}; do
    local response
    response="$(curl -s "$stream_state_url" || true)"
    if [[ "$response" == *'"duelId"'* && "$response" == *'"duelKeyHex"'* ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_hyperscapes_client() {
  wait_for_http_url "$health_url"
}

wait_for_service() {
  case "$SERVICE" in
    keeper)
      wait_for_keeper
      ;;
    solanaProxy)
      wait_for_solana_proxy
      ;;
    anvil)
      wait_for_anvil
      ;;
    hyperscapes)
      wait_for_hyperscapes
      ;;
    hyperscapesClient)
      wait_for_hyperscapes_client
      ;;
    *)
      echo "unsupported service \"$SERVICE\"" >&2
      exit 1
      ;;
  esac
}

start_shell_service() {
  local env_label="$1"
  local not_ready_message="$2"
  require_file "$env_label" "$env_file"
  mkdir -p "$(dirname "$log_path")"
  local command_string="$start_command"
  if [[ -z "$command_string" ]]; then
    command_string="bun run --cwd \"$cwd_path\" service"
  fi
  local command_prefix=""
  if [[ -n "$cwd_path" ]]; then
    command_prefix="cd \"$cwd_path\" && "
  fi
  nohup bash -lc "export PATH=\"/Users/mac/.bun/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH\"; ${command_prefix}set -a; source \"$env_file\"; set +a; ${command_string}" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_service; then
    echo "$not_ready_message" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
  local listener_pid
  listener_pid="$(listener_pids_for_service | head -n 1)"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$pid_file"
  fi
}

start_keeper() {
  start_shell_service "keeper env file" "keeper did not become ready after restart"
}

start_solana_proxy() {
  require_file "proxy env file" "$env_file"
  if [[ -z "$app_dir" ]]; then
    echo "missing appDir in $CONTROL_PATH" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$log_path")"
  nohup bash -lc "set -a; source \"$env_file\"; set +a; node \"$app_dir/scripts/solana-rpc-proxy.mjs\"" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_solana_proxy; then
    echo "solana proxy did not become ready after restart" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
  local listener_pid
  listener_pid="$(listener_pids_for_service | head -n 1)"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$pid_file"
  fi
}

start_anvil() {
  require_file "anvil env file" "$env_file"
  mkdir -p "$(dirname "$log_path")"
  nohup bash -lc "set -a; source \"$env_file\"; set +a; anvil --silent --host 127.0.0.1 --port \"\$ANVIL_PORT\" --chain-id \"\$EVM_CHAIN_ID\" --state \"\$ANVIL_STATE_PATH\" --state-interval \"\${ANVIL_STATE_INTERVAL:-1}\"" \
    >>"$log_path" 2>&1 < /dev/null &
  printf '%s\n' "$!" >"$pid_file"
  if ! wait_for_anvil; then
    echo "anvil did not become ready after restart" >&2
    tail -n 80 "$log_path" || true
    exit 1
  fi
  local listener_pid
  listener_pid="$(listener_pids_for_service | head -n 1)"
  if [[ -n "$listener_pid" ]]; then
    printf '%s\n' "$listener_pid" >"$pid_file"
  fi
}

start_hyperscapes() {
  start_shell_service "hyperscapes env file" "hyperscapes did not become ready after restart"
}

start_hyperscapes_client() {
  start_shell_service "hyperscapes client env file" "hyperscapes client did not become ready after restart"
}

start_service() {
  case "$SERVICE" in
    keeper)
      start_keeper
      ;;
    solanaProxy)
      start_solana_proxy
      ;;
    anvil)
      start_anvil
      ;;
    hyperscapes)
      start_hyperscapes
      ;;
    hyperscapesClient)
      start_hyperscapes_client
      ;;
    *)
      echo "unsupported service \"$SERVICE\"" >&2
      exit 1
      ;;
  esac
}

status_service() {
  local pid=""
  local listener_pid=""
  pid="$(pid_from_file)"
  listener_pid="$(listener_pids_for_service | head -n 1 || true)"
  echo "service=$SERVICE"
  echo "pid=${pid:-}"
  echo "listenerPid=${listener_pid:-}"
  if [[ -n "$health_url" ]]; then
    echo "healthUrl=$health_url"
  fi
  if wait_for_service >/dev/null 2>&1; then
    echo "ready=true"
  else
    echo "ready=false"
  fi
}

case "$ACTION" in
  start)
    stop_service
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    status_service
    ;;
  wait-ready)
    wait_for_service
    ;;
  *)
    echo "unsupported action \"$ACTION\"" >&2
    exit 1
    ;;
esac
