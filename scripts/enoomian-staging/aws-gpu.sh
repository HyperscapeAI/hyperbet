#!/usr/bin/env bash

set -euo pipefail

enoomian_aws_gpu_remote_root() {
  if [[ -n "${ENOOMIAN_AWS_GPU_REMOTE_ROOT:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_AWS_GPU_REMOTE_ROOT}"
    return 0
  fi

  local user="${ENOOMIAN_AWS_GPU_SSH_USER:-root}"
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_TARGET:-}" && "${ENOOMIAN_AWS_GPU_SSH_TARGET}" == *@* ]]; then
    user="${ENOOMIAN_AWS_GPU_SSH_TARGET%@*}"
  fi
  if [[ "${user}" == "root" ]]; then
    printf '%s\n' "/root/hyperscape"
  else
    printf '%s\n' "/home/${user}/hyperscape"
  fi
}

enoomian_aws_gpu_ssh_target() {
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_TARGET:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_AWS_GPU_SSH_TARGET}"
    return 0
  fi

  enoomian_require_env ENOOMIAN_AWS_GPU_HOST
  printf '%s@%s\n' "${ENOOMIAN_AWS_GPU_SSH_USER:-root}" "${ENOOMIAN_AWS_GPU_HOST}"
}

enoomian_aws_gpu_ssh_args() {
  local out_name="$1"
  eval "${out_name}=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)"
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_KEY:-}" ]]; then
    eval "${out_name}+=( -i \"\${ENOOMIAN_AWS_GPU_SSH_KEY}\" )"
  fi
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_PORT:-}" ]]; then
    eval "${out_name}+=( -p \"\${ENOOMIAN_AWS_GPU_SSH_PORT}\" )"
  fi
}

enoomian_aws_gpu_ssh() {
  local target
  local ssh_args=()
  target="$(enoomian_aws_gpu_ssh_target)"
  enoomian_aws_gpu_ssh_args ssh_args
  ssh "${ssh_args[@]}" "${target}" "$@"
}

enoomian_aws_gpu_rsync_rsh() {
  local ssh_cmd="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_KEY:-}" ]]; then
    ssh_cmd+=" -i $(enoomian_aws_gpu_shell_quote "${ENOOMIAN_AWS_GPU_SSH_KEY}")"
  fi
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_PORT:-}" ]]; then
    ssh_cmd+=" -p $(enoomian_aws_gpu_shell_quote "${ENOOMIAN_AWS_GPU_SSH_PORT}")"
  fi
  printf '%s\n' "${ssh_cmd}"
}

enoomian_aws_gpu_shell_quote() {
  local value="$1"
  printf "'%s'" "${value//\'/\'\\\'\'}"
}

enoomian_aws_gpu_write_env_line() {
  local file="$1"
  local key="$2"
  local value="${3:-}"
  printf '%s=' "${key}" >>"${file}"
  enoomian_aws_gpu_shell_quote "${value}" >>"${file}"
  printf '\n' >>"${file}"
}

enoomian_aws_gpu_trim_trailing_slashes() {
  local value="${1:-}"
  while [[ "${value}" == */ ]]; do
    value="${value%/}"
  done
  printf '%s\n' "${value}"
}

