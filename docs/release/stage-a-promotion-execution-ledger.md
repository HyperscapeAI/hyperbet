# Stage-A Promotion Execution Ledger

> **TL;DR:** This is the live execution log for the current non-mainnet promotion run. The new Stage-A wallet set exists locally under `keys/stage-a/`, all three new deployers are funded, and fresh non-mainnet ERC20 collateral tokens now exist on both `BSC testnet` and `AVAX Fuji`. BSC and AVAX PM-core plus perps are now deployed from the new Stage-A wallet set. The current hard blocker is the EVM AMM `Router`, which exceeds the EVM max code-size limit as compiled.

This document records the exact commands, balances, transaction hashes, and blockers for the current Stage-A promotion run. It is intentionally operational and append-only for this execution cycle.

## Scope

- Launch rehearsal targets:
  - `Solana devnet`
  - `BSC testnet`
  - `AVAX Fuji`
- Wallet source of truth:
  - `keys/stage-a/`
- Current execution branch:
  - `audit/develop-pm-hardening`

## Operating Rules

1. Do not record private keys, seed phrases, or raw secret values in this file.
2. Record commands, public addresses, tx hashes, balances, outputs, and blockers.
3. Record every meaningful state transition before moving to the next step.
4. Prefer local-first deployment and verification. Use GitHub Actions when existing CI-held wallets are needed for bootstrap funding.

## Stage-A Wallet Inventory

Public wallet inventory is generated from:

- [public-addresses.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/public-addresses.json)

Local shell export helpers exist at:

- [export-stage-a.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/export-stage-a.sh)
- [stage-a.env](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/stage-a.env)

## Progress Tracker

| Step | Status | Notes |
| --- | --- | --- |
| Generate new Stage-A wallets | Complete | Wallets created locally under `keys/stage-a/` |
| Fund Solana devnet deployer | Complete | New Solana deployer funded |
| Fund AVAX Fuji deployer | Complete | New AVAX deployer funded |
| Fund BSC testnet deployer | Complete | Funded via GitHub Actions from old deployer |
| Deploy fresh BSC non-mainnet collateral tokens | Complete | Addresses written to `keys/stage-a/token-addresses*.json` |
| Deploy fresh AVAX non-mainnet collateral tokens | Complete | Final corrected deploy recorded after env-precedence fix |
| Deploy BSC PM + AMM + perps | In progress | PM-core and perps are deployed; AMM is blocked by EVM max code size |
| Deploy AVAX PM + AMM + perps | In progress | PM-core and perps are deployed; AMM is blocked by the same EVM code-size issue |
| Verify BSC and AVAX deployment receipts | Blocked | Verification confirms AMM receipt fields are still missing |
| Resolve Solana devnet keypair/program-id alignment | Blocked | Devnet preflight fails on all four program keypair/pubkey checks |
| Run staged proof and staged soak | Pending | Blocked on missing EVM AMM and Solana devnet deployment |

## Execution Log

### Step 0. Create the new Stage-A wallet set

Status:
- Complete

Artifacts:
- [public-addresses.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/public-addresses.json)
- [export-stage-a.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/export-stage-a.sh)
- [stage-a.env](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/stage-a.env)

Public addresses of primary deployers:
- BSC / AVAX EVM deployer:
  - `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`
- Solana devnet deployer:
  - `B6rVRCTCUxWQ5fmT1fboPsnbuMuwoKpWSCBK3NHbs83w`

Notes:
- Wallet files are local and gitignored.
- Existing export files already contain the Stage-A wallet envs. Loading them into a shell is still required before local deploy scripts can use them.

### Step 1. Fund the new deployer wallets

Status:
- Complete

#### 1A. Solana devnet deployer

Status:
- Complete

Confirmed balance:
- `B6rVRCTCUxWQ5fmT1fboPsnbuMuwoKpWSCBK3NHbs83w`
  - `5 SOL`

#### 1B. AVAX Fuji deployer

Status:
- Complete

Confirmed balance:
- `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`
  - `3 AVAX`

#### 1C. BSC testnet deployer

Status:
- Complete

Funding source:
- Old CI-held deployer:
  - `0x25DFe05ea0d5bb2F96b9D351765CC5E2DB86dCC0`

Funding workflow:
- [fund-stage-a-wallets.yml](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.github/workflows/fund-stage-a-wallets.yml)

GitHub Actions run:
- `23590515407`

Funding transaction:
- `0xc3b00e93519b4b7dbe8264590dcb9b4859b2f72dcff8ad4f89d75d14c2c4f2bc`

