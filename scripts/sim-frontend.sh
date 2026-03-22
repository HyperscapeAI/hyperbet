#!/usr/bin/env bash
set -euo pipefail

# Start simulation dashboard + betting frontend together.
# The sim dashboard acts as the Game API server for the frontend.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SIM_PID=""
cleanup() {
    if [[ -n "$SIM_PID" ]]; then
        kill "$SIM_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "==> Starting simulation dashboard..."
cd "$ROOT_DIR"
bun run --cwd packages/simulation-dashboard dev &
SIM_PID=$!

echo "==> Waiting for sim dashboard to be ready on :3401..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:3401/api/config > /dev/null 2>&1; then
        break
    fi
    if ! kill -0 "$SIM_PID" 2>/dev/null; then
        echo "ERROR: Simulation dashboard crashed during startup"
        exit 1
    fi
    sleep 1
done

if ! curl -sf http://localhost:3401/api/config > /dev/null 2>&1; then
    echo "ERROR: Simulation dashboard did not become ready in 60s"
    exit 1
fi

echo "==> Fetching contract addresses from sim..."
CONFIG=$(curl -sf http://localhost:3401/api/config)
CLOB=$(echo "$CONFIG" | jq -r .clobAddress)
ORACLE=$(echo "$CONFIG" | jq -r .oracleAddress)
DUEL_KEY=$(echo "$CONFIG" | jq -r .duelKey)

echo "    CLOB:   $CLOB"
echo "    Oracle: $ORACLE"
echo "    Duel:   $DUEL_KEY"

# Write .env.local for the EVM betting frontend
ENV_FILE="$ROOT_DIR/packages/hyperbet-evm/app/.env.local"
cat > "$ENV_FILE" << EOF
VITE_GAME_API_URL=http://localhost:3401
VITE_BSC_RPC_URL=http://localhost:18546
VITE_BSC_CHAIN_ID=31337
VITE_BSC_GOLD_CLOB_ADDRESS=$CLOB
EOF

echo "==> Wrote $ENV_FILE"
echo "==> Starting betting frontend dev server..."
cd "$ROOT_DIR"
exec bun run --cwd packages/hyperbet-evm/app dev
