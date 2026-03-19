# Testnet Operations Ledger

Single source of truth for all testnet wallet generation, funding, secret storage, and governance configuration used in the Stage A deployment flow.

---

## Wallet Inventory

### EVM Wallets (shared across BSC Testnet, AVAX Fuji)

| Role | Address | Purpose |
|------|---------|---------|
| DEPLOYER | `0x25DFe05ea0d5bb2F96b9D351765CC5E2DB86dCC0` | Deploys contracts via CREATE2, funds other wallets |
| ADMIN | `0x99622633cF1e476C8bD9161f5B9d4F290a1D2Ea1` | DEFAULT_ADMIN_ROLE holder (will be replaced by timelock) |
| REPORTER | `0xe94d0c1bBA64da68310DbfC07149E264E77b58AC` | Oracle REPORTER_ROLE — proposes duel results |
| FINALIZER | `0x17D1495dB7374f1814801275bB9dac84Fcb0079e` | Oracle FINALIZER_ROLE — finalizes after dispute window |
| CHALLENGER | `0x2b073F23C61a420c208963C5C650FB54c82f893a` | Oracle CHALLENGER_ROLE — challenges proposals |
| PAUSER | `0xdCDeC0c831ED7Af279E724fddb127dc6134e5df6` | PAUSER_ROLE — emergency pause on oracle + CLOB |
| MARKET_OPERATOR | `0x99622633cF1e476C8bD9161f5B9d4F290a1D2Ea1` | Creates markets (same as ADMIN for testnet) |
| TREASURY | `0x5c5A3554F12875aBB63a6b8027b9A23C423F5C84` | Receives trading fees |
| MARKET_MAKER | `0x1bC49a0d5232cAc83fe696AB604B0b1E58C54A41` | Receives market maker fees on winnings |
| MULTISIG_SIGNER_1 | `0xFC951Ead43344CaBF775E077dcf3334BAe228730` | Multisig signer (1 of 3) |
| MULTISIG_SIGNER_2 | `0x785fceED2d6ab37e5a22329E2ED496427A58CbE2` | Multisig signer (2 of 3) |
| MULTISIG_SIGNER_3 | `0x62e7028DEe826a2a6F811021a5eAA379713A36C6` | Multisig signer (3 of 3) |

### Solana Wallet

| Role | Address | Purpose |
|------|---------|---------|
| DEPLOYER / AUTHORITY | `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya` | Deploys programs, holds config authority and upgrade authority |

---

## Multisig Configuration

- **Type:** Safe (Gnosis Safe) on EVM chains
- **Threshold:** 3-of-3 (all signers required)
- **Signers:** MULTISIG_SIGNER_1, MULTISIG_SIGNER_2, MULTISIG_SIGNER_3
- **Purpose:** Owns the TimelockController, which holds DEFAULT_ADMIN_ROLE on production contracts
- **Solana equivalent:** Squads multisig (to be deployed on devnet)

---

## GitHub Secrets Inventory

All private keys are stored as GitHub Actions secrets in `HyperscapeAI/hyperbet`. Local copies were deleted after storage.

| Secret Name | Corresponds To | Created |
|-------------|---------------|---------|
| `TESTNET_DEPLOYER_PRIVATE_KEY` | DEPLOYER EVM wallet | 2026-03-18 |
| `TESTNET_REPORTER_PRIVATE_KEY` | REPORTER EVM wallet | 2026-03-18 |
| `TESTNET_FINALIZER_PRIVATE_KEY` | FINALIZER EVM wallet | 2026-03-18 |
| `TESTNET_CHALLENGER_PRIVATE_KEY` | CHALLENGER EVM wallet | 2026-03-18 |
| `TESTNET_PAUSER_PRIVATE_KEY` | PAUSER EVM wallet | 2026-03-18 |
| `TESTNET_TREASURY_PRIVATE_KEY` | TREASURY EVM wallet | 2026-03-18 |
| `TESTNET_MARKET_MAKER_PRIVATE_KEY` | MARKET_MAKER EVM wallet | 2026-03-18 |
| `TESTNET_MULTISIG_SIGNER_1_PRIVATE_KEY` | MULTISIG_SIGNER_1 | 2026-03-18 |
| `TESTNET_MULTISIG_SIGNER_2_PRIVATE_KEY` | MULTISIG_SIGNER_2 | 2026-03-18 |
| `TESTNET_MULTISIG_SIGNER_3_PRIVATE_KEY` | MULTISIG_SIGNER_3 | 2026-03-18 |
| `TESTNET_SOLANA_DEPLOYER_KEYPAIR` | Solana DEPLOYER (JSON byte array) | 2026-03-18 |

