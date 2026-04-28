#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: scripts/enoomian-staging/soak.sh [chains] [duration-minutes] [screenshots=true|false] [env-file]
EOF
}

main() {
  local chains="${1:-solana,bsc}"
  local duration_minutes="${2:-120}"
  local screenshots="${3:-true}"
  local env_file="${4:-}"

  case "${screenshots}" in
    true|false) ;;
    *)
      usage
      exit 1
      ;;
  esac

  enoomian_require_cmds bun node
  enoomian_load_env "${env_file}"
  enoomian_export_hyperbet_staged_env
  enoomian_export_hyperscapes_source_env

  export HYPERBET_CI_ARTIFACT_DIR="${HYPERBET_CI_ARTIFACT_DIR:-${ENOOMIAN_REPO_ROOT}/.ci-artifacts}"
  export SOURCE_ACTIVATION_STARTED_AT_MS="${SOURCE_ACTIVATION_STARTED_AT_MS:-$(node -e 'console.log(Date.now())')}"
  export SOURCE_ACTIVATION_BUDGET_MS="${SOURCE_ACTIVATION_BUDGET_MS:-120000}"

  if [[ "${screenshots}" == "true" ]]; then
    bunx playwright install chromium
  fi

  local stream_url
  stream_url="$(enoomian_hyperscapes_stream_url)"
  enoomian_run_stream_probe "${stream_url}" 90000 || enoomian_die "stream readiness probe failed"
  export SOURCE_STREAM_PROBE_PATH="${HYPERBET_CI_ARTIFACT_DIR}/stream-probe/probe-result.json"

  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=read-only --target=solana
  node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode=read-only --target=bsc

  PM_SOAK_ENABLE_CANARY_TRADES=true \
  PM_SOAK_SCREENSHOTS="${screenshots}" \
  PM_SOAK_CHAINS="${chains}" \
  PM_SOAK_DURATION_MINUTES="${duration_minutes}" \
  bun run pm:soak -- --mode=staged --chains="${chains}" --duration-min="${duration_minutes}"
}

main "$@"
