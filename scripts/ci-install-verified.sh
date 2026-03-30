#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_INSTALLED=0

export TMPDIR="$ROOT_DIR/.tmp/bun-install.$$"
mkdir -p "$TMPDIR"

cleanup() {
  local status=$?

  rm -rf "$TMPDIR"

  exit "$status"
}

trap cleanup EXIT

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <target> [<target> ...]" >&2
  exit 1
fi

resolve_cwd() {
  case "$1" in
    root)
      echo "."
      ;;
    hyperbet-solana)
      echo "packages/hyperbet-solana"
      ;;
    hyperbet-solana-app)
      echo "packages/hyperbet-solana/app"
      ;;
    hyperbet-solana-keeper)
      echo "packages/hyperbet-solana/keeper"
      ;;
    hyperbet-bsc)
      echo "packages/hyperbet-bsc"
      ;;
    hyperbet-bsc-app)
      echo "packages/hyperbet-bsc/app"
      ;;
    hyperbet-bsc-keeper)
      echo "packages/hyperbet-bsc/keeper"
      ;;
    hyperbet-avax)
      echo "packages/hyperbet-avax"
      ;;
    hyperbet-avax-app)
      echo "packages/hyperbet-avax/app"
      ;;
    hyperbet-avax-keeper)
      echo "packages/hyperbet-avax/keeper"
      ;;
    hyperbet-evm)
      echo "packages/hyperbet-evm"
      ;;
    hyperbet-evm-app)
      echo "packages/hyperbet-evm/app"
      ;;
    hyperbet-evm-keeper)
      echo "packages/hyperbet-evm/keeper"
      ;;
    market-maker-bot)
      echo "packages/market-maker-bot"
      ;;
    evm-contracts)
      echo "packages/evm-contracts"
      ;;
    hyperbet-solana-anchor)
      echo "packages/hyperbet-solana/anchor"
      ;;
    *)
      echo "unsupported install target: $1" >&2
      exit 1
      ;;
  esac
}

target_requires_root_install() {
  case "$1" in
    root|hyperbet-solana|hyperbet-solana-app|hyperbet-solana-keeper|hyperbet-bsc|hyperbet-bsc-app|hyperbet-bsc-keeper|hyperbet-avax|hyperbet-avax-app|hyperbet-avax-keeper|hyperbet-evm|hyperbet-evm-app|hyperbet-evm-keeper|market-maker-bot|evm-contracts)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

target_requires_nested_install() {
  case "$1" in
    hyperbet-solana-app|hyperbet-solana-keeper|hyperbet-bsc-app|hyperbet-bsc-keeper|hyperbet-avax-app|hyperbet-avax-keeper|hyperbet-evm-app|hyperbet-evm-keeper|hyperbet-solana-anchor)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_lockfile() {
  local cwd="$1"

  if [[ "$cwd" == "." ]]; then
    echo "bun.lock"
  elif [[ -f "$ROOT_DIR/$cwd/bun.lock" ]]; then
    echo "$cwd/bun.lock"
  else
    echo "bun.lock"
  fi
}

verify_lockfile_clean() {
  local lockfile="$1"

  if ! git -C "$ROOT_DIR" diff --exit-code -- "$lockfile" >/dev/null; then
    echo "Lockfile drift detected after install: $lockfile" >&2
    git -C "$ROOT_DIR" diff -- "$lockfile" >&2 || true
    exit 1
  fi
}

install_root_workspace() {
  if [[ "$ROOT_INSTALLED" -eq 1 ]]; then
    return 0
  fi

  bun install
  verify_lockfile_clean "bun.lock"
  ROOT_INSTALLED=1
}

install_target() {
  local target="$1"
  local cwd
  local lockfile

  cwd="$(resolve_cwd "$target")"
  lockfile="$(resolve_lockfile "$cwd")"

  if target_requires_root_install "$target"; then
    install_root_workspace
  fi

  if target_requires_nested_install "$target"; then
    bun install --cwd "$ROOT_DIR/$cwd"
  fi

  if [[ "$lockfile" != "bun.lock" ]] || target_requires_root_install "$target"; then
    verify_lockfile_clean "$lockfile"
  fi
}

for target in "$@"; do
  install_target "$target"
done