Additional repository-level secrets used by the Stage A workflows:

| Secret Name | Purpose |
|-------------|---------|
| `ADMIN_ADDRESS` | Shared EVM admin role address |
| `MARKET_OPERATOR_ADDRESS` | Shared EVM market-operator role address |
| `REPORTER_ADDRESS` | Shared EVM reporter address when not derived from key |
| `TREASURY_ADDRESS` | Shared EVM treasury address when not derived from key |
| `MARKET_MAKER_ADDRESS` | Shared EVM market-maker address when not derived from key |
| `BSC_TESTNET_RPC` | BSC Testnet RPC URL |
| `AVAX_FUJI_RPC` | AVAX Fuji RPC URL |

**Access pattern:** Secrets are consumed by GitHub Actions workflows only. They cannot be read back via the API (write-only). The `fund-multisig-signers.yml` workflow demonstrates the pattern for using deployer keys in CI.

### Secret Consumption Model

All Stage A deployment and verification runs through GitHub Actions workflows using **repository-level secrets**. There is no `staging` environment requirement for the current Stage A path. Operators do not need private keys on their machines.

The workflows map repo secrets to the env surface consumed by `deploy-create2.ts`, `packages/hyperbet-solana/scripts/init-pm-config.ts`, and the verification scripts:

| Runtime env | Secret source |
|-------------|--------------|
| `PRIVATE_KEY` | `TESTNET_DEPLOYER_PRIVATE_KEY` |
| `BSC_TESTNET_RPC` | `BSC_TESTNET_RPC` |
| `AVAX_FUJI_RPC` | `AVAX_FUJI_RPC` |
| `ADMIN_ADDRESS` | `ADMIN_ADDRESS` |
| `MARKET_OPERATOR_ADDRESS` | `MARKET_OPERATOR_ADDRESS` |
| `REPORTER_ADDRESS` | `REPORTER_ADDRESS` or `TESTNET_REPORTER_PRIVATE_KEY` |
| `FINALIZER_ADDRESS` | derived from `TESTNET_FINALIZER_PRIVATE_KEY` |
| `CHALLENGER_ADDRESS` | derived from `TESTNET_CHALLENGER_PRIVATE_KEY` |
| `PAUSER_ADDRESS` | derived from `TESTNET_PAUSER_PRIVATE_KEY` |
| `TREASURY_ADDRESS` | `TREASURY_ADDRESS` or `TESTNET_TREASURY_PRIVATE_KEY` |
| `MARKET_MAKER_ADDRESS` | `MARKET_MAKER_ADDRESS` or `TESTNET_MARKET_MAKER_PRIVATE_KEY` |
| `ANCHOR_WALLET` | temp runner file materialized from `TESTNET_SOLANA_DEPLOYER_KEYPAIR` |
| `SOLANA_EXPECTED_AUTHORITY` | derived from the temp `ANCHOR_WALLET` via `solana-keygen pubkey` |
| `SOLANA_EXPECTED_UPGRADE_AUTHORITY` | derived from the temp `ANCHOR_WALLET` via `solana-keygen pubkey` |

The runtime export happens through [`scripts/export-stage-a-env.sh`](/Users/mac/Desktop/hyperbet/.claude/worktrees/blissful-golick/scripts/export-stage-a-env.sh), which validates that any stored public address matches its paired private key when both are present before exporting the effective Stage A env.

---

## Funding Records

### Initial Deployer Funding (by user, via faucets)

