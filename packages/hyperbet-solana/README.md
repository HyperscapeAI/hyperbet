# Hyperbet Solana

> **TL;DR:** This package is the SOL-only v1 launch surface for Hyperia duel wagering and viewing. It uses the fight oracle and native-SOL CLOB only. Every other product and runtime is outside the launch closure.

## What Lives Here

- `anchor/programs/fight_oracle`: duel lifecycle and authoritative result flow
- `anchor/programs/duel_market`: native-SOL duel prediction-market CLOB
- `app`: SOL duel, stream, and wagering experience
- `keeper`: SOL duel lifecycle, market-management, reconciliation, and recovery services
- `deployments/solana-v1.json`: canonical v1 launch program registry
- `scripts`: SOL deployment preflight, initialization, verification, and artifact tooling

## Current Launch Role

- launch chain: `Solana only`
- non-mainnet proving lane: `devnet`
- user-facing market: `native-SOL PM/CLOB duels`
- launch programs: `fight_oracle` and `duel_market`
- explicitly excluded: every non-duel product and non-Solana runtime

## Key Commands

From `packages/hyperbet-solana`:

```bash
bun run deploy:preflight:devnet
bun run anchor:deploy:devnet
bun run deploy:init:devnet
bun run verify:deployment:devnet
```

Useful variants:

```bash
bun run deploy:preflight:testnet
bun run deploy:preflight:mainnet
bun run deploy:init:testnet
bun run deploy:init:mainnet
bun run verify:deployment:testnet
bun run verify:deployment:mainnet
```

## Development

```bash
bun run dev
bun run dev:local
bun run dev:testnet
bun run dev:mainnet
```

## Tests

```bash
bun run anchor:build
bun run anchor:test
bun run test:e2e:local
```

## Canonical Launch Truth

- `deployments/solana-v1.json`, loaded through `deployments/v1.ts`, is the only canonical v1 launch registry.
- The registry contains exactly four Solana clusters and exactly two program IDs per cluster: the fight oracle and duel CLOB.
- The registry gate rejects extra chains, token rails, non-duel programs, default IDs, and duplicate IDs.
- The SOL-only scope gate rejects prohibited chains and products from root launch commands, launch runtime sources, and the production bundle.
- A recorded mainnet program ID is not deployment authorization. Production remains blocked until clean launch artifacts are deployed, executable upgradeable-loader state and authorities are verified, and the deployment verifier passes.

## Deployment Safety

- Deployment is manual-only and its direct command runs read-only identity preflight before any chain mutation, then repeats strict finalized identity verification afterward.
- Initialization and verification require explicit distinct Solana role public keys, an explicit dispute window, all three fee values, and `SOLANA_LAUNCH_FEE_POLICY_APPROVED=true`; there are no production economics defaults.
- Freezing configuration additionally requires `SOLANA_LAUNCH_CONFIG_FREEZE_APPROVED=true`. Mainnet initialization refuses to run without `--freeze` and an explicit expected upgrade authority.
- RPC evidence records only protocol and host, never configured credentials, paths, or query parameters.

## Artifact Integrity

- Any IDL generation requires exact Anchor CLI 0.32.1. The former host-generated fallback is removed; a missing or mismatched CLI fails before artifact work.
- Normal and binaries-only release builds require `cargo-build-sbf` and exact Anchor CLI 0.32.1. Both use canonical `anchor build --no-idl -- --tools-version v1.52 -- --locked`, so the SBF tool pin, dependency graph, and binary output cannot drift between modes. Full builds then generate IDLs separately through canonical `anchor idl build`; the explicit IDL-only override is non-release tooling that uses that same command.
- SBF warning visibility is forced on. The build accepts only the exact dual-crate-type/LTO notice and exact Solana 2.3 runtime-symbol set classified by `anchor/scripts/audit-sbf-build-log.ts`; any new warning or symbol fails the build.
- The dual crate type is required because the programs are both deployable `cdylib` artifacts and Rust/Anchor CPI/test libraries. It affects link-time optimization, not program semantics. The classified syscall names are present in the pinned Agave 2.3.0 validator runtime, and the actual two-program validator matrix remains the execution proof.
