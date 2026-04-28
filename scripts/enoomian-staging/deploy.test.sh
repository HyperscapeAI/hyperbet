#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./deploy.sh
source "${SCRIPT_DIR}/deploy.sh"

CALL_LOG=""
TEST_TMP_ROOT=""

setup_test_env() {
  TEST_TMP_ROOT="$(mktemp -d)"
  CALL_LOG="${TEST_TMP_ROOT}/calls.log"
  : > "${CALL_LOG}"

  export ENOOMIAN_REPO_ROOT="${TEST_TMP_ROOT}/repo"
  export ENOOMIAN_HYPERSCAPES_ROOT="${TEST_TMP_ROOT}/hyperscapes"
  mkdir -p "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/keeper"
  mkdir -p "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-solana/deployments"
  mkdir -p "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/keeper"
  mkdir -p "${ENOOMIAN_REPO_ROOT}/packages/hyperbet-bsc/deployments"
  mkdir -p "${ENOOMIAN_HYPERSCAPES_ROOT}"

  export ENOOMIAN_RAILWAY_PROJECT_ID="prj_test"
  export ENOOMIAN_RAILWAY_ENVIRONMENT_ID="env_test"
  export ENOOMIAN_HYPERSCAPES_SERVICE_ID="svc_hyperscapes"
  export ENOOMIAN_HYPERSCAPES_API_URL="https://hyperscapes.example"
  export ENOOMIAN_HYPERSCAPES_WS_URL="wss://hyperscapes.example/ws"
  export ENOOMIAN_HYPERSCAPES_PAGES_URL="https://hyperscapes-pages.example"
  export ENOOMIAN_HYPERSCAPES_PAGES_PROJECT_NAME="enoomian-staging-hyperscapes"
  export ENOOMIAN_HYPERSCAPES_GAME_ASSETS_FALLBACK_URL="https://fallback-assets.example/game-assets"
  export ENOOMIAN_DATABASE_URL="postgres://db"
  export ENOOMIAN_HYPERSCAPES_JWT_SECRET="jwt-secret"
  export ENOOMIAN_HYPERSCAPES_AUTOMATION_TOKEN="automation-token"
  export ENOOMIAN_BETTING_FEED_ACCESS_TOKEN="betting-feed-token"
  export ENOOMIAN_HYPERBET_SOLANA_KEEPER_SERVICE_ID="svc_solana"
  export ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL="https://solana-keeper.example"
  export ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL="wss://solana-keeper.example/ws"
  export ENOOMIAN_HYPERBET_SOLANA_PAGES_URL="https://solana-pages.example"
  export ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME="enoomian-staging-hyperbet-solana"
  export ENOOMIAN_HYPERBET_BSC_KEEPER_SERVICE_ID="svc_bsc"
  export ENOOMIAN_HYPERBET_BSC_KEEPER_URL="https://bsc-keeper.example"
  export ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL="wss://bsc-keeper.example/ws"
  export ENOOMIAN_HYPERBET_BSC_PAGES_URL="https://bsc-pages.example"
  export ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME="enoomian-staging-hyperbet-bsc"
  export ENOOMIAN_HYPERBET_KEEPER_SERVICE_ID="svc_unified"
  export ENOOMIAN_HYPERBET_KEEPER_URL="https://unified-keeper.example"
  export ENOOMIAN_HYPERBET_KEEPER_WS_URL="wss://unified-keeper.example/ws"
  export ENOOMIAN_HYPERBET_PAGES_URL="https://unified-pages.example"
  export ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME="enoomian-staging-hyperbet"
  export ENOOMIAN_SOLANA_CLUSTER="devnet"
  export ENOOMIAN_SOLANA_RPC_URL="https://solana-rpc.example"
  export ENOOMIAN_SOLANA_RPC_WS_URL="wss://solana-rpc.example/ws"
  export ENOOMIAN_SOLANA_ORACLE_DISPUTE_WINDOW_SECS="60"
  export ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID="fight-oracle"
  export ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID="gold-clob"
  export ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID="gold-amm"
  export ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID="gold-perps"
  export ENOOMIAN_SOLANA_STAGE_A_WALLET_PATH="${TEST_TMP_ROOT}/solana-wallet.json"
  export ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY="solana-stream-key"
  export ENOOMIAN_HYPERBET_SOLANA_ORACLE_CONFIG_AUTHORITY_KEYPAIR="solana-config-authority-keypair"
  export ENOOMIAN_HYPERBET_SOLANA_CLOB_CONFIG_AUTHORITY_KEYPAIR="solana-clob-config-authority-keypair"
  export ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR="solana-oracle-keypair"
  export ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR="solana-bot-keypair"
  export ENOOMIAN_HYPERBET_SOLANA_MARKET_MAKER_KEYPAIR="solana-mm-keypair"
  export ENOOMIAN_BSC_RPC_URL="https://bsc-rpc.example"
  export ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS="0xbsc-duel"
  export ENOOMIAN_BSC_GOLD_CLOB_ADDRESS="0xbsc-gold"
  export ENOOMIAN_BSC_GOLD_AMM_ROUTER_ADDRESS="0xbsc-router"
  export ENOOMIAN_BSC_MUSD_TOKEN_ADDRESS="0xbsc-musd"
  export ENOOMIAN_BSC_GOLD_TOKEN_ADDRESS="0xbsc-gold-token"
  export ENOOMIAN_BSC_SKILL_ORACLE_ADDRESS="0xbsc-skill"
  export ENOOMIAN_BSC_PERP_ENGINE_ADDRESS="0xbsc-perp"
  export ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY="bsc-stream-key"
  export ENOOMIAN_HYPERBET_BSC_REPORTER_PRIVATE_KEY="bsc-reporter"
  export ENOOMIAN_HYPERBET_BSC_CANARY_PRIVATE_KEY="bsc-canary"
  export ENOOMIAN_HYPERBET_BSC_MATCHER_PRIVATE_KEY="bsc-matcher"
  export ENOOMIAN_HYPERBET_BSC_ADMIN_PRIVATE_KEY="bsc-admin"
  export ENOOMIAN_HYPERBET_BSC_MARKET_OPERATOR_PRIVATE_KEY="bsc-operator"
  export ENOOMIAN_HYPERBET_BSC_PAUSER_PRIVATE_KEY="bsc-pauser"
  export TESTNET_FINALIZER_PRIVATE_KEY="testnet-finalizer"
  export ENOOMIAN_BSC_CHAIN_ID="97"
  unset ENOOMIAN_HLS_TIME_SECONDS || true
  unset ENOOMIAN_HLS_LIST_SIZE || true
  unset ENOOMIAN_HLS_DELETE_THRESHOLD || true
  unset ENOOMIAN_STREAM_VIDEO_BITRATE_KBPS || true
  unset ENOOMIAN_STREAM_AUDIO_BITRATE_KBPS || true
  unset ENOOMIAN_AWS_GPU_SYNC_HYPERSCAPES_RAILWAY_ENV || true
  unset ENOOMIAN_AWS_GPU_SYNC_HYPERBET_KEEPER_ENV || true
  unset ENOOMIAN_AWS_GPU_DEPLOY_HYPERBET_KEEPER || true
}

