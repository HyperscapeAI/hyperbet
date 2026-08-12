#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_VERSION="${ANCHOR_SBF_TOOLS_VERSION:-v1.52}"
BINARIES_ONLY="${HYPERBET_SOLANA_BUILD_BINARIES_ONLY:-0}"
ALLOW_IDL_ONLY="${HYPERBET_SOLANA_ALLOW_IDL_ONLY:-0}"
ANCHOR_CLI_VERSION="0.32.1"
BASE_RUST_LOG="${RUST_LOG:-}"
ANCHOR_RUST_LOG="${BASE_RUST_LOG:+${BASE_RUST_LOG},}cargo_build_sbf=warn"
export RUST_LOG="${ANCHOR_RUST_LOG}"
PROGRAMS=(
  "fight_oracle"
  "duel_market"
)
SBF_AUDIT_LOG="$(mktemp "${TMPDIR:-/tmp}/hyperbet-sbf-build.XXXXXX")"
trap 'rm -f -- "${SBF_AUDIT_LOG}"' EXIT

# Anchor discovers Anchor.toml from the process working directory. Keep this
# entrypoint deterministic for every caller, including repository-root CI.
cd "${ROOT_DIR}"

run_audited_sbf_command() {
  local expected_programs_csv="$1"
  shift
  local command_status
  local tee_status
  local pipeline_statuses
  local expected_programs

  : >"${SBF_AUDIT_LOG}"
  set +e
  "$@" 2>&1 | tee "${SBF_AUDIT_LOG}"
  pipeline_statuses=("${PIPESTATUS[@]}")
  set -e
  command_status="${pipeline_statuses[0]}"
  tee_status="${pipeline_statuses[1]}"
  if [[ "${command_status}" != "0" ]]; then
    return "${command_status}"
  fi
  if [[ "${tee_status}" != "0" ]]; then
    return "${tee_status}"
  fi

  IFS=',' read -r -a expected_programs <<<"${expected_programs_csv}"
  bun "${ROOT_DIR}/scripts/audit-sbf-build-log.ts" \
    "${SBF_AUDIT_LOG}" \
    "${expected_programs[@]}"
}

mkdir -p "${ROOT_DIR}/target/idl"
mkdir -p "${ROOT_DIR}/target/types"

HAS_CARGO_BUILD_SBF=0
if cargo --list | grep -q "build-sbf"; then
  HAS_CARGO_BUILD_SBF=1
fi

require_canonical_anchor_cli() {
  local actual_anchor_cli_version
  if ! command -v anchor >/dev/null 2>&1; then
    echo "[anchor-build] Anchor CLI ${ANCHOR_CLI_VERSION} is required for canonical artifact generation; host-only fallback is disabled" >&2
    exit 1
  fi

  actual_anchor_cli_version="$(anchor --version | awk '{print $2}')"
  if [[ "$actual_anchor_cli_version" != "$ANCHOR_CLI_VERSION" ]]; then
    echo "[anchor-build] Anchor CLI version mismatch: expected ${ANCHOR_CLI_VERSION}, found ${actual_anchor_cli_version:-unknown}" >&2
    exit 1
  fi
}

generate_canonical_idls() {
  local program
  for program in "${PROGRAMS[@]}"; do
    echo "[anchor-build] canonical idl ${program}"
    anchor idl build \
      --program-name "${program}" \
      --out "${ROOT_DIR}/target/idl/${program}.json" \
      --out-ts "${ROOT_DIR}/target/types/${program}.ts"
  done
}

if [[ "$BINARIES_ONLY" == "1" ]]; then
  if [[ "$HAS_CARGO_BUILD_SBF" != "1" ]]; then
    echo "[anchor-build] cargo-build-sbf is required for binaries-only mode" >&2
    exit 1
  fi
  require_canonical_anchor_cli
  echo "[anchor-build] canonical SBF binaries (tools=${TOOLS_VERSION})"
  run_audited_sbf_command \
    "fight_oracle,duel_market" \
    anchor build --no-idl -- --tools-version "${TOOLS_VERSION}" -- --locked
  echo "[anchor-build] skipped canonical IDL generation (binaries only)"
  echo "[anchor-build] complete"
  exit 0
fi

require_canonical_anchor_cli

if [[ "$HAS_CARGO_BUILD_SBF" == "1" ]]; then
  echo "[anchor-build] canonical SBF binaries (tools=${TOOLS_VERSION})"
  run_audited_sbf_command \
    "fight_oracle,duel_market" \
    anchor build --no-idl -- --tools-version "${TOOLS_VERSION}" -- --locked
  generate_canonical_idls
  node "${ROOT_DIR}/../scripts/sync-anchor-artifacts.mjs"
  echo "[anchor-build] complete"
  exit 0
fi

if [[ "$ALLOW_IDL_ONLY" != "1" ]]; then
  echo "[anchor-build] cargo-build-sbf is required; refusing to reuse stale deploy binaries" >&2
  echo "[anchor-build] set HYPERBET_SOLANA_ALLOW_IDL_ONLY=1 only for an explicit non-release canonical IDL refresh" >&2
  exit 1
fi
echo "[anchor-build] cargo-build-sbf not found; explicit canonical IDL-only mode enabled"

generate_canonical_idls
node "${ROOT_DIR}/../scripts/sync-anchor-artifacts.mjs"

echo "[anchor-build] complete"
