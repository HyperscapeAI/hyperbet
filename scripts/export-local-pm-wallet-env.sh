#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="${ROOT_DIR}/keys/local-pm"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "missing local PM key file: $path" >&2
    exit 1
  fi
}

json_field() {
  local path="$1"
  local field="$2"
  node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(data[process.argv[2]] ?? ""));' "$path" "$field"
}

emit_export() {
  local name="$1"
  local value="$2"
  printf 'export %s=%q\n' "$name" "$value"
}

KEEPER_JSON="${KEY_DIR}/evm-keeper.json"
CANARY_JSON="${KEY_DIR}/evm-canary.json"
MATCHER_JSON="${KEY_DIR}/evm-matcher.json"
SOLANA_KEEPER_KEYPAIR="${KEY_DIR}/solana-keeper.json"
SOLANA_CANARY_KEYPAIR="${KEY_DIR}/solana-canary.json"

require_file "$KEEPER_JSON"
require_file "$CANARY_JSON"
require_file "$MATCHER_JSON"
require_file "$SOLANA_KEEPER_KEYPAIR"
require_file "$SOLANA_CANARY_KEYPAIR"

EVM_KEEPER_PRIVATE_KEY="$(json_field "$KEEPER_JSON" privateKey)"
EVM_KEEPER_ADDRESS="$(json_field "$KEEPER_JSON" address)"
EVM_CANARY_PRIVATE_KEY="$(json_field "$CANARY_JSON" privateKey)"
EVM_CANARY_ADDRESS="$(json_field "$CANARY_JSON" address)"
EVM_MATCHER_PRIVATE_KEY="$(json_field "$MATCHER_JSON" privateKey)"
EVM_MATCHER_ADDRESS="$(json_field "$MATCHER_JSON" address)"
SOLANA_KEEPER_ADDRESS="$(solana-keygen pubkey "$SOLANA_KEEPER_KEYPAIR")"
SOLANA_CANARY_ADDRESS="$(solana-keygen pubkey "$SOLANA_CANARY_KEYPAIR")"

emit_export "LOCAL_PM_EVM_KEEPER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "LOCAL_PM_EVM_CANARY_ADDRESS" "$EVM_CANARY_ADDRESS"
emit_export "LOCAL_PM_EVM_MATCHER_ADDRESS" "$EVM_MATCHER_ADDRESS"
emit_export "LOCAL_PM_SOLANA_KEEPER_ADDRESS" "$SOLANA_KEEPER_ADDRESS"
emit_export "LOCAL_PM_SOLANA_CANARY_ADDRESS" "$SOLANA_CANARY_ADDRESS"

emit_export "EVM_KEEPER_PRIVATE_KEY" "$EVM_KEEPER_PRIVATE_KEY"
emit_export "PRIVATE_KEY" "$EVM_KEEPER_PRIVATE_KEY"
emit_export "ADMIN_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "MARKET_OPERATOR_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "REPORTER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "FINALIZER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "CHALLENGER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "PAUSER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "TREASURY_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "MARKET_MAKER_ADDRESS" "$EVM_KEEPER_ADDRESS"
emit_export "CANARY_PRIVATE_KEY" "$EVM_CANARY_PRIVATE_KEY"
emit_export "MATCHER_PRIVATE_KEY" "$EVM_MATCHER_PRIVATE_KEY"

emit_export "ANCHOR_WALLET" "$SOLANA_KEEPER_KEYPAIR"
emit_export "BOT_KEYPAIR" "$SOLANA_KEEPER_KEYPAIR"
emit_export "ORACLE_AUTHORITY_KEYPAIR" "$SOLANA_KEEPER_KEYPAIR"
emit_export "MARKET_MAKER_KEYPAIR" "$SOLANA_KEEPER_KEYPAIR"
