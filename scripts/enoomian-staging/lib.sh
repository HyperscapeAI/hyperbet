#!/usr/bin/env bash

set -euo pipefail

ENOOMIAN_SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENOOMIAN_REPO_ROOT="$(cd -- "${ENOOMIAN_SCRIPT_DIR}/../.." && pwd)"
ENOOMIAN_DEFAULT_ENV_FILE="${ENOOMIAN_REPO_ROOT}/tmp/enoomian-staging/personal-staging.env"
ENOOMIAN_DEFAULT_TMP_ROOT="${ENOOMIAN_REPO_ROOT}/tmp/enoomian-staging/runtime"

enoomian_resolve_path() {
  local raw_path="$1"
  if [[ "${raw_path}" == /* ]]; then
    printf '%s\n' "${raw_path}"
    return 0
  fi
  printf '%s/%s\n' "$(cd -- "$(dirname "${raw_path}")" && pwd)" "$(basename "${raw_path}")"
}

enoomian_log() {
  printf '[enoomian-staging] %s\n' "$*"
}

enoomian_die() {
  printf '[enoomian-staging] %s\n' "$*" >&2
  exit 1
}

enoomian_tmp_root() {
  local tmp_root="${ENOOMIAN_TMP_ROOT:-${ENOOMIAN_DEFAULT_TMP_ROOT}}"
  mkdir -p "${tmp_root}"
  printf '%s\n' "${tmp_root}"
}

enoomian_mktemp_dir() {
  local prefix="$1"
  local tmp_root
  tmp_root="$(enoomian_tmp_root)"
  mktemp -d "${tmp_root}/${prefix}.XXXXXX"
}

enoomian_last_staged_proof_identity_file() {
  local tmp_root
  tmp_root="$(enoomian_tmp_root)"
  printf '%s\n' "${tmp_root}/last-staged-proof-duel.env"
}

enoomian_persist_staged_proof_identity() {
  local identity_file
  identity_file="$(enoomian_last_staged_proof_identity_file)"
  printf 'export ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID=%q\n' "${ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID}" >"${identity_file}"
  printf 'export ENOOMIAN_RUN_STAGED_PROOF_DUEL_KEY=%q\n' "${ENOOMIAN_RUN_STAGED_PROOF_DUEL_KEY}" >>"${identity_file}"
  printf '%s\n' "${identity_file}"
}

enoomian_load_last_staged_proof_identity() {
  local identity_file="${1:-$(enoomian_last_staged_proof_identity_file)}"
  [[ -f "${identity_file}" ]] || enoomian_die "missing staged proof identity file: ${identity_file}"
  set -a
  # shellcheck disable=SC1090
  source "${identity_file}"
  set +a
  enoomian_require_env ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID ENOOMIAN_RUN_STAGED_PROOF_DUEL_KEY
  enoomian_log "reusing staged proof duel ${ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID}"
}

enoomian_require_cmds() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || enoomian_die "missing command: ${cmd}"
  done
}

enoomian_load_env() {
  local env_file="${1:-${ENOOMIAN_ENV_FILE:-${ENOOMIAN_DEFAULT_ENV_FILE}}}"
  [[ -f "${env_file}" ]] || enoomian_die "missing env file: ${env_file}"
  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
  export ENOOMIAN_ENV_FILE
  ENOOMIAN_ENV_FILE="$(enoomian_resolve_path "${env_file}")"
}

enoomian_assert_personal_env_file() {
  local env_file="${1:-${ENOOMIAN_ENV_FILE:-}}"
  [[ -n "${env_file}" ]] || enoomian_die "missing env file path for personal secret boundary check"

  local resolved_env_file
  resolved_env_file="$(enoomian_resolve_path "${env_file}")"

  if [[ "${resolved_env_file}" == "${ENOOMIAN_REPO_ROOT}/"* ]] &&
    [[ "${resolved_env_file}" != "${ENOOMIAN_REPO_ROOT}/tmp/enoomian-staging/"* ]]; then
    enoomian_die "env file inside the repo must live under tmp/enoomian-staging/: ${resolved_env_file}"
  fi
}

enoomian_require_env() {
  local missing=()
  local key
  for key in "$@"; do
    [[ -n "${!key:-}" ]] || missing+=("${key}")
  done
  if (( ${#missing[@]} > 0 )); then
    enoomian_die "missing required env: ${missing[*]}"
  fi
}

# Assert that the hyperbet main checkout ($ENOOMIAN_REPO_ROOT) is on the
# `enoomian/staging` branch. Every deploy target except the read-only
# `check-personal-secrets` validator runs this guard so we can never
# again build and ship a bundle from `main` (or any other branch) by
# accident. `ENOOMIAN_ALLOW_OFFBRANCH_DEPLOY=1` is an opt-in escape
# hatch for the rare case someone deliberately wants to deploy a
# feature branch for isolated testing — use it with the same caution
# as ENOOMIAN_SKIP_PREFLIGHT.
enoomian_require_enoomian_staging_branch() {
  local expected="enoomian/staging"
  local current
  current="$(git -C "${ENOOMIAN_REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
  if [[ "${current}" == "${expected}" ]]; then
    enoomian_log "repo root ${ENOOMIAN_REPO_ROOT} is on ${expected}"
    return 0
  fi
  if [[ "${ENOOMIAN_ALLOW_OFFBRANCH_DEPLOY:-0}" == "1" ]]; then
    enoomian_log "WARNING: ENOOMIAN_ALLOW_OFFBRANCH_DEPLOY=1 override set; continuing on branch '${current}' instead of '${expected}'"
    return 0
  fi
  enoomian_die "repo root ${ENOOMIAN_REPO_ROOT} is on branch '${current}' but this deploy lane requires '${expected}'. Run: git -C '${ENOOMIAN_REPO_ROOT}' checkout ${expected}. To bypass intentionally (rare): ENOOMIAN_ALLOW_OFFBRANCH_DEPLOY=1 $0 ..."
}

enoomian_require_hyperscapes_root() {
  enoomian_require_env ENOOMIAN_HYPERSCAPES_ROOT
  [[ -d "${ENOOMIAN_HYPERSCAPES_ROOT}" ]] || enoomian_die "invalid ENOOMIAN_HYPERSCAPES_ROOT: ${ENOOMIAN_HYPERSCAPES_ROOT}"
}

enoomian_normalize_keypair_ref() {
  local keypair_ref="${1:-}"
  local trimmed="${keypair_ref#"${keypair_ref%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"

  if [[ -z "${trimmed}" ]]; then
    printf '\n'
    return 0
  fi

  if [[ "${trimmed}" == \[* || "${trimmed}" == base64:* ]]; then
    printf '%s\n' "${trimmed}"
    return 0
  fi

  local expanded="${trimmed}"
  if [[ "${expanded}" == "~"* ]]; then
    expanded="${HOME}${expanded:1}"
  fi

  if [[ -f "${expanded}" ]]; then
    cat "${expanded}"
    return 0
  fi

  printf '%s\n' "${trimmed}"
}

enoomian_base_lane_enabled() {
  local base_rpc_url="${ENOOMIAN_BASE_RPC_URL:-}"
  local base_chain_id="${ENOOMIAN_BASE_CHAIN_ID:-}"
  local base_duel_oracle_address="${ENOOMIAN_BASE_DUEL_ORACLE_ADDRESS:-}"
  local base_gold_clob_address="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS:-}"

  if [[ -z "${base_rpc_url}${base_chain_id}${base_duel_oracle_address}${base_gold_clob_address}" ]]; then
    return 1
  fi

  if [[ -z "${base_rpc_url}" || -z "${base_chain_id}" || -z "${base_duel_oracle_address}" || -z "${base_gold_clob_address}" ]]; then
    enoomian_die "Base staging lane is partially configured; set ENOOMIAN_BASE_RPC_URL, ENOOMIAN_BASE_CHAIN_ID, ENOOMIAN_BASE_DUEL_ORACLE_ADDRESS, and ENOOMIAN_BASE_GOLD_CLOB_ADDRESS together or leave them all empty"
  fi

  return 0
}

enoomian_resolve_bsc_keeper_chains() {
  local chains=("bsc")

  if enoomian_base_lane_enabled; then
    chains+=("base")
  fi

  local joined
  joined="$(IFS=,; printf '%s' "${chains[*]}")"
  printf '%s\n' "${joined}"
}

enoomian_hyperbet_pages_branch() {
  printf '%s\n' "${ENOOMIAN_HYPERBET_PAGES_BRANCH:-enoomian/staging}"
}

enoomian_hyperbet_pages_project_name() {
  if [[ -n "${ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_PAGES_PROJECT_NAME}"
  elif [[ -n "${ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_BSC_PAGES_PROJECT_NAME}"
  else
    printf '%s\n' "${ENOOMIAN_HYPERBET_SOLANA_PAGES_PROJECT_NAME:-}"
  fi
}

enoomian_hyperbet_pages_url() {
  if [[ -n "${ENOOMIAN_HYPERBET_PAGES_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_PAGES_URL}"
  elif [[ -n "${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_BSC_PAGES_URL}"
  else
    printf '%s\n' "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-}"
  fi
}

enoomian_hyperbet_keeper_url() {
  if [[ -n "${ENOOMIAN_HYPERBET_KEEPER_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_KEEPER_URL}"
  elif [[ -n "${ENOOMIAN_HYPERBET_SHARED_KEEPER_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_SHARED_KEEPER_URL}"
  else
    printf '%s\n' "${ENOOMIAN_HYPERBET_BSC_KEEPER_URL:-}"
  fi
}

enoomian_hyperbet_keeper_ws_url() {
  if [[ -n "${ENOOMIAN_HYPERBET_KEEPER_WS_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_KEEPER_WS_URL}"
  elif [[ -n "${ENOOMIAN_HYPERBET_SHARED_KEEPER_WS_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_HYPERBET_SHARED_KEEPER_WS_URL}"
  else
    printf '%s\n' "${ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL:-}"
  fi
}

enoomian_hyperbet_pages_cors_origins() {
  local origins=""
  local candidate

  for candidate in \
    "$(enoomian_hyperbet_pages_url)" \
    "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-}" \
    "${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-}"; do
    candidate="${candidate%/}"
    [[ -n "${candidate}" ]] || continue
    case ",${origins}," in
      *,"${candidate}",*) ;;
      *) origins="${origins:+${origins},}${candidate}" ;;
    esac
  done

  [[ -n "${origins}" ]] || enoomian_die "missing Hyperbet Pages origins for keeper CORS allowlist"
  printf '%s\n' "${origins}"
}

enoomian_backfill_hyperbet_surface_aliases() {
  local unified_pages_url
  local unified_keeper_url
  local unified_keeper_ws_url

  unified_pages_url="$(enoomian_hyperbet_pages_url)"
  unified_keeper_url="$(enoomian_hyperbet_keeper_url)"
  unified_keeper_ws_url="$(enoomian_hyperbet_keeper_ws_url)"

  if [[ -n "${unified_pages_url}" ]]; then
    export ENOOMIAN_HYPERBET_PAGES_URL="${unified_pages_url}"
    export ENOOMIAN_HYPERBET_SOLANA_PAGES_URL="${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-${unified_pages_url}}"
    export ENOOMIAN_HYPERBET_BSC_PAGES_URL="${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-${unified_pages_url}}"
  fi
  if [[ -n "${unified_keeper_url}" ]]; then
    export ENOOMIAN_HYPERBET_KEEPER_URL="${unified_keeper_url}"
    export ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL:-${unified_keeper_url}}"
    export ENOOMIAN_HYPERBET_BSC_KEEPER_URL="${ENOOMIAN_HYPERBET_BSC_KEEPER_URL:-${unified_keeper_url}}"
  fi
  if [[ -n "${unified_keeper_ws_url}" ]]; then
    export ENOOMIAN_HYPERBET_KEEPER_WS_URL="${unified_keeper_ws_url}"
    export ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL:-${unified_keeper_ws_url}}"
    export ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL="${ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL:-${unified_keeper_ws_url}}"
  fi
}

enoomian_make_railway_link_dir() {
  local tmp_dir
  tmp_dir="$(enoomian_mktemp_dir enoomian-railway-link)"
  (
    cd "${tmp_dir}"
    railway link \
      -p "${ENOOMIAN_RAILWAY_PROJECT_ID}" \
      -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
      --json >/dev/null
  )
  printf '%s\n' "${tmp_dir}"
}

enoomian_make_upload_alias() {
  local source_dir="$1"
  local profile="${2:-default}"
  local tmp_dir
  tmp_dir="$(enoomian_mktemp_dir enoomian-upload-root)"
  mkdir -p "${tmp_dir}/src"
  local -a rsync_args=(
    -a
    --delete
    --exclude '.git'
    --exclude 'node_modules'
    --exclude '.turbo'
    --exclude 'dist'
    --exclude 'playwright-report'
    --exclude '.worktrees'
    --exclude '*.sqlite'
    --exclude '*.sqlite-shm'
    --exclude '*.sqlite-wal'
  )
  if [[ "${profile}" == "hyperscapes" ]]; then
    rsync_args+=(
      -L
      --exclude '.claude'
      --exclude '.cursor'
      --exclude '.github'
      --exclude '.husky'
      --exclude '.runtime-locks'
      --exclude 'docs'
      --exclude 'publishing'
      --exclude 'packages/contracts'
      --exclude 'packages/website'
      --exclude 'packages/asset-forge'
      --exclude 'packages/app'
      --exclude 'packages/client'
      --exclude 'packages/sim-engine'
      --exclude 'packages/duel-oracle-solana'
      --exclude 'packages/duel-oracle-evm'
      --exclude 'packages/vast-keeper'
      --exclude 'packages/rtmp-muxer'
      --exclude 'packages/physx-js-webidl/PhysX'
      --exclude 'packages/client/tests'
      --exclude 'packages/server/tests'
      --exclude 'packages/impostors/public'
      --exclude 'packages/server/public/web'
      --exclude 'packages/client/playwright*'
      --exclude 'packages/client/tmp-*'
      --exclude 'packages/server/tmp-*'
      --exclude 'packages/server/world/assets'
    )
  fi
  rsync "${rsync_args[@]}" "${source_dir}/" "${tmp_dir}/src/"
  printf '%s\n' "${tmp_dir}/src"
}

enoomian_stage_hyperscapes_asset_path() {
  local source_assets_dir="$1"
  local packaged_assets_dir="$2"
  local rel="$3"
  local dest_dir

  [[ -e "${source_assets_dir}/${rel}" ]] || enoomian_die "missing staged asset path: ${source_assets_dir}/${rel}"
  dest_dir="${packaged_assets_dir}/$(dirname "${rel}")"
  [[ "${dest_dir}" == "${packaged_assets_dir}/." ]] && dest_dir="${packaged_assets_dir}"
  mkdir -p "${dest_dir}"
  rsync -a "${source_assets_dir}/${rel}" "${dest_dir}/"
}

enoomian_stage_hyperscapes_terrain_biomes() {
  local source_assets_dir="$1"
  local packaged_assets_dir="$2"
  local source_dir="${source_assets_dir}/textures/terrain-biomes"
  local dest_dir="${packaged_assets_dir}/textures/terrain-biomes"
  local max_dim="${ENOOMIAN_HYPERSCAPES_TERRAIN_TEX_MAX_DIM:-128}"
  local source_file
  local dest_file

  [[ -d "${source_dir}" ]] || enoomian_die "missing staged asset path: ${source_dir}"
  mkdir -p "${dest_dir}"

  if [[ -n "${max_dim}" && "${max_dim}" != "0" ]]; then
    enoomian_require_cmds sips
  fi

  for source_file in "${source_dir}"/*.png; do
    [[ -f "${source_file}" ]] || continue
    dest_file="${dest_dir}/$(basename "${source_file}")"
    cp "${source_file}" "${dest_file}"
    if [[ -n "${max_dim}" && "${max_dim}" != "0" ]]; then
      sips -Z "${max_dim}" "${dest_file}" >/dev/null
    fi
    xattr -c "${dest_file}" 2>/dev/null || true
  done
}

enoomian_patch_hyperscapes_upload_root() {
  local upload_root="$1"
  local dockerfile="${upload_root}/Dockerfile.server"
  local dockerignore="${upload_root}/.dockerignore"
  local gitignore="${upload_root}/.gitignore"
  local railwayignore="${upload_root}/.railwayignore"
  local railway_manifest="${upload_root}/railway.json"
  local source_assets_dir="${ENOOMIAN_HYPERSCAPES_ROOT}/packages/server/world/assets"
  local source_manifest_dir="${ENOOMIAN_HYPERSCAPES_ROOT}/packages/server/world/assets/manifests"
  local packaged_assets_dir="${upload_root}/packages/server/world/assets"
  local overlay_manifest_dir="${upload_root}/scripts/assets-manifest-overlay/manifests"
  local asset_bundle="${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy}"
  [[ -f "${dockerfile}" ]] || enoomian_die "missing Dockerfile.server in upload root: ${upload_root}"
  [[ -f "${railway_manifest}" ]] || enoomian_die "missing railway.json in upload root: ${upload_root}"
  [[ -d "${source_assets_dir}" ]] || enoomian_die "missing source assets directory: ${source_assets_dir}"
  [[ -d "${source_manifest_dir}" ]] || enoomian_die "missing source manifest directory: ${source_manifest_dir}"

  cat >"${railwayignore}" <<'EOF'
.git
node_modules
.turbo
playwright-report
.worktrees
packages/*/node_modules
packages/*/dist
EOF

  if [[ -f "${gitignore}" ]] && ! grep -q '^!packages/server/world/assets/\*\*$' "${gitignore}"; then
    cat >>"${gitignore}" <<'EOF'

# Personal staging bundles hydrated game assets.
!packages/server/world/assets/
!packages/server/world/assets/**
EOF
  fi

  if [[ -f "${dockerignore}" ]]; then
    python3 - "${dockerignore}" <<'PY'
from pathlib import Path
import sys

dockerignore = Path(sys.argv[1])
text = dockerignore.read_text()
old = """# Large asset directories (served from CDN)
# Keep manifests in build context so server boots even if CDN manifests are partial.
packages/server/world/assets/*
!packages/server/world/assets/manifests/
!packages/server/world/assets/manifests/**
"""
new = """# Bundled assets are included when present so Railway can serve /game-assets directly.
"""
if old in text:
    text = text.replace(old, new)
else:
    text += "\n# Bundled assets are included when present so Railway can serve /game-assets directly.\n"
dockerignore.write_text(text)
PY
  fi

  python3 - "${railway_manifest}" <<'PY'
from pathlib import Path
import json
import sys

manifest = Path(sys.argv[1])
data = json.loads(manifest.read_text())
deploy = data.setdefault("deploy", {})
deploy["healthcheckPath"] = "/health"
manifest.write_text(json.dumps(data, indent=2) + "\n")
PY

  rm -rf "${packaged_assets_dir}"
  mkdir -p "${packaged_assets_dir}"
  case "${asset_bundle}" in
    full)
      rsync -a "${source_assets_dir}/" "${packaged_assets_dir}/"
      ;;
    proxy)
      local rel
      local -a staged_asset_paths=(
        "manifests"
        "icons"
      )
      for rel in "${staged_asset_paths[@]}"; do
        enoomian_stage_hyperscapes_asset_path "${source_assets_dir}" "${packaged_assets_dir}" "${rel}"
      done
      enoomian_stage_hyperscapes_terrain_biomes "${source_assets_dir}" "${packaged_assets_dir}"
      ;;
    minimal)
      local rel
      local -a staged_asset_paths=(
        "manifests"
        "icons"
        "trees"
        "avatars"
        "emotes"
        "models/mobs"
        "models/misc"
        "models/npcs/banker"
        "models/mining-rocks/essence-rock"
      )
      for rel in "${staged_asset_paths[@]}"; do
        enoomian_stage_hyperscapes_asset_path "${source_assets_dir}" "${packaged_assets_dir}" "${rel}"
      done
      ;;
    streaming)
      local rel
      local -a staged_asset_paths=(
        "manifests"
        "icons"
        "trees"
        "avatars/avatar-male-01.vrm"
      )
      for rel in "${staged_asset_paths[@]}"; do
        enoomian_stage_hyperscapes_asset_path "${source_assets_dir}" "${packaged_assets_dir}" "${rel}"
      done
      ;;
    *)
      enoomian_die "unsupported ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE: ${asset_bundle}"
      ;;
  esac

  if ! grep -q 'RUN mkdir -p /app/packages/server/node_modules' "${dockerfile}"; then
    perl -0pi -e 's/RUN bun install --trust\n/RUN bun install --trust\nRUN mkdir -p \/app\/packages\/server\/node_modules \/app\/packages\/shared\/node_modules \/app\/packages\/procgen\/node_modules \/app\/packages\/impostors\/node_modules \/app\/packages\/plugin-hyperscape\/node_modules \/app\/packages\/web3\/node_modules \/app\/packages\/client\/node_modules\n/' "${dockerfile}"
  fi
  python3 - "${dockerfile}" <<'PY'
from pathlib import Path
import sys

dockerfile = Path(sys.argv[1])
text = dockerfile.read_text()
replacements = {
    "FROM oven/bun:1.3.10-debian AS builder": "FROM node:22-bookworm-slim AS builder",
    "FROM oven/bun:1.3.10-debian AS runtime": "FROM node:22-bookworm-slim AS runtime",
    "    ca-certificates git \\\n    && rm -rf /var/lib/apt/lists/*\n": "    ca-certificates git curl unzip \\\n    && rm -rf /var/lib/apt/lists/*\n\nENV BUN_INSTALL=/root/.bun\nENV PATH=${BUN_INSTALL}/bin:${PATH}\nRUN curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.10\n",
    "    ca-certificates curl \\\n    && rm -rf /var/lib/apt/lists/*\n": "    ca-certificates curl unzip \\\n    && rm -rf /var/lib/apt/lists/*\n\nENV BUN_INSTALL=/root/.bun\nENV PATH=${BUN_INSTALL}/bin:${PATH}\nRUN curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.10\n",
    "    cd /app/packages/server && bun run build && \\\n    cd /app/packages/client && NODE_OPTIONS='--max-old-space-size=4096' bun run build:cf\n": "    cd /app/packages/server && bun run build && \\\n    python3 /app/scripts/fix-esm-specifiers.py\n",
    "    cd /app/packages/web3 && bun run build && \\\n    cd /app/packages/server && bun run build\n": "    cd /app/packages/web3 && bun run build && \\\n    cd /app/packages/server && bun run build && \\\n    python3 /app/scripts/fix-esm-specifiers.py\n",
    "RUN rm -rf packages/server/world/assets && bun scripts/ensure-assets.mjs\n": "RUN if [ -d packages/server/world/assets/manifests ]; then \\\n    echo 'Using staged assets from upload root'; \\\n  else \\\n    rm -rf packages/server/world/assets && bun scripts/ensure-assets.mjs; \\\n  fi\n",
    "RUN bunx playwright install --with-deps chromium && chmod -R 755 /ms-playwright\n": "RUN /root/.bun/bin/bun x playwright install --with-deps chromium && chmod -R 755 /ms-playwright\n",
    "    CMD curl -fsS http://localhost:${PORT:-5555}/status >/dev/null || exit 1\n": "    CMD curl -fsS http://localhost:${PORT:-5555}/health >/dev/null || exit 1\n",
}
for old, new in replacements.items():
    text = text.replace(old, new)
client_tokens = (
    "COPY packages/client/package.json          ./packages/client/\n",
    "COPY packages/client/public/web/physx-js-webidl.js  ./packages/client/public/web/\n",
    "COPY packages/client/public/web/physx-js-webidl.wasm ./packages/client/public/web/\n",
    "COPY packages/client             ./packages/client\n",
    "    packages/client/node_modules\n",
    "    cd /app/packages/client && bun run build:cf && \\\n",
    "COPY --from=builder /app/packages/client/package.json          ./packages/client/\n",
    "    ln -s ../../packages/client            node_modules/@hyperscape/client\n",
    "COPY --from=builder /app/packages/client/node_modules            ./packages/client/node_modules\n",
    "COPY --from=builder /app/packages/client/dist           ./packages/client/dist\n",
)
for token in client_tokens:
    text = text.replace(token, "")
text = text.replace(
    "    packages/web3/node_modules \\\n\n# Download game asset manifests",
    "    packages/web3/node_modules\n\n# Download game asset manifests",
)
text = text.replace(
    "    ln -s ../../packages/server            node_modules/@hyperscape/server && \\\n\nCOPY --from=builder /app/packages/server/node_modules            ./packages/server/node_modules\n",
    "    ln -s ../../packages/server            node_modules/@hyperscape/server\n\nCOPY --from=builder /app/packages/server/node_modules            ./packages/server/node_modules\n",
)
if "python3 /app/scripts/fix-esm-specifiers.py" not in text:
    marker = "    cd /app/packages/server && bun run build\n"
    if marker in text:
        text = text.replace(
            marker,
            "    cd /app/packages/server && bun run build && \\\n    python3 /app/scripts/fix-esm-specifiers.py\n",
            1,
        )
if "COPY --from=builder /app/packages/server/scripts        ./packages/server/scripts\n" not in text:
    marker = "COPY --from=builder /app/packages/server/src            ./packages/server/src\n"
    if marker in text:
        text = text.replace(
            marker,
            marker + "COPY --from=builder /app/packages/server/scripts        ./packages/server/scripts\n",
        )
dockerfile.write_text(text)
PY
  python3 - "${upload_root}" <<'PY'
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
for rel in ("package.json", "packages/shared/package.json"):
    path = root / rel
    data = json.loads(path.read_text())
    if "dependencies" in data and isinstance(data["dependencies"], dict):
        data["dependencies"].pop("better-sqlite3", None)
    if "devDependencies" in data and isinstance(data["devDependencies"], dict):
        data["devDependencies"].pop("better-sqlite3", None)
    path.write_text(json.dumps(data, indent=2) + "\n")

copy_prebuilt = root / "packages" / "physx-js-webidl" / "scripts" / "copy-prebuilt.mjs"
copy_prebuilt.write_text("""#!/usr/bin/env bun

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");
const typesDir = join(rootDir, "types");
const assetBaseUrl = process.env.PHYSX_PREBUILT_BASE_URL || "https://assets.hyperscape.club/web";

const localFiles = [
  {
    src: join(typesDir, "physx-js-webidl.d.ts"),
    dest: join(distDir, "physx-js-webidl.d.ts"),
  },
];

const remoteFiles = [
  {
    url: `${assetBaseUrl}/physx-js-webidl.js`,
    dest: join(distDir, "physx-js-webidl.js"),
  },
  {
    url: `${assetBaseUrl}/physx-js-webidl.wasm`,
    dest: join(distDir, "physx-js-webidl.wasm"),
  },
];

const allExist = [...localFiles, ...remoteFiles].every((file) => existsSync(file.dest));
if (allExist) {
  console.log("PhysX already built, skipping...");
  process.exit(0);
}

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

for (const { src, dest } of localFiles) {
  if (!existsSync(src)) {
    console.error(`ERROR: Prebuilt file not found: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dest);
}

for (const { url, dest } of remoteFiles) {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`ERROR: Failed to download prebuilt file: ${url} (${response.status})`);
    process.exit(1);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
}

console.log(`✓ Downloaded ${remoteFiles.length} PhysX prebuilts and copied ${localFiles.length} type file to dist/`);
""")

fix_esm = root / "scripts" / "fix-esm-specifiers.py"
fix_esm.write_text("""from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "packages"
JS_EXTENSIONS = (".js", ".mjs", ".cjs", ".json", ".node", ".wasm")
FROM_PATTERN = re.compile(r'(?P<prefix>\\b(?:import|export)\\b[^\\n]*?\\bfrom\\s+[\"\\'])(?P<spec>\\.{1,2}/[^\"\\']+)(?P<suffix>[\"\\'])')
DYNAMIC_IMPORT_PATTERN = re.compile(r'(?P<prefix>\\bimport\\s*\\(\\s*)(?P<quote>[\"\\'])(?P<spec>\\.{1,2}/[^\"\\']+)(?P=quote)(?P<suffix>\\s*\\))')
ASSIGNMENT_PATTERN = re.compile(r'(?P<prefix>(?:=|:)\\s*)(?P<quote>[\"\\'])(?P<spec>\\.{1,2}/[^\"\\']+)(?P=quote)')

def resolve_specifier(path: Path, spec: str) -> str:
    if spec.endswith(JS_EXTENSIONS):
        target = (path.parent / spec).resolve()
        if target.exists():
            return spec
        for ext in JS_EXTENSIONS:
            if spec.endswith(ext):
                base_spec = spec[: -len(ext)]
                index_candidate = (path.parent / base_spec).resolve() / f\"index{ext}\"
                if index_candidate.exists():
                    return f\"{base_spec}/index{ext}\"
        return spec

    target = (path.parent / spec).resolve()
    for ext in JS_EXTENSIONS:
        appended_candidate = (path.parent / f"{spec}{ext}").resolve()
        if appended_candidate.exists():
            return f"{spec}{ext}"
        candidate = target.with_suffix(ext)
        if candidate.exists():
            return f\"{spec}{ext}\"

    for ext in JS_EXTENSIONS:
        index_candidate = target / f\"index{ext}\"
        if index_candidate.exists():
            return f\"{spec}/index{ext}\"

    return spec

for path in ROOT.rglob("*.js"):
    if "dist" not in path.parts and "build" not in path.parts:
        continue
    text = path.read_text()
    updated = FROM_PATTERN.sub(
        lambda match: f\"{match.group('prefix')}{resolve_specifier(path, match.group('spec'))}{match.group('suffix')}\",
        text,
    )
    updated = DYNAMIC_IMPORT_PATTERN.sub(
        lambda match: f\"{match.group('prefix')}{match.group('quote')}{resolve_specifier(path, match.group('spec'))}{match.group('quote')}{match.group('suffix')}\",
        updated,
    )
    updated = ASSIGNMENT_PATTERN.sub(
        lambda match: f\"{match.group('prefix')}{match.group('quote')}{resolve_specifier(path, match.group('spec'))}{match.group('quote')}\",
        updated,
    )
    if updated != text:
        path.write_text(updated)
""")
PY

  mkdir -p "${packaged_assets_dir}/manifests"
  mkdir -p "${overlay_manifest_dir}"
  rsync -a --delete "${source_manifest_dir}/" "${packaged_assets_dir}/manifests/"
  rsync -a --delete "${source_manifest_dir}/" "${overlay_manifest_dir}/"
}

enoomian_pick_free_port() {
  python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

enoomian_resolve_hyperscapes_preflight_database_url() {
  if [[ -n "${ENOOMIAN_LOCAL_DATABASE_URL:-}" ]]; then
    printf '%s\n' "${ENOOMIAN_LOCAL_DATABASE_URL}"
    return 0
  fi
  if [[ "${ENOOMIAN_DATABASE_URL:-}" != *".railway.internal"* ]]; then
    printf '%s\n' "${ENOOMIAN_DATABASE_URL}"
    return 0
  fi
  if [[ -n "${ENOOMIAN_POSTGRES_SERVICE_ID:-}" ]]; then
    local public_url
    public_url="$(
      enoomian_railway "." variable list \
        -s "${ENOOMIAN_POSTGRES_SERVICE_ID}" \
        -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" \
        --json | jq -r '.DATABASE_PUBLIC_URL // empty'
    )"
    if [[ -n "${public_url}" ]]; then
      printf '%s\n' "${public_url}"
      return 0
    fi
  fi
  enoomian_die "local Hyperscapes preflight needs ENOOMIAN_LOCAL_DATABASE_URL when ENOOMIAN_DATABASE_URL uses railway.internal"
}

enoomian_validate_hyperscapes_assets_root() {
  local repo_root="$1"
  local node_bin
  local validator

  if [[ "${ENOOMIAN_SKIP_HYPERSCAPES_ASSET_VALIDATION:-0}" == "1" ]]; then
    enoomian_log "skipping Hyperscapes asset validation (ENOOMIAN_SKIP_HYPERSCAPES_ASSET_VALIDATION=1)"
    return 0
  fi

  node_bin="${ENOOMIAN_HYPERSCAPES_NODE_BIN:-/Users/mac/.nvm/versions/node/v22.22.1/bin/node}"
  if [[ ! -x "${node_bin}" ]]; then
    node_bin="$(command -v node)" || enoomian_die "Hyperscapes asset validation could not find a usable node binary"
  fi

  validator="${repo_root}/scripts/validate-assets-sync.mjs"
  [[ -f "${validator}" ]] || enoomian_die "Hyperscapes asset validation script is missing at ${validator}"

  enoomian_log "validating Hyperscapes manifests in ${repo_root}"
  (
    cd "${repo_root}" &&
    "${node_bin}" "${validator}"
  ) || enoomian_die "Hyperscapes asset validation failed in ${repo_root}"
}

enoomian_source_stream_phase() {
  local state_url="${SOURCE_STREAM_STATE_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/api/streaming/state}"
  curl -fsS "${state_url}" | jq -r '(.cycle.phase // .duel.phase // .phase // "IDLE")'
}

enoomian_source_stream_is_active() {
  local phase
  phase="$(enoomian_source_stream_phase 2>/dev/null || printf '%s\n' "IDLE")"
  [[ -n "${phase}" && "${phase}" != "IDLE" && "${phase}" != "null" ]]
}

enoomian_source_capture_ready() {
  local capture_url="${ENOOMIAN_STREAM_RENDERER_HEALTH_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/api/streaming/capture/status}"
  curl -fsS "${capture_url}" | jq -e '
    .running == true and
    .rendererHealth.ready == true and
    .sourceRuntime.ready == true
  ' >/dev/null
}

enoomian_run_stream_probe() {
  local stream_url="$1"
  local timeout_ms="${2:-90000}"
  local probe_root="${HYPERBET_CI_ARTIFACT_DIR:-${ENOOMIAN_REPO_ROOT}/.ci-artifacts}/stream-probe"
  local probe_result="${probe_root}/probe-result.json"

  enoomian_require_cmds bun jq

  if [[ -z "${PM_STREAM_PROBE_HEADLESS:-}" ]]; then
    export PM_STREAM_PROBE_HEADLESS=true
  fi

  if HYPERSCAPES_UI_URL="${stream_url}" \
    STREAM_URL="${stream_url}" \
    bun run pm:stream:probe -- --url="${stream_url}" --timeout-ms "${timeout_ms}"; then
    return 0
  fi

  if [[ -f "${probe_result}" ]] &&
    jq -e '
      (.assetAuditOk == true) and
      ((.snapshot.bestState.bodyPreview // "") | contains("WebGPU Required"))
    ' "${probe_result}" >/dev/null 2>&1 &&
    enoomian_source_capture_ready; then
    enoomian_log "stream probe hit local WebGPU fallback while source capture stayed healthy; continuing"
    return 0
  fi

  return 1
}

enoomian_classify_hyperscapes_preflight_failure() {
  local log_file="$1"
  if grep -Eiq 'DATABASE_URL|connection attempt|migration|postgres|drizzle|Required public tables|No database configuration|Failed to initialize database|ECONNREFUSED|timeout expired' "${log_file}"; then
    printf '%s\n' "database connect/migration failure"
    return 0
  fi
  if grep -Eiq 'Cannot find module|ERR_MODULE_NOT_FOUND|ENOENT|no such file or directory|Could not find migrations folder|missing .* in upload root' "${log_file}"; then
    printf '%s\n' "missing runtime file caused by the trimmed upload root"
    return 0
  fi
  printf '%s\n' "pre-listen startup stall"
}

enoomian_run_hyperscapes_preflight() {
  local upload_root="$1"
  local db_url
  local port
  local log_dir
  local log_file
  local bun_cache_dir
  local node_bin
  local server_pid=""

  db_url="$(enoomian_resolve_hyperscapes_preflight_database_url)"
  port="$(enoomian_pick_free_port)"
  log_dir="$(enoomian_mktemp_dir enoomian-hyperscapes-preflight)"
  log_file="${log_dir}/preflight.log"
  bun_cache_dir="${log_dir}/bun-cache"
  mkdir -p "${bun_cache_dir}"
  node_bin="${ENOOMIAN_HYPERSCAPES_NODE_BIN:-/Users/mac/.nvm/versions/node/v22.22.1/bin/node}"
  if [[ ! -x "${node_bin}" ]]; then
    node_bin="$(command -v node)" || enoomian_die "Hyperscapes preflight could not find a usable node binary"
  fi

  cleanup() {
    local pid="${server_pid:-}"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" >>"${log_file}" 2>&1 || true
      wait "${pid}" >>"${log_file}" 2>&1 || true
    fi
    server_pid=""
  }
  trap cleanup RETURN

  enoomian_log "running Hyperscapes preflight (log: ${log_file})"
  {
    echo "=== hyperscapes preflight host build ==="
    echo "upload_root=${upload_root}"
    echo "port=${port}"
    echo "node_bin=${node_bin}"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >>"${log_file}"

  if ! jq -e '.deploy.healthcheckPath == "/health"' "${upload_root}/railway.json" >>"${log_file}" 2>&1; then
    enoomian_die "Hyperscapes preflight upload root is not patched to use /health. See ${log_file}"
  fi

  if ! grep -Fq 'http://localhost:${PORT:-5555}/health' "${upload_root}/Dockerfile.server"; then
    enoomian_die "Hyperscapes preflight Dockerfile healthcheck is not patched to use /health. See ${log_file}"
  fi

  if ! (
    cd "${upload_root}" &&
    export CI=true &&
    export SKIP_ASSETS=true &&
    export HYPERSCAPE_SKIP_BROWSER_INSTALL=true &&
    bun install --ignore-scripts --force --backend=copyfile --cache-dir "${bun_cache_dir}" &&
    mkdir -p packages/server/node_modules packages/shared/node_modules packages/procgen/node_modules packages/impostors/node_modules packages/plugin-hyperscape/node_modules packages/web3/node_modules packages/client/node_modules &&
    if [[ -d packages/server/world/assets/manifests ]]; then
      if [[ "${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy}" == "full" ]]; then
        bun scripts/validate-assets-sync.mjs
      else
        echo "Skipping upload-root asset validation for ${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy} bundle"
      fi
    else
      rm -rf packages/server/world/assets &&
      bun scripts/ensure-assets.mjs
    fi &&
    cd packages/physx-js-webidl && bun run build &&
    cd "${upload_root}/packages/decimation" && bun run build &&
    cd "${upload_root}/packages/impostors" && bun run build &&
    cd "${upload_root}/packages/procgen" && (bun run build || true) &&
    cd "${upload_root}/packages/shared" && bun run build &&
    cd "${upload_root}/packages/plugin-hyperscape" && bun run build &&
    cd "${upload_root}/packages/web3" && bun run build &&
    cd "${upload_root}/packages/server" && bun run build &&
    python3 "${upload_root}/scripts/fix-esm-specifiers.py"
  ) >>"${log_file}" 2>&1; then
    local build_classification
    build_classification="$(enoomian_classify_hyperscapes_preflight_failure "${log_file}")"
    enoomian_die "Hyperscapes preflight failed during build (${build_classification}). See ${log_file}"
  fi

  if [[ "${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy}" == "full" ]]; then
    enoomian_validate_hyperscapes_assets_root "${upload_root}"
  else
    enoomian_log "skipping post-build upload-root asset validation for ${ENOOMIAN_HYPERSCAPES_ASSET_BUNDLE:-proxy} bundle"
  fi

  (
    cd "${upload_root}" &&
    export NODE_ENV=production &&
    export USE_LOCAL_POSTGRES=false &&
    export DATABASE_URL="${db_url}" &&
    export PORT="${port}" &&
    export PUBLIC_API_URL="${ENOOMIAN_HYPERSCAPES_API_URL}" &&
    export PUBLIC_WS_URL="${ENOOMIAN_HYPERSCAPES_WS_URL}" &&
    export PUBLIC_APP_URL="${ENOOMIAN_HYPERSCAPES_PAGES_URL}" &&
    export PUBLIC_CDN_URL="${ENOOMIAN_PUBLIC_CDN_URL:-${ENOOMIAN_HYPERSCAPES_CDN_URL:-${ENOOMIAN_HYPERSCAPES_API_URL%/}/game-assets}}" &&
    export STREAMING_DUEL_ENABLED=true &&
    export UWS_ENABLED=false &&
    export HEALTH_CHECK_DATABASE=false &&
    export SKIP_MIGRATIONS=true &&
    export SKIP_CDN_MANIFEST_FETCH=true &&
    export JWT_SECRET="${ENOOMIAN_HYPERSCAPES_JWT_SECRET}" &&
    exec "${node_bin}" --experimental-specifier-resolution=node "${upload_root}/packages/server/dist/index.js"
  ) >>"${log_file}" 2>&1 &
  server_pid=$!

  if ! enoomian_wait_for_json "http://127.0.0.1:${port}/health" '.status == "ok"' 30 5; then
    local health_classification
    wait "${server_pid}" >>"${log_file}" 2>&1 || true
    health_classification="$(enoomian_classify_hyperscapes_preflight_failure "${log_file}")"
    enoomian_die "Hyperscapes preflight failed before /health became ready (${health_classification}). See ${log_file}"
  fi

  if ! enoomian_wait_for_json "http://127.0.0.1:${port}/api/streaming/state" '.type != null' 36 5; then
    local state_classification
    wait "${server_pid}" >>"${log_file}" 2>&1 || true
    state_classification="$(enoomian_classify_hyperscapes_preflight_failure "${log_file}")"
    enoomian_die "Hyperscapes preflight failed before /api/streaming/state became ready (${state_classification}). See ${log_file}"
  fi

  cleanup
  trap - RETURN
  enoomian_log "Hyperscapes preflight passed (log: ${log_file})"
}

enoomian_railway() {
  local workdir="$1"
  shift 1
  local tmp_dir
  tmp_dir="$(enoomian_make_railway_link_dir)"
  (
    cd "${tmp_dir}"
    railway "$@"
  )
  local status=$?
  rm -rf "${tmp_dir}"
  return "${status}"
}

enoomian_railway_up() {
  local label="$1"
  shift 1
  local attempts="${ENOOMIAN_RAILWAY_UP_ATTEMPTS:-3}"
  local sleep_seconds="${ENOOMIAN_RAILWAY_UP_RETRY_DELAY_SECONDS:-15}"
  local attempt
  local status=0

  for attempt in $(seq 1 "${attempts}"); do
    set +e
    railway up "$@"
    status=$?
    set -e
    if [[ "${status}" -eq 0 ]]; then
      return 0
    fi
    if [[ "${attempt}" -ge "${attempts}" ]]; then
      return "${status}"
    fi
    enoomian_log "${label} failed on attempt ${attempt}/${attempts}; retrying in ${sleep_seconds}s"
    sleep "${sleep_seconds}"
  done

  return "${status}"
}

enoomian_railway_set() {
  local workdir="$1"
  local service_id="$2"
  local key="$3"
  local value="$4"
  if [[ -z "${value}" ]]; then
    enoomian_railway "${workdir}" variable delete -s "${service_id}" -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" "${key}"
    return $?
  fi
  enoomian_railway "${workdir}" variable set -s "${service_id}" -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" --skip-deploys "${key}=${value}"
}

enoomian_railway_set_stdin() {
  local workdir="$1"
  local service_id="$2"
  local key="$3"
  local value="$4"
  local tmp_dir
  tmp_dir="$(enoomian_make_railway_link_dir)"
  (
    cd "${tmp_dir}"
    printf '%s\n' "${value}" | railway variable set -s "${service_id}" -e "${ENOOMIAN_RAILWAY_ENVIRONMENT_ID}" --skip-deploys "${key}" --stdin
  )
  local status=$?
  rm -rf "${tmp_dir}"
  return "${status}"
}

enoomian_is_present_token() {
  local value="${1:-}"
  [[ -n "${value}" ]] && [[ "${value}" != '""' ]] && [[ "${value}" != "''" ]]
}

enoomian_cloudflare_token() {
  # Return the preferred Cloudflare API token. ENOOMIAN_CLAUDE_DEPLOY_TOKEN
  # (account-scoped: Pages:Edit, Account Settings:Read, Stream:Read) wins
  # when set, so scoped automation does not have to touch the general
  # ENOOMIAN_CLOUDFLARE_API_TOKEN. Falls back to ENOOMIAN_CLOUDFLARE_API_TOKEN
  # for backward compatibility with existing callers.
  if enoomian_is_present_token "${ENOOMIAN_CLAUDE_DEPLOY_TOKEN:-}"; then
    printf '%s' "${ENOOMIAN_CLAUDE_DEPLOY_TOKEN}"
    return 0
  fi
  if enoomian_is_present_token "${ENOOMIAN_CLOUDFLARE_API_TOKEN:-}"; then
    printf '%s' "${ENOOMIAN_CLOUDFLARE_API_TOKEN}"
    return 0
  fi
  return 1
}

enoomian_has_cloudflare_token() {
  enoomian_cloudflare_token >/dev/null 2>&1
}

enoomian_wrangler() {
  local token
  if token="$(enoomian_cloudflare_token)"; then
    # Account-scoped tokens require CLOUDFLARE_ACCOUNT_ID so wrangler skips
    # the /user/... preflight and goes straight to /accounts/{id}/... endpoints.
    CLOUDFLARE_API_TOKEN="${token}" \
    CLOUDFLARE_ACCOUNT_ID="${ENOOMIAN_CLOUDFLARE_ACCOUNT_ID:-}" \
      bunx wrangler "$@"
  else
    bunx wrangler "$@"
  fi
}

enoomian_require_cloudflare_auth() {
  if enoomian_has_cloudflare_token; then
    return 0
  fi
  enoomian_wrangler whoami >/dev/null
}

enoomian_ensure_pages_project() {
  local project_name="$1"
  enoomian_require_cloudflare_auth
  if ! enoomian_wrangler pages project list | grep -Fq "${project_name}"; then
    enoomian_wrangler pages project create "${project_name}" --production-branch enoomian/staging
  fi
}

enoomian_wait_for_json() {
  local url="$1"
  local jq_filter="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-15}"
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    local payload
    payload="$(curl -fsSL "${url}" 2>/dev/null || true)"
    if [[ -n "${payload}" ]] && printf '%s' "${payload}" | jq -e "${jq_filter}" >/dev/null; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done
  return 1
}

enoomian_wait_for_url() {
  local url="$1"
  local attempts="${2:-20}"
  local sleep_seconds="${3:-15}"
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    if curl -fsSL "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done
  return 1
}

enoomian_wait_for_build_info() {
  local url="$1"
  local commit_sha="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-15}"
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    local payload
    payload="$(curl -fsSL "${url}/build-info.json" 2>/dev/null || true)"
    if [[ -n "${payload}" ]] && printf '%s' "${payload}" | jq -e --arg sha "${commit_sha}" '.commitHash == $sha' >/dev/null; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done
  return 1
}

enoomian_hyperscapes_stream_url() {
  enoomian_require_env \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN
  local base_url
  base_url="${ENOOMIAN_HYPERSCAPES_PAGES_URL%/}"
  printf '%s/stream?disableBridgeCapture=1&streamToken=%s\n' \
    "${base_url}" \
    "${ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN}"
}

enoomian_require_tokenized_hyperscapes_stream_url() {
  local stream_url="$1"
  [[ -n "${stream_url}" ]] || return 0
  [[ "${stream_url}" == *"/stream"* || "${stream_url}" == *"page=stream"* ]] || enoomian_die "expected Hyperscapes stream URL, got ${stream_url}"
  [[ "${stream_url}" == *"streamToken="* ]] || enoomian_die "expected tokenized Hyperscapes stream URL, got ${stream_url}"
}

enoomian_hyperscapes_embed_allowed_origins() {
  local origins=""
  local candidate
  local extra_origin

  for candidate in \
    "$(enoomian_hyperbet_pages_url)" \
    "${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-}" \
    "${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-}"; do
    candidate="${candidate%/}"
    [[ -n "${candidate}" ]] || continue
    case ",${origins}," in
      *,"${candidate}",*) ;;
      *) origins="${origins:+${origins},}${candidate}" ;;
    esac
  done

  if [[ -n "${ENOOMIAN_HYPERSCAPES_EXTRA_EMBED_ALLOWED_ORIGINS:-}" ]]; then
    while IFS= read -r extra_origin; do
      extra_origin="${extra_origin%/}"
      [[ -n "${extra_origin}" ]] || continue
      case ",${origins}," in
        *,"${extra_origin}",*) ;;
        *) origins="${origins:+${origins},}${extra_origin}" ;;
      esac
    done < <(printf '%s\n' "${ENOOMIAN_HYPERSCAPES_EXTRA_EMBED_ALLOWED_ORIGINS}" | tr ',' '\n')
  fi

  [[ -n "${origins}" ]] || enoomian_die "missing Hyperbet Pages origins for Hyperscapes iframe allowlist"
  printf '%s\n' "${origins}"
}

enoomian_export_hyperscapes_source_env() {
  enoomian_require_env \
    ENOOMIAN_HYPERSCAPES_API_URL \
    ENOOMIAN_HYPERSCAPES_PAGES_URL \
    ENOOMIAN_BETTING_FEED_ACCESS_TOKEN \
    ENOOMIAN_STREAMING_VIEWER_ACCESS_TOKEN

  local stream_url
  stream_url="$(enoomian_hyperscapes_stream_url)"

  export SOURCE_STREAM_STATE_URL="${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/state"
  export SOURCE_BET_SYNC_STATE_URL="${ENOOMIAN_HYPERSCAPES_API_URL}/api/internal/bet-sync/state"
  export SOURCE_RTMP_STATUS_URL="${ENOOMIAN_HYPERSCAPES_API_URL}/api/streaming/rtmp/status"
  export SOURCE_BET_SYNC_BEARER_TOKEN="${ENOOMIAN_BETTING_FEED_ACCESS_TOKEN}"
  export HYPERSCAPES_UI_URL="${HYPERSCAPES_UI_URL:-${stream_url}}"
  export STREAM_URL="${STREAM_URL:-${stream_url}}"
}

enoomian_hyperbet_shared_api_url() {
  enoomian_hyperbet_keeper_url
}

enoomian_hyperbet_shared_ws_url() {
  enoomian_hyperbet_keeper_ws_url
}

enoomian_prepare_staged_proof_identity() {
  local duel_id="${1:-enoomian-$(node -e 'console.log(Date.now())')}"
  local duel_key_hex
  local identity_file
  duel_key_hex="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  export ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID="${duel_id}"
  export ENOOMIAN_RUN_STAGED_PROOF_DUEL_KEY="0x${duel_key_hex}"
  identity_file="$(enoomian_persist_staged_proof_identity)"
  enoomian_log "using staged proof duel ${ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID}"
  enoomian_log "persisted staged proof identity ${identity_file}"
}

enoomian_export_hyperbet_staged_env() {
  enoomian_require_env \
    ENOOMIAN_HYPERBET_PAGES_URL \
    ENOOMIAN_HYPERBET_KEEPER_URL \
    ENOOMIAN_HYPERBET_KEEPER_WS_URL \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL \
    ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL \
    ENOOMIAN_SOLANA_STAGE_A_WALLET_PATH \
    ENOOMIAN_SOLANA_CLUSTER \
    ENOOMIAN_SOLANA_RPC_URL \
    ENOOMIAN_SOLANA_RPC_WS_URL \
    ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID \
    ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID \
    ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR \
    ENOOMIAN_HYPERBET_SOLANA_MARKET_MAKER_KEYPAIR \
    ENOOMIAN_HYPERBET_BSC_KEEPER_URL \
    ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL \
    ENOOMIAN_BSC_RPC_URL \
    ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_GOLD_CLOB_ADDRESS \
    ENOOMIAN_BSC_GOLD_AMM_ROUTER_ADDRESS \
    ENOOMIAN_BSC_MUSD_TOKEN_ADDRESS \
    ENOOMIAN_BSC_GOLD_TOKEN_ADDRESS \
    ENOOMIAN_BSC_SKILL_ORACLE_ADDRESS \
    ENOOMIAN_BSC_PERP_ENGINE_ADDRESS \
    ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY \
    ENOOMIAN_HYPERBET_BSC_REPORTER_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_CANARY_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_MATCHER_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_ADMIN_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_MARKET_OPERATOR_PRIVATE_KEY \
    ENOOMIAN_HYPERBET_BSC_PAUSER_PRIVATE_KEY \
    ENOOMIAN_BSC_CHAIN_ID

  local staged_proof_duel_id="${ENOOMIAN_RUN_STAGED_PROOF_DUEL_ID:-${ENOOMIAN_STAGED_PROOF_DUEL_ID:-}}"
  local staged_proof_duel_key="${ENOOMIAN_RUN_STAGED_PROOF_DUEL_KEY:-${ENOOMIAN_STAGED_PROOF_DUEL_KEY:-}}"
  [[ -n "${staged_proof_duel_id}" ]] || enoomian_die "missing staged proof duel id"
  [[ -n "${staged_proof_duel_key}" ]] || enoomian_die "missing staged proof duel key"

  export HYPERBET_STAGED_PROOF_DUEL_ID="${staged_proof_duel_id}"
  export HYPERBET_STAGED_PROOF_DUEL_KEY="${staged_proof_duel_key}"
  export HYPERBET_PAGES_STAGING_URL="${ENOOMIAN_HYPERBET_PAGES_URL}"
  export HYPERBET_KEEPER_STAGING_URL="${ENOOMIAN_HYPERBET_KEEPER_URL}"
  export HYPERBET_KEEPER_STAGING_WS_URL="${ENOOMIAN_HYPERBET_KEEPER_WS_URL}"
  export HYPERBET_SOLANA_PAGES_STAGING_URL="${ENOOMIAN_HYPERBET_SOLANA_PAGES_URL:-}"
  export HYPERBET_SOLANA_KEEPER_STAGING_URL="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_URL}"
  export HYPERBET_SOLANA_KEEPER_STAGING_WS_URL="${ENOOMIAN_HYPERBET_SOLANA_KEEPER_WS_URL}"
  export ANCHOR_WALLET="${ENOOMIAN_SOLANA_STAGE_A_WALLET_PATH}"
  export SOLANA_STAGE_A_WALLET_PATH="${ENOOMIAN_SOLANA_STAGE_A_WALLET_PATH}"
  export HYPERBET_SOLANA_STAGING_CLUSTER="${ENOOMIAN_SOLANA_CLUSTER}"
  export HYPERBET_SOLANA_STAGING_RPC_URL="${ENOOMIAN_SOLANA_RPC_URL}"
  export HYPERBET_SOLANA_STAGING_RPC_WS_URL="${ENOOMIAN_SOLANA_RPC_WS_URL}"
  export SOLANA_RPC_WS_URL="${ENOOMIAN_SOLANA_RPC_WS_URL}"
  export HYPERBET_SOLANA_STAGING_FIGHT_ORACLE_PROGRAM_ID="${ENOOMIAN_SOLANA_FIGHT_ORACLE_PROGRAM_ID}"
  export HYPERBET_SOLANA_STAGING_GOLD_CLOB_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_CLOB_PROGRAM_ID}"
  export HYPERBET_SOLANA_STAGING_GOLD_AMM_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_AMM_PROGRAM_ID}"
  export HYPERBET_SOLANA_STAGING_GOLD_PERPS_PROGRAM_ID="${ENOOMIAN_SOLANA_GOLD_PERPS_PROGRAM_ID}"
  export HYPERBET_SOLANA_STAGING_STREAM_PUBLISH_KEY="${ENOOMIAN_HYPERBET_SOLANA_STREAM_PUBLISH_KEY}"
  export HYPERBET_SOLANA_STAGING_ORACLE_AUTHORITY_KEYPAIR="${ENOOMIAN_HYPERBET_SOLANA_ORACLE_AUTHORITY_KEYPAIR}"
  export HYPERBET_SOLANA_STAGING_CANARY_KEYPAIR="${ENOOMIAN_HYPERBET_SOLANA_CANARY_KEYPAIR}"
  export HYPERBET_SOLANA_STAGING_MARKET_MAKER_KEYPAIR="${ENOOMIAN_HYPERBET_SOLANA_MARKET_MAKER_KEYPAIR}"
  export HYPERBET_BSC_PAGES_STAGING_URL="${ENOOMIAN_HYPERBET_BSC_PAGES_URL:-}"
  export HYPERBET_BSC_KEEPER_STAGING_URL="${ENOOMIAN_HYPERBET_BSC_KEEPER_URL}"
  export HYPERBET_BSC_KEEPER_STAGING_WS_URL="${ENOOMIAN_HYPERBET_BSC_KEEPER_WS_URL}"
  export HYPERBET_BSC_STAGING_RPC_URL="${ENOOMIAN_BSC_RPC_URL}"
  export HYPERBET_BSC_STAGING_DUEL_ORACLE_ADDRESS="${ENOOMIAN_BSC_DUEL_ORACLE_ADDRESS}"
  export HYPERBET_BSC_STAGING_GOLD_CLOB_ADDRESS="${ENOOMIAN_BSC_GOLD_CLOB_ADDRESS}"
  export HYPERBET_BSC_STAGING_GOLD_AMM_ROUTER_ADDRESS="${ENOOMIAN_BSC_GOLD_AMM_ROUTER_ADDRESS}"
  export HYPERBET_BSC_STAGING_MUSD_TOKEN_ADDRESS="${ENOOMIAN_BSC_MUSD_TOKEN_ADDRESS}"
  export HYPERBET_BSC_STAGING_GOLD_TOKEN_ADDRESS="${ENOOMIAN_BSC_GOLD_TOKEN_ADDRESS}"
  export HYPERBET_BSC_STAGING_SKILL_ORACLE_ADDRESS="${ENOOMIAN_BSC_SKILL_ORACLE_ADDRESS}"
  export HYPERBET_BSC_STAGING_PERP_ENGINE_ADDRESS="${ENOOMIAN_BSC_PERP_ENGINE_ADDRESS}"
  export HYPERBET_BSC_STAGING_STREAM_PUBLISH_KEY="${ENOOMIAN_HYPERBET_BSC_STREAM_PUBLISH_KEY}"
  export HYPERBET_BSC_STAGING_REPORTER_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_REPORTER_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_CANARY_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_CANARY_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_MATCHER_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_MATCHER_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_ADMIN_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_ADMIN_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_MARKET_OPERATOR_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_MARKET_OPERATOR_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_PAUSER_PRIVATE_KEY="${ENOOMIAN_HYPERBET_BSC_PAUSER_PRIVATE_KEY}"
  export HYPERBET_BSC_STAGING_CHAIN_ID="${ENOOMIAN_BSC_CHAIN_ID}"
  export HYPERBET_BASE_STAGING_CHAIN_ID="${ENOOMIAN_BASE_CHAIN_ID:-}"
  export HYPERBET_BASE_STAGING_DUEL_ORACLE_ADDRESS="${ENOOMIAN_BASE_DUEL_ORACLE_ADDRESS:-}"
  export HYPERBET_BASE_STAGING_GOLD_CLOB_ADDRESS="${ENOOMIAN_BASE_GOLD_CLOB_ADDRESS:-}"
}