reset_mocks() {
  enoomian_log() {
    printf 'log:%s\n' "$*" >> "${CALL_LOG}"
  }

  enoomian_die() {
    printf 'die:%s\n' "$*" >> "${CALL_LOG}"
    return 1
  }

  enoomian_require_hyperscapes_root() { :; }
  enoomian_require_env() { :; }
  enoomian_patch_hyperscapes_upload_root() { :; }
  enoomian_validate_hyperscapes_assets_root() { :; }
  enoomian_run_hyperscapes_preflight() { :; }
  enoomian_wait_for_json() { :; }
  enoomian_normalize_keypair_ref() { printf '%s' "$1"; }
  enoomian_resolve_bsc_keeper_chains() { printf 'bsc'; }
  enoomian_base_lane_enabled() { return 1; }

  git() {
    if [[ "$1" == "-C" && "$3" == "rev-parse" ]]; then
      printf 'deadbeef\n'
      return 0
    fi
    if [[ "$1" == "-C" && "$3" == "log" ]]; then
      printf 'test commit\n'
      return 0
    fi
    printf 'git:%s\n' "$*" >> "${CALL_LOG}"
  }

  node() {
    printf 'node:%s\n' "$*" >> "${CALL_LOG}"
  }

  rsync() {
    printf 'rsync:%s\n' "$*" >> "${CALL_LOG}"
  }

  enoomian_make_upload_alias() {
    local source_root="$1"
    local alias_parent
    alias_parent="$(mktemp -d "${TEST_TMP_ROOT}/alias.XXXXXX")"
    local alias_root="${alias_parent}/upload"
    mkdir -p "${alias_root}"
    printf '%s\n' "${alias_root}"
    printf 'upload:%s:%s\n' "${source_root}" "${alias_root}" >> "${CALL_LOG}"
  }

  railway() {
    printf 'railway:%s\n' "$*" >> "${CALL_LOG}"
  }

  enoomian_railway_set() {
    printf 'set:%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "${CALL_LOG}"
  }

  enoomian_railway_set_stdin() {
    printf 'set_stdin:%s|%s|%s\n' "$1" "$2" "$3" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_legacy_pages_redirects() {
    enoomian_deploy_hyperbet_solana_pages_redirect
    enoomian_deploy_hyperbet_bsc_pages_redirect
  }
}

assert_contains() {
  local pattern="$1"
  if ! grep -q -- "${pattern}" "${CALL_LOG}"; then
    printf 'expected pattern missing: %s\n' "${pattern}" >&2
    cat "${CALL_LOG}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  if grep -q -- "${pattern}" "${CALL_LOG}"; then
    printf 'unexpected pattern present: %s\n' "${pattern}" >&2
    cat "${CALL_LOG}" >&2
    exit 1
  fi
}

assert_order() {
  local first_pattern="$1"
  local second_pattern="$2"
  local first_line
  local second_line

  first_line="$(grep -n -- "${first_pattern}" "${CALL_LOG}" | head -n1 | cut -d: -f1)"
  second_line="$(grep -n -- "${second_pattern}" "${CALL_LOG}" | head -n1 | cut -d: -f1)"

  if [[ -z "${first_line}" || -z "${second_line}" || "${first_line}" -ge "${second_line}" ]]; then
    printf 'expected ordering %s before %s\n' "${first_pattern}" "${second_pattern}" >&2
    cat "${CALL_LOG}" >&2
    exit 1
  fi
}

test_code_only_hyperscapes_deploy() {
  setup_test_env
  reset_mocks
  unset ENOOMIAN_SYNC_RAILWAY_ENV || true

  enoomian_deploy_hyperscapes_railway

  assert_not_contains '^set:'
  assert_not_contains '^set_stdin:'
  assert_contains '^railway:up '
  rm -rf "${TEST_TMP_ROOT}"
}

test_explicit_hyperscapes_env_sync() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperscapes_railway_env

  assert_contains '^set:'
  assert_contains 'set:.*|GAME_ASSETS_FALLBACK_URL|https://fallback-assets.example/game-assets'
  assert_contains 'set:.*|HLS_TIME_SECONDS|2'
  assert_contains 'set:.*|HLS_LIST_SIZE|18'
  assert_contains 'set:.*|HLS_DELETE_THRESHOLD|54'
  assert_contains 'set:.*|STREAM_OUTPUT_WIDTH|426'
  assert_contains 'set:.*|STREAM_OUTPUT_HEIGHT|240'
  assert_contains 'set:.*|STREAM_VIDEO_BITRATE_KBPS|96'
  assert_contains 'set:.*|STREAM_AUDIO_BITRATE_KBPS|32'
  assert_contains '^set_stdin:'
  assert_not_contains '^railway:up '
  rm -rf "${TEST_TMP_ROOT}"
}

