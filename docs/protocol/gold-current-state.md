# Gold Current State

> **TL;DR:** `Gold` is currently a real product concept, but not yet a clean
> cross-chain protocol primitive. In Hyperscapes, it is the native in-game
> earned asset and is mirrored into an ERC20-style `HyperGold` surface. In
> Hyperbet, Solana still carries a `goldMint` surface, but the phase-1 launch
> protocols themselves settle in native assets or dedicated collateral tokens,
> not in a canonical cross-chain Gold token. As of the current launch branch,
> Gold is not blocking `PM/CLOB`, `AMM`, `perps`, or market-maker audit
> readiness. The missing work is a separate Gold architecture and issuance /
> redemption spec, not a phase-1 launch-critical protocol fix.

## Purpose

This document records the current shared understanding of what `Gold` means
across `Hyperscapes` and `Hyperbet`, what is already implemented, what is not
yet true, and what remains intentionally out of the phase-1 launch-critical
surface.

It is a clarification document for release, audit, and architecture work. It
does not override chain-registry truth, deployment manifests, or live contract
behavior.

## Working Product Understanding

The intended product story is:

- `Hyperscapes Gold` is the native in-game earned asset for users and agents.
- `Solana Gold` is intended to be the canonical onchain representation of that
  asset.
- The long-term desired model is a `1:1` relationship between in-game Gold and
  canonical onchain Gold.

That intended model is useful, but it is not yet fully expressed as one clean,
auditable, cross-chain protocol architecture in the current repos.

## What Exists Today

### 1. Hyperscapes has a real game-side Gold model

The Hyperscapes repo already models Gold as an in-game asset with an onchain
ERC20-style mirror:

- [`GoldSystem.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.worktrees/hyperscapes-main-sync/packages/contracts/src/systems/GoldSystem.sol)
  manages in-game Gold plus `HyperGold` mint/burn/sync behavior.
- [`CombatResultSystem.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.worktrees/hyperscapes-main-sync/packages/contracts/src/systems/CombatResultSystem.sol)
  updates in-game Gold balances from duel outcomes.
- [`InventorySystem.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.worktrees/hyperscapes-main-sync/packages/contracts/src/systems/InventorySystem.sol)
  also mutates in-game Gold balances.

So the game side already treats Gold as a real earned asset, not just UI copy.

### 2. Hyperbet Solana still carries a Gold surface

Hyperbet Solana still has a meaningful `goldMint` surface in runtime config,
public-test setup, and price plumbing:

- [`config.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/src/lib/config.ts)
- [`setup-public.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/tests/e2e/setup-public.ts)
- [`birdeye.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-ui/src/lib/birdeye.ts)
- [`index.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-chain-registry/src/index.ts)

This means Gold is not imaginary in Hyperbet. It exists as a configured Solana
asset surface.

### 3. The phase-1 launch protocols do not currently settle in Gold

This is the most important operational truth.

On Solana:

- prediction-market / CLOB funds and payouts are lamport-native in
  [`gold_clob_market`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs)
- perps are native-SOL isolated markets in
  [`gold_perps_market`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/programs/gold_perps_market/src/lib.rs)
- AMM takes lamports as collateral and mints YES/NO market shares in
  [`lvr_amm`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/programs/lvr_amm/src/instructions/buy.rs)

On EVM:

- prediction-market / CLOB is native-asset funded in
  [`GoldClob.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/contracts/GoldClob.sol)
- AMM uses `mUSD` collateral in
  [`Router.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/contracts/lvr_amm/Router.sol)
  and
  [`deploy-amm.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/scripts/deploy-amm.ts)
