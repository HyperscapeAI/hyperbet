# Testnet Operations Ledger

> **Historical snapshot:** This ledger preserves the Stage-A wallet, provisioning, and funding record for the branch-era non-mainnet work. Current open-work ownership lives in [tracking-document-map.md](tracking-document-map.md) and [github-project-production-backlog.md](github-project-production-backlog.md). Use this file as evidence and provisioning history, not as the canonical blocker list.

> **TL;DR:** This is the current Stage-A non-mainnet ledger for `Solana devnet`, `BSC testnet`, and `AVAX Fuji`. Repo-level deploy/testnet secrets exist, but GitHub staged proof and staged soak are still blocked because there is no `staging` environment and no `HYPERBET_*_STAGING_*` vars or secrets provisioned yet. Local Stage-A is also still waiting on shared BSC and AVAX token-address inputs for AMM and perps rehearsal.

Single source of truth for testnet wallet generation, funding, secret storage,
and current provisioning gaps used in the Stage-A deployment flow.

## Wallet Inventory

### EVM Wallets (shared across BSC testnet and AVAX Fuji)

| Role | Address | Purpose |
|------|---------|---------|
| DEPLOYER | `0x25DFe05ea0d5bb2F96b9D351765CC5E2DB86dCC0` | Deploys contracts via CREATE2 and funds other wallets |
| ADMIN | `0x99622633cF1e476C8bD9161f5B9d4F290a1D2Ea1` | Default admin on testnet |
| REPORTER | `0xe94d0c1bBA64da68310DbfC07149E264E77b58AC` | Oracle reporter |
| FINALIZER | `0x17D1495dB7374f1814801275bB9dac84Fcb0079e` | Oracle finalizer |
| CHALLENGER | `0x2b073F23C61a420c208963C5C650FB54c82f893a` | Oracle challenger |
| PAUSER | `0xdCDeC0c831ED7Af279E724fddb127dc6134e5df6` | Emergency pauser |
| MARKET_OPERATOR | `0x99622633cF1e476C8bD9161f5B9d4F290a1D2Ea1` | Market operator on testnet |
| TREASURY | `0x5c5A3554F12875aBB63a6b8027b9A23C423F5C84` | Fee recipient |
| MARKET_MAKER | `0x1bC49a0d5232cAc83fe696AB604B0b1E58C54A41` | MM fee recipient |
| MULTISIG_SIGNER_1 | `0xFC951Ead43344CaBF775E077dcf3334BAe228730` | Multisig signer |
| MULTISIG_SIGNER_2 | `0x785fceED2d6ab37e5a22329E2ED496427A58CbE2` | Multisig signer |
| MULTISIG_SIGNER_3 | `0x62e7028DEe826a2a6F811021a5eAA379713A36C6` | Multisig signer |

### Solana Wallet

| Role | Address | Purpose |
|------|---------|---------|
| DEPLOYER / AUTHORITY | `4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya` | Deploys programs and holds testnet authority |

## GitHub Provisioning Audit (2026-03-25)

### Repo-level secrets confirmed

- `BSC_TESTNET_RPC`
- `AVAX_FUJI_RPC`
- `TESTNET_DEPLOYER_PRIVATE_KEY`
- `TESTNET_REPORTER_PRIVATE_KEY`
- `TESTNET_FINALIZER_PRIVATE_KEY`
- `TESTNET_CHALLENGER_PRIVATE_KEY`
- `TESTNET_PAUSER_PRIVATE_KEY`
- `TESTNET_TREASURY_PRIVATE_KEY`
- `TESTNET_MARKET_MAKER_PRIVATE_KEY`
- `TESTNET_MARKET_OPERATOR_PRIVATE_KEY`
- `TESTNET_SOLANA_DEPLOYER_KEYPAIR`
- repo-level address helpers such as `ADMIN_ADDRESS`, `MARKET_OPERATOR_ADDRESS`,
  `REPORTER_ADDRESS`, `TREASURY_ADDRESS`, and `MARKET_MAKER_ADDRESS`

### Missing staged provisioning

- no GitHub `staging` environment exists yet
- no staged environment secrets exist
- no staged environment vars exist
- no repo-level `HYPERBET_*_STAGING_*` vars or secrets exist

### Missing shared token and address inputs for local Stage-A

- `BSC_TESTNET_MUSD_TOKEN_ADDRESS`
- `AVAX_FUJI_MUSD_TOKEN_ADDRESS`
- `BSC_TESTNET_GOLD_TOKEN_ADDRESS`
- `AVAX_FUJI_GOLD_TOKEN_ADDRESS`
- optional perps margin token addresses when margin is not the GOLD token

## What This Means Operationally

- local Stage-A deploy and verify is partially unblocked
- local BSC and AVAX AMM/perps rehearsal is still blocked on the missing shared
  token/address inputs above
- GitHub staged proof is blocked until staged vars and secrets are provisioned
- GitHub staged soak is blocked until staged vars and secrets are provisioned

The current local Stage-A export path is:

- [scripts/export-stage-a-env.sh](../../scripts/export-stage-a-env.sh)

The current local-first runner is:

- [scripts/run-local-stage-a.ts](../../scripts/run-local-stage-a.ts)

## Current Workflow Model

### Local-first bring-up

Use local execution first:

```bash
bun run stagea:local
```

### GitHub artifactized confirmation

After local Stage-A is green and staging is provisioned, use:

- `.github/workflows/deploy-testnet-v3.yml`
- `.github/workflows/verify-testnet-deployment.yml`
- `.github/workflows/staged-live-proof.yml`
- `.github/workflows/pm-soak.yml`

These workflows now target the phase-1 full-product non-mainnet lane, not a
PM-only scope.

## Funding Records

### Initial deployer funding

| Chain | Wallet | Amount | Source |
|-------|--------|--------|--------|
| BSC testnet | DEPLOYER | 0.3 tBNB | [BNB Chain Testnet Faucet](https://www.bnbchain.org/en/testnet-faucet) |
| AVAX Fuji | DEPLOYER | 1.5 AVAX | [Core Testnet Faucet](https://core.app/tools/testnet-faucet/) |
| Solana devnet | DEPLOYER | 5.0 SOL | `solana airdrop 5 4zVqVfrY5AjqKytAEBEo3MHk2PQBj6u7bTvUcWAu9Sya --url devnet` |

### Multisig signer funding

Funded by `.github/workflows/fund-multisig-signers.yml` using
`TESTNET_DEPLOYER_PRIVATE_KEY`. Workflow run:
[#23249394641](https://github.com/HyperscapeAI/hyperbet/actions/runs/23249394641).

## Security Notes

1. All listed keys are testnet-only.
2. GitHub secrets are write-only and cannot be read back through the API.
3. Historically committed deploy keys are still treated as burned for
   production. Mainnet keys must be generated and handled separately.
4. Stage-A and staged proof should never be treated as a substitute for
   canonical mainnet registry truth.
