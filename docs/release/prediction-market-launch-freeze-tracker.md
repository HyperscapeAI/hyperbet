# Prediction-Market Launch Freeze Tracker

> **TL;DR:** The repo now carries phase-1 full-product plumbing for `PM/CLOB duels + perps/models + internal AMM`, but the release train is still not deploy-only. The remaining blockers are truthful launch-chain registry population, staged environment provisioning, shared non-mainnet token/address inputs, governance/evidence closeout, and the frozen audit packet plus external audit/remediation cycle.

Last updated: 2026-03-25

## Current Position

- Active implementation train: `audit/develop-pm-hardening`
- Launch-blocking chains: `solana`, `bsc`, `avax`
- Non-blocking add-chain lane: `base`
- Launch-scope off-mainnet rehearsal: `solana devnet`, `bsc testnet`, `avax fuji`
- User-facing launch surfaces:
  - `PM/CLOB duels`
  - `perps/models`
- Internal launch-critical surface:
  - `AMM`

## Repo-Side Work Already Landed

- PM-core hardening for oracle finality, order semantics, governance freeze,
  and protocol guardrails
- oracle-only AMM settlement on EVM and Solana
- Solana perps pause preserved after freeze
- Solana full-product deploy, init, freeze, and verify rails now include AMM
- canonical EVM receipt writing for PM, AMM, and perps
- launch-scope staged proof canary results for `pm`, `perps`, and `amm`
- local Stage-A runner plus staged proof and soak workflow wiring
- launch-scope registry gating with `base` removed from phase-1 blocking scope

## Remaining Blockers

### 1. Canonical launch-chain mainnet truth is still incomplete

Current missing launch-truth fields:

- `solana`
  - `goldAmmMarketProgramId`
- `bsc`
  - `goldAmmRouterAddress`
  - `mUsdTokenAddress`
  - `goldTokenAddress`
  - `skillOracleAddress`
  - `perpEngineAddress`
- `avax`
  - PM-core canonical fields
  - AMM canonical fields
  - perps canonical fields
  - governance and operator addresses from final receipts

### 2. Staged proof and staged soak are blocked on provisioning

Audited GitHub state as of 2026-03-25:

- deploy and testnet repo secrets exist
- no GitHub `staging` environment exists
- no `HYPERBET_*_STAGING_*` vars or secrets are provisioned

That means staged proof and soak are structurally ready but operationally
blocked.

### 3. Local Stage-A is waiting on shared token and address inputs

Still missing for honest BSC and AVAX AMM/perps rehearsal:

- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `AVAX_FUJI_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- `AVAX_FUJI_GOLD_TOKEN_ADDRESS`
- optional perps margin token addresses when margin is not the GOLD token

### 4. Governance and audit evidence are still open

Still required:

- governance transfer receipts
- freeze receipts
- signer and key-rotation closeout
- staged proof artifact bundle
- staged soak artifact bundle
- RC freeze manifest
- external audit and remediation outputs

## Ordered Next Steps

1. Provision the missing shared testnet token and address inputs.
2. Run local Stage-A bring-up and verification.
3. Create the GitHub `staging` environment and load all required staged vars
   and secrets.
4. Run staged proof for `pm`, `perps`, and `amm`.
5. Run staged soak and archive the artifact bundle.
6. Populate launch-chain mainnet registry truth from final receipts only.
7. Complete governance transfer and freeze evidence.
8. Freeze the RC and hand off the audit packet.
