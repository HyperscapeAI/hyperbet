# Contract Privileged Surface Inventory

> **TL;DR:** EVM governance permanently frozen via `GovernanceSurfaceFrozen` on all setters + `grantRole`/`revokeRole` override (only PAUSER_ROLE mutable). Solana config freezable one-way via `freeze_oracle_config`/`freeze_config`. Both initializers are one-time only (`AlreadyInitialized` on re-call). Pause controls remain functional after freeze on both chains.

This document tracks mutable privileged surfaces for the prediction-market launch scope and their current guardrails.

## EVM: `packages/evm-contracts/contracts/DuelOutcomeOracle.sol`

- `setReporter` / `setFinalizer` / `setChallenger`: `DEFAULT_ADMIN_ROLE`, now
  immutable in PM20 (`GovernanceSurfaceFrozen` on any setter call post-deploy)
- `setPauser` / `setOraclePaused`: `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` respectively
- `upsertDuel` / `proposeResult` / `challengeResult` / `finalizeResult`: role-gated as defined in the contract
- `cancelDuel`: **`PAUSER_ROLE`** (emergency/finality control path)

## EVM: `packages/evm-contracts/contracts/GoldClob.sol`

- `setOracle` / `setTreasury` / `setMarketMaker` / `setFeeConfig`: `DEFAULT_ADMIN_ROLE`, now
  immutable in PM20 (`GovernanceSurfaceFrozen` on any setter call post-deploy)
- `setMarketCreationPaused` / `setOrderPlacementPaused`: `PAUSER_ROLE`
- `syncMarketFromOracle`, `createMarketForDuel`, `placeOrder`, `claim`: caller/market state and lifecycle checks; not role-admin paths

## SVM: `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs`

- `initializeOracle`: upgrade-authority constrained, one-time only (`AlreadyInitialized` on re-call). No bootstrap fallback — `init_if_needed` pattern removed.
- `updateOracleConfig`: `authority` signer; authority key is immutable; blocked by `config_frozen` after `freeze_oracle_config`
- `freezeOracleConfig`: `authority` signer; one-way permanent freeze of all config updates
- `setOraclePaused`: `authority` signer; emergency pause/unpause (functional even after freeze)
- `reproposeResult`: `reporter` signer; resolution path for challenged duels
- `upsert_duel`: oracle `reporter`
- `challenge_result`: oracle `challenger`
- `cancel_duel` / `finalize_result`: oracle `authority` / `finalizer` as configured

## SVM: `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs`

- `initialize_config`: upgrade-authority constrained, one-time only (`AlreadyInitialized` on re-call). No bootstrap fallback — `init_if_needed` pattern removed.
- `update_config`: `authority` signer; authority key is immutable; blocked by `config_frozen` after `freeze_config`
- `freezeConfig`: `authority` signer; one-way permanent freeze of all config updates
- `setMarketPaused`: `authority` signer; emergency pause/unpause for order placement and market creation (functional even after freeze)
- `initialize_market`: market operator or config authority
- `place_order`, `cancel_order`, `claim`, `sync_market_from_duel`, `initialize_market`: state-transition guards and policy checks on each invocation

## Governance evidence

- Role owner and privileged mutators are now intentionally frozen by PM20 policy.
- Any role owner change requires tracked PR evidence through the lane-specific release docs.
- This inventory is updated as part of Gate `20` and `22` handoff.
