# Auditor Build & Test Guide

> **TL;DR:** `bun install && cd packages/evm-contracts && forge test && bun x hardhat test` runs 152 EVM tests. Solidity 0.8.33, Foundry, Hardhat 2.28.x, Anchor 0.31.x. No secrets needed for local testing. Entry points: `DuelOutcomeOracle.sol`, `GoldClob.sol` (EVM); `fight_oracle/lib.rs`, `gold_clob_market/lib.rs` (Solana).

## Toolchain Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Bun | >= 1.3.x | Package manager, test runner, TypeScript execution |
| Foundry (forge) | >= 0.3.x | Solidity compilation, fuzz testing, gas analysis |
| Hardhat | 2.28.x (via bun) | Solidity testing, network simulation |
| Solidity | 0.8.33 | Smart contract compiler (managed by Foundry/Hardhat) |
| Anchor | >= 0.31.x | Solana program framework (for Solana program review) |
| Rust | >= 1.75.x | Solana program compilation |

## Quick Start

```bash
# Clone and install
git clone <repo>
cd hyperbet
bun install --frozen-lockfile

# EVM contracts — compile
cd packages/evm-contracts
forge build

# EVM contracts — run all tests
forge test                    # Foundry (fuzz + unit)
bun x hardhat test            # Hardhat (integration)

# Fuzz with extended runs (recommended for audit)
forge test --fuzz-runs 1024

# Deployment manifest tests
cd ../..
bun test packages/hyperbet-bsc/tests/ packages/hyperbet-avax/tests/ packages/hyperbet-evm/tests/ packages/hyperbet-solana/tests/

# TypeScript type checks
bun x tsc --noEmit -p packages/hyperbet-solana/app/tsconfig.json
bun x tsc --noEmit -p packages/hyperbet-bsc/app/tsconfig.json
bun x tsc --noEmit -p packages/hyperbet-avax/app/tsconfig.json

# Market maker tests
bun run --cwd packages/market-maker-bot test

# Keeper tests (all chains)
bun test packages/hyperbet-solana/keeper/src/*.test.ts
bun test packages/hyperbet-bsc/keeper/src/*.test.ts
bun test packages/hyperbet-avax/keeper/src/*.test.ts
```

## Contract Entry Points

### EVM (audit scope)
- `packages/evm-contracts/contracts/DuelOutcomeOracle.sol` — oracle lifecycle, dispute, settlement
- `packages/evm-contracts/contracts/GoldClob.sol` — order book, matching, claims, fees

### Solana (audit scope)
- `packages/hyperbet-solana/anchor/programs/fight_oracle/src/lib.rs` — oracle lifecycle
- `packages/hyperbet-solana/anchor/programs/gold_clob_market/src/lib.rs` — order book, matching, claims

### Supporting (reference only)
- `packages/hyperbet-chain-registry/src/index.ts` — deployment manifest and chain config
- `packages/evm-contracts/scripts/deploy-create2.ts` — CREATE2 deployment tooling

## Test Suites by Category

| Suite | Path | Framework | Focus |
|-------|------|-----------|-------|
| OracleFinality.t.sol | test/OracleFinality.t.sol | Foundry | Oracle state machine fuzz |
| OracleFinality.ts | test/OracleFinality.ts | Hardhat | Oracle lifecycle invariants |
| GoldClobCanonical.ts | test/GoldClobCanonical.ts | Hardhat | CLOB matching, orders, settlement |
| GoldClobSettlement.t.sol | test/GoldClobSettlement.t.sol | Foundry | Settlement correctness |
| GoldClobFuzz.t.sol | test/fuzz/GoldClobFuzz.t.sol | Foundry | Claim/cancel fuzz |
| ExploitSuite.t.sol | test/ExploitSuite.t.sol | Foundry | Security exploit scenarios |
| PrecisionDoS.t.sol | test/PrecisionDoS.t.sol | Foundry | Precision edge cases |
| Create2Parity.ts | test/Create2Parity.ts | Hardhat | CREATE2 deployment parity |
| Create2CrossChain.ts | test/Create2CrossChain.ts | Hardhat | Cross-chain address verification |

## Environment Variables

No secrets are required for local testing. All tests use Hardhat's built-in accounts or Foundry's test addresses. For deployment scripts, see `docs/runbooks/create2-mainnet-deploy.md`.
