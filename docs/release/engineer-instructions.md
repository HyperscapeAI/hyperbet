# Engineer Instructions

> **TL;DR:** Historical handoff document from the earlier five-lane sprint-base execution model. Status: closed. Keep this as planning history, not as the current launch instruction set. Current execution is consolidated on `audit/develop-pm-hardening`.

This document is the direct handoff for the five parallel release lanes on
`enoomian/prediction-market-sprint-base`.

## Shared Rules For Everyone

- Do not change the frozen defaults in `docs/enoomian-next-phase-gates.md`
  without Engineer 3 signoff.
- `OPEN` is the only quotable lifecycle state.
- `RESOLVED` and `CANCELLED` are the only terminal settlement states.
- `PROPOSED` and `CHALLENGED` must remain fail-closed.
- STP policy is `cancel-taker` on both EVM and Solana.
- Production contract addresses come from the committed chain registry, not env
  overrides.
- Every PR must include:
  - passing targeted tests
  - a short checklist of what gate criteria it closes
  - a note if it changes any API, ABI, IDL, or runbook

## Engineer 1: EVM Protocol Safety and Order Semantics

### Own This

- Gates `16`, `17A`, and the EVM half of `21`

### Start Here

- `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`
- `packages/evm-contracts/contracts/GoldClob.sol`
- `packages/evm-contracts/test/DuelOutcomeOracle.ts`
- `packages/evm-contracts/test/GoldClob.ts`
- `packages/evm-contracts/test/GoldClobSettlement.t.sol`
- `packages/evm-contracts/test/fuzz/GoldClobFuzz.t.sol`

### Implement

- Remove any EVM launch-path shortcut that can finalize or settle without the
  explicit propose/challenge/finalize flow.
- Ensure settlement and claim logic only accept terminal `RESOLVED` or
  `CANCELLED` outcomes.
- Keep `PROPOSED` and `CHALLENGED` fail-closed for payout, refund, and claim.
- Add explicit order flags for `GTC`, `IOC`, and `post-only`. Unsupported flags
  must revert instead of being ignored.
- Implement deterministic bounded continuation and remainder handling for
  partial fills.
- Implement protocol-level `cancel-taker` STP for same-account or
  same-authority self-crosses.
- Emit machine-readable STP telemetry with:
  - `marketRef`
  - maker authority
  - taker authority
  - maker order id
  - taker order id
  - `policy="cancel-taker"`
  - `prevented=true`

### Do Not Touch

- Shared lifecycle defaults in the chain registry
- Solana program semantics
- AVAX registry values unless the change is required by an EVM deploy artifact

### Prove It

- `bun run --cwd packages/evm-contracts test`
- `bun run ci:contracts:proof`
- `bun run ci:contracts:security`
- `bun run ci:gate:evm`

### Handoff

- Contract PR with updated tests
- Short note listing any new ABI/event surfaces
- Gate checklist showing which `16` / `17A` / `21` merge criteria are now closed

## Engineer 2: Solana Protocol Safety and Order Semantics

### Own This

- Gates `16`, `17B`, and the Solana half of `21`

### Start Here

- `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`
- `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`
- `packages/hyperbet-solana/anchor/tests/hyperbet.ts`
- `packages/hyperbet-solana/anchor/tests/gold_clob_market.test.ts`
- `packages/hyperbet-solana/anchor/tests/black_hat_exploits.ts`

### Implement

- Enforce propose/challenge/finalize on Solana without privileged shortcut
  settlement.
- Ensure settlement and claim instructions only accept terminal `RESOLVED` or
  `CANCELLED`.
- Keep `PROPOSED` and `CHALLENGED` fail-closed for settlement and quoting.
- Add explicit order semantics matching EVM: `GTC`, `IOC`, `post-only`,
  deterministic bounded continuation, and remainder handling.
- Implement protocol-level `cancel-taker` STP with the same telemetry contract
  as EVM.
- Add exploit and regression coverage for premature settlement, challenge
  bypass, stale-state transitions, self-trade attempts, cancel-replace paths,
  and claim/refund abuse.

### Do Not Touch

- Shared lifecycle defaults in the chain registry
- EVM order semantics
- AVAX registry or proof docs

### Prove It

- `bun run --cwd packages/hyperbet-solana anchor:test`
- `bun run ci:gate:solana:build`
- `bun run ci:gate:solana`
- `bun run --cwd packages/market-maker-bot smoke:runtime:solana`

### Handoff

- Solana program PR with updated tests
- Note of any IDL changes that downstream packages must consume
- Gate checklist showing which `16` / `17B` / `21` merge criteria are now closed

## Engineer 3: Integration Owner, Shared Contract, and Parity

### Own This

- Shared lifecycle contract
- Cross-chain parity
- Gate `22`
- Nightly integration

### Start Here

- `packages/hyperbet-chain-registry/src/index.ts`
- `packages/hyperbet-ui/src/lib/predictionMarkets.ts`
- `packages/hyperbet-ui/src/lib/predictionMarketUiState.ts`
- `packages/hyperbet-bsc/keeper/src/service.ts`
- `packages/hyperbet-solana/keeper/src/service.ts`
- `packages/hyperbet-avax/keeper/src/service.ts`
- `.github/workflows/prediction-market-gates.yml`

### Implement

- Maintain the shared lifecycle contract for `OPEN`, `PROPOSED`, `CHALLENGED`,
  `RESOLVED`, and `CANCELLED`.
