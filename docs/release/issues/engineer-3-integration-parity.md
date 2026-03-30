# Title

Shared lifecycle contract, cross-chain parity, and Gate 22 required checks

# Owner

Engineer 3

# Suggested Branch

`enoomian/pm-22-shared-contract-parity`

# Summary

Own the frozen shared contract and integration boundary for the release:

- maintain lifecycle semantics and reserved metadata
- keep UI, keepers, MM, and registry consumers aligned
- add cross-chain parity coverage
- define and enforce the Gate `22` required-check contract
- run nightly integration and block drift

# Frozen Contract

- `OPEN` is the only quotable lifecycle state
- `RESOLVED` and `CANCELLED` are the only terminal settlement states
- `PROPOSED` and `CHALLENGED` are explicit in-flight resolution states
- STP policy is `cancel-taker`
- reserved lifecycle metadata keys:
  - `proposalId`
  - `challengeWindowEndsAt`
  - `finalizedAt`
  - `cancellationReason`

# Start Here

- `packages/hyperbet-chain-registry/src/index.ts`
- `packages/hyperbet-ui/src/lib/predictionMarkets.ts`
- `packages/hyperbet-ui/src/lib/predictionMarketUiState.ts`
- `packages/hyperbet-bsc/keeper/src/service.ts`
- `packages/hyperbet-solana/keeper/src/service.ts`
- `packages/hyperbet-avax/keeper/src/service.ts`
- `.github/workflows/prediction-market-gates.yml`

# Scope

- Maintain the shared lifecycle contract for `OPEN`, `PROPOSED`, `CHALLENGED`,
  `RESOLVED`, and `CANCELLED`.
- Keep `/api/arena/prediction-markets/active` stable at the top level.
- Ensure all producers and consumers agree on the reserved metadata keys.
- Update every consumer to interpret quotable vs terminal states identically.
- Add parity coverage for place, partial fill, cancel, lock, propose,
  challenge, finalize, cancel, claim, and refund traces across Solana, BSC, and
  AVAX.
- Define the final required CI check set for Gate `22`.
- Run nightly integration against the sprint base and refuse merges that drift
  the frozen contract.

# Out Of Scope

- Owning core EVM protocol redesign
- Owning core Solana protocol redesign
- Owning MM durable-store design

# Acceptance Criteria

- Shared lifecycle types, helpers, and metadata are consistent across registry,
  UI, keepers, and MM consumers.
- `/api/arena/prediction-markets/active` remains backward-compatible at the top
  level.
- Every consumer only treats `OPEN` as quotable and only `RESOLVED` or
  `CANCELLED` as terminal.
- Cross-chain parity tests exist for the required lifecycle traces.
- Gate `22` required checks are explicitly documented and reflected in CI policy.
- Nightly integration has an attached checklist and blocks drift from the frozen
  contract.

# Verification

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test --preload ./tests/setup.ts` in `packages/hyperbet-ui`
- `bunx vitest run` in `packages/market-maker-bot`
- `bun run ci:gate:base`

# Required Artifacts

- shared-model PRs
- parity test PR
- written Gate `22` required-check contract in
  `docs/release/gate-22-required-check-contract.md`
- nightly integration checklist attached to the integration branch

# Dependencies

- Review and approve any requested changes from Engineers 1, 2, 4, or 5 that
  would alter the frozen contract