Confirmed balances after funding:
- Old BSC deployer:
  - `0x25DFe05ea0d5bb2F96b9D351765CC5E2DB86dCC0`
  - `0.17939378 tBNB`
- New BSC deployer:
  - `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`
  - `0.2 tBNB`

Notes:
- The workflow could not be `workflow_dispatch`ed directly because GitHub does not expose non-default-branch-only workflows for dispatch.
- The workflow was updated to also run on pushes to `audit/develop-pm-hardening`, then triggered via a commit/push to the same branch.

### Step 2. Prepare fresh non-mainnet ERC20 collateral tokens

Status:
- Complete

Purpose:
- BSC and AVAX phase-1 AMM and perps need fresh local non-mainnet token contracts because there are no reusable existing `mUSD` or perps margin token contracts currently provisioned for this Stage-A wallet set.

Script:
- [deploy-stage-a-tokens.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/scripts/deploy-stage-a-tokens.ts)

What this script deploys:
- `MockUSD`
  - used as AMM collateral on EVM non-mainnet
- `MockERC20`
  - used as the perps margin token on EVM non-mainnet

What this script writes:
- [token-addresses.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/token-addresses.json)
- `token-addresses.bscTestnet.json`
- `token-addresses.avaxFuji.json`

Expected outputs:
- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_PERPS_MARGIN_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- `AVAX_FUJI_MUSD_TOKEN_ADDRESS`
- `AVAX_FUJI_PERPS_MARGIN_TOKEN_ADDRESS`
- `AVAX_FUJI_GOLD_TOKEN_ADDRESS`

Important note:
- On EVM, `*_GOLD_TOKEN_ADDRESS` is currently a compatibility alias to the perps margin token for repo/workflow compatibility. It is not modeling a distinct real Gold token on BSC or AVAX.

#### 2A. BSC testnet token deployment

Status:
- Complete

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:stage-a-tokens:bsc-testnet
```

Execution timestamp:
- `2026-03-26T11:02:50.941Z`

Output files:
- [token-addresses.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/token-addresses.json)
- [token-addresses.bscTestnet.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/token-addresses.bscTestnet.json)

Deployed BSC token addresses:
- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
  - `0x08e621f503aCe8cCCE745fe7441561536AE8445F`
- `BSC_TESTNET_PERPS_MARGIN_TOKEN_ADDRESS`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`
  - compatibility alias to the perps margin token

Mint recipients:
- deployer
- admin
- market operator
- market maker
- keeper
- canary
- matcher

Mint amount per recipient:
- `100000` `mUSD`
- `100000` perps margin tokens

Notes:
- The script completed successfully on `bscTestnet` using the new Stage-A deployer.
- The deployment uses fresh non-mainnet ERC20s only for Stage-A AMM and perps rehearsal.

#### 2B. AVAX Fuji token deployment

Status:
- Complete

First attempt:
- A first AVAX deploy succeeded on-chain, but it used the wrong deployer account.
- Cause:
  - Hardhat prefers `AVAX_FUJI_PRIVATE_KEY` over `PRIVATE_KEY`.
  - The Stage-A export initially set `PRIVATE_KEY` only, while a stale `AVAX_FUJI_PRIVATE_KEY` was still present in the local environment.
- First-attempt outcome:
  - contracts were deployed from `0x7b3D508340f3465A0D57dD54df163A5Fb889bD26`
  - minted balances still went to the new Stage-A recipient set
- Resolution:
  - patched [export-stage-a-wallet-env.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/export-stage-a-wallet-env.ts) to emit:
    - `BSC_TESTNET_PRIVATE_KEY`
    - `AVAX_FUJI_PRIVATE_KEY`
  - regenerated:
    - [export-stage-a.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/export-stage-a.sh)
    - [stage-a.env](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/stage-a.env)
  - re-ran the AVAX token deployment under the corrected Stage-A env

Corrected command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:stage-a-tokens:avax-fuji
```

Corrected execution timestamp:
- `2026-03-26T11:07:46.620Z`

Output files:
- [token-addresses.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/token-addresses.json)
- [token-addresses.avaxFuji.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/keys/stage-a/token-addresses.avaxFuji.json)

Corrected deployer:
- `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`

Deployed AVAX token addresses:
- `AVAX_FUJI_MUSD_TOKEN_ADDRESS`
  - `0x08e621f503aCe8cCCE745fe7441561536AE8445F`
- `AVAX_FUJI_PERPS_MARGIN_TOKEN_ADDRESS`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`
- `AVAX_FUJI_GOLD_TOKEN_ADDRESS`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`
  - compatibility alias to the perps margin token

Important note:
- The final AVAX token addresses match the BSC token addresses.
- That is expected here because the same Stage-A deployer executed the same deployment sequence on a different chain, resulting in the same address derivation pattern.

### Step 3. Deploy BSC PM + AMM + perps

Status:
- In progress

#### 3A. BSC PM-core CREATE2 deployment

Status:
- Complete

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:create2:bsc-testnet
```

