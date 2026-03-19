#!/usr/bin/env bash
set -euo pipefail

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required to derive Stage A public addresses from private keys" >&2
  exit 1
fi

if [[ -n "${TESTNET_SOLANA_DEPLOYER_KEYPAIR:-}" ]] && ! command -v solana-keygen >/dev/null 2>&1; then
  echo "solana-keygen is required when TESTNET_SOLANA_DEPLOYER_KEYPAIR is provided" >&2
  exit 1
fi

GITHUB_ENV_FILE="${GITHUB_ENV:-}"

require_nonempty() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "missing required Stage A input: $name" >&2
    exit 1
  fi
}

emit_env() {
  local name="$1"
  local value="$2"
  if [[ -n "$GITHUB_ENV_FILE" ]]; then
    printf '%s=%s\n' "$name" "$value" >>"$GITHUB_ENV_FILE"
  else
    printf '%s=%s\n' "$name" "$value"
  fi
}

derive_address() {
  cast wallet address --private-key "$1"
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

resolve_public_address() {
  local label="$1"
  local public_value="${2:-}"
  local private_key="${3:-}"
  local derived=""

  if [[ -n "$private_key" ]]; then
    derived="$(derive_address "$private_key")"
  fi

  if [[ -n "$public_value" && -n "$derived" && "$(lowercase "$public_value")" != "$(lowercase "$derived")" ]]; then
    echo "Stage A address mismatch for $label: public value $public_value does not match derived key address $derived" >&2
    exit 1
  fi

  if [[ -n "$public_value" ]]; then
    printf '%s\n' "$public_value"
    return 0
  fi

  if [[ -n "$derived" ]]; then
    printf '%s\n' "$derived"
    return 0
  fi

  echo "missing required Stage A address source for $label" >&2
  exit 1
}

DEPLOYER_KEY="${TESTNET_DEPLOYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
require_nonempty "TESTNET_DEPLOYER_PRIVATE_KEY or PRIVATE_KEY" "$DEPLOYER_KEY"

require_nonempty "BSC_TESTNET_RPC" "${BSC_TESTNET_RPC:-}"
require_nonempty "AVAX_FUJI_RPC" "${AVAX_FUJI_RPC:-}"

ADMIN_RESOLVED="$(resolve_public_address "ADMIN_ADDRESS" "${ADMIN_ADDRESS:-}" "${TESTNET_ADMIN_PRIVATE_KEY:-}")"
MARKET_OPERATOR_RESOLVED="$(resolve_public_address "MARKET_OPERATOR_ADDRESS" "${MARKET_OPERATOR_ADDRESS:-}" "${TESTNET_MARKET_OPERATOR_PRIVATE_KEY:-}")"
REPORTER_RESOLVED="$(resolve_public_address "REPORTER_ADDRESS" "${REPORTER_ADDRESS:-}" "${TESTNET_REPORTER_PRIVATE_KEY:-}")"
FINALIZER_RESOLVED="$(resolve_public_address "FINALIZER_ADDRESS" "${FINALIZER_ADDRESS:-}" "${TESTNET_FINALIZER_PRIVATE_KEY:-}")"
CHALLENGER_RESOLVED="$(resolve_public_address "CHALLENGER_ADDRESS" "${CHALLENGER_ADDRESS:-}" "${TESTNET_CHALLENGER_PRIVATE_KEY:-}")"
PAUSER_RESOLVED="$(resolve_public_address "PAUSER_ADDRESS" "${PAUSER_ADDRESS:-}" "${TESTNET_PAUSER_PRIVATE_KEY:-}")"
TREASURY_RESOLVED="$(resolve_public_address "TREASURY_ADDRESS" "${TREASURY_ADDRESS:-}" "${TESTNET_TREASURY_PRIVATE_KEY:-}")"
MARKET_MAKER_RESOLVED="$(resolve_public_address "MARKET_MAKER_ADDRESS" "${MARKET_MAKER_ADDRESS:-}" "${TESTNET_MARKET_MAKER_PRIVATE_KEY:-}")"

emit_env "PRIVATE_KEY" "$DEPLOYER_KEY"
emit_env "BSC_TESTNET_RPC" "${BSC_TESTNET_RPC}"
emit_env "AVAX_FUJI_RPC" "${AVAX_FUJI_RPC}"
emit_env "ADMIN_ADDRESS" "$ADMIN_RESOLVED"
emit_env "MARKET_OPERATOR_ADDRESS" "$MARKET_OPERATOR_RESOLVED"
emit_env "REPORTER_ADDRESS" "$REPORTER_RESOLVED"
emit_env "FINALIZER_ADDRESS" "$FINALIZER_RESOLVED"
emit_env "CHALLENGER_ADDRESS" "$CHALLENGER_RESOLVED"
emit_env "PAUSER_ADDRESS" "$PAUSER_RESOLVED"
emit_env "TREASURY_ADDRESS" "$TREASURY_RESOLVED"
emit_env "MARKET_MAKER_ADDRESS" "$MARKET_MAKER_RESOLVED"
emit_env "DISPUTE_WINDOW_SECONDS" "${DISPUTE_WINDOW_SECONDS:-3600}"

if [[ -n "${TIMELOCK_ADDRESS:-}" ]]; then
  emit_env "TIMELOCK_ADDRESS" "${TIMELOCK_ADDRESS}"
fi
if [[ -n "${MULTISIG_ADDRESS:-}" ]]; then
  emit_env "MULTISIG_ADDRESS" "${MULTISIG_ADDRESS}"
fi
if [[ -n "${EMERGENCY_COUNCIL_ADDRESS:-}" ]]; then
  emit_env "EMERGENCY_COUNCIL_ADDRESS" "${EMERGENCY_COUNCIL_ADDRESS}"
fi

if [[ -n "${TESTNET_SOLANA_DEPLOYER_KEYPAIR:-}" ]]; then
  stage_a_dir="${RUNNER_TEMP:-/tmp}/hyperbet-stage-a"
  mkdir -p "$stage_a_dir"
  wallet_path="$stage_a_dir/testnet-solana-deployer.json"
  printf '%s\n' "${TESTNET_SOLANA_DEPLOYER_KEYPAIR}" >"$wallet_path"
  solana_authority="$(solana-keygen pubkey "$wallet_path")"
  emit_env "ANCHOR_WALLET" "$wallet_path"
  emit_env "SOLANA_STAGE_A_WALLET_PATH" "$wallet_path"
  emit_env "SOLANA_EXPECTED_AUTHORITY" "$solana_authority"
  emit_env "SOLANA_EXPECTED_UPGRADE_AUTHORITY" "$solana_authority"
fi

echo "resolved Stage A public addresses:"
echo "  admin=$ADMIN_RESOLVED"
echo "  market_operator=$MARKET_OPERATOR_RESOLVED"
echo "  reporter=$REPORTER_RESOLVED"
echo "  finalizer=$FINALIZER_RESOLVED"
echo "  challenger=$CHALLENGER_RESOLVED"
echo "  pauser=$PAUSER_RESOLVED"
echo "  treasury=$TREASURY_RESOLVED"
echo "  market_maker=$MARKET_MAKER_RESOLVED"
