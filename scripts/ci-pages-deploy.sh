#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: scripts/ci-pages-deploy.sh <command> [args]

Commands:
  verify-dist <app_dir>
  deploy <app_dir> <pages_project_name>
  resolve-url <pages_project_name> <deploy_target> <github_sha>
  verify-metadata <deployed_url> <expected_url> <github_sha>
USAGE
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBCOMMAND="${1:-}"
shift || true

resolve_commit_message() {
  local commit_message
  commit_message="$(git -C "$ROOT_DIR" log -1 --pretty=%s | tr -d '"' | cut -c1-100)"
  printf '%s\n' "$commit_message"
}

deploy_branch() {
  local deploy_target="${DEPLOY_TARGET:-production}"
  local workflow_event_name="${GITHUB_EVENT_NAME:-}"
  local workflow_input_environment="${INPUTS_ENVIRONMENT:-}"

  if [[ "$workflow_event_name" == "workflow_dispatch" && "$workflow_input_environment" == "preview" ]]; then
    printf 'preview-%s\n' "${GITHUB_RUN_ID:-}"
    return 0
  fi

  if [[ "$deploy_target" == "staging" ]]; then
    printf '%s\n' "enoomian/staging"
    return 0
  fi

  printf '%s\n' "main"
}

verify_metadata() {
  local deployed_url="${1:?missing deployed_url}"
  local expected_url="${2:?}"
  local expected_sha="${3:?missing expected sha}"

  for _ in $(seq 1 20); do
    local payload
    payload="$(curl -fsSL "${deployed_url}/build-info.json" || true)"
    if [[ -n "$payload" ]] && echo "$payload" | jq -e --arg sha "$expected_sha" '.commitHash == $sha' >/dev/null; then
      echo "build-info.json matches ${expected_sha} at ${deployed_url}"
      break
    fi
    sleep 15
  done

  curl -fsSL "${deployed_url}/build-info.json" | jq -e --arg sha "$expected_sha" '.commitHash == $sha'

  if [[ -n "$expected_url" && "$expected_url" != "$deployed_url" ]]; then
    local custom_payload
    custom_payload="$(curl -fsSL "${expected_url}/build-info.json" || true)"
    if [[ -n "$custom_payload" ]] && echo "$custom_payload" | jq -e --arg sha "$expected_sha" '.commitHash == $sha' >/dev/null; then
      echo "custom domain build-info.json matches ${expected_sha}"
    else
      echo "warning: ${expected_url}/build-info.json is not serving ${expected_sha} yet" >&2
    fi
  fi
}

case "$SUBCOMMAND" in
  verify-dist)
    if [[ $# -ne 1 ]]; then
      usage
      exit 1
    fi
    APP_DIR="${1:?missing app_dir}"

    test -f "${APP_DIR}/dist/build-info.json"
    if find "${APP_DIR}/dist" -name '*.map' | grep -q .; then
      echo "Unexpected source maps in production dist"
      exit 1
    fi
    if grep -R -n "api-key=" "${APP_DIR}/dist"; then
      echo "Provider key leak detected in dist"
      exit 1
    fi
    ;;

  deploy)
    if [[ $# -ne 2 ]]; then
      usage
      exit 1
    fi
    APP_DIR="${1:?missing app_dir}"
    PAGES_PROJECT_NAME="${2:?missing pages project name}"
    DEPLOY_TARGET="${DEPLOY_TARGET:-production}"

    BRANCH="$(deploy_branch)"
    COMMIT_MSG="$(resolve_commit_message)"

    (cd "$APP_DIR" && npx wrangler@4.72.0 pages deploy dist \
      --project-name="${PAGES_PROJECT_NAME}" \
      --branch="${BRANCH}" \
      --commit-hash="${GITHUB_SHA}" \
      --commit-message="${COMMIT_MSG}" \
      --commit-dirty=true \
      --skip-caching)
    ;;

  resolve-url)
    if [[ $# -ne 3 ]]; then
      usage
      exit 1
    fi
    PAGES_PROJECT_NAME="${1:?missing pages project name}"
    DEPLOY_TARGET="${2:?missing deploy target}"
    GITHUB_SHA="${3:?missing github sha}"

    pages_environment="production"
    if [[ "${DEPLOY_TARGET}" != "production" ]]; then
      pages_environment="preview"
    fi

    deployed_url="$(npx wrangler@4.72.0 pages deployment list \
      --project-name "${PAGES_PROJECT_NAME}" \
      --environment "${pages_environment}" \
      --json | jq -r --arg source "${GITHUB_SHA::7}" 'map(select(.Source == $source)) | .[0].Deployment // empty')"

    if [[ -z "${deployed_url}" || "${deployed_url}" == "null" ]]; then
      echo "Unable to resolve deployed Pages URL for ${PAGES_PROJECT_NAME}" >&2
      exit 1
    fi

    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      echo "deployed_url=${deployed_url}" >> "${GITHUB_OUTPUT}"
    fi
    printf '%s\n' "${deployed_url}"
    ;;

  verify-metadata)
    if [[ $# -ne 3 ]]; then
      usage
      exit 1
    fi
    verify_metadata "$1" "$2" "$3"
    ;;

  *)
    usage
    exit 1
    ;;
esac