| Chain | Wallet | Amount | Source |
|-------|--------|--------|--------|
| BSC Testnet | DEPLOYER | 0.3 tBNB | [BNB Chain Testnet Faucet](https://www.bnbchain.org/en/testnet-faucet) |
| AVAX Fuji | DEPLOYER | 1.5 AVAX | [Core Testnet Faucet](https://core.app/tools/testnet-faucet/) |
| Solana Devnet | DEPLOYER | 5.0 SOL | `solana airdrop 5 4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya --url devnet` |

### Multisig Signer Funding (automated via CI workflow)

Funded by `.github/workflows/fund-multisig-signers.yml` using `TESTNET_DEPLOYER_PRIVATE_KEY` from GitHub Secrets. Workflow run: [#23249394641](https://github.com/HyperscapeAI/hyperbet/actions/runs/23249394641).

| Chain | Wallet | Amount | Tx Hash |
|-------|--------|--------|---------|
| BSC Testnet | MULTISIG_SIGNER_1 | 0.010 tBNB | `0x25102368c7d8af26d4929b02df00fb50b09c884ab417e31bdbdf0e399916e673` (first run) + second run |
| BSC Testnet | MULTISIG_SIGNER_2 | 0.005 tBNB | Via workflow run #23249394641 |
| BSC Testnet | MULTISIG_SIGNER_3 | 0.005 tBNB | Via workflow run #23249394641 |
| AVAX Fuji | MULTISIG_SIGNER_1 | 0.020 AVAX | Via workflow run #23249394641 |
| AVAX Fuji | MULTISIG_SIGNER_2 | 0.020 AVAX | Via workflow run #23249394641 |
| AVAX Fuji | MULTISIG_SIGNER_3 | 0.020 AVAX | Via workflow run #23249394641 |

### Balance Snapshot (post-funding, 2026-03-18)

| Wallet | BSC Testnet | AVAX Fuji | Solana Devnet |
|--------|-----------|----------|--------------|
| DEPLOYER | 0.280 tBNB | 1.440 AVAX | 5.000 SOL |
| MULTISIG_SIGNER_1 | 0.010 tBNB | 0.020 AVAX | — |
| MULTISIG_SIGNER_2 | 0.005 tBNB | 0.020 AVAX | — |
| MULTISIG_SIGNER_3 | 0.005 tBNB | 0.020 AVAX | — |

---

## Key Generation Method

- **EVM wallets:** Generated via `cast wallet new` (Foundry). Each role got a fresh keypair. Private keys were immediately stored in GitHub Secrets and deleted from local filesystem.
- **Solana wallet:** Generated via `solana-keygen new`. Keypair JSON stored in GitHub Secrets as `TESTNET_SOLANA_DEPLOYER_KEYPAIR`.
- **No key reuse** across roles. Each role has a unique keypair.
- **No mainnet keys** were generated. These are testnet-only. Mainnet keys will be generated fresh during the Stage B ceremony.

---

## CI Workflows Using Secrets

| Workflow | Secrets Used | Purpose |
|----------|-------------|---------|
| `fund-multisig-signers.yml` | `TESTNET_DEPLOYER_PRIVATE_KEY` | Sends gas to multisig signers |
| `deploy-testnet-v3.yml` | repo-level Stage A secrets listed above | While branch-only, a push to `enoomian/pm16-17-20-21` triggers PM-scope deploy + verify for BSC Testnet, AVAX Fuji, and Solana devnet |
| `verify-testnet-deployment.yml` | repo-level Stage A secrets listed above | Verifies deployed testnet PM surfaces and writes structured artifacts |

---

## Security Notes

1. **All keys are testnet-only.** They hold zero real value. Compromise has no financial impact.
2. **GitHub Secrets are write-only.** Once stored, they cannot be read back via API or CLI. They are only injected into workflow runtime.
3. **Local copies were deleted** immediately after GitHub Secret storage was confirmed. The only exception in Stage A is the temporary runner-local `ANCHOR_WALLET` file materialized from `TESTNET_SOLANA_DEPLOYER_KEYPAIR` during workflow execution.
4. **Mainnet keys will be generated separately** during the Stage B ceremony, following the same role separation but with hardware wallet / multisig custody.
5. **The funding workflow** (`fund-multisig-signers.yml`) is triggered by push to `enoomian/pm16-17-20-21` when its own file changes. It should be removed or disabled before merge to `develop`.
6. **The Stage A PM deploy workflow** (`deploy-testnet-v3.yml`) is also push-triggered on `enoomian/pm16-17-20-21` while it remains off the default branch, because branch-only `workflow_dispatch` cannot be invoked from GitHub CLI/API.

---

## Chain Configuration Summary

| Parameter | BSC Testnet | AVAX Fuji | Solana Devnet |
|-----------|-----------|----------|--------------|
| Chain ID | 97 | 43113 | devnet |
| RPC | `https://data-seed-prebsc-1-s1.bnbchain.org:8545` | Alchemy (via env) | `https://api.devnet.solana.com` |
| Block Explorer | `https://testnet.bscscan.com` | `https://testnet.snowtrace.io` | `https://explorer.solana.com/?cluster=devnet` |
| Gas Token | tBNB | AVAX | SOL |
| CREATE2 Proxy | Arachnid (`0x4e59b44847b379578588920ca78fbf26c0b4956c`) | Same | N/A |
| Salt Policy | `keccak256("hyperbet/v3/{ContractName}")` | Same | N/A |
