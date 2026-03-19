# Prediction-Market Test Flow

This runbook defines the correct testing strategy for the current
`Hyperscapes -> Hyperbet -> deployed testnet contracts` stack.

The short answer is:

- use deployed testnets as the canonical chain truth,
- use local Hyperscapes + local keeper + local UI for fast engineering
  integration,
- use staged/deployed surfaces for final signoff,
- do **not** rely on synthetic market bootstrap or unrelated local chain setup
  when proving PM integration.

## Decision

The expert approach for this codebase is a **hybrid testnet-first model**.

That means:

1. BSC Testnet, AVAX Fuji, and Solana devnet remain the canonical PM contract
   and program layer for every serious integration test.
2. Local Hyperscapes and local Hyperbet keeper/UI remain the fastest and most
   debuggable place to prove game-event integration.
3. Fully deployed/staged surfaces are the release-signoff lane, not the only
   engineering lane.

## Why Not "All Local"

All-local is wrong for this stack because:

- the PM contracts/programs we care about are already deployed and verified on
  testnets,
- local synthetic bootstrap can diverge from actual deployed role, registry, and
  freeze state,
- local MUD/anvil bootstrap in the sibling repo is not the source of truth for
  PM behavior.

Use local-only chains for unit tests and isolated contract tests, not for the
system-level PM integration claim.

## Why Not "All Remote"

All-remote is also the wrong default for day-to-day engineering because:

- failures become hard to attribute across game, keeper, UI, and infrastructure,
- privileged writer keys are intentionally not present on every machine,
- iterating on game-event ingestion is much slower when every test depends on
  remote services.

The right split is local runtime surfaces over canonical deployed chain state.

## Recommended Lanes

### Lane 1: Local Integration Read Path

Use this lane for fast engineering validation of the real game integration.

Components:

- Hyperscapes local game/server
- Hyperbet local keeper service
- Hyperbet local UI
- deployed testnets remain the canonical contract layer, but no privileged
  writes are attempted

Use when:

- validating duel lifecycle ingestion
- validating keeper read-model behavior
- validating UI rendering against real duel state
- capturing paired local UI evidence while the duel lifecycle advances
- debugging game -> keeper -> UI issues

Expected state:

- duel moves through `ANNOUNCEMENT`, `LOCKED`, `RESOLUTION`
- Hyperbet UI reflects live duel state
- `markets[]` may remain empty if keeper bot is disabled
- both local UIs open automatically and screenshots are written to
  `output/playwright/hyperscapes-pm-local/`

Runbook:

- [Hyperscapes Local PM Integration](./hyperscapes-local-pm-integration.md)

### Lane 2: Local Integration Write Path Against Testnets

Use this lane when you need the local duel to open, lock, and resolve real PM
markets on deployed BSC/AVAX testnet contracts.

Requirements:

- same local runtime stack as Lane 1
- local access to the already-assigned EVM `REPORTER`, `MARKET_OPERATOR`, and
  `FINALIZER` keys for the deployed testnet PM contracts
  or
- fresh BSC/AVAX testnet deployments owned by keys you control locally

Use when:

- validating duel -> market open
- validating lock timing
- validating result proposal/finalization
- validating claim/refund behavior from locally driven game outcomes

Expected state:

- keeper bot enabled
- `markets[]` populated
- duel lifecycle drives real testnet writes

Important constraint:

- if the deployed testnet governance surface is already frozen to GitHub-held
  testnet roles, a random new local wallet is not enough
- trader wallets and writer wallets are different concerns

### Lane 3: Staged Full-Stack Testnet Signoff

Use this lane for release evidence, not for first-pass debugging.

Components:

- deployed testnet PM contracts/programs
- staged or workflow-driven deployment/verification
- staged keeper/game wiring or GH-held privileged execution

Use when:

- producing Stage A evidence
- proving deployment and governance state
- proving launch-critical flows end to end
- collecting screenshots, tx hashes, verification receipts, and final signoff

Primary docs:

- [PM Launch Execution Plan](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/docs/release/pm-launch-execution-plan.md)
- [Testnet Operations Ledger](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/docs/release/testnet-operations-ledger.md)

## Recommended Order

1. Run contract/program gates and deployment verification.
2. Run Lane 1 to prove the live local Hyperscapes -> keeper -> UI integration.
3. Run Lane 2 only when local writer authority is available or when using fresh
   locally controlled testnet deployments.
4. Run Lane 3 for signoff and evidence capture.

That order keeps engineering fast without letting local assumptions replace
canonical testnet truth.

## What We Should Standardize

For this repo, the standard decision should be:

- **Canonical chain truth:** deployed BSC Testnet, AVAX Fuji, Solana devnet
- **Canonical engineering integration:** local Hyperscapes + local Hyperbet
  keeper/UI over that testnet truth
- **Canonical release signoff:** staged/deployed full-stack testnet lane

## Practical Rule

If the question is "what should the contracts/programs be?", use deployed
testnets.

If the question is "did the game integration actually work?", use local
Hyperscapes + local keeper/UI first.

If the question is "are we ready to sign off?", use the staged full-stack
testnet lane and the release evidence docs.
