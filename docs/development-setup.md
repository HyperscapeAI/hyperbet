# Hyperbet Development Setup

## Toolchain

- Bun `1.3.1`
- Anchor CLI `0.32.1`
- Solana CLI with `solana-test-validator`
- Rust and Cargo
- `jq`
- Foundry (`forge` and `anvil`) for EVM local demos

Run the repo doctor first:

```bash
bun run dev:doctor
```

Install the workspace and nested app/keeper packages:

```bash
bun run dev:bootstrap
```

## Local Demos

Each primary surface has a root entrypoint:

```bash
bun run dev:local:solana
bun run dev:local:bsc
bun run dev:local:avax
```

These commands wrap the existing package-local demo scripts and fail early if the pinned toolchain is not present.

## Environment Templates

The shared keeper template is in [`.env.example`](../.env.example).

Local e2e demo scripts still generate package-specific `.env.e2e` files inside the app folders as part of their seed/setup flow.
