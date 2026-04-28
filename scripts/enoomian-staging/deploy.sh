#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

# Lock the deploy lane to `enoomian/staging` before touching anything
# branch-dependent. The secret manifest below is tracked on
# enoomian/staging only, so running from any other branch would
# otherwise surface as a confusing "No such file or directory" at
# the next source line. enoomian_require_enoomian_staging_branch
# respects ENOOMIAN_ALLOW_OFFBRANCH_DEPLOY=1 as an escape hatch; see
# lib.sh for the helper definition.
enoomian_require_enoomian_staging_branch

# shellcheck source=../enoomian-staging-secret-manifest.sh
source "${SCRIPT_DIR}/../enoomian-staging-secret-manifest.sh"
# shellcheck source=./aws-gpu.sh
source "${SCRIPT_DIR}/aws-gpu.sh"

enoomian_require_dist_dir() {
  local dir="$1"
  local label="$2"
  if [[ ! -d "${dir}" ]]; then
    enoomian_die "${label} dist directory not found: ${dir}"
  fi
}

enoomian_print_manifest_section() {
  local title="$1"
  shift

  printf '%s\n' "${title}:"
  local key
  for key in "$@"; do
    printf '  %s\n' "${key}"
  done
}

enoomian_print_personal_secret_manifest() {
  cat <<EOF
Enoomian staging personal secret manifest
Source of truth: local untracked env file (default: ${ENOOMIAN_DEFAULT_ENV_FILE})
Shared project secrets are intentionally not read by this deploy lane.
EOF
  enoomian_print_manifest_section "required-now" "${ENOOMIAN_PERSONAL_SECRET_REQUIRED_KEYS[@]}"
  enoomian_print_manifest_section "optional-now" "${ENOOMIAN_PERSONAL_SECRET_OPTIONAL_KEYS[@]}"
  enoomian_print_manifest_section "reserved-cloudflare-rollout" "${ENOOMIAN_PERSONAL_SECRET_RESERVED_CLOUDFLARE_KEYS[@]}"
}

enoomian_check_personal_secrets() {
  enoomian_assert_personal_env_file "${ENOOMIAN_ENV_FILE}"
  enoomian_require_env "${ENOOMIAN_PERSONAL_SECRET_REQUIRED_KEYS[@]}"
  enoomian_log "validated personal secret source ${ENOOMIAN_ENV_FILE}"
  enoomian_log "deploys from this lane use only the local env file plus dedicated enoomian staging targets"
}

enoomian_sync_personal_secrets() {
  enoomian_check_personal_secrets
  enoomian_log "syncing personal secrets into dedicated enoomian staging Railway services only"
  enoomian_sync_hyperscapes_railway_env
  enoomian_sync_hyperbet_keepers_env
  enoomian_log "Pages deploys continue to use local build-time env only; no shared Pages env sync was performed"
}

enoomian_deploy_code() {
  enoomian_check_personal_secrets
  enoomian_log "deploying code only; Railway environment sync remains an explicit separate step"
  enoomian_deploy_hyperscapes_railway
  enoomian_deploy_hyperscapes_pages
  enoomian_deploy_hyperbet_keeper
  enoomian_deploy_hyperbet_pages
  enoomian_deploy_hyperbet_legacy_pages_redirects
}

enoomian_apply_railway_manifest_entry() {
  local workdir="$1"
  local service_id="$2"
  local mode="$3"
  local key="$4"
  local value="${5:-}"

  if [[ "${mode}" == "stdin" ]]; then
    enoomian_railway_set_stdin "${workdir}" "${service_id}" "${key}" "${value}"
  else
    enoomian_railway_set "${workdir}" "${service_id}" "${key}" "${value}"
  fi
}

enoomian_count_railway_manifest_entry() {
  ENOOMIAN_RAILWAY_MANIFEST_ENTRY_COUNT=$((ENOOMIAN_RAILWAY_MANIFEST_ENTRY_COUNT + 1))
}

enoomian_count_railway_manifest_entries() {
  local emit_fn="$1"
  local workdir="$2"
  local service_id="$3"

  ENOOMIAN_RAILWAY_MANIFEST_ENTRY_COUNT=0
  "${emit_fn}" enoomian_count_railway_manifest_entry "${workdir}" "${service_id}"
  printf '%s' "${ENOOMIAN_RAILWAY_MANIFEST_ENTRY_COUNT}"
}

enoomian_maybe_sync_railway_env() {
  local label="$1"
  local env_target="$2"
  local sync_fn="$3"
  local emit_fn="$4"
  local workdir="$5"
  local service_id="$6"
  local entry_count

  entry_count="$(enoomian_count_railway_manifest_entries "${emit_fn}" "${workdir}" "${service_id}")"
  if [[ "${ENOOMIAN_SYNC_RAILWAY_ENV:-0}" == "1" ]]; then
    enoomian_log "ENOOMIAN_SYNC_RAILWAY_ENV=1 is deprecated; syncing ${label} Railway env (${entry_count} vars) before deploy"
    "${sync_fn}"
  else
    enoomian_log "${label} deploy is code-only by default; skipping Railway env sync (${entry_count} vars). Run deploy.sh ${env_target} to reconcile Railway vars."
  fi
}