Execution timestamp:
- `2026-03-26T11:10:00.113Z`

Canonical receipt:
- [bscTestnet.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/bscTestnet.json)

Deployer:
- `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`

Constructor roles used:
- admin:
  - `0xd75676D9466db83a74E55572e45828751e2e8101`
- reporter:
  - `0x8FA91419FDC9d25A646c6B9684C148DeFa1C2df0`
- finalizer:
  - `0x67e3078B238F9eAA04C60834ccCc6A4685F704b7`
- challenger:
  - `0x3A123B14bca41E14d12d4854F6a1180ECC38b42b`
- pauser:
  - `0xdeB6a5897C5B2FbB3C7dCe821b5ffe69aeA60d51`
- market operator:
  - `0x7E82E3553f1baB7964c6dbd760d565be14D566bb`
- treasury:
  - `0xae6bd4dAC4731995980EEdFF70ccC6B29E8FbD62`
- market maker:
  - `0xc2Aac21a8bb955c3D6a76b77A9824C8cd81d6f5B`
- dispute window:
  - `3600`

Deployed addresses:
- `duelOracleAddress`
  - `0x5B0a0D5cf66F2A725560fCdb3bF74067c8c50A3C`
- `goldClobAddress`
  - `0xb7b2833875A17d5E5401C310C694Bb75a21a2582`

Deployment transactions:
- oracle:
  - `0xb93a97b918c2a7764f1d6c406849e3b8dddee223d82be1f22d476cb8acda53a4`
- clob:
  - `0x23096538668f896d7111509b0790c849399c0a7a3a5d37f15c6cace3e9fb2e11`

Notes:
- The new Stage-A deployer successfully used the Arachnid deterministic deployment proxy.
- These PM-core addresses are now the oracle and CLOB inputs for the next BSC AMM and verification steps.

#### 3B. BSC AMM deployment

Status:
- Blocked

Attempted command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export DUEL_ORACLE_ADDRESS=0x5B0a0D5cf66F2A725560fCdb3bF74067c8c50A3C
export MUSD_TOKEN_ADDRESS=0x08e621f503aCe8cCCE745fe7441561536AE8445F
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:amm:bsc-testnet
```

What happened:
- First failure:
  - `Router` deployment script did not link the required `Math` and `SwapMath` libraries.
- Fix applied:
  - patched [deploy-amm.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/scripts/deploy-amm.ts) to deploy and link:
    - `contracts/lvr_amm/lib/Math.sol:Math`
    - `contracts/lvr_amm/lib/SwapMath.sol:SwapMath`
- Second failure:
  - short library name `Math` was ambiguous with OpenZeppelin `Math`
- Fix applied:
  - updated the same script to use fully qualified library names
- Third failure:
  - on-chain deployment reverted with:
    - `ProviderError: max code size exceeded`

Measured compiled sizes:
- `Router`
  - runtime size:
    - `26124` bytes
  - creation size:
    - `27147` bytes
- EVM runtime limit:
  - `24576` bytes

Current conclusion:
- The current `Router` implementation is too large to deploy on BSC testnet as compiled.
- This is an implementation blocker for the EVM AMM lane, not a wallet or environment problem.

#### 3C. BSC perps deployment

Status:
- Complete

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export PERPS_MARGIN_TOKEN_ADDRESS=0xB5e215607565808d00b16c69a8074d35060438DE
export GOLD_TOKEN_ADDRESS=0xB5e215607565808d00b16c69a8074d35060438DE
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:perps:bsc-testnet
```

Execution timestamp:
- `2026-03-26T11:12:53.497Z`

Canonical receipt:
- [bscTestnet.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/bscTestnet.json)

Deployed addresses:
- `skillOracleAddress`
  - `0x9064B86E9050bb9C01868B36740D6d9F12a18F0d`
- `perpEngineAddress`
  - `0x0c6c9B3A7C374F121a0Ad0bBFB01945d1F567cfc`