test_compat_hyperscapes_deploy_syncs_before_up() {
  setup_test_env
  reset_mocks
  export ENOOMIAN_SYNC_RAILWAY_ENV=1

  enoomian_deploy_hyperscapes_railway

  assert_contains '^set:'
  assert_contains '^railway:up '
  assert_order '^set:' '^railway:up '
  rm -rf "${TEST_TMP_ROOT}"
}

test_keeper_env_sync_target() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperbet_solana_keeper_env

  assert_contains 'set:.*|SOLANA_ORACLE_DISPUTE_WINDOW_SECS|60'
  assert_contains 'set_stdin:.*|ORACLE_CONFIG_AUTHORITY_KEYPAIR'
  assert_contains 'set_stdin:.*|CLOB_CONFIG_AUTHORITY_KEYPAIR'
  assert_contains '^set:'
  assert_contains '^set_stdin:'
  assert_not_contains '^railway:up '
  rm -rf "${TEST_TMP_ROOT}"
}

test_unified_keeper_env_sync_wires_raw_source_and_bsc_roles() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperbet_keeper_env

  assert_contains 'set:.*|GAME_URL|https://hyperscapes.example'
  assert_contains 'set:.*|SOLANA_ORACLE_DISPUTE_WINDOW_SECS|60'
  assert_contains 'set_stdin:.*|ORACLE_CONFIG_AUTHORITY_KEYPAIR'
  assert_contains 'set_stdin:.*|CLOB_CONFIG_AUTHORITY_KEYPAIR'
  assert_contains 'set:.*|STREAM_STATE_SOURCE_URL|https://hyperscapes.example/api/streaming/state'
  assert_contains 'set_stdin:.*|HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY'
  assert_contains 'set_stdin:.*|HYPERBET_BSC_STAGING_MARKET_OPERATOR_PRIVATE_KEY'
  assert_contains 'set_stdin:.*|HYPERBET_BSC_STAGING_FINALIZER_PRIVATE_KEY'
  assert_not_contains '^railway:up '
  rm -rf "${TEST_TMP_ROOT}"
}

