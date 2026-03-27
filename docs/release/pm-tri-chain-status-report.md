# PM Tri-Chain Status Report

## Context

- Base branch: `audit/develop-pm-hardening`
- Report branch: `enoomian/pm-trichain-report`
- Scope: `PM/CLOB duels + perps/models + internal AMM` across `Solana devnet`, `BSC testnet`, and `AVAX Fuji`

This branch is a docs-only handoff branch. It contains committed documentation and evidence references, but it does not contain the full raw artifact bundle. The branch-level source of truth for what is committed, what exists only locally, and what is still missing is:

- [pm-tri-chain-evidence-tracker.md](pm-tri-chain-evidence-tracker.md)

## Executive Summary

The expert reading of `audit/develop-pm-hardening` is that prediction-market work is already in a real tri-chain non-mainnet proving posture. PM is the most mature surface. Perps is already integrated into the phase-1 launch shape and partially proven on live non-mainnet lanes. AMM is designed into the same launch shape and proof model, but it is not closeout-complete.

The important distinction for this report branch is between:

- committed evidence that is already in git
- local-only artifacts and receipts that are referenced in docs but ignored by repo policy
- closeout items that are still genuinely missing

That distinction is what keeps this branch honest.

## PM Accomplishments

### PM-core hardening is already merged into the active implementation train

The committed release tracker records:

- oracle finality hardening
- order semantics hardening
- governance freeze and protocol guardrails
- launch-scope registry gating for the real launch chains

Primary source:

- [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)

### PM is already scoped as a tri-chain non-mainnet launch rehearsal

The committed release docs explicitly treat these as the launch-blocking rehearsal lanes:

- `Solana devnet`
- `BSC testnet`
- `AVAX Fuji`

Primary sources:

- [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
- [testnet-operations-ledger.md](testnet-operations-ledger.md)

### PM already has committed operational and browser evidence

Committed docs already record:

- Stage-A wallet creation and funding
- non-mainnet deployment actions
- PM-specific tx hashes and signatures
- browser acceptance evidence for live PM flows on deployed non-mainnet chains

Primary sources:

- [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md)
- [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md)

## Tri-Chain Evidence By Chain

### Solana devnet

- Committed doc evidence:
  - the Stage-A ledger records full-product Stage-A deploy, init, freeze, and verification activity under the Stage-A wallet model
  - the browser matrix records PM lifecycle shell, YES/NO order placement, restart recovery, and cancelled-duel refund
  - concrete Solana signatures are already committed in the ledger, including:
    - funding transfer: `4Cc3K1hxGA6d8BkhoTgfsqxzRHfUWnC1j7N34zTLRt3YFZzcYHosz75WbpXBwNSGGiHJMaHPjaed82pn43XXmQnL`
    - `gold_clob_market` deploy: `4jQHApQGyUSAeHRyBBkcTdBK253TmsjLVJW8YjysztndhR5U9jSb51FJWW5P6XjjbYFPv7zB144JciTE64x9mSa9`
    - `lvr_amm` deploy: `jUgwWfhNmP21eY5onNBAQ6ZdjRRVL6D7ppqQXrd65ajPMRTCK5KmvzRt9riJgkLb2k4tPnwa5yfPyeoVw65CbWK`
    - `gold_perps_market` deploy: `3AxDvrrRa6zkiRAYPFsATMNkq2kMRF7W2AxuSTVLuXReCi1rzsFBhCUJLnGv1X9wNpbU1LYMm1LYVpFokbgmvCzj`
    - freeze oracle: `4y7z65ARWA1hi9qomFpGvsQTX7kMVEu7eBWz9Q1gozd8XNuhwJGkGC7kTphEvgU6USjKQYBof1GobrX592aTsZPx`
    - freeze market: `28osBuQUnW57qLNtqLdFwzzBG6LAwddMUSjavRJHfmhJvsz2UEnihMDhm7jKkms15B4NNzfhdsjUCNumUDgfa69Y`
    - freeze AMM: `3wrADkbgimSnzX5Pj3bzgZSvuNRWvARS72u23jCbzifKuDgs9hWbxHdNV6KJLz2BpFPzMyM2mMzdyEAShZJLZHzH`
    - freeze perps: `2bakr3e2jpHiuqEDSYGEr98PUnEphELubiKHh23KZbssQEq6jKTZSSNoicYhRan4nDGYJKpeZYtu7eouXndfQ3mM`
- Local artifact referenced:
  - `.ci-artifacts/stage-a/solana-devnet.json`
  - `.ci-artifacts/stage-a/solana-init-devnet.json`
  - `.ci-artifacts/stage-a/direct-canaries/solana.json`
- Remaining gap:
  - the committed browser acceptance docs still call out the matured winner-claim lane as intentionally time-gated
  - staged proof, staged soak, and canonical mainnet truth are still not captured as committed closeout evidence

### BSC testnet

- Committed doc evidence:
  - PM-core deployment txs are recorded in the Stage-A ledger:
    - oracle: `0xb93a97b918c2a7764f1d6c406849e3b8dddee223d82be1f22d476cb8acda53a4`
    - clob: `0x23096538668f896d7111509b0790c849399c0a7a3a5d37f15c6cace3e9fb2e11`
  - perps deployment txs are also recorded:
    - `SkillOracle`: `0x36f78eeeb87013affda44fa1a3c3dc89c977a3acc003ed98a791ac7c9ff34d36`
    - `AgentPerpEngine`: `0xcef23a7bf0de93c7217bb12b9ba12f6b9ca5920b67503e0f36bc4c27327a270a`
  - browser PM evidence is committed:
    - recovery YES: `0x79c6a2a7840ad0736b6d85b45fab05296735d67d7655e6ed9b081c040beb35bd`
    - cancel YES: `0xc0163a00de2f03133ed1f7b8f58bf5d6611963336bfda418a1d4d95bc390b670`
    - cancel refund claim: `0x73277718f9c347752176315d122544007975fbfae0ab64271582383be617bdb6`
- Local artifact referenced:
  - `.ci-artifacts/stage-a/bscTestnet.json`
  - `.ci-artifacts/stage-a/direct-canaries/bsc.json`
  - `keys/stage-a/token-addresses.bscTestnet.json`
- Remaining gap:
  - closeout docs still do not treat the BSC lane as fully closed for staged proof, staged soak, canonical mainnet truth, and governance evidence
  - local Stage-A evidence exists, but it is not embedded in git

### AVAX Fuji

- Committed doc evidence:
  - PM-core deployment txs are recorded in the Stage-A ledger:
    - oracle: `0x9ddab4aca88ff472c5b654742447a3816b294efc30a0536375d0d4f4e258c801`
    - clob: `0x2f967a345d20702681a1edf6ac233712448883be5ac407a38c48551aa9be8de4`
  - perps deployment txs are also recorded:
    - `SkillOracle`: `0x093bf63a7f75d9aaad3d293991a85b2e951c333aa1f6feebe823f4b49dc82246`
    - `AgentPerpEngine`: `0xa7abd767a84698b8c258bc1225b11cf4d94e6aae08b2e73eaca2bbfc13103553`
  - the browser acceptance matrix records AVAX live PM/browser flow coverage
- Local artifact referenced:
  - `.ci-artifacts/stage-a/avaxFuji.json`
  - `.ci-artifacts/stage-a/direct-canaries/avax.json`
  - `keys/stage-a/token-addresses.avaxFuji.json`
- Remaining gap:
  - as with BSC, local Stage-A proof is not the same as committed closeout evidence
  - staged proof, staged soak, canonical mainnet truth, and governance evidence remain open

## PM-AMM-Perps Approach

This branch does not treat AMM and perps as separate side efforts outside PM. The committed repo posture is to prove the full phase-1 product together:

1. keep proof scope coupled across `pm`, `perps`, and `amm`
2. reuse shared deployment truth and registry-shaped receipts
3. keep Solana and EVM verification rails aligned to full-product scope
4. use local-first bring-up, then staged proof, then soak for closeout

Committed sources already show:

- oracle-only AMM settlement on EVM and Solana
- Solana perps pause preserved after freeze
- Solana full-product deploy/init/freeze/verify rails extended to include AMM
- canonical EVM receipt writing for PM, AMM, and perps
- staged proof and soak wiring aimed at `pm`, `perps`, and `amm`

Primary sources:

- [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
- [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

## Current State And Blockers

For release-closeout truth on this branch, the branch narrative follows:

1. [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
2. [testnet-operations-ledger.md](testnet-operations-ledger.md)
3. [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

[stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md) is still important, but it is treated as append-only operational evidence. It contains later local progress and local artifact references that are stronger than what the closeout trackers currently assert. Until those closeout docs are reconciled, those items should be read as local-only or partial evidence, not final closeout.

On that basis, the honest current blockers are:

- launch-chain canonical mainnet registry truth is still incomplete
- GitHub `staging` environment and `HYPERBET_*_STAGING_*` vars and secrets are not provisioned
- no committed staged proof artifact bundle exists
- no committed staged soak artifact bundle exists
- governance transfer, freeze receipts, signer closeout, and final audit package items remain open
- BSC and AVAX AMM/perps supporting token/address inputs are not yet reconciled across the authoritative closeout docs
- the Stage-A execution ledger still records unresolved AMM execution history that should be treated as non-final until the closeout docs are aligned

## Key References

1. [pm-tri-chain-evidence-tracker.md](pm-tri-chain-evidence-tracker.md)
2. [prediction-market-launch-freeze-tracker.md](prediction-market-launch-freeze-tracker.md)
3. [testnet-operations-ledger.md](testnet-operations-ledger.md)
4. [stage-a-promotion-execution-ledger.md](stage-a-promotion-execution-ledger.md)
5. [stage-a-browser-acceptance-matrix.md](stage-a-browser-acceptance-matrix.md)
6. [launch-ops-evidence-index.md](launch-ops-evidence-index.md)

## Bottom Line

PM is the most mature and best-evidenced surface in the phase-1 launch stack. Perps is already inside the launch shape and partially proven on real non-mainnet lanes. AMM is part of the same launch architecture and evidence model, but this report branch does not overstate its closeout status.

The purpose of `enoomian/pm-trichain-report` is therefore not to pretend the whole package is done. It is to give reviewers an honest, branch-accurate view of:

- what is already proven in committed docs
- what exists only as local artifact evidence
- what still has to be captured before closeout
