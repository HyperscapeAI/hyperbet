#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_CLUSTER="${1:-${SOLANA_DEPLOY_CLUSTER:-}}"
PROGRAM_SCOPE="${HYPERBET_SOLANA_PROGRAM_SCOPE:-all}"

if [[ "${2:-}" == "--pm-only" ]]; then
  PROGRAM_SCOPE="pm"
fi

if [[ "$PROGRAM_SCOPE" == "pm" ]]; then
  PROGRAMS=(
    "fight_oracle"
    "gold_clob_market"
  )
else
  PROGRAMS=(
    "fight_oracle"
    "gold_clob_market"
    "gold_perps_market"
  )
fi

resolve_wallet_path() {
  local candidates=()

  if [[ -n "${ANCHOR_WALLET:-}" ]]; then
    candidates+=("${ANCHOR_WALLET}")
  fi
  candidates+=(
    "$HOME/.config/solana/hyperscape-keys/deployer.json"
    "$HOME/.config/solana/id.json"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf 'No Anchor wallet found. Checked:\n' >&2
  printf '  %s\n' "${candidates[@]}" >&2
  exit 1
}

cleanup_stale_buffers() {
  local context="${1:-cleanup}"
  local output=""
  local status=0

  set +e
  output="$(
    solana program close \
      --buffers \
      --url "$TARGET_CLUSTER" \
      --keypair "$WALLET_PATH" \
      --authority "$WALLET_PATH" \
      --recipient "$WALLET_ADDRESS" 2>&1
  )"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    if [[ -n "$output" ]]; then
      printf '%s\n' "$output"
    fi
    echo "[deploy] reclaimed stale buffers ($context)"
    return 0
  fi

  if grep -Eqi "no .*buffer" <<<"$output"; then
    echo "[deploy] no stale buffers to reclaim ($context)"
    return 0
  fi

  printf '%s\n' "$output" >&2
  return $status
}

program_matches_binary() {
  local program_id="$1"
  local binary_path="$2"
  local dumped_binary
  local local_hash
  local deployed_hash

  if ! solana program show \
    --url "$TARGET_CLUSTER" \
    --keypair "$WALLET_PATH" \
    "$program_id" >/dev/null 2>&1; then
    return 1
  fi

  dumped_binary="$(mktemp "${TMPDIR:-/tmp}/hyperbet-program-dump.XXXXXX.so")"
  if ! solana program dump \
    --url "$TARGET_CLUSTER" \
    --keypair "$WALLET_PATH" \
    "$program_id" \
    "$dumped_binary" >/dev/null 2>&1; then
    rm -f "$dumped_binary"
    return 1
  fi

  local_hash="$(shasum -a 256 "$binary_path" | cut -d' ' -f1)"
  deployed_hash="$(shasum -a 256 "$dumped_binary" | cut -d' ' -f1)"
  rm -f "$dumped_binary"

  [[ "$local_hash" == "$deployed_hash" ]]
}

deploy_program() {
  local program="$1"
  local keypair_path="$2"
  local binary_path="$3"
  local output=""
  local status=0

  set +e
  output="$(
    solana program deploy \
      --url "$TARGET_CLUSTER" \
      --keypair "$WALLET_PATH" \
      --fee-payer "$WALLET_PATH" \
      --upgrade-authority "$WALLET_PATH" \
      --program-id "$keypair_path" \
      "$binary_path" 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ $status -eq 0 ]]; then
    return 0
  fi

  echo "[deploy] deployment failed for $program; reclaiming any staged buffers"
  cleanup_stale_buffers "after failed $program deploy"
  echo "[deploy] balance after failed $program deploy: $(solana balance --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH")"
  return $status
}

if [[ -z "$TARGET_CLUSTER" ]]; then
  echo "usage: bash anchor/scripts/deploy-programs.sh <devnet|testnet|mainnet-beta>" >&2
  exit 1
fi

case "$TARGET_CLUSTER" in
  devnet|testnet|mainnet-beta) ;;
  mainnet)
    TARGET_CLUSTER="mainnet-beta"
    ;;
  *)
    echo "unsupported cluster: $TARGET_CLUSTER" >&2
    exit 1
    ;;
esac

for required in bun solana solana-keygen; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "missing required command: $required" >&2
    exit 1
  fi
done

WALLET_PATH="$(resolve_wallet_path)"
WALLET_ADDRESS="$(solana-keygen pubkey "$WALLET_PATH")"
echo "[deploy] cluster: $TARGET_CLUSTER"
echo "[deploy] scope:   $PROGRAM_SCOPE"
echo "[deploy] wallet:  $WALLET_PATH"
echo "[deploy] address: $WALLET_ADDRESS"
echo "[deploy] balance: $(solana balance --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH")"
cleanup_stale_buffers "before deployment"
echo "[deploy] balance after cleanup: $(solana balance --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH")"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[deploy] building anchor workspace"
  bun run --cwd "$ROOT_DIR" build
fi

for program in "${PROGRAMS[@]}"; do
  keypair_path="$ROOT_DIR/target/deploy/${program}-keypair.json"
  binary_path="$ROOT_DIR/target/deploy/${program}.so"

  if [[ ! -f "$keypair_path" ]]; then
    echo "missing program keypair: $keypair_path" >&2
    exit 1
  fi
  if [[ ! -f "$binary_path" ]]; then
    echo "missing program binary: $binary_path" >&2
    exit 1
  fi

  program_id="$(solana-keygen pubkey "$keypair_path")"
  if program_matches_binary "$program_id" "$binary_path"; then
    echo "[deploy] $program ($program_id) already matches current binary; skipping deploy"
  else
    echo "[deploy] deploying $program ($program_id)"
    deploy_program "$program" "$keypair_path" "$binary_path"
  fi

  echo "[deploy] verifying $program ($program_id)"
  solana program show --url "$TARGET_CLUSTER" --keypair "$WALLET_PATH" "$program_id"
done

echo "[deploy] complete"
