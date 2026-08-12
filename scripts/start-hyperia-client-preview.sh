#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "[hyperia-client] missing required env: $name" >&2
    exit 1
  fi
}

require_env HYPERIA_ROOT
require_env GAME_HTTP_URL
require_env GAME_WS_URL
require_env HYPERIA_PUBLIC_CDN_URL
require_env GAME_CLIENT_PORT

NODE_BIN="${NODE_BIN:-$(command -v node)}"
DUEL_CLIENT_NODE_BIN="${DUEL_CLIENT_NODE_BIN:-$NODE_BIN}"
CLIENT_DIR="$HYPERIA_ROOT/packages/client"
CLIENT_DIST="$CLIENT_DIR/dist"

if [[ ! -f "$CLIENT_DIST/stream.html" ]]; then
  echo "[hyperia-client] missing built preview assets at $CLIENT_DIST/stream.html" >&2
  exit 1
fi

PUBLIC_API_URL="$GAME_HTTP_URL" \
PUBLIC_WS_URL="$GAME_WS_URL" \
PUBLIC_CDN_URL="$HYPERIA_PUBLIC_CDN_URL" \
"$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const distDir = process.argv[1];
  fs.mkdirSync(distDir, { recursive: true });
  const payload = {
    PUBLIC_API_URL: process.env.PUBLIC_API_URL,
    PUBLIC_WS_URL: process.env.PUBLIC_WS_URL,
    PUBLIC_CDN_URL: process.env.PUBLIC_CDN_URL,
  };
  const serialized = JSON.stringify(payload, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  fs.writeFileSync(
    path.join(distDir, "env.js"),
    `window.env = ${serialized};\n`,
    "utf8",
  );
' "$CLIENT_DIST"

cd "$CLIENT_DIR"
exec env \
  NODE_ENV=production \
  "$DUEL_CLIENT_NODE_BIN" \
  ./node_modules/vite/bin/vite.js \
  preview \
  --host 127.0.0.1 \
  --port "$GAME_CLIENT_PORT" \
  --strictPort