- Keep `/api/arena/prediction-markets/active` stable at the top level.
- Ensure all producers and consumers agree on reserved metadata keys:
  - `proposalId`
  - `challengeWindowEndsAt`
  - `finalizedAt`
  - `cancellationReason`
- Update every consumer to interpret quotable vs terminal states the same way.
- Add parity coverage for identical lifecycle traces across Solana, BSC, and
  AVAX.
- Define the final required CI check set for Gate `22`.
- Run nightly integration against the sprint base and refuse merges that drift
  the frozen contract.

### Do Not Touch

- Core EVM protocol semantics beyond shared-type or parity plumbing
- Core Solana protocol semantics beyond shared-type or parity plumbing
- MM durable storage design

### Prove It

- `bun test` in `packages/hyperbet-chain-registry`
- `bun test --preload ./tests/setup.ts` in `packages/hyperbet-ui`
- `bunx vitest run` in `packages/market-maker-bot`
- `bun run ci:gate:base`

### Handoff

- Shared-model PRs
- Parity test PR
- Written Gate `22` required-check contract in
  `docs/release/gate-22-required-check-contract.md`
- Nightly integration checklist attached to the integration branch

## Engineer 4: MM Durability and Adversarial Proof

### Own This

- Gate `18`
- Adversarial pass/fail contract

### Start Here

- `packages/market-maker-bot/src/index.ts`
- `packages/market-maker-bot/src/adversarial/suite.ts`
- `packages/market-maker-bot/src/adversarial/index.ts`
- `packages/simulation-dashboard/src/scenario-catalog.ts`
- `docs/runbooks/quote-disablement-and-safe-restart.md`
- `docs/runbooks/claim-backlog-drainage.md`

### Implement

- Move authoritative MM state out of in-memory arrays and into managed Postgres.
- Create a storage layer under `packages/market-maker-bot/src/storage/` and keep
  quote logic isolated from raw SQL.
- Implement canonical tables:
  - `orders`
  - `order_events`
  - `reconciliation_cursors`
  - `claim_backlog`
  - `outbox`
- Add startup reconciliation from on-chain truth plus persisted intent.
- Add orphan-order sweeps, claim-backlog sweeps, and deterministic restart
  recovery drills.
- Rewrite adversarial pass/fail so it enforces hard budgets for attacker PnL,
  toxic fill rate, drawdown, exploit events, stale-quote uptime, orphan orders,
  reconciliation lag, and unresolved claim backlog.
- Add missing scenarios for restart mid-fill, orphan sweep failure, RPC split
  brain, nonce collision/replay, reorg/finality lag, rounding abuse, fee-token
  depletion, and cross-market inventory bleed.

### Do Not Touch

- Frozen lifecycle semantics
- AVAX registry truth
- EVM or Solana matching rules except where the MM must consume them

### Prove It

- `bunx vitest run` in `packages/market-maker-bot`
- `bun run market-maker:simulate:adversarial`
- `bun run market-maker:simulate:adversarial:ci`

### Handoff

- MM storage PR
- Recovery drill artifact set
- Adversarial suite PR with the new budget contract documented
- Gate checklist showing which `18` merge criteria are now closed

## Engineer 5: AVAX Canonicalization, Governance, and Launch Evidence

### Own This

- Gates `19`, `20`, `23`, and `24`
- Gate `14A` execution

### Start Here

- `packages/hyperbet-chain-registry/src/index.ts`
- `packages/hyperbet-avax/deployments/index.ts`
- `packages/hyperbet-avax/keeper/src/service.ts`
- `scripts/staged-live-proof.ts`
- `.github/workflows/staged-live-proof.yml`
- `docs/runbooks/staged-live-proof.md`
- `docs/release/release-memo-template.md`
- `docs/release/external-audit-package-checklist.md`

### Implement

- Commit canonical AVAX production addresses into the shared registry and remove
  env-only production truth.
- Make AVAX deploy manifests, env audit, runtime smoke, and staged-proof
  support match BSC and Solana.
- Prepare governance and emergency controls without changing frozen settlement or
  order semantics:
  - multisig ownership
  - timelocked non-emergency actions
  - scoped pause surfaces
  - separated reporter/challenger/finalizer/emergency powers
- Run Gate `14A` in the correct order:
  - read-only proof first
  - canary-write second
  - preserve artifacts for final release signoff
- Build the Gate `23` evidence package and Gate `24` audit package in parallel
  with feature development.

### Do Not Touch

- Frozen lifecycle semantics
- STP policy
- MM storage authority

### Prove It

- `bun test` in `packages/hyperbet-chain-registry`
- `bun run build:avax`
- `bun run staged:proof -- --mode=read-only --target=avax`
- `bun run staged:proof -- --mode=canary-write --target=avax`

When live env and secrets are available:

- capture AVAX proof artifacts
- attach runtime smokes and env audit outputs

### Handoff

- AVAX registry/deploy PR
- Governance-control PR
- Staged-proof artifact package
- Updated release memo and audit checklist

## Merge Order

- Engineer 3 merges shared-model and consumer contract changes first.
- Engineers 1 and 2 merge protocol changes after Engineer 3 confirms the shared
  contract still holds.
- Engineer 4 merges MM durability after the shared lifecycle contract is stable.
- Engineer 5 merges AVAX and evidence work independently, then lands governance
  control wiring after protocol surfaces stabilize.