test_personal_secret_boundary_rejects_repo_env_outside_tmp() {
  setup_test_env
  reset_mocks

  if enoomian_assert_personal_env_file "${ENOOMIAN_REPO_ROOT}/.env.personal"; then
    printf 'expected boundary check to fail\n' >&2
    exit 1
  fi

  assert_contains '^die:env file inside the repo must live under tmp/enoomian-staging/:'
  rm -rf "${TEST_TMP_ROOT}"
}

test_sync_personal_secrets_wrapper() {
  setup_test_env
  reset_mocks
  export ENOOMIAN_ENV_FILE="${ENOOMIAN_REPO_ROOT}/tmp/enoomian-staging/personal-staging.env"
  mkdir -p "$(dirname "${ENOOMIAN_ENV_FILE}")"
  : > "${ENOOMIAN_ENV_FILE}"

  enoomian_sync_hyperscapes_railway_env() {
    printf 'sync:hyperscapes\n' >> "${CALL_LOG}"
  }

  enoomian_sync_hyperbet_keepers_env() {
    printf 'sync:keepers\n' >> "${CALL_LOG}"
  }

  enoomian_sync_personal_secrets

  assert_contains '^sync:hyperscapes$'
  assert_contains '^sync:keepers$'
  rm -rf "${TEST_TMP_ROOT}"
}

test_deploy_code_wrapper() {
  setup_test_env
  reset_mocks
  export ENOOMIAN_ENV_FILE="${ENOOMIAN_REPO_ROOT}/tmp/enoomian-staging/personal-staging.env"
  mkdir -p "$(dirname "${ENOOMIAN_ENV_FILE}")"
  : > "${ENOOMIAN_ENV_FILE}"

  enoomian_deploy_hyperscapes_railway() { printf 'deploy:hyperscapes-railway\n' >> "${CALL_LOG}"; }
  enoomian_deploy_hyperscapes_pages() { printf 'deploy:hyperscapes-pages\n' >> "${CALL_LOG}"; }
  enoomian_deploy_hyperbet_keeper() { printf 'deploy:unified-keeper\n' >> "${CALL_LOG}"; }
  enoomian_deploy_hyperbet_pages() { printf 'deploy:unified-pages\n' >> "${CALL_LOG}"; }
  enoomian_deploy_hyperbet_legacy_pages_redirects() { printf 'deploy:legacy-redirects\n' >> "${CALL_LOG}"; }

  enoomian_deploy_code

  assert_contains '^deploy:hyperscapes-railway$'
  assert_contains '^deploy:hyperscapes-pages$'
  assert_contains '^deploy:unified-keeper$'
  assert_contains '^deploy:unified-pages$'
  assert_contains '^deploy:legacy-redirects$'
  rm -rf "${TEST_TMP_ROOT}"
}

