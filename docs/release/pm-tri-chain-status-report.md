# PM Tri-Chain Status Report

## Context

- Base branch: `audit/develop-pm-hardening`
- Report branch: `enoomian/pm-trichain-report`
- Date: 2026-03-27
- Scope: summarize the current prediction-market rollout posture across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`, then explain the approach and current status for `PM + perps + internal AMM`.

## Executive Summary

Prediction-market work is no longer in a single-chain or PM-only posture.
On this branch, the system is being treated as a tri-chain phase-1 product:

- `PM/CLOB duels` as the primary user-facing launch surface
- `perps/models` as the second user-facing launch surface
- `AMM` as an internal launch-critical liquidity surface

The PM side is materially advanced on all three non-mainnet chains and already has supporting deployment, verification, and browser acceptance evidence. The remaining work on this branch is no longer basic PM-core development. It is the integration and closeout work around AMM, perps, staged proof, staged soak, and final governance/evidence completion.

## What We Have Done For PM

### 1. PM-core hardening landed on the active implementation branch

Per the release tracker, the repo-side work already merged on `audit/develop-pm-hardening` includes:

- PM-core hardening for oracle finality
- order semantics hardening
- governance freeze and protocol guardrails
- launch-scope registry gating for the real launch chains

Primary source:

- [prediction-market-launch-freeze-tracker.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/prediction-market-launch-freeze-tracker.md)

### 2. Tri-chain non-mainnet PM rehearsal is defined and wired

The off-mainnet rehearsal scope is explicitly:

- `Solana devnet`
- `BSC testnet`
- `AVAX Fuji`

The release and ops docs treat these three lanes as the launch-blocking rehearsal surface, with `Base` removed from phase-1 blocking scope.

Primary sources:

- [prediction-market-launch-freeze-tracker.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/prediction-market-launch-freeze-tracker.md)
- [testnet-operations-ledger.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/testnet-operations-ledger.md)

### 3. Testnet/devnet evidence already exists for PM bring-up

The Stage-A execution ledger records the concrete non-mainnet operational bring-up:

- new Stage-A wallet set created locally under `keys/stage-a/`
- new deployers funded for Solana, BSC, and AVAX
- fresh non-mainnet collateral tokens created on BSC and AVAX where needed for broader rehearsal
- Solana devnet full-product deployment/init/freeze/verification recorded as complete under the Stage-A wallet set
- BSC and AVAX PM-core plus perps deployment recorded under the new Stage-A wallet set

Primary source:

- [stage-a-promotion-execution-ledger.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/stage-a-promotion-execution-ledger.md)

### 4. PM browser acceptance evidence exists across all three chains

The Stage-A browser acceptance matrix shows the synthetic non-mainnet browser lane is already live against deployed Stage-A chains:

- BSC: live PM flows passing
- AVAX: live PM flows passing
- Solana: live PM flows passing, with the matured winner-claim lane explicitly separated because it is time-gated by protocol timing

Covered PM behaviors include:

- fresh/open market interaction
- YES and NO order placement
- keeper recovery
- cancel and refund
- Solana lifecycle shell and cancellation/refund flows

Primary source:

- [stage-a-browser-acceptance-matrix.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/stage-a-browser-acceptance-matrix.md)

## Tri-Chain Evidence Snapshot

### Solana devnet

- PM is part of a deployed and verified Stage-A path on devnet.
- Browser acceptance covers PM lifecycle shell, order placement, restart recovery, and cancelled-duel refund.
- The remaining PM-adjacent browser gap is the intentionally time-gated matured winner-claim lane.

### BSC testnet

- PM is deployed on the Stage-A chain with live market-flow/browser evidence.
- Browser evidence proves live PM creation, order placement, recovery, cancellation, and refund behavior.
- The PM lane is real-chain backed, not mocked.

### AVAX Fuji

- PM is deployed on the Stage-A chain with the same live PM flow coverage shape as BSC.
- Browser evidence covers live market creation, order placement, recovery, cancellation, and refund.

## Approach We Took For PM + AMM + Perps

This branch does not treat AMM and perps as side experiments outside PM. The approach is to prove the full phase-1 product together:

1. Keep proof scope coupled across `pm`, `perps`, and `amm`
2. Reuse shared deployment truth and registry-shaped receipts
3. Keep Solana and EVM verification rails aligned to full-product scope
4. Use local-first bring-up, then staged proof, then soak for closeout

The supporting repo work already landed for that approach includes:

- oracle-only AMM settlement on EVM and Solana
- Solana perps pause preserved after freeze
- Solana full-product deploy/init/freeze/verify rails extended to include AMM
- canonical EVM receipt writing for PM, AMM, and perps
- staged proof canary wiring for `pm`, `perps`, and `amm`
- soak workflow wiring for the same launch-scope surfaces

Primary sources:

- [prediction-market-launch-freeze-tracker.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/prediction-market-launch-freeze-tracker.md)
- [launch-ops-evidence-index.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/launch-ops-evidence-index.md)

## Where PM-AMM And Perps Stand On This Branch

### PM

- PM-core is the most mature part of the launch scope.
- The tri-chain non-mainnet lanes, ops docs, and browser evidence are already centered around PM as a real deployed surface.
- The remaining PM work is mostly acceptance and launch-closeout work, not core protocol construction.

### Perps

- Perps are already treated as launch-scope, user-facing functionality under the `models` / `agents` surface.
- BSC and AVAX Stage-A deployment status includes perps on-chain bring-up.
- Solana browser coverage already includes perps open/close flows.
- The remaining work is not “whether perps exists”; it is raising non-mainnet proof depth and finishing staged proof/soak plus live-duel acceptance.

### AMM

- AMM is intentionally treated as internal launch-critical infrastructure, not as a browser acceptance surface.
- The repo-side wiring for AMM is already part of full-product deployment, verification, registry, and staged-proof design.
- On this branch, the main honest blocker is still the EVM AMM `Router` size issue called out in the Stage-A promotion ledger.

## Honest Current Blockers

From the release tracker, testnet ledger, launch evidence index, and Stage-A execution ledger, the current blockers on this branch are:

- truthful launch-chain canonical registry population is still incomplete
- GitHub `staging` environment and `HYPERBET_*_STAGING_*` vars/secrets are not yet provisioned
- local BSC/AVAX AMM and perps rehearsal still depends on shared token/address inputs being fully provisioned in the expected paths
- staged proof artifact bundle does not exist yet
- staged soak artifact bundle does not exist yet
- governance transfer, freeze receipts, signer closeout, and final audit packet are still open
- EVM AMM deployment remains blocked on `Router` size as compiled in the current Stage-A ledger state

## Recommended Reading Order

For reviewers who want the shortest path through the evidence:

1. [prediction-market-launch-freeze-tracker.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/prediction-market-launch-freeze-tracker.md)
2. [testnet-operations-ledger.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/testnet-operations-ledger.md)
3. [stage-a-promotion-execution-ledger.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/stage-a-promotion-execution-ledger.md)
4. [stage-a-browser-acceptance-matrix.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/stage-a-browser-acceptance-matrix.md)
5. [launch-ops-evidence-index.md](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/docs/release/launch-ops-evidence-index.md)

## Bottom Line

The right expert reading of `audit/develop-pm-hardening` is:

- prediction-market work is already in a tri-chain non-mainnet proving posture
- PM is the most mature and best-evidenced surface
- perps are integrated into the launch shape and already partially proven on live non-mainnet lanes
- AMM is designed into the same launch shape, but still carries an honest EVM deployment blocker plus staged-proof closeout work
- the remaining work is launch-integration and evidence closeout, not a return to PM-core design
