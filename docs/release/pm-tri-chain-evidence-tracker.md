# PM Tri-Chain Evidence Tracker

## Current Basis

- Base branch: `audit/develop-pm-hardening`
- Report branch: `enoomian/pm-trichain-report`
- Scope: `PM/CLOB duels + perps/models + internal AMM` across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`

Evidence labels used throughout this tracker:

- `committed evidence in branch`
- `referenced supporting artifact`
- `not yet captured`

Status vocabulary used throughout this tracker:

- `satisfied in committed docs`
- `partially satisfied`
- `supporting evidence referenced`
- `missing`

## Evidence Handling Note

This branch is meant to support external review. It contains documented evidence in the branch and references to supporting materials that are maintained outside the branch itself.

Release-readiness view for this branch follows:

1. [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
2. [testnet-operations-ledger.md](testnet-operations-ledger.md)
3. [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

[stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) contains additional operational detail, transaction history, signatures, and supporting references. Where those operational details go further than the release-readiness materials, this tracker keeps the distinction explicit and treats the release-readiness sources as authoritative until the record is reconciled.

## Evidence Inventory

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| PM-core hardening and tri-chain launch scope documented | satisfied in committed docs | committed evidence in branch | `prediction-market-launch-freeze-tracker.md`, `release-memo-template.md` | N/A | none for branch reporting |
| Tri-chain Stage-A operational history recorded | satisfied in committed docs | committed evidence in branch | `stage-a-promotion-execution-ledger.md` | on-chain tx hashes and Solana signatures recorded in that document | keep aligned with release-readiness materials |
| Local Stage-A verify outputs for Solana, BSC, and AVAX referenced | supporting evidence referenced | referenced supporting artifact | `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/solana-devnet.json`, `.ci-artifacts/stage-a/solana-init-devnet.json`, `.ci-artifacts/stage-a/bscTestnet.json`, `.ci-artifacts/stage-a/avaxFuji.json` | attach outside this branch if required for formal package review |
| Browser acceptance proof for PM and perps surfaces documented | partially satisfied | committed evidence in branch | `stage-a-browser-acceptance-matrix.md`, `stage-a-promotion-execution-ledger.md` | direct canary outputs referenced separately | complete remaining real-duel and time-dependent scenarios |
| Direct canary outputs referenced | supporting evidence referenced | referenced supporting artifact | `stage-a-browser-acceptance-matrix.md`, `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/direct-canaries/{solana,bsc,avax}.json` | attach or publish separately if needed |
| Staged proof bundles | missing | not yet captured | `launch-ops-evidence-index.md`, `external-audit-package-checklist.md` | none present under `.ci-artifacts/staged-live-proof/` | provision staging and run staged proof |
| Staged soak bundles | missing | not yet captured | `launch-ops-evidence-index.md`, `external-audit-package-checklist.md` | none present under `.ci-artifacts/pm-soak/` | provision staging and run staged soak |
| Canonical mainnet registry truth | missing | not yet captured | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | populate from final mainnet receipts |
| Governance transfer and freeze receipt package | partially satisfied | committed evidence in branch | `stage-a-promotion-execution-ledger.md`, `prediction-market-launch-freeze-tracker.md` | Solana freeze transactions recorded; broader governance package remains incomplete | collect full cross-chain governance receipt set |
| Audit handoff attachments | missing | not yet captured | `external-audit-package-checklist.md` | N/A | refresh ABI freeze, residual risk register, and findings ledger |

## Required Items

### Scope And Freeze

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| Launch scope documented in release memo template | satisfied in committed docs | committed evidence in branch | `release-memo-template.md` | N/A | none |
| Launch freeze tracker linked | satisfied in committed docs | committed evidence in branch | `prediction-market-launch-freeze-tracker.md` | N/A | none |
| Final RC branch and commit recorded at freeze time | missing | not yet captured | `external-audit-package-checklist.md` | N/A | record final RC branch and commit at freeze time |
| Freeze manifest regenerated and attached | missing | not yet captured | `external-audit-package-checklist.md`, `manifests/rc-2026-03-audit-handoff-freeze.json` | N/A | regenerate and attach final freeze manifest |

### Non-Mainnet Bring-Up And Proof

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| Local Stage-A runner linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | none |
| Staged proof driver and workflow linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | none |
| Soak workflow and runbook linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | none |
| Local Stage-A deploy and verify artifacts attached for Solana, BSC, and AVAX | supporting evidence referenced | referenced supporting artifact | `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/solana-devnet.json`, `.ci-artifacts/stage-a/solana-init-devnet.json`, `.ci-artifacts/stage-a/bscTestnet.json`, `.ci-artifacts/stage-a/avaxFuji.json` | make attachments available in the final review package |
| Read-only staged proof artifact bundle attached | missing | not yet captured | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | none | run staged proof and capture bundle |
| Canary-write staged proof bundle attached with `pm`, `perps`, and `amm` results per chain | missing | not yet captured | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | none | run staged proof after staging setup |
| Staged soak artifact bundle attached | missing | not yet captured | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | none | run staged soak and capture bundle |
| `verify-chains.json` attached and green | missing | not yet captured | `external-audit-package-checklist.md`, `staged-live-proof.md` | none | generate and attach after staged proof |

### Launch-Chain Canonical Truth

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| Shared registry and gate linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | none |
| Solana canonical `goldAmmMarketProgramId` committed from mainnet deployment evidence | missing | not yet captured | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | commit from final mainnet deployment evidence |
| BSC canonical PM, AMM, perps, and governance fields committed from mainnet deployment evidence | missing | not yet captured | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | commit from final mainnet deployment evidence |
| AVAX canonical PM, AMM, perps, and governance fields committed from mainnet deployment evidence | missing | not yet captured | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | commit from final mainnet deployment evidence |

### Governance And Emergency Controls

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| Governance and signer runbooks linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md` | N/A | none |
| Ownership-transfer, signer, and freeze tx hashes attached for all launch-critical surfaces | partially satisfied | committed evidence in branch | `stage-a-promotion-execution-ledger.md`, `prediction-market-launch-freeze-tracker.md` | Solana freeze transactions recorded in branch docs | attach full cross-chain governance receipt set |
| Key-rotation completion recorded for historically exposed deploy keys | missing | not yet captured | `external-audit-package-checklist.md`, `prediction-market-launch-freeze-tracker.md` | N/A | record key rotation closeout |

