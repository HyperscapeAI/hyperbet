#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: scripts/enoomian-staging/proof.sh [both|solana|bsc] [read-only|canary-write] [env-file]
EOF
}

main() {
  local scope="${1:-both}"
  local mode="${2:-read-only}"
  local env_file="${3:-}"

  case "${scope}" in
    both|solana|bsc) ;;
    *)
      usage
      exit 1
      ;;
  esac

  case "${mode}" in
    read-only|canary-write) ;;
    *)
      usage
      exit 1
      ;;
  esac

  enoomian_require_cmds bun node
  enoomian_load_env "${env_file}"
  enoomian_export_hyperbet_staged_env

  case "${scope}" in
    solana)
      node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode="${mode}" --target=solana
      ;;
    bsc)
      node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode="${mode}" --target=bsc
      ;;
    both)
      node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode="${mode}" --target=solana
      node --import tsx "${ENOOMIAN_REPO_ROOT}/scripts/staged-live-proof.ts" --deployment=staging --mode="${mode}" --target=bsc
      ;;
  esac
}

main "$@"