enoomian_aws_gpu_write_runtime_env() {
  local env_file="$1"
  local stream_url
  local public_cdn_url
  local stream_delivery_mode
  local stream_delivery_provider
  local stream_playback_url
  local stream_playback_llhls_url
  local stream_external_delivery_provider
  local stream_external_playback_hls_url
  local stream_external_playback_llhls_url
  local stream_external_ingest_rtmps_url
  local stream_ingest_rtmps_url
  local stream_enabled_destinations
  local stream_canonical_provider_priority
  local stream_ingest_transport
  local stream_capture_width
  local stream_capture_height
  local database_url
  local remote_root
  local api_port

  enoomian_require_env \
    ENOOMIAN_HYPERSCAPES_ROOT \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_HYPERSCAPES_WS_URL \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_JWT_SECRET \
    ENOOMIAN_BETTING_FEED_ACCESS_TOKEN \
    ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN

  database_url="${ENOOMIAN_AWS_GPU_DATABASE_URL:-${ENOOMIAN_EXTERNAL_DATABASE_URL:-${ENOOMIAN_LOCAL_DATABASE_URL:-${ENOOMIAN_DATABASE_URL:-}}}}"
  [[ -n "${database_url}" ]] || enoomian_die "missing AWS-reachable database url: set ENOOMIAN_AWS_GPU_DATABASE_URL or ENOOMIAN_LOCAL_DATABASE_URL"

  stream_url="$(enoomian_hyperscapes_stream_url)"
  enoomian_require_tokenized_hyperscapes_stream_url "${stream_url}"

  public_cdn_url="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  stream_delivery_mode="${ENOOMIAN_AWS_GPU_STREAM_DELIVERY_MODE:-${ENOOMIAN_STREAM_DELIVERY_MODE:-external_hls}}"
  stream_delivery_provider="${ENOOMIAN_AWS_GPU_STREAM_DELIVERY_PROVIDER:-${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-cloudflare_stream}}"
  stream_playback_url="${ENOOMIAN_AWS_GPU_PUBLIC_HLS_URL:-${ENOOMIAN_STREAM_PLAYBACK_URL:-}}"
  stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  stream_external_delivery_provider="${ENOOMIAN_STREAM_EXTERNAL_DELIVERY_PROVIDER:-}"
  stream_external_playback_hls_url="${ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_HLS_URL:-}"
  stream_external_playback_llhls_url="${ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_LLHLS_URL:-}"
  if [[ "${stream_delivery_mode}" == "external_hls" ]]; then
    stream_external_delivery_provider="${stream_external_delivery_provider:-${stream_delivery_provider:-cloudflare_stream}}"
    stream_external_playback_hls_url="${stream_external_playback_hls_url:-${stream_playback_url}}"
    stream_external_playback_llhls_url="${stream_external_playback_llhls_url:-${stream_playback_llhls_url}}"
  fi
  stream_external_ingest_rtmps_url="$(enoomian_aws_gpu_trim_trailing_slashes "${ENOOMIAN_STREAM_EXTERNAL_INGEST_RTMPS_URL:-}")"
  stream_ingest_rtmps_url="$(enoomian_aws_gpu_trim_trailing_slashes "${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}")"
  stream_enabled_destinations="${ENOOMIAN_AWS_GPU_STREAM_ENABLED_DESTINATIONS:-${ENOOMIAN_STREAM_ENABLED_DESTINATIONS:-}}"
  stream_canonical_provider_priority="${ENOOMIAN_AWS_GPU_STREAM_CANONICAL_PROVIDER_PRIORITY:-${ENOOMIAN_STREAM_CANONICAL_PROVIDER_PRIORITY:-cloudflare_stream}}"
  stream_ingest_transport="${ENOOMIAN_STREAM_INGEST_TRANSPORT:-rtmps}"
  stream_capture_width="${ENOOMIAN_STREAM_CAPTURE_WIDTH:-${ENOOMIAN_STREAM_OUTPUT_WIDTH:-1280}}"
  stream_capture_height="${ENOOMIAN_STREAM_CAPTURE_HEIGHT:-${ENOOMIAN_STREAM_OUTPUT_HEIGHT:-720}}"
  remote_root="$(enoomian_aws_gpu_remote_root)"
  api_port="${ENOOMIAN_AWS_GPU_API_PORT:-5560}"

  : >"${env_file}"
  enoomian_aws_gpu_write_env_line "${env_file}" NODE_ENV production
  enoomian_aws_gpu_write_env_line "${env_file}" PORT "${api_port}"
  enoomian_aws_gpu_write_env_line "${env_file}" UWS_PORT "${ENOOMIAN_AWS_GPU_UWS_PORT:-5561}"
  enoomian_aws_gpu_write_env_line "${env_file}" DUEL_DATABASE_MODE remote
  enoomian_aws_gpu_write_env_line "${env_file}" USE_LOCAL_POSTGRES false
  enoomian_aws_gpu_write_env_line "${env_file}" DATABASE_URL "${database_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" JWT_SECRET "${ENOOMIAN_HYPERSCAPES_JWT_SECRET}"
  enoomian_aws_gpu_write_env_line "${env_file}" SKIP_MIGRATIONS true
  enoomian_aws_gpu_write_env_line "${env_file}" DISABLE_RATE_LIMIT true
  enoomian_aws_gpu_write_env_line "${env_file}" UWS_ENABLED false
  enoomian_aws_gpu_write_env_line "${env_file}" HEALTH_CHECK_DATABASE false
  enoomian_aws_gpu_write_env_line "${env_file}" STREAMING_DUEL_ENABLED true
  enoomian_aws_gpu_write_env_line "${env_file}" STREAMING_CAPTURE_ENABLED true
  enoomian_aws_gpu_write_env_line "${env_file}" STREAMING_LOCAL_CAPTURE_WORKER_ENABLED false
  enoomian_aws_gpu_write_env_line "${env_file}" STREAMING_LOCAL_CAPTURE_USE_PUBLIC_URL false
  enoomian_aws_gpu_write_env_line "${env_file}" DUEL_OWNS_STREAM_CAPTURE false
  enoomian_aws_gpu_write_env_line "${env_file}" GAME_URL "${stream_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" GAME_FALLBACK_URLS "${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/stream.html,${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/?page=stream"
  enoomian_aws_gpu_write_env_line "${env_file}" PUBLIC_API_URL "${ENOOMIAN_HYPERSCAPES_API_URL}"
  enoomian_aws_gpu_write_env_line "${env_file}" PUBLIC_WS_URL "${ENOOMIAN_HYPERSCAPES_WS_URL}"
  enoomian_aws_gpu_write_env_line "${env_file}" PUBLIC_APP_URL "${ENOOMIAN_HYPERSCAPES_PAGES_URL}"
  enoomian_aws_gpu_write_env_line "${env_file}" PUBLIC_CDN_URL "${public_cdn_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" PUBLIC_ASSETS_URL "${public_cdn_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" BETTING_FEED_ACCESS_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAMING_VIEWER_ACCESS_TOKEN "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN}"

  enoomian_aws_gpu_write_env_line "${env_file}" DISPLAY "${ENOOMIAN_AWS_GPU_DISPLAY:-:99}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_MODE x11_nvenc
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_HEADLESS false
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_CHANNEL "${ENOOMIAN_AWS_GPU_CHROME_CHANNEL:-chrome-beta}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_ANGLE vulkan
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_WIDTH "${stream_capture_width}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CAPTURE_HEIGHT "${stream_capture_height}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_OUTPUT_WIDTH "${ENOOMIAN_STREAM_OUTPUT_WIDTH:-1280}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_OUTPUT_HEIGHT "${ENOOMIAN_STREAM_OUTPUT_HEIGHT:-720}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_VIDEO_BITRATE_KBPS "${ENOOMIAN_STREAM_VIDEO_BITRATE_KBPS:-4500}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_AUDIO_BITRATE_KBPS "${ENOOMIAN_STREAM_AUDIO_BITRATE_KBPS:-128}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_FPS "${ENOOMIAN_STREAM_FPS:-30}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_GOP_SIZE "${ENOOMIAN_STREAM_GOP_SIZE:-60}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_AUDIO_SAMPLE_RATE "${ENOOMIAN_STREAM_AUDIO_SAMPLE_RATE:-48000}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_LOW_LATENCY "${ENOOMIAN_STREAM_LOW_LATENCY:-true}"
  enoomian_aws_gpu_write_env_line "${env_file}" FFMPEG_HWACCEL nvidia
  enoomian_aws_gpu_write_env_line "${env_file}" RTMP_STATUS_FILE "${ENOOMIAN_AWS_GPU_RTMP_STATUS_FILE:-${remote_root}/.runtime-locks/rtmp-status.json}"

  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_DELIVERY_MODE "${stream_delivery_mode}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_DELIVERY_PROVIDER "${stream_delivery_provider}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_PLAYBACK_URL "${stream_playback_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_PLAYBACK_HLS_URL "${stream_playback_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_PLAYBACK_LLHLS_URL "${stream_playback_llhls_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_EXTERNAL_DELIVERY_PROVIDER "${stream_external_delivery_provider}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_EXTERNAL_PLAYBACK_HLS_URL "${stream_external_playback_hls_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_EXTERNAL_PLAYBACK_LLHLS_URL "${stream_external_playback_llhls_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CANONICAL_PROVIDER_PRIORITY "${stream_canonical_provider_priority}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_ENABLED_DESTINATIONS "${stream_enabled_destinations}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_ENABLE_AUTOMATIC_FAILOVER "${ENOOMIAN_STREAM_ENABLE_AUTOMATIC_FAILOVER:-false}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CLOUDFLARE_PROBE_ONLY "${ENOOMIAN_STREAM_CLOUDFLARE_PROBE_ONLY:-false}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CLOUDFLARE_LIVE_INPUT_ID "${STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${ENOOMIAN_STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${ENOOMIAN_STREAM_INGEST_SRT_STREAM_ID:-}}}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_CLOUDFLARE_ACCOUNT_ID "${STREAM_CLOUDFLARE_ACCOUNT_ID:-${ENOOMIAN_CLOUDFLARE_ACCOUNT_ID:-}}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_PROFILE "${ENOOMIAN_STREAM_INGEST_PROFILE:-cloudflare_live}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_TRANSPORT "${stream_ingest_transport}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_EXTERNAL_INGEST_RTMPS_URL "${stream_external_ingest_rtmps_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_RTMPS_URL "${stream_ingest_rtmps_url}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_STREAM_KEY "${ENOOMIAN_STREAM_INGEST_STREAM_KEY:-}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_SRT_URL "${ENOOMIAN_STREAM_INGEST_SRT_URL:-}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_SRT_STREAM_ID "${ENOOMIAN_STREAM_INGEST_SRT_STREAM_ID:-}"
  enoomian_aws_gpu_write_env_line "${env_file}" STREAM_INGEST_SRT_PASSPHRASE "${ENOOMIAN_STREAM_INGEST_SRT_PASSPHRASE:-}"
}

enoomian_aws_gpu_plan() {
  local target="(unset)"
  local remote_root
  local public_api="${ENOOMIAN_AWS_GPU_PUBLIC_API_URL:-}"
  remote_root="$(enoomian_aws_gpu_remote_root)"
  if [[ -n "${ENOOMIAN_AWS_GPU_SSH_TARGET:-${ENOOMIAN_AWS_GPU_HOST:-}}" ]]; then
    target="$(enoomian_aws_gpu_ssh_target)"
  fi

  cat <<EOF
Enoomian AWS GPU deployment plan

Scope:
  - branch: enoomian/staging only
  - source host: ${target}
  - remote root: ${remote_root}
  - capture mode: x11_nvenc
  - delivery: Cloudflare Stream remains untouched; AWS canary can publish self-HLS when configured
  - AWS source publisher: ${ENOOMIAN_AWS_GPU_START_SOURCE:-0} (set ENOOMIAN_AWS_GPU_START_SOURCE=1 only for canary/cutover)
  - Pages: unchanged unless hyperscapes-aws-gpu-activate is run
  - Railway: unchanged unless existing Railway env/deploy targets are run

Deploy target:
  scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-deploy [env-file]

Activation target:
  scripts/enoomian-staging/deploy.sh hyperscapes-aws-gpu-activate [env-file]

Activation requires:
  - ENOOMIAN_AWS_GPU_PUBLIC_API_URL
  - ENOOMIAN_AWS_GPU_PUBLIC_WS_URL
  - ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY=1

Current activation API override: ${public_api:-"(unset)"}
EOF
}

enoomian_aws_gpu_preflight() {
  enoomian_require_cmds ssh rsync curl jq
  enoomian_require_env ENOOMIAN_HYPERSCAPES_ROOT
  [[ -d "${ENOOMIAN_HYPERSCAPES_ROOT}" ]] || enoomian_die "invalid ENOOMIAN_HYPERSCAPES_ROOT: ${ENOOMIAN_HYPERSCAPES_ROOT}"
  [[ -f "${ENOOMIAN_HYPERSCAPES_ROOT}/ecosystem.config.cjs" ]] || enoomian_die "missing Hyperscapes ecosystem.config.cjs in ${ENOOMIAN_HYPERSCAPES_ROOT}"
  enoomian_aws_gpu_ssh_target >/dev/null
  enoomian_log "local AWS GPU deploy preflight passed"
}

enoomian_aws_gpu_remote_preflight() {
  enoomian_aws_gpu_preflight
  enoomian_log "checking AWS GPU host prerequisites"
  enoomian_aws_gpu_ssh 'bash -lc '"'"'
    set -euo pipefail
    command -v nvidia-smi >/dev/null
    nvidia-smi >/dev/null
    command -v ffmpeg >/dev/null
    ffmpeg -hide_banner -encoders 2>/dev/null > /tmp/hyperscape-ffmpeg-encoders.txt
    grep -q h264_nvenc /tmp/hyperscape-ffmpeg-encoders.txt
    command -v Xvfb >/dev/null
    command -v xdpyinfo >/dev/null
    command -v bun >/dev/null
    if ! command -v google-chrome-beta >/dev/null && ! command -v google-chrome >/dev/null && ! command -v chromium >/dev/null; then
      echo "missing Chrome/Chromium browser" >&2
      exit 1
    fi
  '"'"
  enoomian_log "AWS GPU remote preflight passed"
}

enoomian_aws_gpu_sync_code() {
  local target
  local remote_root
  local rsync_rsh
  target="$(enoomian_aws_gpu_ssh_target)"
  remote_root="$(enoomian_aws_gpu_remote_root)"
  rsync_rsh="$(enoomian_aws_gpu_rsync_rsh)"

  enoomian_log "creating remote root ${target}:${remote_root}"
  enoomian_aws_gpu_ssh "mkdir -p '${remote_root}'"

  enoomian_log "syncing Hyperscapes checkout to AWS GPU host"
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'packages/*/node_modules' \
    --exclude 'packages/client/dist' \
    --exclude 'packages/server/dist' \
    --exclude '.runtime-locks' \
    --exclude 'logs' \
    -e "${rsync_rsh}" \
    "${ENOOMIAN_HYPERSCAPES_ROOT%/}/" \
    "${target}:${remote_root}/"
}

enoomian_aws_gpu_push_runtime_env() {
  local env_tmp
  local target
  local remote_root
  local rsync_rsh
  env_tmp="$(mktemp "$(enoomian_tmp_root)/aws-gpu-env.XXXXXX")"
  target="$(enoomian_aws_gpu_ssh_target)"
  remote_root="$(enoomian_aws_gpu_remote_root)"
  rsync_rsh="$(enoomian_aws_gpu_rsync_rsh)"

  enoomian_aws_gpu_write_runtime_env "${env_tmp}"
  chmod 600 "${env_tmp}"
  enoomian_log "pushing AWS GPU runtime env to ${target} (secret values not printed)"
  rsync -az -e "${rsync_rsh}" "${env_tmp}" "${target}:/tmp/hyperscape-secrets.env"
  enoomian_aws_gpu_ssh "mkdir -p '${remote_root}' && install -m 600 /tmp/hyperscape-secrets.env '${remote_root}/.env.production' && if [ \"\$(id -u)\" = 0 ]; then install -m 600 /tmp/hyperscape-secrets.env /root/hyperscape-secrets.env; fi"
  rm -f "${env_tmp}"
}

enoomian_aws_gpu_remote_bootstrap() {
  local remote_root
  local start_source
  remote_root="$(enoomian_aws_gpu_remote_root)"
  start_source="${ENOOMIAN_AWS_GPU_START_SOURCE:-0}"

  enoomian_log "bootstrapping AWS GPU host runtime"
  enoomian_aws_gpu_ssh "REMOTE_ROOT='${remote_root}' ENOOMIAN_AWS_GPU_START_SOURCE='${start_source}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "${REMOTE_ROOT}"
export PATH="${HOME}/.bun/bin:/root/.bun/bin:${PATH}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null
  SUDO="sudo"
fi

${SUDO} apt-get update
${SUDO} apt-get install -y build-essential python3 socat xvfb git-lfs ffmpeg wget gnupg iproute2 lsof postgresql-client x11-utils jq curl

if ! command -v google-chrome-beta >/dev/null 2>&1; then
  wget -q -O /tmp/google-linux-signing-key.pub https://dl.google.com/linux/linux_signing_key.pub
  ${SUDO} apt-key add /tmp/google-linux-signing-key.pub || true
  echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | ${SUDO} tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y google-chrome-beta
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:/root/.bun/bin:${PATH}"
fi

mkdir -p logs .runtime-locks
bun install

bun run build:shared
(cd packages/server && bun run build)
(cd packages/client && bun run build:cf)

set -a
. "${REMOTE_ROOT}/.env.production"
set +a

bunx pm2 delete hyperscape-duel-api hyperscape-stream-source 2>/dev/null || true

display="${DISPLAY:-:99}"
display_num="${display#:}"
pkill -f "Xvfb ${display}" 2>/dev/null || true
pkill -f "ffmpeg .*${display}\\.0" 2>/dev/null || true
pkill -f "chrome.*${display}" 2>/dev/null || true
rm -f "/tmp/.X${display_num}-lock" "/tmp/.X11-unix/X${display_num}"
xvfb_log="${REMOTE_ROOT}/logs/xvfb.log"
nohup Xvfb "${display}" -screen 0 "${STREAM_CAPTURE_WIDTH:-1280}x${STREAM_CAPTURE_HEIGHT:-720}x24" -ac +extension GLX +render -noreset >"${xvfb_log}" 2>&1 &
for attempt in $(seq 1 10); do
  if xdpyinfo -display "${display}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! xdpyinfo -display "${display}" >/dev/null 2>&1; then
  echo "Xvfb did not become ready on ${display}" >&2
  cat "${xvfb_log}" >&2 || true
  exit 1
fi
ffmpeg -hide_banner -encoders 2>/dev/null > /tmp/hyperscape-ffmpeg-encoders.txt
grep -q h264_nvenc /tmp/hyperscape-ffmpeg-encoders.txt

if [ "${ENOOMIAN_AWS_GPU_START_SOURCE:-0}" = "1" ]; then
  bunx pm2 start ecosystem.config.cjs --update-env
else
  bunx pm2 start ecosystem.config.cjs --only hyperscape-duel-api --update-env
fi
bunx pm2 save
bunx pm2 status
REMOTE_SCRIPT
}

enoomian_aws_gpu_deploy() {
  enoomian_check_personal_secrets
  enoomian_aws_gpu_preflight
  enoomian_aws_gpu_sync_code
  enoomian_aws_gpu_push_runtime_env
  enoomian_aws_gpu_remote_bootstrap
  enoomian_log "AWS GPU source deploy complete; Cloudflare Pages and Railway were not changed"
}

enoomian_aws_gpu_status() {
  local remote_root
  local api_port
  local start_source
  remote_root="$(enoomian_aws_gpu_remote_root)"
  api_port="${ENOOMIAN_AWS_GPU_API_PORT:-5560}"
  start_source="${ENOOMIAN_AWS_GPU_START_SOURCE:-0}"
  enoomian_aws_gpu_preflight
  enoomian_aws_gpu_ssh "REMOTE_ROOT='${remote_root}' API_PORT='${api_port}' START_SOURCE='${start_source}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "${REMOTE_ROOT}"
health_json="$(curl -fsS "http://127.0.0.1:${API_PORT}/health")"
status_tmp="$(mktemp)"
status_code="$(curl -sS -o "${status_tmp}" -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/streaming/capture/status" || true)"

if [ "${status_code}" = "200" ]; then
  jq \
    --argjson health "${health_json}" \
    --arg startSource "${START_SOURCE}" \
    '{
      apiHealth: $health,
      sourcePublisherConfigured: ($startSource == "1"),
      captureStatusCode: 200,
      running,
      rendererReady: .rendererHealth.ready,
      sourceReady: .sourceRuntime.ready,
      captureMode: .sourceRuntime.captureMode,
      playbackUrl: (.delivery.playbackUrl // .cloudflare.playbackUrl // null),
      workerHeartbeatAt: .sourceRuntime.workerHeartbeatAt
    }' <"${status_tmp}"
else
  jq -n \
    --argjson health "${health_json}" \
    --arg startSource "${START_SOURCE}" \
    --arg statusCode "${status_code}" \
    '{
      apiHealth: $health,
      sourcePublisherConfigured: ($startSource == "1"),
      captureStatusCode: ($statusCode | tonumber? // 0),
      running: false,
      rendererReady: false,
      sourceReady: false,
      captureMode: null,
      playbackUrl: null,
      workerHeartbeatAt: null
    }'
fi

rm -f "${status_tmp}"
REMOTE_SCRIPT
}

enoomian_aws_gpu_activate() {
  if [[ "${ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY:-0}" != "1" ]]; then
    enoomian_die "refusing to activate AWS GPU authority without ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY=1"
    return 1
  fi
  enoomian_require_env ENOOMIAN_AWS_GPU_PUBLIC_API_URL ENOOMIAN_AWS_GPU_PUBLIC_WS_URL

  enoomian_log "activating AWS GPU authority for enoomian staging only"
  export ENOOMIAN_HYPERSCAPES_API_URL="${ENOOMIAN_AWS_GPU_PUBLIC_API_URL%/}"
  export ENOOMIAN_HYPERSCAPES_WS_URL="${ENOOMIAN_AWS_GPU_PUBLIC_WS_URL}"
  export ENOOMIAN_HYPERSCAPES_PUBLIC_API_URL="${ENOOMIAN_HYPERSCAPES_API_URL}"
  export ENOOMIAN_HYPERSCAPES_PUBLIC_WS_URL="${ENOOMIAN_HYPERSCAPES_WS_URL}"
  export ENOOMIAN_STREAM_DELIVERY_MODE="${ENOOMIAN_AWS_GPU_STREAM_DELIVERY_MODE:-self_hls}"
  export ENOOMIAN_STREAM_DELIVERY_PROVIDER="${ENOOMIAN_AWS_GPU_STREAM_DELIVERY_PROVIDER:-self_hls}"
  export ENOOMIAN_STREAM_PLAYBACK_URL="${ENOOMIAN_AWS_GPU_PUBLIC_HLS_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  export ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL="${ENOOMIAN_AWS_GPU_PUBLIC_LLHLS_URL:-}"
  export ENOOMIAN_STREAM_CANONICAL_PROVIDER_PRIORITY="${ENOOMIAN_AWS_GPU_STREAM_CANONICAL_PROVIDER_PRIORITY:-self_hls,cloudflare_stream}"
  export ENOOMIAN_STREAM_RENDERER_HEALTH_URL="${ENOOMIAN_AWS_GPU_PUBLIC_API_URL%/}/api/streaming/capture/status"

  if [[ "${ENOOMIAN_AWS_GPU_SYNC_HYPERSCAPES_RAILWAY_ENV:-0}" == "1" ]]; then
    enoomian_sync_hyperscapes_railway_env
  else
    enoomian_log "skipping Hyperscapes Railway env sync for AWS GPU authority; public authority is AWS + Pages"
  fi
  enoomian_deploy_hyperscapes_pages
  if [[ "${ENOOMIAN_AWS_GPU_SYNC_HYPERBET_KEEPER_ENV:-1}" == "1" ]]; then
    enoomian_sync_hyperbet_keepers_env
  else
    enoomian_log "skipping Hyperbet keeper Railway env sync for AWS GPU authority by explicit override; Hyperbet app may keep the previous canonical session"
  fi
  if [[ "${ENOOMIAN_AWS_GPU_DEPLOY_HYPERBET_KEEPER:-1}" == "1" ]]; then
    enoomian_deploy_hyperbet_keeper
  else
    enoomian_log "skipping Hyperbet keeper deploy for AWS GPU authority by explicit override; Railway --skip-deploys env changes may not be live"
  fi
  enoomian_deploy_hyperbet_pages
  enoomian_log "AWS GPU authority activation complete for enoomian staging"
}
