# PM Tri-Chain Status Report

## Context

- Base branch: `audit/develop-pm-hardening`
- Report branch: `enoomian/pm-trichain-report`
- Scope: `PM/CLOB duels + perps/models + internal AMM` across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`

This branch is the external handoff view of the current phase-1 non-mainnet posture. It contains the reviewer-facing status summary, the detailed evidence tracker, and audience-specific summaries for circulation.

Supporting evidence is presented in two forms:

- documented evidence in this branch
- referenced supporting artifacts listed in the tracker

Detailed inventory:

- [pm-tri-chain-evidence-tracker.md](pm-tri-chain-evidence-tracker.md)
- [pm-tri-chain-summaries.md](pm-tri-chain-summaries.md)

## Current Position

Prediction-market work is already operating in a tri-chain proving posture. The launch scope being exercised on this branch is:

- `PM/CLOB duels`
- `perps/models`
- `AMM` as the internal liquidity surface

PM is the most mature surface in that stack. It already has documented deployment, operational, and browser acceptance evidence across the three non-mainnet lanes. Perps is part of the same launch shape and is materially advanced. AMM is part of the same architecture and proof model, but it still has remaining release requirements before closeout.

## What Has Been Completed For PM

The branch evidence shows four concrete outcomes for PM:

1. PM-core hardening is already merged into the active implementation branch, including oracle finality, order semantics, governance freeze, and protocol guardrails.
2. The launch-blocking non-mainnet rehearsal scope is already defined across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`.
3. The Stage-A execution record already captures chain bring-up, funding, deployment activity, and PM-related transaction history.
4. Browser acceptance evidence already exists for live PM flows on all three non-mainnet lanes.

Primary references:

- [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
- [testnet-operations-ledger.md](testnet-operations-ledger.md)
- [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md)
- [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md)

## Tri-Chain Evidence By Chain

### Solana devnet

Documented evidence in this branch shows that Solana has:

- recorded Stage-A deployment, initialization, freeze, and verification activity
- PM browser coverage for lifecycle shell, order placement, restart recovery, and cancelled-duel refund
- documented deploy and freeze signatures in the evidence tracker

Referenced supporting artifacts are tracked separately in the evidence tracker. Remaining release requirements for the Solana lane include staged proof, staged soak, final launch configuration closeout, and the remaining time-dependent winner-claim scenario.

### BSC testnet

Documented evidence in this branch shows that BSC has:

- recorded PM-core deployment activity
- recorded perps deployment activity
- documented browser evidence for live PM flows, including recovery, cancellation, and refund behavior

Referenced supporting verification outputs and chain support files are listed in the evidence tracker. Remaining release requirements for BSC include staged proof, staged soak, governance closeout, final launch configuration capture, and attachment of the supporting verification bundle outside the branch summary itself.

### AVAX Fuji

Documented evidence in this branch shows that AVAX has:

- recorded PM-core deployment activity
- recorded perps deployment activity
- documented live PM/browser coverage through the branch evidence set

Referenced supporting verification outputs and chain support files are listed in the evidence tracker. Remaining release requirements for AVAX match the same closeout class as BSC: staged proof, staged soak, governance completion, final launch configuration capture, and supporting verification attachment.

## PM, Perps, And AMM Approach

The delivery approach on `audit/develop-pm-hardening` is not PM-only. The branch evidence shows a single phase-1 product model:

1. prove `pm`, `perps`, and `amm` together
2. use shared deployment truth and registry-shaped receipts
3. keep Solana and EVM verification paths aligned to full-product scope
4. move from non-mainnet bring-up into staged proof and staged soak for release closeout

Documented work already in branch sources includes:

- oracle-based AMM settlement on EVM and Solana
- Solana perps pause preserved after freeze
- Solana full-product deploy, init, freeze, and verify paths extended to include AMM
- canonical EVM receipt writing for PM, AMM, and perps
- staged proof and soak wiring aimed at the same full launch scope

Primary references:

- [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
- [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

## Current Blockers And Next Requirements

For release-readiness decisions, this branch follows:

1. [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
2. [testnet-operations-ledger.md](testnet-operations-ledger.md)
3. [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

Those sources still show these remaining release requirements:

- canonical launch-chain mainnet truth is incomplete
- GitHub `staging` and the required `HYPERBET_*_STAGING_*` variables and secrets are not yet provisioned
- staged proof has not yet been captured as a branch-attached evidence set
- staged soak has not yet been captured as a branch-attached evidence set
- governance transfer, freeze receipts, signer closeout, and final audit package items remain open
- BSC and AVAX supporting token and address inputs still need to be fully reconciled in the release-readiness materials

The Stage-A execution ledger contains additional operational detail and supporting references beyond the release-readiness trackers. The evidence tracker preserves that detail without overstating it as final closeout.

## Bottom Line

PM is already in a real tri-chain proving posture. Perps is integrated into the same launch shape and materially advanced. AMM is part of the same system design and evidence model, but it is not yet release-complete.

This branch is intended to make that position clear to readers who were not involved in the implementation history. It packages:

- a clean external status report
- a detailed evidence tracker
- short branch-ready summaries for team and project-owner communication
