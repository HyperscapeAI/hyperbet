# Prediction-Market Governance And Emergency Controls

This runbook documents the intended real-funds authority model for the EVM
prediction-market contracts and the operator actions allowed under that model.

## Governance Model

- Non-emergency admin authority lives behind the committed `timelockAddress`.
- The timelock is expected to be owned by the recorded `multisigAddress`.
- Emergency pause authority lives behind the committed
  `emergencyCouncilAddress`.
- Operational roles stay separate:
  - `reporterAddress`
  - `finalizerAddress`
  - `challengerAddress`
  - `marketOperatorAddress`

## Scoped Emergency Controls

- `DuelOutcomeOracle` emergency pause blocks:
  - duel upserts
  - proposal writes
  - challenge writes
  - finalization writes
  - duel cancellation writes
- `GoldClob` emergency pause blocks:
  - new market creation
  - new order placement
- Emergency pause does **not** block:
  - reads
  - market sync
  - canceling an already-resting order
  - claim or refund cleanup

## PM20 Governance Freeze (Setters + Authority)

- `DuelOutcomeOracle` and `GoldClob` keep governance and market-routing fields immutable after bootstrap on this branch:
  - `setReporter`, `setFinalizer`, `setChallenger`
  - `setOracle`, `setTreasury`, `setMarketMaker`, `setFeeConfig`
- Solana `initialize_oracle` and `initialize_config` read and lock to the upgrade
  authority when authority is unset. `update_oracle_config` and `update_config`
  require matching authority and do not permit authority reassignment.
- Emergency controls stay mutable for recovery:
  - `setPauser`
  - `setOraclePaused`
  - `setMarketCreationPaused`
  - `setOrderPlacementPaused`

## When To Use Emergency Pause

- oracle compromise or suspicious result publication
- market-operator compromise
- keeper/proxy behavior creating unsafe write pressure
- chain instability that makes new writes unsafe while cleanup must remain open

## Emergency Response Steps

1. Record the exact UTC time, chain, commit, and triggering symptom.
2. Halt new writes:
   - `DuelOutcomeOracle.setOraclePaused(true)`
   - `GoldClob.setMarketCreationPaused(true)`
   - `GoldClob.setOrderPlacementPaused(true)`
3. Confirm read surfaces remain healthy:
   - keeper `/status`
   - `/api/arena/prediction-markets/active`
   - `verify:chains`
4. Decide whether the event is:
   - temporary incident, keep cleanup paths open
   - signer compromise, rotate affected role keys before unpausing
   - market-integrity failure, cancel impacted duels and drive refunds
5. Before unpausing, attach:
   - incident summary
   - tx hashes for every pause/unpause action
   - verification outputs after mitigation

## Reviewable Evidence

- deployment receipt with `timelockAddress`, `multisigAddress`, and
  `emergencyCouncilAddress`
- role assignment txs or constructor args for reporter/finalizer/challenger
- pause/unpause tx hashes
- post-incident verification output