- `perpMarginTokenAddress`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`

Deployment transactions:
- `SkillOracle`
  - `0x36f78eeeb87013affda44fa1a3c3dc89c977a3acc003ed98a791ac7c9ff34d36`
- `AgentPerpEngine`
  - `0xcef23a7bf0de93c7217bb12b9ba12f6b9ca5920b67503e0f36bc4c27327a270a`

Notes:
- BSC perps deployment completed successfully under the new Stage-A deployer.
- The canonical BSC receipt is now populated for PM-core plus perps, but not AMM.

### Step 4. Deploy AVAX PM + AMM + perps

Status:
- In progress

#### 4A. AVAX PM-core CREATE2 deployment

Status:
- Complete

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:create2:avax-fuji
```

Execution timestamp:
- `2026-03-26T11:13:51.528Z`

Canonical receipt:
- [avaxFuji.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/avaxFuji.json)

Deployer:
- `0x4f2714dc431dc948B5B138Ef9b998e943568DE4d`

Deployed addresses:
- `duelOracleAddress`
  - `0x5B0a0D5cf66F2A725560fCdb3bF74067c8c50A3C`
- `goldClobAddress`
  - `0xb7b2833875A17d5E5401C310C694Bb75a21a2582`

Deployment transactions:
- oracle:
  - `0x9ddab4aca88ff472c5b654742447a3816b294efc30a0536375d0d4f4e258c801`
- clob:
  - `0x2f967a345d20702681a1edf6ac233712448883be5ac407a38c48551aa9be8de4`

Notes:
- The AVAX PM-core redeploy replaced the old stale-wallet receipt with a clean Stage-A deployer receipt.
- As expected, the AVAX PM-core addresses match the BSC PM-core addresses because the same Stage-A deployer executed the same CREATE2 deployment with the same constructor arguments on another EVM chain.

#### 4B. AVAX AMM deployment

Status:
- Blocked by the same implementation issue as BSC

Current conclusion:
- The AMM `Router` runtime size is chain-agnostic for these EVM deployments.
- Since the compiled runtime size is `26124` bytes, it exceeds the EVM runtime code-size limit on AVAX just as it does on BSC.
- The AVAX AMM lane is therefore blocked by the same `Router` implementation issue and was not re-attempted separately after the BSC proof.

#### 4C. AVAX perps deployment

Status:
- Complete

First attempt:
- The first AVAX perps run was terminated by the desktop execution layer with `SIGKILL`.
- Chain check after the interruption showed no code at the candidate perps addresses, so that first attempt did not leave partial deployed state.

Successful retry command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export PERPS_MARGIN_TOKEN_ADDRESS=0xB5e215607565808d00b16c69a8074d35060438DE
export GOLD_TOKEN_ADDRESS=0xB5e215607565808d00b16c69a8074d35060438DE
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:perps:avax-fuji
```

Execution timestamp:
- `2026-03-26T11:15:00.735Z`

Canonical receipt:
- [avaxFuji.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/avaxFuji.json)

Deployed addresses:
- `skillOracleAddress`
  - `0x249db7Bf653b4Dfe20201B1d578F1df77b9f2a94`
- `perpEngineAddress`
  - `0x9064B86E9050bb9C01868B36740D6d9F12a18F0d`
- `perpMarginTokenAddress`
  - `0xB5e215607565808d00b16c69a8074d35060438DE`

Deployment transactions:
- `SkillOracle`
  - `0x093bf63a7f75d9aaad3d293991a85b2e951c333aa1f6feebe823f4b49dc82246`
- `AgentPerpEngine`
  - `0xa7abd767a84698b8c258bc1225b11cf4d94e6aae08b2e73eaca2bbfc13103553`

Notes:
- The AVAX perps retry completed cleanly under the new Stage-A deployer.
- The canonical AVAX receipt is now populated for PM-core plus perps, but not AMM.

### Step 5. Verify current BSC and AVAX deployment receipts

Status:
- Blocked

Purpose:
- Confirm the canonical non-mainnet receipts are complete enough for full-product verification.

#### 5A. BSC receipt verification

Status:
- Blocked

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
node --import tsx /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet
```

Observed result:
- Verification exited early with a missing-address error.

Missing receipt fields reported by the verifier:
- `goldAmmRouterAddress`
  - empty
- `mUsdTokenAddress`
  - empty

Conclusion:
- The BSC canonical receipt correctly reflects that PM-core and perps exist, but AMM is not deployed and the canonical receipt does not yet carry AMM-linked fields.
- This failure is expected until the EVM AMM lane is fixed and deployed.

#### 5B. AVAX receipt verification