### Staging Provisioning

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| GitHub `staging` environment created | missing | not yet captured | `testnet-operations-ledger.md`, `prediction-market-launch-freeze-tracker.md` | N/A | create the environment |
| Required `HYPERBET_*_STAGING_*` variables and secrets loaded | missing | not yet captured | `testnet-operations-ledger.md`, `prediction-market-launch-freeze-tracker.md` | N/A | provision all required variables and secrets |
| Shared BSC and AVAX testnet token addresses recorded in the authoritative release materials | partially satisfied | referenced supporting artifact | `testnet-operations-ledger.md`, `stage-a-promotion-execution-ledger.md` | `keys/stage-a/token-addresses.bscTestnet.json`, `keys/stage-a/token-addresses.avaxFuji.json` | reconcile token and address records into the release-readiness materials |
| Canary, admin, operator, and reporter wallets funded for staged proof and staged soak | partially satisfied | committed evidence in branch | `testnet-operations-ledger.md`, `stage-a-promotion-execution-ledger.md` | deployer funding, Solana sweep, and BSC gas rebalance transactions recorded in docs | complete staged-proof-specific funding and record it in release materials |

### Audit Handoff Package

| Requirement | Current status | Evidence label | Committed source | Referenced support | Gap / next action |
|---|---|---|---|---|---|
| Reviewer-facing release prep linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md` | N/A | none |
| Deploy guide linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md` | N/A | none |
| Runbook index linked | satisfied in committed docs | committed evidence in branch | `external-audit-package-checklist.md` | N/A | none |
| ABI freeze files refreshed and attached | missing | not yet captured | `external-audit-package-checklist.md` | N/A | refresh and attach ABI freeze files |
| Residual-risk register attached | missing | not yet captured | `external-audit-package-checklist.md` | N/A | add residual-risk register |
| Final findings ledger and accepted risks attached | missing | not yet captured | `external-audit-package-checklist.md` | N/A | add final findings ledger and accepted risks |

## Chain-Level Evidence

### Solana devnet

#### PM

##### documented branch evidence

- `gold_clob_market` deploy signature: `4jQHApQGyUSAeHRyBBkcTdBK253TmsjLVJW8YjysztndhR5U9jSb51FJWW5P6XjjbYFPv7zB144JciTE64x9mSa9`
- freeze market transaction: `28osBuQUnW57qLNtqLdFwzzBG6LAwddMUSjavRJHfmhJvsz2UEnihMDhm7jKkms15B4NNzfhdsjUCNumUDgfa69Y`
- browser acceptance source: `stage-a-browser-acceptance-matrix.md`

##### referenced support

- `.ci-artifacts/stage-a/solana-devnet.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- final launch configuration closeout

#### Perps

##### documented branch evidence

- `gold_perps_market` deploy signature: `3AxDvrrRa6zkiRAYPFsATMNkq2kMRF7W2AxuSTVLuXReCi1rzsFBhCUJLnGv1X9wNpbU1LYMm1LYVpFokbgmvCzj`
- freeze perps transaction: `2bakr3e2jpHiuqEDSYGEr98PUnEphELubiKHh23KZbssQEq6jKTZSSNoicYhRan4nDGYJKpeZYtu7eouXndfQ3mM`
- browser coverage includes long and short open-close flows

##### referenced support

- `.ci-artifacts/stage-a/solana-init-devnet.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle

