# PM Tri-Chain Evidence Tracker

## Current Basis

- Base branch: `audit/develop-pm-hardening`
- Report branch: `enoomian/pm-trichain-report`
- Scope: `PM/CLOB duels + perps/models + internal AMM` across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`
- Branch policy: this is a docs-only branch; raw artifacts remain mostly local or ignored by repo policy

Evidence labels used throughout this tracker:

- `Committed doc evidence`
- `Local artifact referenced`
- `Missing / not yet captured`

Status vocabulary used throughout this tracker:

- `Satisfied in committed docs`
- `Partially satisfied`
- `Local-only evidence exists`
- `Missing`

Evidence type vocabulary used throughout this tracker:

- `Doc`
- `Doc + local artifact`
- `Doc + on-chain tx/signature`
- `Missing`

Document precedence for this branch narrative:

1. [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
2. [testnet-operations-ledger.md](testnet-operations-ledger.md)
3. [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md)
4. [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md)
5. [launch-ops-evidence-index.md](launch-ops-evidence-index.md)
6. [external-audit-package-checklist.md](external-audit-package-checklist.md)

Known discrepancy rule:

- the closeout docs above still describe staged proof, staged soak, canonical mainnet truth, and governance completion as open
- the Stage-A promotion ledger contains stronger local execution evidence, later tx/signature history, and references to local files under `.ci-artifacts/stage-a/*`
- when those sources disagree, this tracker treats the closeout docs as authoritative for release readiness and treats Stage-A ledger extras as `Partially satisfied` or `Local-only evidence exists`

## Evidence Inventory

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| PM-core hardening and tri-chain launch scope documented | Satisfied in committed docs | Doc | `prediction-market-launch-freeze-tracker.md`, `release-memo-template.md` | N/A | None for branch reporting |
| Tri-chain Stage-A operational history recorded | Satisfied in committed docs | Doc + on-chain tx/signature | `stage-a-promotion-execution-ledger.md` | Multiple tx hashes and Solana signatures are committed in the doc itself | Keep doc aligned with closeout tracker language |
| Local Stage-A verify outputs for Solana, BSC, AVAX | Local-only evidence exists | Doc + local artifact | `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/solana-devnet.json`, `.ci-artifacts/stage-a/solana-init-devnet.json`, `.ci-artifacts/stage-a/bscTestnet.json`, `.ci-artifacts/stage-a/avaxFuji.json` | Attach externally or change artifact policy outside this branch |
| Browser acceptance proof for PM/perps surfaces | Partially satisfied | Doc + on-chain tx/signature | `stage-a-browser-acceptance-matrix.md`, `stage-a-promotion-execution-ledger.md` | BSC browser tx evidence is committed; direct canaries exist locally | Complete real `real_hyperscapes` lane and the timed Solana maturity lane closeout |
| Direct canary outputs | Local-only evidence exists | Doc + local artifact | `stage-a-browser-acceptance-matrix.md`, `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/direct-canaries/{solana,bsc,avax}.json` | Externalize or snapshot separately if needed for review |
| Staged proof bundles | Missing | Missing | `launch-ops-evidence-index.md`, `external-audit-package-checklist.md` | None present under `.ci-artifacts/staged-live-proof/` | Provision staging and run staged proof |
| Staged soak bundles | Missing | Missing | `launch-ops-evidence-index.md`, `external-audit-package-checklist.md` | None present under `.ci-artifacts/pm-soak/` | Provision staging and run soak |
| Canonical mainnet registry truth | Missing | Missing | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | Populate from final mainnet receipts only |
| Governance transfer and freeze receipts package | Partially satisfied | Doc + on-chain tx/signature | `stage-a-promotion-execution-ledger.md`, `prediction-market-launch-freeze-tracker.md` | Solana freeze txs committed in doc; cross-surface package incomplete | Collect and attach all ownership-transfer, signer, and freeze receipts |
| Audit handoff attachments | Missing | Missing | `external-audit-package-checklist.md` | N/A | Refresh ABI freeze, residual risk register, and final findings ledger |

## Required Items

### Scope And Freeze

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| Launch scope documented in release memo template | Satisfied in committed docs | Doc | `release-memo-template.md` | N/A | None |
| Launch freeze tracker linked | Satisfied in committed docs | Doc | `prediction-market-launch-freeze-tracker.md` | N/A | None |
| Final RC branch and commit recorded at freeze time | Missing | Missing | `external-audit-package-checklist.md` | N/A | Record final RC branch and commit at actual freeze |
| Freeze manifest regenerated and attached | Missing | Missing | `external-audit-package-checklist.md`, `manifests/rc-2026-03-audit-handoff-freeze.json` | N/A | Regenerate and attach freeze manifest at freeze time |

### Non-Mainnet Bring-Up And Proof

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| Local Stage-A runner linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | None |
| Staged proof driver and workflow linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | None |
| Soak workflow and runbook linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | None |
| Local Stage-A deploy and verify artifacts attached for Solana devnet, BSC testnet, and AVAX Fuji | Local-only evidence exists | Doc + local artifact | `stage-a-promotion-execution-ledger.md` | `.ci-artifacts/stage-a/solana-devnet.json`, `.ci-artifacts/stage-a/solana-init-devnet.json`, `.ci-artifacts/stage-a/bscTestnet.json`, `.ci-artifacts/stage-a/avaxFuji.json` | Artifacts exist locally but are ignored and not attached in git |
| Read-only staged proof artifact bundle attached | Missing | Missing | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | None | Run staged proof and capture bundle |
| Canary-write staged proof artifact bundle attached with `pm`, `perps`, and `amm` sub-results per chain | Missing | Missing | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | None | Run staged proof after staging env provisioning |
| Staged soak artifact bundle attached | Missing | Missing | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | None | Run staged soak and capture bundle |
| `verify-chains.json` attached and green | Missing | Missing | `external-audit-package-checklist.md`, `staged-live-proof.md` | None | Generate and attach after staged proof |

### Launch-Chain Canonical Truth

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| Shared registry and gate linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md`, `launch-ops-evidence-index.md` | N/A | None |
| Solana canonical `goldAmmMarketProgramId` committed from mainnet deployment evidence | Missing | Missing | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | Commit from final mainnet deployment evidence only |
| BSC canonical PM, AMM, perps, and governance fields committed from mainnet deployment evidence | Missing | Missing | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | Commit from final mainnet deployment evidence only |
| AVAX canonical PM, AMM, perps, and governance fields committed from mainnet deployment evidence | Missing | Missing | `prediction-market-launch-freeze-tracker.md`, `launch-ops-evidence-index.md` | N/A | Commit from final mainnet deployment evidence only |

### Governance And Emergency Controls

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| Governance and signer runbooks linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md` | N/A | None |
| Ownership-transfer, signer, and freeze tx hashes attached for all launch-critical surfaces | Partially satisfied | Doc + on-chain tx/signature | `stage-a-promotion-execution-ledger.md`, `prediction-market-launch-freeze-tracker.md` | Solana freeze txs are committed in docs; broader ownership-transfer package is not | Capture and attach full cross-chain governance receipt set |
| Key-rotation completion recorded for any historically exposed deploy keys | Missing | Missing | `external-audit-package-checklist.md`, `prediction-market-launch-freeze-tracker.md` | N/A | Record key rotation closeout explicitly |

### Staging Provisioning

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| GitHub `staging` environment created | Missing | Missing | `testnet-operations-ledger.md`, `prediction-market-launch-freeze-tracker.md` | N/A | Create the environment |
| Required `HYPERBET_*_STAGING_*` vars and secrets loaded | Missing | Missing | `testnet-operations-ledger.md`, `prediction-market-launch-freeze-tracker.md` | N/A | Provision all required vars and secrets |
| Shared BSC and AVAX testnet token addresses recorded in `testnet-operations-ledger.md` | Partially satisfied | Doc + local artifact | `testnet-operations-ledger.md`, `stage-a-promotion-execution-ledger.md` | `keys/stage-a/token-addresses.bscTestnet.json`, `keys/stage-a/token-addresses.avaxFuji.json` are referenced in docs and present locally | Reconcile the authoritative closeout docs so the recorded local token addresses become committed closeout truth |
| Canary, admin, operator, and reporter wallets funded for staged proof and staged soak | Partially satisfied | Doc + on-chain tx/signature | `testnet-operations-ledger.md`, `stage-a-promotion-execution-ledger.md` | deployer funding, Solana sweep, and BSC gas rebalance txs are committed in docs | Finish staged-proof-specific wallet funding and record it as a staged closeout step |

### Audit Handoff Package

| Requirement | Current status | Evidence type | Committed source | Local artifact / chain proof | Gap / next action |
|---|---|---|---|---|---|
| Reviewer-facing release prep linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md` | N/A | None |
| Deploy guide linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md` | N/A | None |
| Runbook index linked | Satisfied in committed docs | Doc | `external-audit-package-checklist.md` | N/A | None |
| ABI freeze files refreshed and attached | Missing | Missing | `external-audit-package-checklist.md` | N/A | Refresh ABI freeze files and attach them to the audit handoff |
| Residual-risk register attached | Missing | Missing | `external-audit-package-checklist.md` | N/A | Add residual risk register |
| Final findings ledger and accepted risks attached | Missing | Missing | `external-audit-package-checklist.md` | N/A | Add final findings ledger and accepted risks |

## Chain-Level Evidence

### Solana devnet

#### PM

- `Committed doc evidence`
  - `gold_clob_market` deploy signature: `4jQHApQGyUSAeHRyBBkcTdBK253TmsjLVJW8YjysztndhR5U9jSb51FJWW5P6XjjbYFPv7zB144JciTE64x9mSa9`
  - freeze market tx: `28osBuQUnW57qLNtqLdFwzzBG6LAwddMUSjavRJHfmhJvsz2UEnihMDhm7jKkms15B4NNzfhdsjUCNumUDgfa69Y`
  - browser evidence source: `stage-a-browser-acceptance-matrix.md`

#### Perps

- `Committed doc evidence`
  - `gold_perps_market` deploy signature: `3AxDvrrRa6zkiRAYPFsATMNkq2kMRF7W2AxuSTVLuXReCi1rzsFBhCUJLnGv1X9wNpbU1LYMm1LYVpFokbgmvCzj`
  - freeze perps tx: `2bakr3e2jpHiuqEDSYGEr98PUnEphELubiKHh23KZbssQEq6jKTZSSNoicYhRan4nDGYJKpeZYtu7eouXndfQ3mM`
  - browser coverage includes perps LONG/SHORT open-close flows

#### AMM

- `Committed doc evidence`
  - `lvr_amm` deploy signature: `jUgwWfhNmP21eY5onNBAQ6ZdjRRVL6D7ppqQXrd65ajPMRTCK5KmvzRt9riJgkLb2k4tPnwa5yfPyeoVw65CbWK`
  - freeze AMM tx: `3wrADkbgimSnzX5Pj3bzgZSvuNRWvARS72u23jCbzifKuDgs9hWbxHdNV6KJLz2BpFPzMyM2mMzdyEAShZJLZHzH`
- `Local artifact referenced`
  - `.ci-artifacts/stage-a/solana-init-devnet.json`

#### Verification / browser / canary evidence

- `Local artifact referenced`
  - `.ci-artifacts/stage-a/solana-devnet.json`
  - `.ci-artifacts/stage-a/direct-canaries/solana.json`
- `Missing / not yet captured`
  - staged proof bundle
  - staged soak bundle

### BSC testnet

#### PM

- `Committed doc evidence`
  - oracle deploy tx: `0xb93a97b918c2a7764f1d6c406849e3b8dddee223d82be1f22d476cb8acda53a4`
  - clob deploy tx: `0x23096538668f896d7111509b0790c849399c0a7a3a5d37f15c6cace3e9fb2e11`
  - browser txs:
    - `0x79c6a2a7840ad0736b6d85b45fab05296735d67d7655e6ed9b081c040beb35bd`
    - `0xc0163a00de2f03133ed1f7b8f58bf5d6611963336bfda418a1d4d95bc390b670`
    - `0x73277718f9c347752176315d122544007975fbfae0ab64271582383be617bdb6`

#### Perps

- `Committed doc evidence`
  - `SkillOracle` deploy tx: `0x36f78eeeb87013affda44fa1a3c3dc89c977a3acc003ed98a791ac7c9ff34d36`
  - `AgentPerpEngine` deploy tx: `0xcef23a7bf0de93c7217bb12b9ba12f6b9ca5920b67503e0f36bc4c27327a270a`

#### AMM

- `Partially satisfied`
  - the Stage-A ledger includes local execution history and later local artifact references for BSC AMM work
  - authoritative closeout docs still do not treat BSC AMM as fully closed out
- `Local artifact referenced`
  - `.ci-artifacts/stage-a/bscTestnet.json`

#### Verification / browser / canary evidence

- `Local artifact referenced`
  - `.ci-artifacts/stage-a/direct-canaries/bsc.json`
  - `keys/stage-a/token-addresses.bscTestnet.json`
- `Missing / not yet captured`
  - staged proof bundle
  - staged soak bundle

### AVAX Fuji

#### PM

- `Committed doc evidence`
  - oracle deploy tx: `0x9ddab4aca88ff472c5b654742447a3816b294efc30a0536375d0d4f4e258c801`
  - clob deploy tx: `0x2f967a345d20702681a1edf6ac233712448883be5ac407a38c48551aa9be8de4`

#### Perps

- `Committed doc evidence`
  - `SkillOracle` deploy tx: `0x093bf63a7f75d9aaad3d293991a85b2e951c333aa1f6feebe823f4b49dc82246`
  - `AgentPerpEngine` deploy tx: `0xa7abd767a84698b8c258bc1225b11cf4d94e6aae08b2e73eaca2bbfc13103553`

#### AMM

- `Partially satisfied`
  - the Stage-A ledger includes local execution history and later local artifact references for AVAX AMM work
  - authoritative closeout docs still do not treat AVAX AMM as fully closed out
- `Local artifact referenced`
  - `.ci-artifacts/stage-a/avaxFuji.json`

#### Verification / browser / canary evidence

- `Local artifact referenced`
  - `.ci-artifacts/stage-a/direct-canaries/avax.json`
  - `keys/stage-a/token-addresses.avaxFuji.json`
- `Missing / not yet captured`
  - staged proof bundle
  - staged soak bundle

## What Is Not In Git

The branch references these evidence classes, but repo policy currently keeps them out of git:

- `.ci-artifacts/stage-a/*`
- `.ci-artifacts/stage-a/direct-canaries/*`
- `.ci-artifacts/staged-live-proof/*`
- `.ci-artifacts/pm-soak/*`
- `packages/evm-contracts/deployments/*`
- `keys/stage-a/*`

Implication:

- the branch can honestly point to committed docs plus local artifact paths
- the branch cannot honestly claim to embed the raw artifact bundle itself

## Closeout Gaps

- record the final RC branch and commit at freeze time
- regenerate and attach the RC freeze manifest
- reconcile the closeout docs with the later Stage-A ledger history where local execution has advanced
- attach local Stage-A verify artifacts externally or adopt a separate artifact publication mechanism
- provision GitHub `staging` and all `HYPERBET_*_STAGING_*` vars/secrets
- run staged proof and capture `summary.json`, `verify-chains.json`, and per-chain `pm`/`perps`/`amm` outputs
- run staged soak and capture the bundle
- populate canonical mainnet registry truth from final mainnet receipts only
- attach ownership-transfer, signer, and freeze receipts for every launch-critical surface
- refresh ABI freeze attachments, residual risk register, and final findings ledger
- resolve and document any remaining AMM/perps closeout discrepancies that are still true on `audit/develop-pm-hardening`