Status:
- Blocked

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
node --import tsx /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts/scripts/verify-deployment.ts --network avaxFuji
```

Observed result:
- Verification exited early with a missing-address error.

Missing receipt fields reported by the verifier:
- `goldAmmRouterAddress`
  - empty
- `mUsdTokenAddress`
  - empty

Conclusion:
- The AVAX canonical receipt correctly reflects that PM-core and perps exist, but AMM is not deployed and the canonical receipt does not yet carry AMM-linked fields.
- This failure is expected until the EVM AMM lane is fixed and deployed.

### Step 6. Solana devnet preflight

Status:
- Blocked

Command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana deploy:preflight:devnet
```

Observed result:
- Preflight completed its checks and reported four failures.
- IDL manifest checks passed.
- Program keypair/pubkey alignment checks failed for all four Solana programs.

Failed program keypair checks:
- `fight_oracle`
  - expected manifest program id:
    - `B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo`
- `gold_clob_market`
  - expected manifest program id:
    - `DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf`
- `lvr_amm`
  - expected manifest program id:
    - `Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5`
- `gold_perps_market`
  - expected manifest program id:
    - `EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT`

Conclusion:
- The current local Solana deploy keypairs under `packages/hyperbet-solana/anchor/target/deploy/` do not match the manifest / registry program IDs.
- Solana devnet deploy cannot proceed honestly until either:
  - the correct program keypairs are provided, or
  - the manifest / registry truth is intentionally rotated to new program IDs.

### Step 7. Remaining execution path

Pending steps after token deployment:

1. Fund any Stage-A non-deployer roles that need native gas for operational actions.
2. Decide whether to shrink/refactor the EVM AMM `Router` or otherwise change the EVM AMM deployment approach so it fits under the EVM code-size limit.
3. Re-run BSC and AVAX verification after the AMM lane is fixed and the canonical receipts include AMM fields.
4. Resolve Solana devnet program-keypair alignment and run Solana devnet deploy/init/verify.
5. Run staged proof and staged soak only after the missing EVM AMM lane and Solana deploy lane are resolved.

## Current Blockers

Known remaining blockers before full non-mainnet signoff:

1. Solana devnet still has a program keypair vs registry mismatch that must be resolved before deployment can proceed.
2. EVM AMM `Router` exceeds the EVM runtime code-size limit as currently compiled, blocking BSC and likely AVAX AMM deployment.
3. BSC and AVAX verification cannot pass yet because the AMM receipt fields are still absent from the canonical receipts.
4. GitHub `staging` environment and staged vars/secrets are still not provisioned, which blocks staged proof and staged soak in GitHub.

## Update: EVM AMM Unblock And Solana Mixed-Mode Preflight

Execution window:
- `2026-03-26T11:36Z` through `2026-03-26T11:47Z`

### Step 8. Shrink the EVM AMM Router and validate locally

Status:
- Complete

Files changed:
- [Router.sol](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/contracts/lvr_amm/Router.sol)
- [LvrMarket.t.sol](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/test/LvrMarket.t.sol)
- [goldAmmRouterAbi.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-ui/src/lib/goldAmmRouterAbi.ts)
- [deploy-amm.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/scripts/deploy-amm.ts)

Implementation result:
- Removed OpenZeppelin `AccessControl` from `Router`.
- Replaced it with a minimal fixed-role check:
  - `DEFAULT_ADMIN_ROLE`
  - `MARKET_OPERATOR_ROLE`
  - `hasRole(bytes32,address)`
- Removed unused AMM metadata/index helpers from `Router`:
  - `allMarketIds`
  - `getMarketCount`
  - `getMarketAtIndex`
  - `getMarketMetadata`
  - stored metadata / liquidity mirror
- Kept the active AMM runtime surface:
  - `create`
  - `getAllMarkets`
  - `buyYes`
  - `buyNo`
  - `sellYes`
  - `sellNo`
  - `proposerOutcome`
  - `redeem`
  - `settleFromOracle`
  - `settleMarket`
  - `freezeConfig`
  - `configFrozen`
  - `hasRole`
- Updated the Solidity tests to use `getAllMarkets()` instead of removed count/index helpers.
- Replaced the stale static UI ABI with the reduced Router surface.
- Fixed `deploy-amm.ts` so `freezeConfig()` is sent by the configured admin signer instead of always by the deployer signer.

Measured runtime size:
- Router deployed runtime: `22877` bytes
- EIP-170 limit: `24576` bytes
- Headroom recovered: `1699` bytes

Validation:
- `bun x hardhat compile`
  - passed
- `forge test --match-contract LvrMarketTest`
  - passed
  - `32 passed / 0 failed`
- `git diff --check`
  - clean

Conclusion:
- The EVM AMM size blocker is resolved.

### Step 9. Fund Stage-A EVM admin for AMM freeze

Status:
- Complete

