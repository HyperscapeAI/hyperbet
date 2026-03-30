#!/usr/bin/env bash
set -euo pipefail

FORGE_BIN="${FORGE_BIN:-$(command -v forge 2>/dev/null || true)}"
if [[ -z "$FORGE_BIN" && -x "/opt/homebrew/bin/forge" ]]; then
  FORGE_BIN="/opt/homebrew/bin/forge"
fi
if [[ -z "$FORGE_BIN" && -x "$HOME/.foundry/bin/forge" ]]; then
  FORGE_BIN="$HOME/.foundry/bin/forge"
fi
if [[ -z "$FORGE_BIN" ]]; then
  echo "[run-foundry] forge binary not found; set FORGE_BIN or install foundry" >&2
  exit 127
fi

exec "$FORGE_BIN" "$@"