test_hyperscapes_pages_public_api_ws_overrides() {
  setup_test_env
  reset_mocks

  export ENOOMIAN_HYPERSCAPES_PUBLIC_API_URL="https://hyperscapes-public.example"
  export ENOOMIAN_HYPERSCAPES_PUBLIC_WS_URL="wss://hyperscapes-public.example/ws"
  export ENOOMIAN_ALLOW_SPLIT_HYPERSCAPES_PUBLIC_RAIL=1
  export ENOOMIAN_PUBLIC_CDN_URL="https://cdn-public.example/game-assets"
  mkdir -p "${ENOOMIAN_HYPERSCAPES_ROOT}/packages/client/dist"

  bun() {
    printf 'bun:%s|api=%s|ws=%s\n' "$*" "${PUBLIC_API_URL:-}" "${PUBLIC_WS_URL:-}" >> "${CALL_LOG}"
  }

  enoomian_ensure_pages_project() {
    printf 'pages-project:%s\n' "$1" >> "${CALL_LOG}"
  }

  enoomian_wrangler() {
    printf 'wrangler:%s\n' "$*" >> "${CALL_LOG}"
  }

  enoomian_wait_for_url() {
    printf 'wait-url:%s\n' "$1" >> "${CALL_LOG}"
    return 0
  }

  enoomian_hyperbet_pages_branch() {
    printf 'enoomian-staging'
  }

  enoomian_hyperscapes_embed_allowed_origins() {
    printf 'https://allowed.example'
  }

  enoomian_deploy_hyperscapes_pages

  assert_contains '^bun:run build:client|api=https://hyperscapes-public.example|ws=wss://hyperscapes-public.example/ws$'
  assert_not_contains '^bun:run build:client|api=https://hyperscapes.example|ws=wss://hyperscapes.example/ws$'
  assert_contains '^wrangler:pages deploy dist '
  grep -q '"PUBLIC_API_URL": "https://hyperscapes-public.example"' "${ENOOMIAN_HYPERSCAPES_ROOT}/packages/client/dist/env.js"
  grep -q '"PUBLIC_WS_URL": "wss://hyperscapes-public.example/ws"' "${ENOOMIAN_HYPERSCAPES_ROOT}/packages/client/dist/env.js"
  grep -q '"PUBLIC_CDN_URL": "https://cdn-public.example/game-assets"' "${ENOOMIAN_HYPERSCAPES_ROOT}/packages/client/dist/env.js"
  grep -q '"PUBLIC_ASSETS_URL": "https://cdn-public.example/game-assets"' "${ENOOMIAN_HYPERSCAPES_ROOT}/packages/client/dist/env.js"
  rm -rf "${TEST_TMP_ROOT}"
}

test_backfill_hyperbet_surface_aliases() {
  setup_test_env
  reset_mocks

  unset ENOOMIAN_HYPERBET_SOLANA_PAGES_URL
  unset ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL
  unset ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL
  unset ENOOMIAN_HYPERBET_BSC_PAGES_URL
  unset ENOOMIAN_HYPERBET_BSC_KEEPER_URL
  unset ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL

  enoomian_backfill_hyperbet_surface_aliases

  [[ "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL}" == "${ENOOMIAN_HYPERBET_PAGES_URL}" ]]
  [[ "${ENOOMIAN_HYPERBET_BSC_PAGES_URL}" == "${ENOOMIAN_HYPERBET_PAGES_URL}" ]]
  [[ "${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL}" == "${ENOOMIAN_HYPERBET_KEEPER_URL}" ]]
  [[ "${ENOOMIAN_HYPERBET_BSC_KEEPER_URL}" == "${ENOOMIAN_HYPERBET_KEEPER_URL}" ]]
  [[ "${ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL}" == "${ENOOMIAN_HYPERBET_KEEPER_WS_URL}" ]]
  [[ "${ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL}" == "${ENOOMIAN_HYPERBET_KEEPER_WS_URL}" ]]
  rm -rf "${TEST_TMP_ROOT}"
}