enoomian_emit_hyperscapes_railway_env_manifest() {
  local sink="$1"
  local workdir="$2"
  local service_id="$3"
  local repo_root="${ENOOMIAN_HYPERSCAPES_ROOT}"
  local public_stream_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/stream"
  local public_stream_html_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/stream.html"
  local public_legacy_stream_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/?page=stream"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_playback_hls_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_canonical_provider_priority="${ENOOMIAN_STREAM_CANONICAL_PROVIDER_PRIORITY:-}"
  local stream_enable_automatic_failover="${ENOOMIAN_STREAM_ENABLE_AUTOMATIC_FAILOVER:-}"
  local stream_failback_soak_ms="${ENOOMIAN_STREAM_FAILBACK_SOAK_MS:-}"
  local stream_external_delivery_provider="${ENOOMIAN_STREAM_EXTERNAL_DELIVERY_PROVIDER:-}"
  local stream_external_playback_hls_url="${ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_HLS_URL:-}"
  local stream_external_playback_llhls_url="${ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_LLHLS_URL:-}"
  local stream_external_ingest_rtmps_url="${ENOOMIAN_STREAM_EXTERNAL_INGEST_RTMPS_URL:-}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"
  local stream_ingest_stream_key="${ENOOMIAN_STREAM_INGEST_STREAM_KEY:-}"
  local stream_ingest_profile="${ENOOMIAN_STREAM_INGEST_PROFILE:-default}"
  local stream_ingest_transport="${ENOOMIAN_STREAM_INGEST_TRANSPORT:-rtmps}"
  local stream_ingest_srt_url="${ENOOMIAN_STREAM_INGEST_SRT_URL:-}"
  local stream_ingest_srt_stream_id="${ENOOMIAN_STREAM_INGEST_SRT_STREAM_ID:-}"
  local stream_ingest_srt_passphrase="${ENOOMIAN_STREAM_INGEST_SRT_PASSPHRASE:-}"
  local stream_audio_sample_rate="${ENOOMIAN_STREAM_AUDIO_SAMPLE_RATE:-}"
  local stream_gop_size="${ENOOMIAN_STREAM_GOP_SIZE:-}"
  local stream_cloudflare_probe_only="${ENOOMIAN_STREAM_CLOUDFLARE_PROBE_ONLY:-false}"
  local stream_cloudflare_live_input_id="${STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${ENOOMIAN_STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${stream_ingest_srt_stream_id}}}"
  local stream_cloudflare_account_id="${STREAM_CLOUDFLARE_ACCOUNT_ID:-${ENOOMIAN_CLOUDFLARE_ACCOUNT_ID:-}}"
  local stream_cloudflare_webhook_secret="${STREAM_CLOUDFLARE_WEBHOOK_SECRET:-${ENOOMIAN_STREAM_CLOUDFLARE_WEBHOOK_SECRET:-}}"
  local stream_low_latency="${ENOOMIAN_STREAM_LOW_LATENCY:-true}"
  local stream_fps="${ENOOMIAN_STREAM_FPS:-30}"
  local stream_output_width="${ENOOMIAN_STREAM_OUTPUT_WIDTH:-426}"
  local stream_output_height="${ENOOMIAN_STREAM_OUTPUT_HEIGHT:-240}"
  local stream_video_bitrate_kbps="${ENOOMIAN_STREAM_VIDEO_BITRATE_KBPS:-96}"
  local stream_audio_bitrate_kbps="${ENOOMIAN_STREAM_AUDIO_BITRATE_KBPS:-32}"
  local hls_time_seconds="${ENOOMIAN_HLS_TIME_SECONDS:-2}"
  local hls_list_size="${ENOOMIAN_HLS_LIST_SIZE:-18}"
  local hls_delete_threshold="${ENOOMIAN_HLS_DELETE_THRESHOLD:-54}"
  local commit_sha

  if git -C "${repo_root}" rev-parse HEAD >/dev/null 2>&1; then
    commit_sha="$(git -C "${repo_root}" rev-parse HEAD)"
  else
    commit_sha="local-enoomian-$(date +%s)"
  fi

  "${sink}" "${workdir}" "${service_id}" plain NODE_ENV production
  "${sink}" "${workdir}" "${service_id}" plain USE_LOCAL_POSTGRES false
  "${sink}" "${workdir}" "${service_id}" plain STREAMING_DUEL_ENABLED true
  "${sink}" "${workdir}" "${service_id}" plain STREAMING_LOCAL_CAPTURE_WORKER_ENABLED false
  "${sink}" "${workdir}" "${service_id}" plain STREAMING_LOCAL_CAPTURE_USE_PUBLIC_URL false
  "${sink}" "${workdir}" "${service_id}" plain STREAMING_CAPTURE_ENABLED false
  "${sink}" "${workdir}" "${service_id}" plain DISABLE_RATE_LIMIT true
  "${sink}" "${workdir}" "${service_id}" plain UWS_ENABLED false
  "${sink}" "${workdir}" "${service_id}" plain HEALTH_CHECK_DATABASE false
  "${sink}" "${workdir}" "${service_id}" plain SKIP_MIGRATIONS true
  "${sink}" "${workdir}" "${service_id}" plain SKIP_CDN_MANIFEST_FETCH true
  "${sink}" "${workdir}" "${service_id}" plain GAME_URL "${public_stream_url}"
  "${sink}" "${workdir}" "${service_id}" plain GAME_FALLBACK_URLS "${public_legacy_stream_url},${public_stream_html_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CAPTURE_MODE cdp
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CAPTURE_HEADLESS false
  "${sink}" "${workdir}" "${service_id}" plain HLS_OUTPUT_PATH ""
  "${sink}" "${workdir}" "${service_id}" plain HLS_SEGMENT_PATTERN ""
  "${sink}" "${workdir}" "${service_id}" plain HLS_TIME_SECONDS "${hls_time_seconds}"
  "${sink}" "${workdir}" "${service_id}" plain HLS_LIST_SIZE "${hls_list_size}"
  "${sink}" "${workdir}" "${service_id}" plain HLS_DELETE_THRESHOLD "${hls_delete_threshold}"
  "${sink}" "${workdir}" "${service_id}" plain HLS_ALLOW_CACHE 0
  "${sink}" "${workdir}" "${service_id}" plain STREAM_LOW_LATENCY "${stream_low_latency}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_FPS "${stream_fps}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_OUTPUT_WIDTH "${stream_output_width}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_OUTPUT_HEIGHT "${stream_output_height}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_VIDEO_BITRATE_KBPS "${stream_video_bitrate_kbps}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_AUDIO_BITRATE_KBPS "${stream_audio_bitrate_kbps}"
  "${sink}" "${workdir}" "${service_id}" plain RTMP_STATUS_FILE ""
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_MODE "${stream_delivery_mode}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_PROVIDER "${stream_delivery_provider}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_HLS_URL "${stream_playback_hls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_LLHLS_URL "${stream_playback_llhls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CANONICAL_PROVIDER_PRIORITY "${stream_canonical_provider_priority}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_ENABLE_AUTOMATIC_FAILOVER "${stream_enable_automatic_failover}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_FAILBACK_SOAK_MS "${stream_failback_soak_ms}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_EXTERNAL_DELIVERY_PROVIDER "${stream_external_delivery_provider}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_EXTERNAL_PLAYBACK_HLS_URL "${stream_external_playback_hls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_EXTERNAL_PLAYBACK_LLHLS_URL "${stream_external_playback_llhls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_EXTERNAL_INGEST_RTMPS_URL "${stream_external_ingest_rtmps_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_RTMPS_URL "${stream_ingest_rtmps_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_PROFILE "${stream_ingest_profile}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_TRANSPORT "${stream_ingest_transport}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_SRT_URL "${stream_ingest_srt_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_SRT_STREAM_ID "${stream_ingest_srt_stream_id}"
  "${sink}" "${workdir}" "${service_id}" stdin STREAM_INGEST_SRT_PASSPHRASE "${stream_ingest_srt_passphrase}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_AUDIO_SAMPLE_RATE "${stream_audio_sample_rate}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_GOP_SIZE "${stream_gop_size}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CLOUDFLARE_PROBE_ONLY "${stream_cloudflare_probe_only}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CLOUDFLARE_LIVE_INPUT_ID "${stream_cloudflare_live_input_id}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_CLOUDFLARE_ACCOUNT_ID "${stream_cloudflare_account_id}"
  if [[ -n "${stream_cloudflare_webhook_secret}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_CLOUDFLARE_WEBHOOK_SECRET "${stream_cloudflare_webhook_secret}"
  fi
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_API_URL "${ENOOMIAN_HYPERSCAPES_API_URL}"
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_WS_URL "${ENOOMIAN_HYPERSCAPES_WS_URL}"
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_APP_URL "${ENOOMIAN_HYPERSCAPES_PAGES_URL}"
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_CDN_URL "${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_ASSETS_URL "${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  if [[ -n "${ENOOMIAN_HYPERSCAPES_GAME_ASSETS_FALLBACK_URL:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain GAME_ASSETS_FALLBACK_URL "${ENOOMIAN_HYPERSCAPES_GAME_ASSETS_FALLBACK_URL}"
  else
    "${sink}" "${workdir}" "${service_id}" plain GAME_ASSETS_FALLBACK_URL ""
  fi
  "${sink}" "${workdir}" "${service_id}" plain PUBLIC_ASSET_VERSION "${commit_sha}"
  "${sink}" "${workdir}" "${service_id}" stdin DATABASE_URL "${ENOOMIAN_DATABASE_URL}"
  "${sink}" "${workdir}" "${service_id}" stdin JWT_SECRET "${ENOOMIAN_HYPERSCAPES_JWT_SECRET}"
  if [[ -n "${stream_ingest_stream_key}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_INGEST_STREAM_KEY "${stream_ingest_stream_key}"
  else
    "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_STREAM_KEY ""
  fi
  if [[ -n "${ENOOMIAN_PUBLIC_PRIVY_APP_ID:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin PUBLIC_PRIVY_APP_ID "${ENOOMIAN_PUBLIC_PRIVY_APP_ID}"
  fi
  if [[ -n "${ENOOMIAN_PRIVY_APP_SECRET:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin PRIVY_APP_SECRET "${ENOOMIAN_PRIVY_APP_SECRET}"
  fi
  if [[ -n "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin BETTING_FEED_ACCESS_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  fi
  if [[ -n "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAMING_VIEWER_ACCESS_TOKEN "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN}"
  fi
  if [[ -n "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain STREAMING_PUBLIC_DELAY_MS "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS}"
  fi
  "${sink}" "${workdir}" "${service_id}" plain STREAMING_EMIT_RAW_SOURCE_TIME "${ENOOMIAN_STREAMING_EMIT_RAW_SOURCE_TIME:-false}"
  "${sink}" "${workdir}" "${service_id}" stdin STREAMING_AUTOMATION_TOKEN "${ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN}"
}

enoomian_sync_hyperscapes_railway_env() {
  enoomian_require_hyperscapes_root
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERSCAPES_SERVICE_ID \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_HYPERSCAPES_WS_URL \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_DATABASE_URL \
    ENOOMIAN_HYPERSCAPES_JWT_SECRET \
    ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN

  enoomian_log "syncing Hyperscapes Railway service variables"
  enoomian_emit_hyperscapes_railway_env_manifest \
    enoomian_apply_railway_manifest_entry \
    "${ENOOMIAN_HYPERSCAPES_ROOT}" \
    "${ENOOMIAN_HYPERSCAPES_SERVICE_ID}"
}

enoomian_emit_hyperbet_solana_keeper_env_manifest() {
  local sink="$1"
  local workdir="$2"
  local service_id="$3"
  local stream_playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_renderer_health_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-}"
  local stream_renderer_health_bearer_token="${ENOOMIAN_STREAM_RENDERER_HEALTH_BEARER_TOKEN:-}"
  local stream_renderer_health_poll_ms="${ENOOMIAN_STREAM_RENDERER_HEALTH_POLL_MS:-2000}"
  local stream_renderer_hls_freshness_ms="${ENOOMIAN_STREAM_RENDERER_HLS_FRESHNESS_MS:-15000}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"
  local oracle_config_authority_keypair
  local clob_config_authority_keypair
  local oracle_authority_keypair
  local bot_keypair

  oracle_config_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_CONFIG_AUTHORITY_KEYPAIR}")"
  clob_config_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_CLOB_CONFIG_AUTHORITY_KEYPAIR}")"
  oracle_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}")"
  bot_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR}")"

  "${sink}" "${workdir}" "${service_id}" plain NODE_ENV production
  "${sink}" "${workdir}" "${service_id}" plain ENABLE_KEEPER_BOT true
  "${sink}" "${workdir}" "${service_id}" plain CORS_ORIGINS "$(enoomian_hyperbet_pages_cors_origins)"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_EVENTS_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/events"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_STATE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/state"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_STATE_SOURCE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/state"
  if [[ -n "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin BET_SYNC_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_STATE_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  fi
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_KIND hls
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_MODE "${stream_delivery_mode}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_PROVIDER "${stream_delivery_provider}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_HLS_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_LLHLS_URL "${stream_playback_llhls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_RTMPS_URL "${stream_ingest_rtmps_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_URL "${stream_renderer_health_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_POLL_MS "${stream_renderer_health_poll_ms}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HLS_FRESHNESS_MS "${stream_renderer_hls_freshness_ms}"
  if [[ -n "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain STREAM_PRESENTATION_DELAY_MS "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS}"
  fi
  if [[ -n "${stream_renderer_health_bearer_token}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_RENDERER_HEALTH_BEARER_TOKEN "${stream_renderer_health_bearer_token}"
  else
    "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_BEARER_TOKEN ""
  fi
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_CLUSTER "${ENOOMIAN_SOLANA_CLUSTER}"
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_RPC_URL "${ENOOMIAN_SOLANA_RPC_URL}"
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_ORACLE_DISPUTE_WINDOW_SECS "${ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS}"
  "${sink}" "${workdir}" "${service_id}" plain FIGHT_ORACLE_PROGRAM_ID "${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain GOLD_CLOB_MARKET_PROGRAM_ID "${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain GOLD_AMM_MARKET_PROGRAM_ID "${ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain GOLD_PERPS_MARKET_PROGRAM_ID "${ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" stdin STREAM_PUBLISH_KEY "${ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin ARENA_EXTERNAL_BET_WRITE_KEY "${ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_CONFIG_AUTHORITY_KEYPAIR "${oracle_config_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin CLOB_CONFIG_AUTHORITY_KEYPAIR "${clob_config_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_AUTHORITY_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_REPORTER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_FINALIZER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_CHALLENGER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin CLOB_MARKET_OPERATOR_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin BOT_KEYPAIR "${bot_keypair}"
}

enoomian_sync_hyperbet_solana_keeper_env() {
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID \
    ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_CONFIG_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CLOB_CONFIG_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR

  enoomian_log "syncing Hyperbet Solana keeper Railway variables"
  enoomian_emit_hyperbet_solana_keeper_env_manifest \
    enoomian_apply_railway_manifest_entry \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/keeper" \
    "${ENOOMIAN_HYPERBET_SOLANA_KEEPER_SERVICE_ID}"
}

enoomian_emit_hyperbet_bsc_keeper_env_manifest() {
  local sink="$1"
  local workdir="$2"
  local service_id="$3"
  local stream_playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_renderer_health_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-}"
  local stream_renderer_health_bearer_token="${ENOOMIAN_STREAM_RENDERER_HEALTH_BEARER_TOKEN:-}"
  local stream_renderer_health_poll_ms="${ENOOMIAN_STREAM_RENDERER_HEALTH_POLL_MS:-2000}"
  local stream_renderer_hls_freshness_ms="${ENOOMIAN_STREAM_RENDERER_HLS_FRESHNESS_MS:-15000}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"
  local oracle_authority_keypair
  local evm_keeper_chains
  local base_rpc_url=""
  local base_duel_oracle_address=""
  local base_gold_clob_address=""

  oracle_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}")"
  evm_keeper_chains="$(enoomian_resolve_bsc_keeper_chains)"
  if enoomian_base_lane_enabled; then
    base_rpc_url="${ENOOMIAN_BASE_RPC_URL}"
    base_duel_oracle_address="${ENOOMIAN_BASE_DUEL_ORACLE_ADDRESS}"
    base_gold_clob_address="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS}"
  fi

  "${sink}" "${workdir}" "${service_id}" plain NODE_ENV production
  "${sink}" "${workdir}" "${service_id}" plain ENABLE_KEEPER_BOT true
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_CLUSTER "${ENOOMIAN_SOLANA_CLUSTER}"
  "${sink}" "${workdir}" "${service_id}" plain EVM_KEEPER_CHAINS "${evm_keeper_chains}"
  "${sink}" "${workdir}" "${service_id}" plain CORS_ORIGINS "$(enoomian_hyperbet_pages_cors_origins)"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_EVENTS_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/events"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_STATE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/state"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_STATE_SOURCE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/state"
  if [[ -n "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin BET_SYNC_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_STATE_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  fi
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_KIND hls
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_MODE "${stream_delivery_mode}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_PROVIDER "${stream_delivery_provider}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_HLS_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_LLHLS_URL "${stream_playback_llhls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_RTMPS_URL "${stream_ingest_rtmps_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_URL "${stream_renderer_health_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_POLL_MS "${stream_renderer_health_poll_ms}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HLS_FRESHNESS_MS "${stream_renderer_hls_freshness_ms}"
  if [[ -n "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain STREAM_PRESENTATION_DELAY_MS "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS}"
  fi
  if [[ -n "${stream_renderer_health_bearer_token}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_RENDERER_HEALTH_BEARER_TOKEN "${stream_renderer_health_bearer_token}"
  else
    "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_BEARER_TOKEN ""
  fi
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_RPC_URL "${ENOOMIAN_SOLANA_RPC_URL}"
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_ORACLE_DISPUTE_WINDOW_SECS "${ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS}"
  "${sink}" "${workdir}" "${service_id}" plain FIGHT_ORACLE_PROGRAM_ID "${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain GOLD_CLOB_MARKET_PROGRAM_ID "${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_RPC_URL "${ENOOMIAN_BSC_RPC_URL}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_DUEL_ORACLE_ADDRESS "${ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_GOLD_CLOB_ADDRESS "${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}"
  "${sink}" "${workdir}" "${service_id}" plain BASE_RPC_URL "${base_rpc_url}"
  "${sink}" "${workdir}" "${service_id}" plain BASE_DUEL_ORACLE_ADDRESS "${base_duel_oracle_address}"
  "${sink}" "${workdir}" "${service_id}" plain BASE_GOLD_CLOB_ADDRESS "${base_gold_clob_address}"
  "${sink}" "${workdir}" "${service_id}" stdin STREAM_PUBLISH_KEY "${ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin ARENA_EXTERNAL_BET_WRITE_KEY "${ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_AUTHORITY_KEYPAIR "${oracle_authority_keypair}"
}

enoomian_sync_hyperbet_bsc_keeper_env() {
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_URL \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR

  enoomian_log "syncing Hyperbet BSC keeper Railway variables"
  enoomian_emit_hyperbet_bsc_keeper_env_manifest \
    enoomian_apply_railway_manifest_entry \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/keeper" \
    "${ENOOMIAN_HYPERBET_BSC_KEEPER_SERVICE_ID}"
}

enoomian_emit_hyperbet_keeper_env_manifest() {
  local sink="$1"
  local workdir="$2"
  local service_id="$3"
  local stream_playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_renderer_health_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-}"
  local stream_renderer_health_bearer_token="${ENOOMIAN_STREAM_RENDERER_HEALTH_BEARER_TOKEN:-}"
  local stream_renderer_health_poll_ms="${ENOOMIAN_STREAM_RENDERER_HEALTH_POLL_MS:-2000}"
  local stream_renderer_hls_freshness_ms="${ENOOMIAN_STREAM_RENDERER_HLS_FRESHNESS_MS:-15000}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"
  local evm_keeper_chains
  local keeper_pages_url
  local keeper_pages_origins
  local keeper_url
  local keeper_ws_url
  local oracle_config_authority_keypair
  local clob_config_authority_keypair
  local oracle_authority_keypair
  local bot_keypair
  local market_maker_keypair
  local bsc_finalizer_private_key

  keeper_pages_url="$(enoomian_hyperbet_pages_url)"
  keeper_pages_origins="$(enoomian_hyperbet_pages_cors_origins)"
  keeper_url="$(enoomian_hyperbet_keeper_url)"
  keeper_ws_url="$(enoomian_hyperbet_keeper_ws_url)"
  oracle_config_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_CONFIG_AUTHORITY_KEYPAIR}")"
  clob_config_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_CLOB_CONFIG_AUTHORITY_KEYPAIR}")"
  oracle_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}")"
  bot_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR}")"
  market_maker_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_MARKET_MAKER_KEYPAIR}")"
  bsc_finalizer_private_key="${ENOOMIAN_HYPERBET_BSC_FINALIZER_PRIVATE_KEY:-${TESTNET_FINALIZER_PRIVATE_KEY:-}}"
  [[ -n "${bsc_finalizer_private_key}" ]] || enoomian_die "missing required env: ENOOMIAN_HYPERBET_BSC_FINALIZER_PRIVATE_KEY or TESTNET_FINALIZER_PRIVATE_KEY"
  evm_keeper_chains="bsc"

  "${sink}" "${workdir}" "${service_id}" plain NODE_ENV production
  "${sink}" "${workdir}" "${service_id}" plain ENABLE_KEEPER_BOT true
  "${sink}" "${workdir}" "${service_id}" plain EVM_KEEPER_CHAINS "${evm_keeper_chains}"
  "${sink}" "${workdir}" "${service_id}" plain CORS_ORIGINS "${keeper_pages_origins}"
  "${sink}" "${workdir}" "${service_id}" plain HYPERBET_KEEPER_URL "${keeper_url}"
  "${sink}" "${workdir}" "${service_id}" plain HYPERBET_KEEPER_WS_URL "${keeper_ws_url}"
  "${sink}" "${workdir}" "${service_id}" plain HYPERBET_SOLANA_KEEPER_URL "${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL}"
  "${sink}" "${workdir}" "${service_id}" plain GAME_URL "${ENOOMIAN_HYPERSCAPES_API_URL}"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_EVENTS_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/events"
  "${sink}" "${workdir}" "${service_id}" plain BET_SYNC_SOURCE_STATE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/state"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_STATE_SOURCE_URL "${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/state"
  if [[ -n "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin BET_SYNC_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_STATE_SOURCE_BEARER_TOKEN "${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  fi
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_KIND hls
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_MODE "${stream_delivery_mode}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_DELIVERY_PROVIDER "${stream_delivery_provider}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_HLS_URL "${stream_playback_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_PLAYBACK_LLHLS_URL "${stream_playback_llhls_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_INGEST_RTMPS_URL "${stream_ingest_rtmps_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_URL "${stream_renderer_health_url}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_POLL_MS "${stream_renderer_health_poll_ms}"
  "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HLS_FRESHNESS_MS "${stream_renderer_hls_freshness_ms}"
  if [[ -n "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS:-}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain STREAM_PRESENTATION_DELAY_MS "${ENOOMIAN_STREAMING_PUBLIC_DELAY_MS}"
  fi
  if [[ -n "${stream_renderer_health_bearer_token}" ]]; then
    "${sink}" "${workdir}" "${service_id}" stdin STREAM_RENDERER_HEALTH_BEARER_TOKEN "${stream_renderer_health_bearer_token}"
  else
    "${sink}" "${workdir}" "${service_id}" plain STREAM_RENDERER_HEALTH_BEARER_TOKEN ""
  fi
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_CLUSTER "${ENOOMIAN_SOLANA_CLUSTER}"
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_RPC_URL "${ENOOMIAN_SOLANA_RPC_URL}"
  "${sink}" "${workdir}" "${service_id}" plain SOLANA_ORACLE_DISPUTE_WINDOW_SECS "${ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS}"
  "${sink}" "${workdir}" "${service_id}" plain FIGHT_ORACLE_PROGRAM_ID "${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain GOLD_CLOB_MARKET_PROGRAM_ID "${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_RPC_URL "${ENOOMIAN_BSC_RPC_URL}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_DUEL_ORACLE_ADDRESS "${ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS}"
  "${sink}" "${workdir}" "${service_id}" plain BSC_GOLD_CLOB_ADDRESS "${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}"
  "${sink}" "${workdir}" "${service_id}" plain BASE_RPC_URL ""
  "${sink}" "${workdir}" "${service_id}" plain BASE_DUEL_ORACLE_ADDRESS ""
  "${sink}" "${workdir}" "${service_id}" plain BASE_GOLD_CLOB_ADDRESS ""
  "${sink}" "${workdir}" "${service_id}" stdin STREAM_PUBLISH_KEY "${ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin ARENA_EXTERNAL_BET_WRITE_KEY "${ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY "${ENOOMIAN_HYPERBET_BSC_REPORTER_PRIVATE_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin HYPERBET_BSC_STAGING_MARKET_OPERATOR_PRIVATE_KEY "${ENOOMIAN_HYPERBET_BSC_MARKET_OPERATOR_PRIVATE_KEY}"
  "${sink}" "${workdir}" "${service_id}" stdin HYPERBET_BSC_STAGING_FINALIZER_PRIVATE_KEY "${bsc_finalizer_private_key}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_CONFIG_AUTHORITY_KEYPAIR "${oracle_config_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin CLOB_CONFIG_AUTHORITY_KEYPAIR "${clob_config_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_AUTHORITY_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_REPORTER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_FINALIZER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin ORACLE_CHALLENGER_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin CLOB_MARKET_OPERATOR_KEYPAIR "${oracle_authority_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin BOT_KEYPAIR "${bot_keypair}"
  "${sink}" "${workdir}" "${service_id}" stdin MARKET_MAKER_KEYPAIR "${market_maker_keypair}"
  if [[ -n "${keeper_pages_url}" ]]; then
    "${sink}" "${workdir}" "${service_id}" plain PUBLIC_APP_URL "${keeper_pages_url}"
  fi
}

enoomian_sync_hyperbet_keeper_env() {
  enoomian_backfill_hyperbet_surface_aliases
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_KEEPER_URL \
    ENOOMIAN_HYPERBET_KEEPER_WS_URL \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_BSC_REPORTER_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_MARKET_OPERATOR_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_CONFIG_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CLOB_CONFIG_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_MARKET_MAKER_KEYPAIR

  enoomian_log "syncing Hyperbet unified keeper Railway variables"
  enoomian_emit_hyperbet_keeper_env_manifest \
    enoomian_apply_railway_manifest_entry \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-evm/keeper" \
    "${ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID}"
}

enoomian_sync_hyperbet_keepers_env() {
  enoomian_sync_hyperbet_keeper_env
}

enoomian_deploy_hyperscapes_railway() {
  enoomian_require_hyperscapes_root
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERSCAPES_SERVICE_ID \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_HYPERSCAPES_WS_URL \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_DATABASE_URL \
    ENOOMIAN_HYPERSCAPES_JWT_SECRET \
    ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN

  local repo_root="${ENOOMIAN_HYPERSCAPES_ROOT}"
  local service_id="${ENOOMIAN_HYPERSCAPES_SERVICE_ID}"
  local upload_root
  local commit_sha
  local public_stream_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/stream"
  local public_stream_html_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/stream.html"
  local public_legacy_stream_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}/?page=stream"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_playback_hls_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"
  local stream_ingest_stream_key="${ENOOMIAN_STREAM_INGEST_STREAM_KEY:-}"
  local stream_ingest_profile="${ENOOMIAN_STREAM_INGEST_PROFILE:-default}"
  local stream_ingest_transport="${ENOOMIAN_STREAM_INGEST_TRANSPORT:-rtmps}"
  local stream_ingest_srt_url="${ENOOMIAN_STREAM_INGEST_SRT_URL:-}"
  local stream_ingest_srt_stream_id="${ENOOMIAN_STREAM_INGEST_SRT_STREAM_ID:-}"
  local stream_ingest_srt_passphrase="${ENOOMIAN_STREAM_INGEST_SRT_PASSPHRASE:-}"
  local stream_audio_sample_rate="${ENOOMIAN_STREAM_AUDIO_SAMPLE_RATE:-}"
  local stream_gop_size="${ENOOMIAN_STREAM_GOP_SIZE:-}"
  local stream_cloudflare_probe_only="${ENOOMIAN_STREAM_CLOUDFLARE_PROBE_ONLY:-false}"
  local stream_cloudflare_live_input_id="${STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${ENOOMIAN_STREAM_CLOUDFLARE_LIVE_INPUT_ID:-${stream_ingest_srt_stream_id}}}"
  local stream_cloudflare_account_id="${STREAM_CLOUDFLARE_ACCOUNT_ID:-${ENOOMIAN_CLOUDFLARE_ACCOUNT_ID:-}}"
  local stream_cloudflare_webhook_secret="${STREAM_CLOUDFLARE_WEBHOOK_SECRET:-${ENOOMIAN_STREAM_CLOUDFLARE_WEBHOOK_SECRET:-}}"
  local stream_low_latency="${ENOOMIAN_STREAM_LOW_LATENCY:-true}"
  local stream_fps="${ENOOMIAN_STREAM_FPS:-30}"
  local stream_output_width="${ENOOMIAN_STREAM_OUTPUT_WIDTH:-426}"
  local stream_output_height="${ENOOMIAN_STREAM_OUTPUT_HEIGHT:-240}"
  local stream_video_bitrate_kbps="${ENOOMIAN_STREAM_VIDEO_BITRATE_KBPS:-96}"
  local stream_audio_bitrate_kbps="${ENOOMIAN_STREAM_AUDIO_BITRATE_KBPS:-32}"
  local hls_time_seconds="${ENOOMIAN_HLS_TIME_SECONDS:-2}"
  local hls_list_size="${ENOOMIAN_HLS_LIST_SIZE:-18}"
  local hls_delete_threshold="${ENOOMIAN_HLS_DELETE_THRESHOLD:-54}"

  if git -C "${repo_root}" rev-parse HEAD >/dev/null 2>&1; then
    commit_sha="$(git -C "${repo_root}" rev-parse HEAD)"
  else
    commit_sha="local-enoomian-$(date +%s)"
  fi

  upload_root="$(enoomian_make_upload_alias "${repo_root}" hyperscapes)"
  enoomian_patch_hyperscapes_upload_root "${upload_root}"
  if [[ "${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy}" == "full" ]]; then
    enoomian_validate_hyperscapes_assets_root "${upload_root}"
  else
    enoomian_validate_hyperscapes_assets_root "${repo_root}"
    enoomian_log "skipping trimmed upload-root asset validation for ${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy} bundle"
  fi
  if [[ "${ENOOMIAN_SKIP_PREFLIGHT:-0}" != "1" ]]; then
    enoomian_run_hyperscapes_preflight "${upload_root}"
  else
    enoomian_log "skipping Hyperscapes preflight (ENOOMIAN_SKIP_PREFLIGHT=1)"
  fi

  enoomian_maybe_sync_railway_env \
    "Hyperscapes" \
    "hyperscapes-railway-env" \
    enoomian_sync_hyperscapes_railway_env \
    enoomian_emit_hyperscapes_railway_env_manifest \
    "${repo_root}" \
    "${service_id}"

  enoomian_log "deploying Hyperscapes to personal Railway"
  (
    cd "${upload_root}"
    enoomian_railway_up \
      "Hyperscapes Railway upload" \
      -p "${ENOOMIAN_RAILWAY_PROJECT_ID}" \
      -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
      -s "${service_id}" \
      --ci \
      --verbose
  )
  rm -rf "$(dirname "${upload_root}")"

  enoomian_log "verifying Hyperscapes status"
  enoomian_wait_for_json "${ENOOMIAN_HYPERSCAPES_API_URL}/health" '.status == "ok"' 30 10 || enoomian_die "Hyperscapes /health did not become healthy"
  enoomian_wait_for_json "${ENOOMIAN_HYPERSCAPES_API_URL}/status" '.uptime != null and .connectedUsers != null' 30 10 || enoomian_die "Hyperscapes /status did not become healthy"
  enoomian_wait_for_json "${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/state" '.type != null' 36 10 || enoomian_die "Hyperscapes streaming state did not become healthy"
}

enoomian_write_hyperscapes_pages_env_js() {
  local output_file="$1"
  local public_api_url="$2"
  local public_ws_url="$3"
  local public_cdn_url="$4"
  local public_app_url="$5"
  local embed_allowed_origins="${6:-}"
  local streaming_viewer_access_token="${7:-}"
  local public_privy_app_id="${8:-}"

  python3 - "${output_file}" "${public_api_url}" "${public_ws_url}" "${public_cdn_url}" "${public_app_url}" "${embed_allowed_origins}" "${streaming_viewer_access_token}" "${public_privy_app_id}" <<'PY'
import json
import pathlib
import sys

output_file, public_api_url, public_ws_url, public_cdn_url, public_app_url, embed_allowed_origins, streaming_viewer_access_token, public_privy_app_id = sys.argv[1:]

env = {
    "PUBLIC_API_URL": public_api_url,
    "PUBLIC_WS_URL": public_ws_url,
    "PUBLIC_CDN_URL": public_cdn_url,
    "PUBLIC_ASSETS_URL": public_cdn_url,
    "PUBLIC_APP_URL": public_app_url,
}

if embed_allowed_origins:
    env["PUBLIC_EMBED_ALLOWED_ORIGINS"] = embed_allowed_origins
if streaming_viewer_access_token:
    env["PUBLIC_STREAMING_VIEWER_ACCESS_TOKEN"] = streaming_viewer_access_token
if public_privy_app_id:
    env["PUBLIC_PRIVY_APP_ID"] = public_privy_app_id

path = pathlib.Path(output_file)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(
    "// Generated by scripts/enoomian-staging/deploy.sh\n"
    "(() => {\n"
    f"  window.env = {json.dumps(env, indent=2, sort_keys=True)};\n"
    "})();\n",
    encoding="utf-8",
)
PY
}

enoomian_validate_hyperscapes_pages_env_js() {
  local env_file="$1"
  local expected_api_url="$2"
  local expected_ws_url="$3"
  local expected_cdn_url="$4"

  python3 - "${env_file}" "${expected_api_url}" "${expected_ws_url}" "${expected_cdn_url}" <<'PY'
import json
import pathlib
import re
import sys

env_file, expected_api_url, expected_ws_url, expected_cdn_url = sys.argv[1:]
content = pathlib.Path(env_file).read_text(encoding="utf-8")
match = re.search(r"window\.env = (\{.*\});\n\}\)\(\);", content, re.S)
if not match:
    raise SystemExit(f"Unable to parse {env_file}")

env = json.loads(match.group(1))
expected = {
    "PUBLIC_API_URL": expected_api_url,
    "PUBLIC_WS_URL": expected_ws_url,
    "PUBLIC_CDN_URL": expected_cdn_url,
    "PUBLIC_ASSETS_URL": expected_cdn_url,
}

for key, value in expected.items():
    actual = env.get(key)
    if actual != value:
        raise SystemExit(
            f"{env_file} drifted for {key}: expected {value!r}, found {actual!r}"
        )
PY
}

enoomian_deploy_hyperscapes_pages() {
  enoomian_require_hyperscapes_root
  enoomian_require_env \
    ENOOMIAN_HYPERSCAPES_PAGES_PROJECT_NAME \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_HYPERSCAPES_WS_URL

  local repo_root="${ENOOMIAN_HYPERSCAPES_ROOT}"
  local hyperscapes_public_api_url="${ENOOMIAN_HYPERSCAPES_PUBLIC_API_URL:-${ENOOMIAN_HYPERSCAPES_API_URL}}"
  local hyperscapes_public_ws_url="${ENOOMIAN_HYPERSCAPES_PUBLIC_WS_URL:-${ENOOMIAN_HYPERSCAPES_WS_URL}}"
  local hyperscapes_cdn_url
  local commit_sha
  local commit_msg
  hyperscapes_cdn_url="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  if [[ "${ENOOMIAN_ALLOW_SPLIT_HYPERSCAPES_PUBLIC_RAIL:-0}" != "1" ]]; then
    if [[ "${hyperscapes_public_api_url%/}" != "${ENOOMIAN_HYPERSCAPES_API_URL%/}" ]]; then
      enoomian_die "Refusing Hyperscapes Pages deploy: ENOOMIAN_HYPERSCAPES_PUBLIC_API_URL must match ENOOMIAN_HYPERSCAPES_API_URL for the enoomian staging canonical rail"
    fi
    if [[ "${hyperscapes_public_ws_url%/}" != "${ENOOMIAN_HYPERSCAPES_WS_URL%/}" ]]; then
      enoomian_die "Refusing Hyperscapes Pages deploy: ENOOMIAN_HYPERSCAPES_PUBLIC_WS_URL must match ENOOMIAN_HYPERSCAPES_WS_URL for the enoomian staging canonical rail"
    fi
  fi
  if git -C "${repo_root}" rev-parse HEAD >/dev/null 2>&1; then
    commit_sha="$(git -C "${repo_root}" rev-parse HEAD)"
    commit_msg="$(git -C "${repo_root}" log -1 --pretty=%s | tr -d '"' | cut -c1-100)"
  else
    commit_sha="local-enoomian-$(date +%s)"
    commit_msg="local staging deploy"
  fi

  enoomian_ensure_pages_project "${ENOOMIAN_HYPERSCAPES_PAGES_PROJECT_NAME}"

  enoomian_log "building Hyperscapes client"
  (
    cd "${repo_root}"
    bun install --frozen-lockfile
    export NODE_OPTIONS='--max-old-space-size=4096'
    export PUBLIC_API_URL="${hyperscapes_public_api_url}"
    export PUBLIC_WS_URL="${hyperscapes_public_ws_url}"
    export PUBLIC_APP_URL="${ENOOMIAN_HYPERSCAPES_PAGES_URL}"
    export PUBLIC_CDN_URL="${hyperscapes_cdn_url}"
    export PUBLIC_ASSET_VERSION="${commit_sha}"
    export PUBLIC_EMBED_ALLOWED_ORIGINS="$(enoomian_hyperscapes_embed_allowed_origins)"
    if [[ -n "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" ]]; then
      export PUBLIC_STREAMING_VIEWER_ACCESS_TOKEN="${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN}"
    else
      unset PUBLIC_STREAMING_VIEWER_ACCESS_TOKEN || true
    fi
    if [[ -n "${ENOOMIAN_PUBLIC_PRIVY_APP_ID:-}" ]]; then
      export PUBLIC_PRIVY_APP_ID="${ENOOMIAN_PUBLIC_PRIVY_APP_ID}"
    else
      unset PUBLIC_PRIVY_APP_ID || true
    fi
    bun run build:client
  )

  enoomian_log "stamping Hyperscapes Pages runtime env"
  enoomian_write_hyperscapes_pages_env_js \
    "${repo_root}/packages/client/dist/env.js" \
    "${hyperscapes_public_api_url}" \
    "${hyperscapes_public_ws_url}" \
    "${hyperscapes_cdn_url}" \
    "${ENOOMIAN_HYPERSCAPES_PAGES_URL}" \
    "$(enoomian_hyperscapes_embed_allowed_origins)" \
    "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" \
    "${ENOOMIAN_PUBLIC_PRIVY_APP_ID:-}"
  enoomian_validate_hyperscapes_pages_env_js \
    "${repo_root}/packages/client/dist/env.js" \
    "${hyperscapes_public_api_url}" \
    "${hyperscapes_public_ws_url}" \
    "${hyperscapes_cdn_url}"

  enoomian_log "deploying Hyperscapes Pages"
  (
    cd "${repo_root}/packages/client"
    enoomian_wrangler pages deploy dist \
      --project-name="${ENOOMIAN_HYPERSCAPES_PAGES_PROJECT_NAME}" \
      --branch="$(enoomian_hyperbet_pages_branch)" \
      --commit-hash="${commit_sha}" \
      --commit-message="${commit_msg}"
  )

  enoomian_wait_for_url "${ENOOMIAN_HYPERSCAPES_PAGES_URL}" || enoomian_die "Hyperscapes Pages URL did not become reachable"
}

enoomian_pages_commit_message() {
  if git -C "${ENOOMIAN_REPO_ROOT}" rev-parse HEAD >/dev/null 2>&1; then
    git -C "${ENOOMIAN_REPO_ROOT}" log -1 --pretty=%s | tr -d '"' | cut -c1-100
  else
    printf '%s\n' "local staging deploy"
  fi
}

enoomian_pages_deploy_dist() {
  local dist_dir="$1"
  local project_name="$2"
  local commit_sha="$3"
  local commit_msg="$4"

  enoomian_wrangler pages deploy "${dist_dir}" \
    --project-name="${project_name}" \
    --branch="$(enoomian_hyperbet_pages_branch)" \
    --commit-hash="${commit_sha}" \
    --commit-message="${commit_msg}" \
    --commit-dirty=true \
    --skip-caching
}

enoomian_make_hyperbet_redirect_dist() {
  local target_url="$1"
  local label="$2"
  local redirect_root

  redirect_root="$(enoomian_mktemp_dir "enoomian-${label}-redirect")"
  target_url="${target_url%/}"

  cat >"${redirect_root}/_headers" <<'EOF'
/*
  Cache-Control: no-store
EOF

  cat >"${redirect_root}/_redirects" <<EOF
/build-info.json ${target_url}/build-info.json 302
/ ${target_url}/ 302
/* ${target_url}/:splat 302
EOF

  cat >"${redirect_root}/index.html" <<EOF
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${label} moved</title>
    <meta http-equiv="refresh" content="0; url=${target_url}/" />
  </head>
  <body>
    <p>This surface moved to <a href="${target_url}/">${target_url}/</a>.</p>
  </body>
</html>
EOF

  printf '%s\n' "${redirect_root}"
}

enoomian_deploy_hyperbet_keeper() {
  enoomian_backfill_hyperbet_surface_aliases
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_KEEPER_URL \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY

  local package_root="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-evm"
  local keeper_root="${package_root}/keeper"
  local service_id="${ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID}"
  local upload_root
  local keeper_health_filter='.ok == true and .proxies.solanaRpc == true and .proxies.bscRpc == true'

  enoomian_log "staging Hyperbet unified keeper workspace"
  (
    cd "${ENOOMIAN_REPO_ROOT}"
    node --import tsx scripts/stage-deploy-workspace.ts --target=keeper:shared
  )
  mkdir -p "${keeper_root}/workspace-packages/packages/hyperbet-evm/deployments"
  rsync -a \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-evm/deployments/" \
    "${keeper_root}/workspace-packages/packages/hyperbet-evm/deployments/"

  enoomian_maybe_sync_railway_env \
    "Hyperbet unified keeper" \
    "hyperbet-keeper-env" \
    enoomian_sync_hyperbet_keeper_env \
    enoomian_emit_hyperbet_keeper_env_manifest \
    "${keeper_root}" \
    "${service_id}"

  enoomian_log "deploying Hyperbet unified keeper"
  upload_root="$(enoomian_make_upload_alias "${package_root}")"
  enoomian_railway_up \
    "Hyperbet unified keeper upload" \
    "${upload_root}" \
    --path-as-root \
    -p "${ENOOMIAN_RAILWAY_PROJECT_ID}" \
    -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
    -s "${service_id}" \
    --ci \
    --verbose
  rm -rf "$(dirname "${upload_root}")"

  enoomian_wait_for_json "${ENOOMIAN_HYPERBET_KEEPER_URL}/status" "${keeper_health_filter}" || enoomian_die "Hyperbet unified keeper did not become healthy"
}

enoomian_deploy_hyperbet_pages() {
  enoomian_backfill_hyperbet_surface_aliases
  enoomian_require_env \
    ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERBET_KEEPER_URL \
    ENOOMIAN_HYPERBET_KEEPER_WS_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_CHAIN_ID \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS

  local api_url="${ENOOMIAN_HYPERBET_KEEPER_URL}"
  local ws_url="${ENOOMIAN_HYPERBET_KEEPER_WS_URL}"
  local stream_url=""
  local playback_url=""
  local public_cdn_url
  local commit_sha
  local commit_msg
  local use_game_evm_rpc_proxy
  local base_rpc_url=""
  local base_chain_id=""
  local base_gold_clob_address=""
  local avax_rpc_url=""
  local avax_chain_id=""
  local avax_gold_clob_address=""
  local dist_dir="${ENOOMIAN_HYPERBET_PAGES_DIST_DIR:-}"

  public_cdn_url="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  use_game_evm_rpc_proxy="${ENOOMIAN_HYPERBET_PAGES_USE_GAME_EVM_RPC_PROXY:-true}"
  enoomian_log "Base and AVAX remain disabled on the unified staging Pages surface"
  if [[ -n "${ENOOMIAN_HYPERSCAPES_PAGES_URL:-}" && -n "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" ]]; then
    stream_url="$(enoomian_hyperscapes_stream_url)"
  fi
  enoomian_require_tokenized_hyperscapes_stream_url "${stream_url}"
  if [[ -n "${stream_url}" && "${stream_url}" == *twitch.tv* ]]; then
    enoomian_die "expected a Hyperscapes stream URL for staging, got ${stream_url}"
  fi

  # Prefer the Cloudflare Stream HLS manifest as the canonical bets-page
  # stream URL. StreamPlayer.tsx sniffs the `.m3u8` suffix and mounts a
  # native <video> with hls.js, which collapses cold boot from ~60s (full
  # Hyperscape WebGPU client spin-up inside an iframe of /stream) to ~2-5s
  # (video tag + HLS segment fetch). If the env does not expose a playback
  # URL we fall back to the legacy hyperscape /stream iframe so the viewer
  # still sees *something*.
  playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${stream_url}}"
  if [[ -n "${playback_url}" && "${playback_url}" == *.m3u8* ]]; then
    enoomian_log "Hyperbet Pages stream embed = HLS manifest (${playback_url})"
  else
    enoomian_log "Hyperbet Pages stream embed = hyperscape /stream iframe (no HLS manifest set)"
  fi

  commit_sha="$(git -C "${ENOOMIAN_REPO_ROOT}" rev-parse HEAD)"
  commit_msg="$(enoomian_pages_commit_message)"

  enoomian_ensure_pages_project "${ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME}"

  if [[ -n "${dist_dir}" ]]; then
    enoomian_require_dist_dir "${dist_dir}" "Hyperbet unified Pages"
    enoomian_log "using prebuilt Hyperbet unified Pages dist from ${dist_dir}"
  else
    dist_dir="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-evm/app/dist"
    enoomian_log "building Hyperbet unified Pages"
    (
      cd "${ENOOMIAN_REPO_ROOT}"
      CF_PAGES_COMMIT_SHA="${commit_sha}" \
      VITE_GAME_API_URL="${api_url}" \
      VITE_GAME_WS_URL="${ws_url}" \
      VITE_PUBLIC_CDN_URL="${public_cdn_url}" \
      VITE_STREAM_URL="${playback_url}" \
      VITE_SOLANA_CLUSTER="${ENOOMIAN_SOLANA_CLUSTER}" \
      VITE_FIGHT_ORACLE_PROGRAM_ID="${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}" \
      VITE_GOLD_CLOB_MARKET_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}" \
      VITE_USE_GAME_RPC_PROXY=true \
      VITE_USE_GAME_EVM_RPC_PROXY="${use_game_evm_rpc_proxy}" \
      VITE_BSC_RPC_URL="${ENOOMIAN_BSC_RPC_URL}" \
      VITE_BASE_RPC_URL="${base_rpc_url}" \
      VITE_AVAX_RPC_URL="${avax_rpc_url}" \
      VITE_BSC_CHAIN_ID="${ENOOMIAN_BSC_CHAIN_ID}" \
      VITE_BASE_CHAIN_ID="${base_chain_id}" \
      VITE_AVAX_CHAIN_ID="${avax_chain_id}" \
      VITE_BSC_GOLD_CLOB_ADDRESS="${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}" \
      VITE_BASE_GOLD_CLOB_ADDRESS="${base_gold_clob_address}" \
      VITE_AVAX_GOLD_CLOB_ADDRESS="${avax_gold_clob_address}" \
      VITE_ENABLE_VIEWER_ALIGNED_BET_STATE="${ENOOMIAN_VITE_ENABLE_VIEWER_ALIGNED_BET_STATE:-false}" \
      bun run --cwd packages/hyperbet-evm/app build --mode mainnet-beta
    )
  fi

  enoomian_log "deploying Hyperbet unified Pages"
  (
    cd "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-evm/app"
    enoomian_pages_deploy_dist "${dist_dir}" "${ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME}" "${commit_sha}" "${commit_msg}"
  )

  enoomian_wait_for_build_info "${ENOOMIAN_HYPERBET_PAGES_URL}" "${commit_sha}" || enoomian_die "Hyperbet unified Pages build-info did not update"
}

enoomian_deploy_hyperbet_legacy_pages_redirect() {
  local legacy_label="$1"
  local legacy_project_name="$2"
  local legacy_url="$3"
  local target_url="$4"
  local commit_sha
  local commit_msg
  local redirect_root

  [[ -n "${target_url}" ]] || enoomian_die "missing unified Hyperbet Pages URL"

  if [[ -z "${legacy_project_name}" || -z "${legacy_url}" ]]; then
    enoomian_log "skipping ${legacy_label} redirect deploy because no legacy Pages project/url is configured"
    return 0
  fi

  if [[ "${legacy_url%/}" == "${target_url%/}" ]]; then
    enoomian_log "skipping ${legacy_label} redirect deploy because the legacy URL already matches the unified URL"
    return 0
  fi

  commit_sha="$(git -C "${ENOOMIAN_REPO_ROOT}" rev-parse HEAD)"
  commit_msg="$(enoomian_pages_commit_message)"
  redirect_root="$(enoomian_make_hyperbet_redirect_dist "${target_url}" "${legacy_label}")"

  enoomian_ensure_pages_project "${legacy_project_name}"

  enoomian_log "deploying ${legacy_label} Pages redirect"
  (
    cd "${redirect_root}"
    enoomian_pages_deploy_dist "${redirect_root}" "${legacy_project_name}" "${commit_sha}" "${commit_msg}"
  )

  enoomian_wait_for_build_info "${legacy_url}" "${commit_sha}" || enoomian_die "${legacy_label} Pages redirect build-info did not update"
  rm -rf "${redirect_root}"
}

enoomian_deploy_hyperbet_solana_pages_redirect() {
  enoomian_backfill_hyperbet_surface_aliases
  enoomian_require_env \
    ENOOMIAN_HYPERBET_PAGES_URL

  enoomian_deploy_hyperbet_legacy_pages_redirect \
    "Hyperbet Solana" \
    "${ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME:-}" \
    "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-}" \
    "${ENOOMIAN_HYPERBET_PAGES_URL}"
}

enoomian_deploy_hyperbet_bsc_pages_redirect() {
  enoomian_backfill_hyperbet_surface_aliases
  enoomian_require_env \
    ENOOMIAN_HYPERBET_PAGES_URL

  enoomian_deploy_hyperbet_legacy_pages_redirect \
    "Hyperbet BSC" \
    "${ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME:-}" \
    "${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-}" \
    "${ENOOMIAN_HYPERBET_PAGES_URL}"
}

enoomian_deploy_hyperbet_legacy_pages_redirects() {
  enoomian_deploy_hyperbet_solana_pages_redirect
  enoomian_deploy_hyperbet_bsc_pages_redirect
}

enoomian_deploy_hyperbet_solana_keeper() {
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL \
    ENOOMIAN_HYPERBET_SOLANA_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID \
    ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR

  local keeper_root="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/keeper"
  local service_id="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_SERVICE_ID}"
  local upload_root
  local oracle_authority_keypair
  local bot_keypair
  local stream_playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_renderer_health_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-}"
  local stream_renderer_health_bearer_token="${ENOOMIAN_STREAM_RENDERER_HEALTH_BEARER_TOKEN:-}"
  local stream_renderer_health_poll_ms="${ENOOMIAN_STREAM_RENDERER_HEALTH_POLL_MS:-2000}"
  local stream_renderer_hls_freshness_ms="${ENOOMIAN_STREAM_RENDERER_HLS_FRESHNESS_MS:-15000}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"

  oracle_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}")"
  bot_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR}")"

  enoomian_log "staging Hyperbet Solana keeper workspace"
  (
    cd "${ENOOMIAN_REPO_ROOT}"
    node --import tsx scripts/stage-deploy-workspace.ts --target=keeper:solana
  )
  mkdir -p "${keeper_root}/workspace-packages/packages/hyperbet-solana/deployments"
  rsync -a \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/deployments/" \
    "${keeper_root}/workspace-packages/packages/hyperbet-solana/deployments/"

  enoomian_maybe_sync_railway_env \
    "Hyperbet Solana keeper" \
    "hyperbet-solana-keepers-env" \
    enoomian_sync_hyperbet_solana_keeper_env \
    enoomian_emit_hyperbet_solana_keeper_env_manifest \
    "${keeper_root}" \
    "${service_id}"

  enoomian_log "deploying Hyperbet Solana keeper"
  upload_root="$(enoomian_make_upload_alias "${keeper_root}")"
  enoomian_railway_up \
    "Hyperbet Solana keeper upload" \
    "${upload_root}" \
    --path-as-root \
    -p "${ENOOMIAN_RAILWAY_PROJECT_ID}" \
    -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
    -s "${service_id}" \
    --ci \
    --verbose
  rm -rf "$(dirname "${upload_root}")"

  enoomian_wait_for_json "${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL}/status" '.ok == true and .proxies.solanaRpc == true' || enoomian_die "Hyperbet Solana keeper did not become healthy"
}

enoomian_deploy_hyperbet_bsc_keeper() {
  enoomian_require_env \
    ENOOMIAN_RAILWAY_PROJECT_ID \
    ENOOMIAN_RAILWAY_ENVIRONMENT_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_SERVICE_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_URL \
    ENOOMIAN_HYPERBET_SOLANA_PAGES_URL \
    ENOOMIAN_HYPERBET_BSC_PAGES_URL \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR

  local keeper_root="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/keeper"
  local service_id="${ENOOMIAN_HYPERBET_BSC_KEEPER_SERVICE_ID}"
  local upload_root
  local oracle_authority_keypair
  local evm_keeper_chains
  local base_rpc_url=""
  local base_duel_oracle_address=""
  local base_gold_clob_address=""
  local keeper_health_filter='.ok == true and .proxies.solanaRpc == true and .proxies.bscRpc == true'
  local stream_playback_url="${ENOOMIAN_STREAM_PLAYBACK_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/live/stream.m3u8}"
  local stream_playback_llhls_url="${ENOOMIAN_STREAM_PLAYBACK_LLHLS_URL:-}"
  local stream_delivery_mode="${ENOOMIAN_STREAM_DELIVERY_MODE:-self_hls}"
  local stream_delivery_provider="${ENOOMIAN_STREAM_DELIVERY_PROVIDER:-}"
  local stream_renderer_health_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-}"
  local stream_renderer_health_bearer_token="${ENOOMIAN_STREAM_RENDERER_HEALTH_BEARER_TOKEN:-}"
  local stream_renderer_health_poll_ms="${ENOOMIAN_STREAM_RENDERER_HEALTH_POLL_MS:-2000}"
  local stream_renderer_hls_freshness_ms="${ENOOMIAN_STREAM_RENDERER_HLS_FRESHNESS_MS:-15000}"
  local stream_ingest_rtmps_url="${ENOOMIAN_STREAM_INGEST_RTMPS_URL:-}"

  oracle_authority_keypair="$(enoomian_normalize_keypair_ref "${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}")"
  evm_keeper_chains="$(enoomian_resolve_bsc_keeper_chains)"
  if enoomian_base_lane_enabled; then
    base_rpc_url="${ENOOMIAN_BASE_RPC_URL}"
    base_duel_oracle_address="${ENOOMIAN_BASE_DUEL_ORACLE_ADDRESS}"
    base_gold_clob_address="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS}"
    keeper_health_filter="${keeper_health_filter} and .proxies.baseRpc == true"
  else
    enoomian_log "Base staging lane disabled for Hyperbet BSC keeper"
  fi

  enoomian_log "staging Hyperbet BSC keeper workspace"
  (
    cd "${ENOOMIAN_REPO_ROOT}"
    node --import tsx scripts/stage-deploy-workspace.ts --target=keeper:bsc
  )
  mkdir -p "${keeper_root}/workspace-packages/packages/hyperbet-bsc/deployments"
  rsync -a \
    "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/deployments/" \
    "${keeper_root}/workspace-packages/packages/hyperbet-bsc/deployments/"

  enoomian_maybe_sync_railway_env \
    "Hyperbet BSC keeper" \
    "hyperbet-keepers-env" \
    enoomian_sync_hyperbet_bsc_keeper_env \
    enoomian_emit_hyperbet_bsc_keeper_env_manifest \
    "${keeper_root}" \
    "${service_id}"

  enoomian_log "deploying Hyperbet BSC keeper"
  upload_root="$(enoomian_make_upload_alias "${keeper_root}")"
  enoomian_railway_up \
    "Hyperbet BSC keeper upload" \
    "${upload_root}" \
    --path-as-root \
    -p "${ENOOMIAN_RAILWAY_PROJECT_ID}" \
    -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
    -s "${service_id}" \
    --ci \
    --verbose
  rm -rf "$(dirname "${upload_root}")"

  enoomian_wait_for_json "${ENOOMIAN_HYPERBET_BSC_KEEPER_URL}/status" "${keeper_health_filter}" || enoomian_die "Hyperbet BSC keeper did not become healthy"
}

enoomian_deploy_hyperbet_solana_pages() {
  enoomian_require_env \
    ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME \
    ENOOMIAN_HYPERBET_SOLANA_PAGES_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_BSC_CHAIN_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_URL \
    ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL

  local api_url
  local ws_url
  local stream_url
  local public_cdn_url
  local commit_sha
  local use_game_evm_rpc_proxy
  local base_rpc_url=""
  local base_chain_id=""
  local base_gold_clob_address=""
  local dist_dir="${ENOOMIAN_HYPERBET_SOLANA_PAGES_DIST_DIR:-}"
  api_url="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL}"
  ws_url="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL}"
  public_cdn_url="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  use_game_evm_rpc_proxy="${ENOOMIAN_HYPERBET_PAGES_USE_GAME_EVM_RPC_PROXY:-true}"
  if enoomian_base_lane_enabled; then
    base_rpc_url="${ENOOMIAN_BASE_RPC_URL}"
    base_chain_id="${ENOOMIAN_BASE_CHAIN_ID}"
    base_gold_clob_address="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS}"
  else
    enoomian_log "Base staging lane disabled for Hyperbet Solana Pages"
  fi
  stream_url=""
  if [[ -n "${ENOOMIAN_HYPERSCAPES_PAGES_URL:-}" && -n "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" ]]; then
    stream_url="$(enoomian_hyperscapes_stream_url)"
  fi
  enoomian_require_tokenized_hyperscapes_stream_url "${stream_url}"
  if [[ -n "${stream_url}" && "${stream_url}" == *twitch.tv* ]]; then
    enoomian_die "expected a Hyperscapes stream URL for staging, got ${stream_url}"
  fi
  commit_sha="$(git -C "${ENOOMIAN_REPO_ROOT}" rev-parse HEAD)"

  enoomian_ensure_pages_project "${ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME}"

  if [[ -n "${dist_dir}" ]]; then
    enoomian_require_dist_dir "${dist_dir}" "Hyperbet Solana Pages"
    enoomian_log "using prebuilt Hyperbet Solana Pages dist from ${dist_dir}"
  else
    dist_dir="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/app/dist"
    enoomian_log "building Hyperbet Solana Pages"
    (
      cd "${ENOOMIAN_REPO_ROOT}"
      CF_PAGES_COMMIT_SHA="${commit_sha}" \
      VITE_GAME_API_URL="${api_url}" \
      VITE_GAME_WS_URL="${ws_url}" \
      VITE_PUBLIC_CDN_URL="${public_cdn_url}" \
      VITE_STREAM_URL="${stream_url}" \
      VITE_STREAM_SOURCES="${stream_url}" \
      VITE_STREAM_FALLBACK_URL="" \
      VITE_SOLANA_CLUSTER="${ENOOMIAN_SOLANA_CLUSTER}" \
      VITE_FIGHT_ORACLE_PROGRAM_ID="${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}" \
      VITE_GOLD_CLOB_MARKET_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}" \
      VITE_USE_GAME_RPC_PROXY=true \
      VITE_USE_GAME_EVM_RPC_PROXY="${use_game_evm_rpc_proxy}" \
      VITE_BSC_RPC_URL="${ENOOMIAN_BSC_RPC_URL}" \
      VITE_BASE_RPC_URL="${base_rpc_url}" \
      VITE_BSC_CHAIN_ID="${ENOOMIAN_BSC_CHAIN_ID}" \
      VITE_BASE_CHAIN_ID="${base_chain_id}" \
      VITE_BSC_GOLD_CLOB_ADDRESS="${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}" \
      VITE_BASE_GOLD_CLOB_ADDRESS="${base_gold_clob_address}" \
      VITE_ENABLE_VIEWER_ALIGNED_BET_STATE="${ENOOMIAN_VITE_ENABLE_VIEWER_ALIGNED_BET_STATE:-false}" \
      bun run --cwd packages/hyperbet-solana/app build --mode mainnet-beta
    )
  fi

  enoomian_log "deploying Hyperbet Solana Pages"
  (
    local commit_msg
    commit_msg="$(git -C "${ENOOMIAN_REPO_ROOT}" log -1 --pretty=%s | tr -d '"' | cut -c1-100)"
    enoomian_wrangler pages deploy "${dist_dir}" \
      --project-name="${ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME}" \
      --branch="$(enoomian_hyperbet_pages_branch)" \
      --commit-hash="${commit_sha}" \
      --commit-message="${commit_msg}" \
      --commit-dirty=true \
      --skip-caching
  )

  enoomian_wait_for_build_info "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL}" "${commit_sha}" || enoomian_die "Hyperbet Solana Pages build-info did not update"
}

enoomian_deploy_hyperbet_bsc_pages() {
  enoomian_require_env \
    ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME \
    ENOOMIAN_HYPERBET_BSC_PAGES_URL \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_BSC_CHAIN_ID \
    ENOOMIAN_HYPERBET_BSC_KEEPER_URL \
    ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL

  local api_url
  local ws_url
  local stream_url
  local public_cdn_url
  local commit_sha
  local use_game_evm_rpc_proxy
  local base_rpc_url=""
  local base_chain_id=""
  local base_gold_clob_address=""
  local dist_dir="${ENOOMIAN_HYPERBET_BSC_PAGES_DIST_DIR:-}"
  api_url="${ENOOMIAN_HYPERBET_BSC_KEEPER_URL}"
  ws_url="${ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL}"
  public_cdn_url="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}"
  use_game_evm_rpc_proxy="${ENOOMIAN_HYPERBET_PAGES_USE_GAME_EVM_RPC_PROXY:-true}"
  if enoomian_base_lane_enabled; then
    base_rpc_url="${ENOOMIAN_BASE_RPC_URL}"
    base_chain_id="${ENOOMIAN_BASE_CHAIN_ID}"
    base_gold_clob_address="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS}"
  else
    enoomian_log "Base staging lane disabled for Hyperbet BSC Pages"
  fi
  stream_url=""
  if [[ -n "${ENOOMIAN_HYPERSCAPES_PAGES_URL:-}" && -n "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN:-}" ]]; then
    stream_url="$(enoomian_hyperscapes_stream_url)"
  fi
  enoomian_require_tokenized_hyperscapes_stream_url "${stream_url}"
  if [[ -n "${stream_url}" && "${stream_url}" == *twitch.tv* ]]; then
    enoomian_die "expected a Hyperscapes stream URL for staging, got ${stream_url}"
  fi
  commit_sha="$(git -C "${ENOOMIAN_REPO_ROOT}" rev-parse HEAD)"

  enoomian_ensure_pages_project "${ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME}"

  if [[ -n "${dist_dir}" ]]; then
    enoomian_require_dist_dir "${dist_dir}" "Hyperbet BSC Pages"
    enoomian_log "using prebuilt Hyperbet BSC Pages dist from ${dist_dir}"
  else
    dist_dir="${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/app/dist"
    enoomian_log "building Hyperbet BSC Pages"
    (
      cd "${ENOOMIAN_REPO_ROOT}"
      CF_PAGES_COMMIT_SHA="${commit_sha}" \
      VITE_GAME_API_URL="${api_url}" \
      VITE_GAME_WS_URL="${ws_url}" \
      VITE_PUBLIC_CDN_URL="${public_cdn_url}" \
      VITE_STREAM_URL="${stream_url}" \
      VITE_STREAM_SOURCES="${stream_url}" \
      VITE_STREAM_FALLBACK_URL="" \
      VITE_SOLANA_CLUSTER="${ENOOMIAN_SOLANA_CLUSTER}" \
      VITE_FIGHT_ORACLE_PROGRAM_ID="${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}" \
      VITE_GOLD_CLOB_MARKET_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}" \
      VITE_USE_GAME_RPC_PROXY=true \
      VITE_USE_GAME_EVM_RPC_PROXY="${use_game_evm_rpc_proxy}" \
      VITE_BSC_RPC_URL="${ENOOMIAN_BSC_RPC_URL}" \
      VITE_BASE_RPC_URL="${base_rpc_url}" \
      VITE_BSC_CHAIN_ID="${ENOOMIAN_BSC_CHAIN_ID}" \
      VITE_BASE_CHAIN_ID="${base_chain_id}" \
      VITE_BSC_GOLD_CLOB_ADDRESS="${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}" \
      VITE_BASE_GOLD_CLOB_ADDRESS="${base_gold_clob_address}" \
      VITE_ENABLE_VIEWER_ALIGNED_BET_STATE="${ENOOMIAN_VITE_ENABLE_VIEWER_ALIGNED_BET_STATE:-false}" \
      bun run --cwd packages/hyperbet-bsc/app build --mode mainnet-beta
    )
  fi

  enoomian_log "deploying Hyperbet BSC Pages"
  (
    local commit_msg
    commit_msg="$(git -C "${ENOOMIAN_REPO_ROOT}" log -1 --pretty=%s | tr -d '"' | cut -c1-100)"
    enoomian_wrangler pages deploy "${dist_dir}" \
      --project-name="${ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME}" \
      --branch="$(enoomian_hyperbet_pages_branch)" \
      --commit-hash="${commit_sha}" \
      --commit-message="${commit_msg}" \
      --commit-dirty=true \
      --skip-caching
  )

  enoomian_wait_for_build_info "${ENOOMIAN_HYPERBET_BSC_PAGES_URL}" "${commit_sha}" || enoomian_die "Hyperbet BSC Pages build-info did not update"
}

usage() {
  cat <<'EOF'
usage: scripts/enoomian-staging/deploy.sh <target> [env-file]

targets:
  print-personal-secret-manifest
  check-personal-secrets
  sync-personal-secrets
  deploy-code
  hyperscapes-railway
  hyperscapes-railway-env
  hyperscapes-pages
  hyperscapes-aws-gpu-plan
  hyperscapes-aws-gpu-preflight
  hyperscapes-aws-gpu-deploy
  hyperscapes-aws-gpu-status
  hyperscapes-aws-gpu-activate
  hyperbet-solana-keepers-env
  hyperbet-bsc-keeper-env
  hyperbet-keeper-env
  hyperbet-solana-keeper
  hyperbet-bsc-keeper
  hyperbet-keeper
  hyperbet-solana-pages-redirect
  hyperbet-bsc-pages-redirect
  hyperbet-pages-redirects
  hyperbet-keepers-env
  hyperbet-keepers
  hyperbet-pages
  all
EOF
}

main() {
  local target="${1:-}"
  local env_file="${2:-}"

  [[ -n "${target}" ]] || {
    usage
    exit 1
  }

  if [[ "${target}" == "print-personal-secret-manifest" ]]; then
    enoomian_print_personal_secret_manifest
    return 0
  fi

  enoomian_require_cmds railway bun curl jq node git rsync
  enoomian_load_env "${env_file}"
  enoomian_assert_personal_env_file "${ENOOMIAN_ENV_FILE}"

  case "${target}" in
    check-personal-secrets) enoomian_check_personal_secrets ;;
    sync-personal-secrets) enoomian_sync_personal_secrets ;;
    deploy-code) enoomian_deploy_code ;;
    hyperscapes-railway) enoomian_deploy_hyperscapes_railway ;;
    hyperscapes-railway-env) enoomian_sync_hyperscapes_railway_env ;;
    hyperscapes-pages) enoomian_deploy_hyperscapes_pages ;;
    hyperscapes-aws-gpu-plan) enoomian_aws_gpu_plan ;;
    hyperscapes-aws-gpu-preflight) enoomian_aws_gpu_remote_preflight ;;
    hyperscapes-aws-gpu-deploy) enoomian_aws_gpu_deploy ;;
    hyperscapes-aws-gpu-status) enoomian_aws_gpu_status ;;
    hyperscapes-aws-gpu-activate) enoomian_aws_gpu_activate ;;
    hyperbet-solana-keepers-env) enoomian_sync_hyperbet_solana_keeper_env ;;
    hyperbet-bsc-keeper-env) enoomian_sync_hyperbet_bsc_keeper_env ;;
    hyperbet-keeper-env) enoomian_sync_hyperbet_keeper_env ;;
    hyperbet-solana-keeper) enoomian_deploy_hyperbet_solana_keeper ;;
    hyperbet-bsc-keeper) enoomian_deploy_hyperbet_bsc_keeper ;;
    hyperbet-keeper) enoomian_deploy_hyperbet_keeper ;;
    hyperbet-solana-pages-redirect) enoomian_deploy_hyperbet_solana_pages_redirect ;;
    hyperbet-bsc-pages-redirect) enoomian_deploy_hyperbet_bsc_pages_redirect ;;
    hyperbet-pages-redirects) enoomian_deploy_hyperbet_legacy_pages_redirects ;;
    hyperbet-keepers-env) enoomian_sync_hyperbet_keepers_env ;;
    hyperbet-keepers) enoomian_deploy_hyperbet_keeper ;;
    hyperbet-pages)
      enoomian_deploy_hyperbet_pages
      enoomian_deploy_hyperbet_legacy_pages_redirects
      ;;
    all) enoomian_deploy_code ;;
    *)
      usage
      exit 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