#### AMM

##### documented branch evidence

- `lvr_amm` deploy signature: `jUgwWfhNmP21eY5onNBAQ6ZdjRRVL6D7ppqQXrd65ajPMRTCK5KmvzRt9riJgkLb2k4tPnwa5yfPyeoVw65CbWK`
- freeze AMM transaction: `3wrADkbgimSnzX5Pj3bzgZSvuNRWvARS72u23jCbzifKuDgs9hWbxHdNV6KJLz2BpFPzMyM2mMzdyEAShZJLZHzH`

##### referenced support

- `.ci-artifacts/stage-a/direct-canaries/solana.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- final launch configuration closeout

### BSC testnet

#### PM

##### documented branch evidence

- oracle deploy transaction: `0xb93a97b918c2a7764f1d6c406849e3b8dddee223d82be1f22d476cb8acda53a4`
- clob deploy transaction: `0x23096538668f896d7111509b0790c849399c0a7a3a5d37f15c6cace3e9fb2e11`
- browser transactions:
  - `0x79c6a2a7840ad0736b6d85b45fab05296735d67d7655e6ed9b081c040beb35bd`
  - `0xc0163a00de2f03133ed1f7b8f58bf5d6611963336bfda418a1d4d95bc390b670`
  - `0x73277718f9c347752176315d122544007975fbfae0ab64271582383be617bdb6`

##### referenced support

- `.ci-artifacts/stage-a/bscTestnet.json`
- `.ci-artifacts/stage-a/direct-canaries/bsc.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- governance closeout package
- final launch configuration capture

#### Perps

##### documented branch evidence

- `SkillOracle` deploy transaction: `0x36f78eeeb87013affda44fa1a3c3dc89c977a3acc003ed98a791ac7c9ff34d36`
- `AgentPerpEngine` deploy transaction: `0xcef23a7bf0de93c7217bb12b9ba12f6b9ca5920b67503e0f36bc4c27327a270a`

##### referenced support

- `keys/stage-a/token-addresses.bscTestnet.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- supporting token and address reconciliation in release materials

#### AMM

##### documented branch evidence

- branch release-readiness sources do not yet treat BSC AMM as closeout-complete

##### referenced support

- Stage-A execution history and BSC verification references in `stage-a-promotion-execution-ledger.md`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- release-readiness reconciliation

### AVAX Fuji

#### PM

##### documented branch evidence

- oracle deploy transaction: `0x9ddab4aca88ff472c5b654742447a3816b294efc30a0536375d0d4f4e258c801`
- clob deploy transaction: `0x2f967a345d20702681a1edf6ac233712448883be5ac407a38c48551aa9be8de4`

##### referenced support

- `.ci-artifacts/stage-a/avaxFuji.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- governance closeout package

#### Perps

##### documented branch evidence

- `SkillOracle` deploy transaction: `0x093bf63a7f75d9aaad3d293991a85b2e951c333aa1f6feebe823f4b49dc82246`
- `AgentPerpEngine` deploy transaction: `0xa7abd767a84698b8c258bc1225b11cf4d94e6aae08b2e73eaca2bbfc13103553`

##### referenced support

- `keys/stage-a/token-addresses.avaxFuji.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- supporting token and address reconciliation in release materials

#### AMM

##### documented branch evidence

- branch release-readiness sources do not yet treat AVAX AMM as closeout-complete

##### referenced support

- Stage-A execution history and AVAX verification references in `stage-a-promotion-execution-ledger.md`
- `.ci-artifacts/stage-a/direct-canaries/avax.json`

##### remaining requirements

- staged proof bundle
- staged soak bundle
- release-readiness reconciliation

## Referenced Supporting Artifacts

The tracker references supporting materials in these classes:

- `.ci-artifacts/stage-a/*`
- `.ci-artifacts/stage-a/direct-canaries/*`
- `.ci-artifacts/staged-live-proof/*`
- `.ci-artifacts/pm-soak/*`
- `packages/evm-contracts/deployments/*`
- `keys/stage-a/*`

These references are part of the evidence picture, but they are not attached directly in this branch.

## Closeout Gaps

- record the final RC branch and commit at freeze time
- regenerate and attach the RC freeze manifest
- reconcile release-readiness materials with the later Stage-A execution detail where they differ
- make the Stage-A verification outputs available with the final package
- provision GitHub `staging` and all required `HYPERBET_*_STAGING_*` variables and secrets
- run staged proof and capture `summary.json`, `verify-chains.json`, and per-chain `pm` / `perps` / `amm` outputs
- run staged soak and capture the resulting bundle
- populate canonical mainnet registry truth from final mainnet receipts
- attach ownership-transfer, signer, and freeze receipts for every launch-critical surface
- refresh ABI freeze attachments, residual-risk register, and final findings ledger
