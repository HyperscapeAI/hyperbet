#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_CLUSTER="${1:-${SOLANA_DEPLOY_CLUSTER:-}}"
SOLANA_CLUSTER_URL="${SOLANA_RPC_URL:-}"
DEPLOY_TRANSPORT="${SOLANA_DEPLOY_TRANSPORT:-}"
DEPLOY_TRANSPORT_ARGS=()

PROGRAMS=(
  "fight_oracle"
  "duel_market"
)

resolve_wallet_path() {
  local candidates=()

  if [[ -n "${SOLANA_STAGE_A_WALLET_PATH:-}" ]]; then
    candidates+=("${SOLANA_STAGE_A_WALLET_PATH}")
  fi
  if [[ -n "${ANCHOR_WALLET:-}" ]]; then
    candidates+=("${ANCHOR_WALLET}")
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "Stage-A Solana wallet path is required via SOLANA_STAGE_A_WALLET_PATH or ANCHOR_WALLET" >&2
  if [[ ${#candidates[@]} -gt 0 ]]; then
    printf 'Checked:\n' >&2
    printf '  %s\n' "${candidates[@]}" >&2
  fi
  exit 1
}

read_idl_address() {
  local filepath="$1"
  node -e "const fs=require('fs'); const file=process.argv[1]; if (!fs.existsSync(file)) process.exit(1); const parsed=JSON.parse(fs.readFileSync(file,'utf8')); const direct=typeof parsed.address==='string' ? parsed.address.trim() : ''; const metadata=typeof parsed.metadata?.address==='string' ? parsed.metadata.address.trim() : ''; const value=direct || metadata; if (!value) process.exit(1); process.stdout.write(value);" "$filepath"
}

cleanup_stale_buffers() {
  local context="${1:-cleanup}"
  local output=""
  local status=0

  set +e
  output="$(
    solana program close \
      --buffers \
      --url "$SOLANA_CLUSTER_URL" \
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

STAGE_A_CLI_DIR=""
PREPARED_CLI_SIGNER_PATH=""

cleanup_cli_signers() {
  if [[ -n "$STAGE_A_CLI_DIR" && -d "$STAGE_A_CLI_DIR" ]]; then
    rm -rf "$STAGE_A_CLI_DIR"
  fi
}

prepare_cli_signer() {
  local source_path="$1"
  local target_name="$2"

  if [[ -z "$STAGE_A_CLI_DIR" ]]; then
    STAGE_A_CLI_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hyperbet-stage-a-signers.XXXXXX")"
    trap cleanup_cli_signers EXIT
  fi

  local target_path="$STAGE_A_CLI_DIR/$target_name"
  cp "$source_path" "$target_path"
  chmod 600 "$target_path"
  PREPARED_CLI_SIGNER_PATH="$target_path"
}

program_exists() {
  local program_id="$1"
  solana program show \
    --url "$SOLANA_CLUSTER_URL" \
    --keypair "$WALLET_PATH" \
    "$program_id" >/dev/null 2>&1
}

program_matches_binary() {
  local program_id="$1"
  local binary_path="$2"
  local dumped_binary
  local local_hash
  local deployed_hash

  if ! solana program show \
    --url "$SOLANA_CLUSTER_URL" \
    --keypair "$WALLET_PATH" \
    "$program_id" >/dev/null 2>&1; then
    return 1
  fi

  dumped_binary="$(mktemp "${TMPDIR:-/tmp}/hyperbet-program-dump.XXXXXX.so")"
  if ! solana program dump \
    --url "$SOLANA_CLUSTER_URL" \
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
      --url "$SOLANA_CLUSTER_URL" \
      --keypair "$WALLET_PATH" \
      --fee-payer "$WALLET_PATH" \
      --upgrade-authority "$WALLET_PATH" \
      "${DEPLOY_TRANSPORT_ARGS[@]}" \
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
  echo "[deploy] balance after failed $program deploy: $(solana balance --url "$SOLANA_CLUSTER_URL" --keypair "$WALLET_PATH")"
  return $status
}

upgrade_program() {
  local program="$1"
  local program_id="$2"
  local binary_path="$3"
  local output=""
  local status=0

  set +e
  output="$(
    anchor upgrade "$binary_path" \
      --program-id "$program_id" \
      --provider.cluster "$SOLANA_CLUSTER_URL" \
      --provider.wallet "$WALLET_PATH" 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ $status -eq 0 ]]; then
    return 0
  fi

  echo "[deploy] upgrade failed for $program ($program_id); reclaiming any staged buffers"
  cleanup_stale_buffers "after failed $program upgrade"
  echo "[deploy] balance after failed $program upgrade: $(solana balance --url "$SOLANA_CLUSTER_URL" --keypair "$WALLET_PATH")"
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

if [[ -z "$SOLANA_CLUSTER_URL" ]]; then
  SOLANA_CLUSTER_URL="$TARGET_CLUSTER"
fi

if [[ -z "$DEPLOY_TRANSPORT" && "$TARGET_CLUSTER" != "mainnet-beta" ]]; then
  DEPLOY_TRANSPORT="rpc"
fi

case "$DEPLOY_TRANSPORT" in
  "") ;;
  rpc) DEPLOY_TRANSPORT_ARGS+=(--use-rpc) ;;
  quic) DEPLOY_TRANSPORT_ARGS+=(--use-quic) ;;
  udp) DEPLOY_TRANSPORT_ARGS+=(--use-udp) ;;
  tpu) DEPLOY_TRANSPORT_ARGS+=(--use-tpu-client) ;;
  *)
    echo "unsupported SOLANA_DEPLOY_TRANSPORT: $DEPLOY_TRANSPORT" >&2
    exit 1
    ;;
