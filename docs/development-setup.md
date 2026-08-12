# Hyperbet Development Setup

## Toolchain

- Bun `1.3.6`
- Anchor CLI `0.32.1`
- Solana CLI with `solana-test-validator`
- Rust and Cargo
- `jq`

Run the repo doctor first:

```bash
bun run dev:doctor
```

Install the workspace and nested Solana program/app/keeper packages:

```bash
bun run dev:bootstrap
```

## Local demo

```bash
bun run dev:local:solana
```

This command fails early if the pinned Solana toolchain is not present. The local validator loads only `fight_oracle` and `duel_market`.

## Environment Templates

The shared keeper template is in [`.env.example`](../.env.example).

The local E2E harness generates `packages/hyperbet-solana/app/.env.e2e` as part of its isolated setup flow. Do not commit that file.

Public devnet/testnet browser acceptance is read-only and requires explicit `E2E_GAME_API_URL` and `SOLANA_RPC_URL` values:

```bash
bun run --cwd packages/hyperbet-solana/app test:e2e:devnet
```

The public harness refuses mainnet and never loads a funded browser wallet.
