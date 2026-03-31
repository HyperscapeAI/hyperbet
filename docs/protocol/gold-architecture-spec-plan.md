# Gold Architecture Spec Plan

> **TL;DR:** Phase-1 launch does not need a fully solved cross-chain Gold asset
> system, but the product does need a formal Gold architecture spec before it
> can honestly claim `1:1` backing between Hyperscapes in-game Gold, Solana
> Gold, and any future EVM representation. This plan defines what that spec must
> answer, what invariants it must guarantee, and what implementation tracks will
> follow from it.

## Purpose

This document is the planning frame for the future `Gold Architecture Spec`.
Its job is to force one coherent answer to:

- what Gold is
- where Gold is canonical
- who can mint and burn it
- how redemption works
- how cross-chain representations work
- what is live in phase-1 versus deferred

This is a planning document, not the final spec.

## Why A Separate Gold Spec Is Needed

The current repos already show real Gold-related behavior, but not one unified
cross-chain asset model:

- Hyperscapes game logic has in-game Gold plus `HyperGold`
- Hyperbet Solana carries `goldMint`
- EVM launch protocols do not fundamentally require Gold
- some EVM env/schema/workflow fields still imply a distinct EVM Gold token

Without a single architecture spec, product claims can drift faster than code
and audit evidence.

## Non-Goals

This spec plan is not trying to redesign phase-1 launch collateral, AMM math,
or perps margining.

It should not force:

- PM/CLOB to switch to Gold settlement
- AMM to stop using designated collateral tokens
- perps to stop using explicit margin tokens
- phase-1 launch to wait for a bridge or tokenomics redesign

## Required Spec Decisions

The final Gold Architecture Spec must answer the following decisively.

### 1. Canonical asset definition

Define the exact relationship between:

- Hyperscapes in-game Gold
- Hyperscapes `HyperGold`
- Hyperbet Solana `goldMint`
- any future BSC Gold representation
- any future AVAX Gold representation

The spec must say whether these are:

- one canonical asset plus wrapped forms
- two different assets with a peg model
- one offchain/game ledger plus one onchain redeemable token

### 2. Canonical issuance domain

Choose the source of truth for supply:

- game ledger is canonical
- Solana mint is canonical
- another issuance service or treasury is canonical

One canonical source must exist. Without that, `1:1` backing is only a claim.

### 3. Mint / burn authority model

The spec must define:

- which actor can mint
- which actor can burn
- what evidence authorizes minting
- what evidence authorizes burning
- whether minting is synchronous, batched, or operator-mediated
- emergency pause / circuit-breaker behavior

### 4. Redemption model

The spec must describe exact user flows for:

- game Gold -> Solana Gold
- Solana Gold -> game Gold
- Solana Gold -> EVM Gold
- EVM Gold -> Solana Gold
- if EVM redemption is not supported in phase-1, the spec must say so plainly

### 5. Cross-chain representation model

If Gold is portable to EVM, the spec must choose one model:

- canonical Solana Gold with bridged wrappers on EVM
- canonical game-issued HyperGold with mirrored representations
- synthetic EVM Gold backed by treasury inventory

It must also name the bridge or transport trust model explicitly.

### 6. Accounting and reserve invariants

The spec must define hard invariants such as:

- total issued claims never exceed canonical supply
- wrapped supply on all non-canonical chains never exceeds locked or reserved
  canonical Gold
- burns and unlocks reconcile exactly
- game-side credits and onchain liabilities stay within defined tolerances or
  halt the system

### 7. Operational controls

The spec must define:

- signer policy
- treasury custody
- reserve attestation cadence
- bridge pause / mint pause / redeem pause controls
- incident response when reconciliation fails
- acceptable operator discretion, if any

### 8. User-facing product semantics

The spec must say what Gold means to users on each surface:

- in-game reward balance
- withdrawable token
- tradable asset
- collateral asset
- reward / loyalty asset

These are not the same thing and should not be conflated.

### 9. Chain-by-chain phase support

The spec must explicitly mark:

- what Gold supports on `Solana` in phase-1
- what Gold supports on `BSC` in phase-1
- what Gold supports on `AVAX` in phase-1
- what remains intentionally unsupported until a later phase

## Recommended Interim Product Posture

Until the final spec is implemented:

- `Solana Gold` should be treated as the only meaningful onchain Gold surface
- EVM launch products should continue using native assets or designated
  collateral tokens
- EVM Gold should not be treated as a required protocol primitive
- any EVM `goldTokenAddress` usage should be documented as compatibility alias
  behavior, not proof of a mature Gold rollout

This keeps phase-1 honest while preserving a path to a real multi-chain Gold
design later.

## Required Implementation Tracks After The Spec

Once the architecture spec is approved, implementation will likely split into
separate tracks:

### Track A — Asset model cleanup

- rename misleading EVM Gold fields where they are only margin-token aliases
- update chain-registry and verification semantics
- align docs and runbooks with the real Gold model

### Track B — Issuance and redemption

- implement mint/burn authority flows
- implement reserve or lock/unlock accounting
- implement redemption APIs / operator tooling

### Track C — Cross-chain representation

- implement wrapped-token or bridge mechanics
- add reconciliation and monitoring
- add chain-specific custody / pause controls

### Track D — Audit and evidence

- formal invariants
- unit / integration / adversarial tests
- reconciliation proofs
- operational runbooks
- external audit scope for Gold-specific mechanisms

## Exit Criteria For The Final Spec

The future Gold Architecture Spec is complete only when it includes:

- canonical terminology
- canonical supply source
- issuance and burn rules
- redemption rules
- chain-by-chain support table
- reserve/reconciliation invariants
- operator and emergency controls
- audit scope and test requirements
- explicit statement of what phase-1 does and does not support

## Related Documents

- [Gold current state](gold-current-state.md)
- [Prediction market release prep](../prediction-market-release-prep.md)
- [System design alignment](../system-design-alignment.md)