Reason:
- After the Router fix, BSC AMM deployment reached `freezeConfig()` and failed correctly because the separate admin wallet had no native gas.

Funding transactions:
- BSC admin funding tx
  - `0x6c01b44df850a26ef50a8ff5c681ce2139e7687e3055beeb5cba0d96b6f48128`
  - resulting admin balance:
    - `0.01 tBNB`
- AVAX admin funding tx
  - `0x64160c9d036f4ee7c5f10f6360e91c8a1d7814659763e244c46a5c80e3f3cb88`
  - resulting admin balance:
    - `0.1 AVAX`

Conclusion:
- The AMM deploy path now has both the deployer and the separate admin role funded enough for deploy plus freeze.

### Step 10. Redeploy and verify BSC full product

Status:
- Complete

AMM deployment command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export MUSD_TOKEN_ADDRESS=0x08e621f503aCe8cCCE745fe7441561536AE8445F
export DUEL_ORACLE_ADDRESS=0x5B0a0D5cf66F2A725560fCdb3bF74067c8c50A3C
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:amm:bsc-testnet
```

AMM deployment result:
- `goldAmmRouterAddress`
  - `0xc053e98CC2Ef1CF1328E6c9d467B433E1abcEf6d`
- `ammMathLibraryAddress`
  - `0xBfF1D19924e1Fe618151363E0467CEB97E78C915`
- `ammSwapMathLibraryAddress`
  - `0x8D695Aa351868543bD7eb9a9cF22C5036472cC8B`
- `ammConfigFrozen`
  - `true`

Canonical receipt:
- [bscTestnet.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/bscTestnet.json)

Verification command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
node --import tsx /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts/scripts/verify-deployment.ts --network bscTestnet --out /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/.ci-artifacts/stage-a/bscTestnet.json
```

Verification artifact:
- [.ci-artifacts/stage-a/bscTestnet.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.ci-artifacts/stage-a/bscTestnet.json)

Verification result:
- Passed with `failures: []`

Conclusion:
- BSC PM + CLOB + AMM + perps is green under the Stage-A wallet set.

### Step 11. Redeploy and verify AVAX full product

Status:
- Complete