test_optional_legacy_redirects_skip_when_not_configured() {
  setup_test_env
  reset_mocks

  unset ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME
  unset ENOOMIAN_HYPERBET_SOLANA_PAGES_URL
  unset ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME
  unset ENOOMIAN_HYPERBET_BSC_PAGES_URL

  enoomian_deploy_hyperbet_legacy_pages_redirects

  assert_not_contains '^die:'
  assert_not_contains '^railway:'
  assert_contains 'skipping Hyperbet Solana redirect deploy because no legacy Pages project/url is configured'
  assert_contains 'skipping Hyperbet BSC redirect deploy because no legacy Pages project/url is configured'
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_runtime_env_uses_cloudflare_and_x11_nvenc() {
  setup_test_env
  reset_mocks

  export ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN="viewer-token"
  export ENOOMIAN_STREAM_DELIVERY_MODE="external_hls"
  export ENOOMIAN_STREAM_DELIVERY_PROVIDER="cloudflare_stream"
  export ENOOMIAN_STREAM_PLAYBACK_URL="https://customer.example/live/manifest/video.m3u8?protocol=llhls"
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_HLS_URL="https://customer.example/live/manifest/video.m3u8"
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_LLHLS_URL="https://customer.example/live/manifest/video.m3u8?protocol=llhls"
  export ENOOMIAN_STREAM_INGEST_RTMPS_URL="rtmps://live.cloudflare.com:443/live/"
  export ENOOMIAN_STREAM_INGEST_STREAM_KEY="stream-key"
  export STREAM_CLOUDFLARE_LIVE_INPUT_ID="live-input"
  export STREAM_CLOUDFLARE_ACCOUNT_ID="cf-account"

  local env_file="${TEST_TMP_ROOT}/aws-gpu.env"
  enoomian_aws_gpu_write_runtime_env "${env_file}"

  grep -q "^STREAM_CAPTURE_MODE='x11_nvenc'$" "${env_file}"
  grep -q "^FFMPEG_HWACCEL='nvidia'$" "${env_file}"
  grep -q "^STREAM_DELIVERY_MODE='external_hls'$" "${env_file}"
  grep -q "^STREAM_DELIVERY_PROVIDER='cloudflare_stream'$" "${env_file}"
  grep -q "^BETTING_FEED_ACCESS_TOKEN='betting-feed-token'$" "${env_file}"
  grep -q "^STREAM_PLAYBACK_HLS_URL='https://customer.example/live/manifest/video.m3u8?protocol=llhls'$" "${env_file}"
  grep -q "^STREAM_INGEST_RTMPS_URL='rtmps://live.cloudflare.com:443/live'$" "${env_file}"
  grep -q "^STREAM_INGEST_STREAM_KEY='stream-key'$" "${env_file}"
  grep -q "^GAME_URL='https://hyperscapes-pages.example/stream?disableBridgeCapture=1&streamToken=viewer-token'$" "${env_file}"
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_runtime_env_honors_aws_delivery_provider_override() {
  setup_test_env
  reset_mocks

  export ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN="viewer-token"
  export ENOOMIAN_STREAM_DELIVERY_PROVIDER="cloudflare_stream"
  export ENOOMIAN_AWS_GPU_STREAM_DELIVERY_MODE="self_hls"
  export ENOOMIAN_AWS_GPU_STREAM_DELIVERY_PROVIDER="self_hls"
  export ENOOMIAN_STREAM_EXTERNAL_DELIVERY_PROVIDER=""
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_HLS_URL=""
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_LLHLS_URL=""
  export ENOOMIAN_STREAM_EXTERNAL_INGEST_RTMPS_URL=""

  local env_file="${TEST_TMP_ROOT}/aws-gpu.env"
  enoomian_aws_gpu_write_runtime_env "${env_file}"

  grep -q "^STREAM_DELIVERY_MODE='self_hls'$" "${env_file}"
  grep -q "^STREAM_DELIVERY_PROVIDER='self_hls'$" "${env_file}"
  grep -q "^STREAM_EXTERNAL_DELIVERY_PROVIDER=''$" "${env_file}"
  grep -q "^STREAM_EXTERNAL_PLAYBACK_HLS_URL=''$" "${env_file}"
  grep -q "^STREAM_EXTERNAL_PLAYBACK_LLHLS_URL=''$" "${env_file}"
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_runtime_env_uses_aws_provider_override_for_external_delivery() {
  setup_test_env
  reset_mocks

  export ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN="viewer-token"
  export ENOOMIAN_STREAM_DELIVERY_PROVIDER="cloudflare_stream"
  export ENOOMIAN_AWS_GPU_STREAM_DELIVERY_MODE="external_hls"
  export ENOOMIAN_AWS_GPU_STREAM_DELIVERY_PROVIDER="custom_cdn"
  export ENOOMIAN_AWS_GPU_PUBLIC_HLS_URL="https://aws-gpu.example/live/stream.m3u8"
  export ENOOMIAN_STREAM_EXTERNAL_DELIVERY_PROVIDER=""
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_HLS_URL=""
  export ENOOMIAN_STREAM_EXTERNAL_PLAYBACK_LLHLS_URL=""
  export ENOOMIAN_STREAM_EXTERNAL_INGEST_RTMPS_URL=""

  local env_file="${TEST_TMP_ROOT}/aws-gpu.env"
  enoomian_aws_gpu_write_runtime_env "${env_file}"

  grep -q "^STREAM_DELIVERY_MODE='external_hls'$" "${env_file}"
  grep -q "^STREAM_DELIVERY_PROVIDER='custom_cdn'$" "${env_file}"
  grep -q "^STREAM_EXTERNAL_DELIVERY_PROVIDER='custom_cdn'$" "${env_file}"
  grep -q "^STREAM_EXTERNAL_PLAYBACK_HLS_URL='https://aws-gpu.example/live/stream.m3u8'$" "${env_file}"
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_activation_requires_explicit_guard() {
  setup_test_env
  reset_mocks

  export ENOOMIAN_AWS_GPU_PUBLIC_API_URL="https://aws-gpu.example"
  export ENOOMIAN_AWS_GPU_PUBLIC_WS_URL="wss://aws-gpu.example/ws"
  unset ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY || true

  if enoomian_aws_gpu_activate; then
    printf 'expected AWS GPU activation without guard to fail\n' >&2
    exit 1
  fi

  assert_contains 'refusing to activate AWS GPU authority'
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_activation_reconciles_keeper_authority_by_default() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperscapes_railway_env() {
    printf 'aws-activate:hyperscapes-railway-env|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperscapes_pages() {
    printf 'aws-activate:hyperscapes-pages|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_sync_hyperbet_keepers_env() {
    printf 'aws-activate:hyperbet-keepers-env|health=%s\n' "${ENOOMIAN_STREAM_RENDERER_HEALTH_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_keeper() {
    printf 'aws-activate:hyperbet-keeper-deploy\n' >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_pages() {
    printf 'aws-activate:hyperbet-pages\n' >> "${CALL_LOG}"
  }

  export ENOOMIAN_AWS_GPU_PUBLIC_API_URL="https://aws-gpu.example"
  export ENOOMIAN_AWS_GPU_PUBLIC_WS_URL="wss://aws-gpu.example/ws"
  export ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY="1"

  enoomian_aws_gpu_activate

  assert_contains 'aws-activate:hyperscapes-pages|api=https://aws-gpu.example|ws=wss://aws-gpu.example/ws'
  assert_contains 'aws-activate:hyperbet-keepers-env|health=https://aws-gpu.example/api/streaming/capture/status'
  assert_contains 'aws-activate:hyperbet-keeper-deploy'
  assert_contains 'aws-activate:hyperbet-pages'
  assert_contains 'skipping Hyperscapes Railway env sync for AWS GPU authority'
  assert_not_contains 'aws-activate:hyperscapes-railway-env'
  assert_not_contains '^railway:'
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_activation_can_skip_keeper_reconciliation_when_explicitly_requested() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperscapes_railway_env() {
    printf 'aws-activate:hyperscapes-railway-env|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperscapes_pages() {
    printf 'aws-activate:hyperscapes-pages|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_sync_hyperbet_keepers_env() {
    printf 'aws-activate:hyperbet-keepers-env|health=%s\n' "${ENOOMIAN_STREAM_RENDERER_HEALTH_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_keeper() {
    printf 'aws-activate:hyperbet-keeper-deploy\n' >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_pages() {
    printf 'aws-activate:hyperbet-pages\n' >> "${CALL_LOG}"
  }

  export ENOOMIAN_AWS_GPU_PUBLIC_API_URL="https://aws-gpu.example"
  export ENOOMIAN_AWS_GPU_PUBLIC_WS_URL="wss://aws-gpu.example/ws"
  export ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY="1"
  export ENOOMIAN_AWS_GPU_SYNC_HYPERBET_KEEPER_ENV="0"
  export ENOOMIAN_AWS_GPU_DEPLOY_HYPERBET_KEEPER="0"

  enoomian_aws_gpu_activate

  assert_contains 'aws-activate:hyperscapes-pages|api=https://aws-gpu.example|ws=wss://aws-gpu.example/ws'
  assert_contains 'aws-activate:hyperbet-pages'
  assert_contains 'skipping Hyperbet keeper Railway env sync for AWS GPU authority by explicit override'
  assert_contains 'skipping Hyperbet keeper deploy for AWS GPU authority by explicit override'
  assert_not_contains 'aws-activate:hyperscapes-railway-env'
  assert_not_contains 'aws-activate:hyperbet-keepers-env'
  assert_not_contains 'aws-activate:hyperbet-keeper-deploy'
  rm -rf "${TEST_TMP_ROOT}"
}

test_aws_gpu_activation_syncs_hyperscapes_railway_when_explicitly_requested() {
  setup_test_env
  reset_mocks

  enoomian_sync_hyperscapes_railway_env() {
    printf 'aws-activate:hyperscapes-railway-env|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperscapes_pages() {
    printf 'aws-activate:hyperscapes-pages|api=%s|ws=%s\n' "${ENOOMIAN_HYPERSCAPES_API_URL}" "${ENOOMIAN_HYPERSCAPES_WS_URL}" >> "${CALL_LOG}"
  }

  enoomian_sync_hyperbet_keepers_env() {
    printf 'aws-activate:hyperbet-keepers-env|health=%s\n' "${ENOOMIAN_STREAM_RENDERER_HEALTH_URL}" >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_keeper() {
    printf 'aws-activate:hyperbet-keeper-deploy\n' >> "${CALL_LOG}"
  }

  enoomian_deploy_hyperbet_pages() {
    printf 'aws-activate:hyperbet-pages\n' >> "${CALL_LOG}"
  }

  export ENOOMIAN_AWS_GPU_PUBLIC_API_URL="https://aws-gpu.example"
  export ENOOMIAN_AWS_GPU_PUBLIC_WS_URL="wss://aws-gpu.example/ws"
  export ENOOMIAN_AWS_GPU_ACTIVATE_PUBLIC_AUTHORITY="1"
  export ENOOMIAN_AWS_GPU_SYNC_HYPERSCAPES_RAILWAY_ENV="1"

  enoomian_aws_gpu_activate

  assert_contains 'aws-activate:hyperscapes-railway-env|api=https://aws-gpu.example|ws=wss://aws-gpu.example/ws'
  assert_contains 'aws-activate:hyperscapes-pages|api=https://aws-gpu.example|ws=wss://aws-gpu.example/ws'
  assert_contains 'aws-activate:hyperbet-keepers-env|health=https://aws-gpu.example/api/streaming/capture/status'
  assert_contains 'aws-activate:hyperbet-keeper-deploy'
  assert_contains 'aws-activate:hyperbet-pages'
  rm -rf "${TEST_TMP_ROOT}"
}

test_code_only_hyperscapes_deploy
test_explicit_hyperscapes_env_sync
test_compat_hyperscapes_deploy_syncs_before_up
test_keeper_env_sync_target
test_unified_keeper_env_sync_wires_raw_source_and_bsc_roles
test_personal_secret_boundary_rejects_repo_env_outside_tmp
test_sync_personal_secrets_wrapper
test_hyperscapes_pages_public_api_ws_overrides
test_deploy_code_wrapper
test_backfill_hyperbet_surface_aliases
test_optional_legacy_redirects_skip_when_not_configured
test_aws_gpu_runtime_env_uses_cloudflare_and_x11_nvenc
test_aws_gpu_runtime_env_honors_aws_delivery_provider_override
test_aws_gpu_runtime_env_uses_aws_provider_override_for_external_delivery
test_aws_gpu_activation_requires_explicit_guard
test_aws_gpu_activation_reconciles_keeper_authority_by_default
test_aws_gpu_activation_can_skip_keeper_reconciliation_when_explicitly_requested
test_aws_gpu_activation_syncs_hyperscapes_railway_when_explicitly_requested

printf 'deploy.sh tests passed\n'
