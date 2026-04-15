#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}" >> "${GITHUB_ENV}"
  else
    echo "CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}"
  fi
  exit 0
fi

if [[ -z "${CLOUDFLARE_WRANGLER_CONFIG_B64:-}" ]]; then
  echo "Missing Cloudflare deploy credentials" >&2
  exit 1
fi

mkdir -p "${HOME}/.wrangler/config"
printf '%s' "${CLOUDFLARE_WRANGLER_CONFIG_B64}" | base64 --decode > "${HOME}/.wrangler/config/default.toml"