- perps use an ERC20 margin token plus `SkillOracle` in
  [`AgentPerpEngine.sol`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/contracts/perps/AgentPerpEngine.sol)
  and
  [`deploy-perps.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/scripts/deploy-perps.ts)

So the current launch product does not rely on Gold as the universal settlement
asset.

## What Gold Is Serving Today

Given the current implementation, Gold is serving four different roles, some
real and some transitional:

- game-native earned asset inside Hyperscapes
- Solana asset/config surface inside Hyperbet
- UI / pricing / wallet metadata surface
- localnet and public-test scaffolding surface

Gold is not yet serving one clean, cross-chain role as:

- universal launch collateral
- universal PM settlement asset
- universal AMM collateral asset
- universal perps margin asset
- provably canonical cross-chain claim with audited mint/burn/redemption rules

## What Gold Is Not Yet

The current repos do **not** yet prove all of the following:

- that Hyperscapes in-game Gold and Hyperbet Solana `goldMint` are the exact
  same canonical asset under one enforceable supply model
- that BSC or AVAX already hold a wrapped or canonical Gold representation
- that there is an implemented `1:1` reserve or redemption mechanism across all
  supported chains
- that a user can trustlessly redeem Gold between game balances, Solana, and
  EVM chains under a single audited issuance model

Until those properties exist in code and operations, Gold should not be
described as a fully solved cross-chain asset system.

## What This Means For Phase-1 Launch

Gold is **not** a blocker for phase-1 audit readiness of:

- `PM/CLOB`
- `AMM`
- `perps`
- `market-maker`
- staged proof
- soak / local validation
- launch-train governance hardening

Why:

- those systems already function with native-asset or dedicated collateral
  flows
- the existing release blockers are deploy truth, staged env provisioning,
  governance evidence, and frozen audit packaging
- the absence of a distinct EVM Gold token does not stop the current launch
  product from functioning

This does **not** mean Gold is unimportant. It means Gold belongs on a parallel
architecture track, not inside the critical path for phase-1 release hardening.

## What We Would Forfeit By Not Solving Gold On EVM Yet

If Gold remains Solana-only in phase-1, we forfeit:

- a clean cross-chain user balance story for Gold
- direct EVM-chain redemption of in-game Gold
- Gold-denominated EVM treasury / incentive / fee flows
- the ability to honestly claim that the same Gold asset is live and portable
  on `Solana`, `BSC`, and `AVAX`

We do **not** forfeit the current launch functions of PM, AMM, perps, and
market making.

## What We Actually Tested Locally

The current local validation proved protocol functionality, not a canonical
cross-chain Gold system.

What we exercised:

- Solana local E2E with a `goldMint` config slot that is treated as legacy
  scaffolding in
  [`setup-localnet.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/tests/e2e/setup-localnet.ts)
- BSC and AVAX local EVM setup with a deployed `Mock Gold` in:
  - [`packages/hyperbet-bsc/app/tests/e2e/setup-evm-local.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-bsc/app/tests/e2e/setup-evm-local.ts)
  - [`packages/hyperbet-avax/app/tests/e2e/setup-evm-local.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-avax/app/tests/e2e/setup-evm-local.ts)
- soak harness deployment of `Mock Gold` plus separate `MockUSD` in
  [`soak-harness.ts`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/soak-harness.ts)
- integrated local runner export of EVM Gold env vars in
  [`run-hyperscapes-pm-local.sh`](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/run-hyperscapes-pm-local.sh)

What we did **not** prove:

- canonical `1:1` backing between in-game Gold and Solana Gold
- cross-chain wrapped Gold correctness
- redemption integrity across Solana and EVM
- reserve/accounting invariants for a unified Gold asset system

## Working Release Position

Until the architecture is specified and implemented:

- treat `Solana Gold` as the only meaningful onchain Gold surface
- treat EVM `goldTokenAddress` fields as compatibility debt, not proof of a
  real separate Gold asset requirement
- do not block phase-1 launch-hardening on EVM Gold issuance
- do not market the cross-chain `1:1` Gold model as an implemented invariant
  unless the issuance, redemption, and accounting design is frozen and audited

## Next Document

The follow-on design artifact is:

- [Gold architecture spec plan](gold-architecture-spec-plan.md)

That document defines the questions, invariants, and implementation work needed
to turn the intended Gold model into a real cross-chain system.