esac

for required in anchor bun node solana solana-keygen; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "missing required command: $required" >&2
    exit 1
  fi
done

WALLET_PATH="$(resolve_wallet_path)"
prepare_cli_signer "$WALLET_PATH" wallet.json
WALLET_PATH="$PREPARED_CLI_SIGNER_PATH"
WALLET_ADDRESS="$(solana-keygen pubkey "$WALLET_PATH")"
if [[ -n "${SOLANA_EXPECTED_AUTHORITY:-}" && "$WALLET_ADDRESS" != "${SOLANA_EXPECTED_AUTHORITY}" ]]; then
  echo "Stage-A Solana deploy wallet mismatch: wallet=$WALLET_ADDRESS expected=${SOLANA_EXPECTED_AUTHORITY}" >&2
  exit 1
fi
echo "[deploy] cluster: $TARGET_CLUSTER"
echo "[deploy] rpc url:  $SOLANA_CLUSTER_URL"
echo "[deploy] scope:   solana-duel-v1"
echo "[deploy] wallet:  $WALLET_PATH"
echo "[deploy] address: $WALLET_ADDRESS"
echo "[deploy] balance: $(solana balance --url "$SOLANA_CLUSTER_URL" --keypair "$WALLET_PATH")"

if [[ "$TARGET_CLUSTER" != "mainnet-beta" ]]; then
  echo "[deploy] syncing durable Stage-A program keypairs into anchor/target/deploy"
  node --import tsx "$ROOT_DIR/../scripts/sync-stage-a-program-keypairs.ts"
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "[deploy] building anchor workspace"
  HYPERBET_SOLANA_BUILD_BINARIES_ONLY=1 bun run --cwd "$ROOT_DIR" build
fi

echo "[deploy] running read-only program identity preflight"
SOLANA_STAGE_A_WALLET_PATH="$WALLET_PATH" \
SOLANA_RPC_URL="$SOLANA_CLUSTER_URL" \
  bun run "$ROOT_DIR/../scripts/preflight-contract-deploy.ts" \
  --cluster "$TARGET_CLUSTER"

cleanup_stale_buffers "before deployment"
echo "[deploy] balance after cleanup: $(solana balance --url "$SOLANA_CLUSTER_URL" --keypair "$WALLET_PATH")"

for program in "${PROGRAMS[@]}"; do
  keypair_path="$ROOT_DIR/target/deploy/${program}-keypair.json"
  binary_path="$ROOT_DIR/target/deploy/${program}.so"
  idl_path="$ROOT_DIR/target/idl/${program}.json"

  if [[ ! -f "$binary_path" ]]; then
    echo "missing program binary: $binary_path" >&2
    exit 1
  fi
  if [[ ! -f "$idl_path" ]]; then
    echo "missing program idl: $idl_path" >&2
    exit 1
  fi

  program_id="$(read_idl_address "$idl_path")"
  if program_matches_binary "$program_id" "$binary_path"; then
    echo "[deploy] $program ($program_id) already matches current binary; skipping deploy"
  elif program_exists "$program_id"; then
    echo "[deploy] upgrading $program ($program_id)"
    upgrade_program "$program" "$program_id" "$binary_path"
  else
    if [[ ! -f "$keypair_path" ]]; then
      echo "missing program keypair for fresh deploy: $keypair_path" >&2
      exit 1
    fi
    prepare_cli_signer "$keypair_path" "${program}-keypair.json"
    cli_keypair_path="$PREPARED_CLI_SIGNER_PATH"
    keypair_program_id="$(solana-keygen pubkey "$cli_keypair_path")"
    if [[ "$keypair_program_id" != "$program_id" ]]; then
      echo "program keypair mismatch for fresh deploy: $program keypair=$keypair_program_id expected=$program_id" >&2
      exit 1
    fi

    echo "[deploy] deploying $program ($program_id)"
    deploy_program "$program" "$cli_keypair_path" "$binary_path"
  fi

  echo "[deploy] verifying $program ($program_id)"
  solana program show --url "$SOLANA_CLUSTER_URL" --keypair "$WALLET_PATH" "$program_id"
done

echo "[deploy] running mandatory post-deploy program identity verification"
SOLANA_STAGE_A_WALLET_PATH="$WALLET_PATH" \
SOLANA_RPC_URL="$SOLANA_CLUSTER_URL" \
  bun run "$ROOT_DIR/../scripts/preflight-contract-deploy.ts" \
  --cluster "$TARGET_CLUSTER" \
  --require-deployed

echo "[deploy] complete"