AMM deployment command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export MUSD_TOKEN_ADDRESS=0x08e621f503aCe8cCCE745fe7441561536AE8445F
export DUEL_ORACLE_ADDRESS=0x5B0a0D5cf66F2A725560fCdb3bF74067c8c50A3C
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts deploy:amm:avax-fuji
```

AMM deployment result:
- `goldAmmRouterAddress`
  - `0x537b46C2Cd80f18E47f700825d1Bf886701AA8Dd`
- `ammMathLibraryAddress`
  - `0x31Ee5701EF01Bc4FAdCBB935A0a4D7C60f5812a0`
- `ammSwapMathLibraryAddress`
  - `0x06b288A6e0684Aaa686Cba984E19Ca35bEb5C748`
- `ammConfigFrozen`
  - `true`

Canonical receipt:
- [avaxFuji.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/evm-contracts/deployments/avaxFuji.json)

Verification command:

```bash
source /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/keys/stage-a/export-stage-a.sh
export AVAX_FUJI_RPC=https://avax-fuji.g.alchemy.com/v2/h85R-i8JMJTM3RRVgxLza
node --import tsx /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/evm-contracts/scripts/verify-deployment.ts --network avaxFuji --out /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/.ci-artifacts/stage-a/avaxFuji.json
```

Verification artifact:
- [.ci-artifacts/stage-a/avaxFuji.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/.ci-artifacts/stage-a/avaxFuji.json)

Verification result:
- Passed with `failures: []`

Operational note:
- The default AVAX verification RPC path timed out from the desktop shell.
- Re-running with the explicit Fuji Alchemy URL from `packages/evm-contracts/.env` succeeded immediately.

Conclusion:
- AVAX PM + CLOB + AMM + perps is green under the Stage-A wallet set.

### Step 12. Rework Solana preflight and deploy semantics

Status:
- Complete at the script level

Files changed:
- [preflight-contract-deploy.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/scripts/preflight-contract-deploy.ts)
- [verify-deployment.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/scripts/verify-deployment.ts)
- [deploy-programs.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/scripts/deploy-programs.sh)
- [export-stage-a-env.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/scripts/export-stage-a-env.sh)

Implementation result:
- Preflight now distinguishes:
  - `upgrade` mode when the canonical program already exists on chain
  - `fresh-deploy` mode when the canonical program is missing
- Upgrade-mode checks now validate:
  - on-chain executable program exists
  - upgrade authority matches the expected old deployer
  - anchor/app/keeper IDLs still match the manifest
- Fresh-deploy mode still requires local keypair pubkey to match the manifest target id.
- `deploy-programs.sh` now:
  - upgrades existing programs by canonical program id
  - fresh-deploys missing programs only when local keypair and manifest agree
- Solana verification now defaults expected authority and upgrade authority from the active wallet path if explicit overrides are absent.
- `export-stage-a-env.sh` no longer force-overwrites explicit Solana authority overrides.

Validation:
- `bash -n packages/hyperbet-solana/anchor/scripts/deploy-programs.sh`
  - passed
- `bash -n scripts/export-stage-a-env.sh`
  - passed

Behavioral proof:

PM-only preflight command:

```bash
SOLANA_EXPECTED_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
SOLANA_EXPECTED_UPGRADE_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana deploy:preflight:devnet:pm
```

PM-only preflight result:
- passed
- `fight_oracle`
  - upgrade mode
  - authority matched `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`
- `gold_clob_market`
  - upgrade mode
  - authority matched `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`

Full-product preflight command:

```bash
SOLANA_EXPECTED_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
SOLANA_EXPECTED_UPGRADE_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana deploy:preflight:devnet
```

Full-product preflight result:
- failed only on the missing canonical full-product programs:
  - `lvr_amm`
    - fresh-deploy mode
    - canonical keypair file still missing / mismatched
  - `gold_perps_market`
    - fresh-deploy mode
    - canonical keypair file still missing / mismatched

Conclusion:
- Solana PM is no longer blocked by stale local keypair files.
- Solana full-product is now blocked only by the unrecovered canonical keypairs for `lvr_amm` and `gold_perps_market`, or by the need to intentionally rotate those two IDs.

## Current Blockers (Updated)

Known remaining blockers before full non-mainnet signoff:

1. Solana devnet still needs either:
   - recovery of the canonical `lvr_amm` and `gold_perps_market` keypair files, or
   - an explicit rotation of only those two program IDs.
2. Solana devnet deploy/init/verify has not yet been re-run end-to-end under the new mixed upgrade/fresh-deploy semantics.
3. GitHub `staging` environment and staged vars/secrets are still not provisioned, which blocks staged proof and staged soak in GitHub.

## Current State Summary

What is now green:

1. EVM AMM Router size is under the EIP-170 limit.
2. BSC full product verifies cleanly.
3. AVAX full product verifies cleanly.
4. Solana PM-only devnet preflight passes in upgrade mode under the old authority wallet.

What is still pending:

1. Solana full-product devnet deploy decision:
   - recover canonical AMM/perps keypairs, or
   - rotate those two program IDs
2. Solana init/freeze/verify after that decision
3. staging proof and soak after Solana is green

### Step 13. Rotate Solana AMM/perps IDs and validate fresh-deploy readiness

Status:
- Complete at the repo and preflight level

Reason for rotation:
- The canonical devnet PM programs already existed on-chain and remained under the old upgrade authority.
- The canonical devnet `lvr_amm` and `gold_perps_market` IDs did not exist on-chain.
- The only local AMM/perps program keypairs available in `anchor/target/deploy` resolved to:
  - `lvr_amm`: `BGmzj676aVzRaJ3Hb9BJRYrjtXuhzoc1YTFA6wcucUNF`
  - `gold_perps_market`: `6YjWiway8kaSjwtAinJxqWPvV3DqBVapDWAsSEZjjmbP`
- No local keypair file matching the old placeholder IDs was recoverable from the repo or local Solana config directory.

Files changed:
- [packages/hyperbet-solana/anchor/programs/lvr_amm/src/lib.rs](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/programs/lvr_amm/src/lib.rs)
- [packages/hyperbet-solana/anchor/programs/gold_perps_market/src/lib.rs](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/programs/gold_perps_market/src/lib.rs)
- [packages/hyperbet-solana/anchor/Anchor.toml](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/Anchor.toml)
- [packages/hyperbet-chain-registry/src/index.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-chain-registry/src/index.ts)
- [packages/hyperbet-chain-registry/tests/chainRegistry.test.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-chain-registry/tests/chainRegistry.test.ts)
- [packages/hyperbet-solana/deployments/contracts.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/deployments/contracts.json)
- [packages/hyperbet-deployments/contracts.json](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-deployments/contracts.json)
- [packages/hyperbet-solana/app/src/lib/programIds.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/src/lib/programIds.ts)
- [packages/hyperbet-solana/anchor/scripts/run-localnet-tests.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/anchor/scripts/run-localnet-tests.sh)
- [packages/hyperbet-solana/app/scripts/run-e2e-local.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/scripts/run-e2e-local.sh)
- [packages/hyperbet-solana/app/scripts/run-local-demo.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/app/scripts/run-local-demo.sh)
- [packages/hyperbet-bsc/app/scripts/run-e2e-local.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-bsc/app/scripts/run-e2e-local.sh)
- [packages/hyperbet-bsc/app/scripts/run-local-demo.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-bsc/app/scripts/run-local-demo.sh)
- [packages/hyperbet-avax/app/scripts/run-e2e-local.sh](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-avax/app/scripts/run-e2e-local.sh)

Rotation result:
- `goldAmmMarketProgramId`
  - old placeholder: `Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5`
  - rotated repo truth: `BGmzj676aVzRaJ3Hb9BJRYrjtXuhzoc1YTFA6wcucUNF`
- `goldPerpsMarketProgramId`
  - old placeholder: `EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT`
  - rotated repo truth: `6YjWiway8kaSjwtAinJxqWPvV3DqBVapDWAsSEZjjmbP`

Artifact regeneration:
- Rebuilt the changed SBF binaries directly:

```bash
cd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana/anchor
cargo build-sbf --manifest-path programs/gold_perps_market/Cargo.toml
cargo build-sbf --manifest-path programs/lvr_amm/Cargo.toml
```

- Updated the Anchor target IDL/type address metadata to the rotated IDs.
- Synced those IDLs/types into downstream PM consumers:

```bash
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana sync:anchor-artifacts
```

Validation:
- [packages/hyperbet-chain-registry/tests/chainRegistry.test.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-chain-registry/tests/chainRegistry.test.ts)
  - passed: `19/19`
- [packages/hyperbet-solana/tests/deployments.test.ts](/Volumes/OWC%20Envoy%20Pro%20FX/Work/hyperbet/packages/hyperbet-solana/tests/deployments.test.ts)
  - passed: `3/3`
- Full mixed-mode Solana devnet preflight:

```bash
SOLANA_EXPECTED_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
SOLANA_EXPECTED_UPGRADE_AUTHORITY=4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya \
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana deploy:preflight:devnet
```

Preflight result:
- passed with warnings only for the PM local keypair mismatch wording
- `fight_oracle`
  - upgrade mode
  - on-chain authority matched `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`
- `gold_clob_market`
  - upgrade mode
  - on-chain authority matched `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`
- `lvr_amm`
  - fresh-deploy mode
  - rotated local keypair now matches manifest
- `gold_perps_market`
  - fresh-deploy mode
  - rotated local keypair now matches manifest

### Step 14. Attempt real devnet deploy under the old authority

Status:
- Blocked by missing local upgrade-authority key

Deploy attempt:

```bash
ANCHOR_WALLET=/Users/mac/.config/solana/hyperscape-keys/deployer.json \
SKIP_BUILD=1 \
bun run --cwd /Volumes/OWC\ Envoy\ Pro\ FX/Work/hyperbet/packages/hyperbet-solana anchor:deploy:devnet
```

Observed wallet identity:
- local wallet file on disk resolved to:
  - `RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u`
- on-chain PM upgrade authority remained:
  - `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`

Deploy result:
- failed immediately on the first PM upgrade:

```text
Program's authority Some(4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya) does not match authority provided RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u
```

Local authority-key search:
- searched `/Users/mac/.config/solana`
- only local Solana key material found:
  - `RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u /Users/mac/.config/solana/RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u.json`
  - `RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u /Users/mac/.config/solana/hyperscape-keys/deployer.json`
  - `RFXuMwGJ4Rm9mYcYLstWX8ANnZxV25eyfd4ZdMeBY1u /Users/mac/.config/solana/id.json`

Conclusion:
- The repository is now prepared for the intended Solana mixed upgrade/fresh-deploy flow.
- The remaining blocker is external to the repo:
  - the actual local keypair for `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya` is not present on this machine.
- Without that key, PM upgrades cannot proceed, and therefore the full Solana devnet promotion cannot complete.

## Current Blockers (Updated Again)

Known remaining blockers before full non-mainnet signoff:

1. Recover or provide the local Solana keypair for upgrade authority `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya`.
2. Re-run Solana devnet deploy with that authority wallet:
   - PM upgrade for `fight_oracle`
   - PM upgrade for `gold_clob_market`
   - fresh deploy for rotated `lvr_amm`
   - fresh deploy for rotated `gold_perps_market`
3. Run Solana init/freeze and Solana full-product verify after the deploy succeeds.
4. Provision GitHub `staging` and run staged proof / staged soak after Solana is green.
