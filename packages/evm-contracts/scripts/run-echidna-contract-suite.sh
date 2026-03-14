#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v echidna >/dev/null 2>&1; then
  exec echidna \
    echidna/DuelOutcomeOracleEchidna.sol \
    --contract DuelOutcomeOracleEchidna \
    --config echidna/duel-outcome-oracle.yaml
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run \
    --rm \
    -v "$ROOT_DIR":/src \
    -w /src \
    ghcr.io/crytic/echidna/echidna \
    echidna \
    echidna/DuelOutcomeOracleEchidna.sol \
    --contract DuelOutcomeOracleEchidna \
    --config echidna/duel-outcome-oracle.yaml
fi

echo "echidna or docker is required" >&2
exit 1
