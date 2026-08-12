# Auditor Build Guide

## Pinned tools

- Bun 1.3.6
- Anchor CLI 0.32.1
- Solana CLI/validator 2.3.0
- Rust toolchain compatible with the checked lockfile

## Reproduce

```bash
bun install --frozen-lockfile
bun install --cwd packages/hyperbet-solana/anchor --frozen-lockfile
bun run ci:env
bun run ci:scope:solana
bun run ci:gate:registry:launch
bun run ci:gate:solana:build
bun run --cwd packages/hyperbet-solana/anchor test
bun run --cwd packages/hyperbet-solana/keeper test:launch
bun run --cwd packages/hyperbet-ui test
bun run ci:gate:solana
bun run ci:gate:e2e:solana
bun run build
```

Canonical sources are `anchor/programs/fight_oracle/src/lib.rs` and `anchor/programs/duel_market/src/lib.rs`. Generated IDLs/types must match the build outputs. Record tool versions, git SHA/status, command logs, test counts, SBF/IDL hashes, and any non-determinism.

The release build must contain exactly the two launch programs. Any extra program, runtime, product surface, warning class, or generated-artifact mismatch is a failed reproduction.
