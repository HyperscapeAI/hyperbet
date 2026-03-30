#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$ROOT/.env.stage-a.testnet.local}"
STAGE_A_ENV_FILE="${STAGE_A_ENV_FILE:-$ROOT/keys/stage-a/export-stage-a.sh}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/.ci-artifacts/stage-a/direct-canaries}"
DUEL_ENV_FILE="${DUEL_ENV_FILE:-$ROOT/keys/stage-a/acceptance/duel.env}"

mkdir -p "$ARTIFACT_DIR"
mkdir -p "$(dirname "$DUEL_ENV_FILE")"

if [[ ! -f "$STAGE_A_ENV_FILE" ]]; then
  echo "[stage-a-canaries] missing stage-a env file: $STAGE_A_ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
  echo "[stage-a-canaries] missing local acceptance env file: $LOCAL_ENV_FILE" >&2
  exit 1
fi

source "$STAGE_A_ENV_FILE"
set -a
source "$LOCAL_ENV_FILE"
set +a

BUN_BIN="${BUN_BIN:-$(command -v bun 2>/dev/null || true)}"
if [[ -z "$BUN_BIN" && -x "$HOME/.bun/bin/bun" ]]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" ]]; then
  echo "[stage-a-canaries] bun not found" >&2
  exit 1
fi

timestamp="$(date +%s)"
if [[ -f "$DUEL_ENV_FILE" ]]; then
  set -a
  source "$DUEL_ENV_FILE"
  set +a
fi

duel_id="${HYPERBET_STAGED_PROOF_DUEL_ID:-${STAGE_A_ACCEPTANCE_DUEL_ID:-$timestamp}}"
raw_key="$(printf '%s' "stage-a-${timestamp}-${RANDOM}" | shasum -a 256 | awk '{print $1}')"
duel_key="0x${HYPERBET_STAGED_PROOF_DUEL_KEY:-${STAGE_A_ACCEPTANCE_DUEL_KEY:-$raw_key}}"

export HYPERBET_STAGED_PROOF_DUEL_ID="$duel_id"
export HYPERBET_STAGED_PROOF_DUEL_KEY="$duel_key"

cat >"$DUEL_ENV_FILE" <<EOF
export STAGE_A_ACCEPTANCE_DUEL_ID="$HYPERBET_STAGED_PROOF_DUEL_ID"
export STAGE_A_ACCEPTANCE_DUEL_KEY="${HYPERBET_STAGED_PROOF_DUEL_KEY#0x}"
EOF

echo "[stage-a-canaries] duel_id=$HYPERBET_STAGED_PROOF_DUEL_ID"
echo "[stage-a-canaries] duel_key=$HYPERBET_STAGED_PROOF_DUEL_KEY"
echo "[stage-a-canaries] duel_env_file=$DUEL_ENV_FILE"

"$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-bsc/keeper/src/staged-proof-bsc.ts \
  >"$ARTIFACT_DIR/bsc.json"
"$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-avax/keeper/src/staged-proof-avax.ts \
  >"$ARTIFACT_DIR/avax.json"
"$BUN_BIN" --cwd "$ROOT" --bun packages/hyperbet-solana/keeper/src/staged-proof-solana.ts \
  >"$ARTIFACT_DIR/solana.json"

jq -n \
  --arg duelId "$HYPERBET_STAGED_PROOF_DUEL_ID" \
  --arg duelKey "$HYPERBET_STAGED_PROOF_DUEL_KEY" \
  --slurpfile bsc "$ARTIFACT_DIR/bsc.json" \
  --slurpfile avax "$ARTIFACT_DIR/avax.json" \
  --slurpfile solana "$ARTIFACT_DIR/solana.json" \
  '{
    duelId: $duelId,
    duelKey: $duelKey,
    bsc: $bsc[0],
    avax: $avax[0],
    solana: $solana[0]
  }' >"$ARTIFACT_DIR/summary.json"

echo "[stage-a-canaries] artifacts:"
echo "  $ARTIFACT_DIR/bsc.json"
echo "  $ARTIFACT_DIR/avax.json"
echo "  $ARTIFACT_DIR/solana.json"
echo "  $ARTIFACT_DIR/summary.json"
