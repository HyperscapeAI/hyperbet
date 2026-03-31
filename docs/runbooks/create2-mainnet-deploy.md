# CREATE2 Deterministic Deployment Runbook

> **TL;DR:** This runbook covers the EVM portion of the phase-1 launch train. The active production-readiness EVM chain is `BSC`. `AVAX` remains a preserved but isolated follow-on lane, and `Base` remains an optional add-chain rehearsal lane. PM CREATE2 deployment must be followed by AMM and perps deployment plus full-product verification before any registry values are promoted.

> **Factory:** Arachnid Deterministic Deployment Proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`)

## Preflight

Current scope note:

- blocking EVM path: `BSC`
- preserved but isolated follow-on lane: `AVAX`
- when this runbook mentions AVAX below, treat it as preserved operational
  guidance, not a blocker for the current signoff decision

1. Compute deterministic PM addresses:

```bash
npx hardhat run scripts/predict-create2-addresses.ts
```

2. Verify the deterministic deployment proxy exists on the target chain:

```bash
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url "$RPC_URL"
```

3. Confirm governance and operator addresses are finalized for the target
   environment:

- `ADMIN_ADDRESS`
- `REPORTER_ADDRESS`
- `FINALIZER_ADDRESS`
- `CHALLENGER_ADDRESS`
- `PAUSER_ADDRESS`
- `MARKET_OPERATOR_ADDRESS`
- `TREASURY_ADDRESS`
- `MARKET_MAKER_ADDRESS`

4. Confirm shared token inputs for AMM and perps exist for the target
   environment:

- `MUSD_TOKEN_ADDRESS`
- `GOLD_TOKEN_ADDRESS`
- perps margin token address when distinct from `GOLD_TOKEN_ADDRESS`

## Testnet Rehearsal

### BSC testnet

```bash
npx hardhat run scripts/deploy-create2.ts --network bscTestnet
npx hardhat run scripts/deploy-amm.ts --network bscTestnet
npx hardhat run scripts/deploy-perps.ts --network bscTestnet
node --import tsx scripts/verify-deployment.ts --network bscTestnet
```

### AVAX Fuji

```bash
npx hardhat run scripts/deploy-create2.ts --network avaxFuji
npx hardhat run scripts/deploy-amm.ts --network avaxFuji
npx hardhat run scripts/deploy-perps.ts --network avaxFuji
node --import tsx scripts/verify-deployment.ts --network avaxFuji
```

### Optional Base add-chain rehearsal

```bash
npx hardhat run scripts/deploy-create2.ts --network baseSepolia
npx hardhat run scripts/deploy-amm.ts --network baseSepolia
npx hardhat run scripts/deploy-perps.ts --network baseSepolia
node --import tsx scripts/verify-deployment.ts --network baseSepolia
```

## Promotion Rules

- Do not promote testnet receipts into mainnet registry truth.
- Do not treat Base success as a phase-1 blocker or phase-1 completion signal.
- Do not treat PM CREATE2 success alone as full-product completion. AMM,
  perps, and full-product verification must also pass.

## Mainnet Sequence

### BSC mainnet

```bash
npx hardhat run scripts/deploy-create2.ts --network bsc
npx hardhat run scripts/deploy-amm.ts --network bsc
npx hardhat run scripts/deploy-perps.ts --network bsc
node --import tsx scripts/verify-deployment.ts --network bsc
```

### AVAX mainnet

```bash
npx hardhat run scripts/deploy-create2.ts --network avax
npx hardhat run scripts/deploy-amm.ts --network avax
npx hardhat run scripts/deploy-perps.ts --network avax
node --import tsx scripts/verify-deployment.ts --network avax
```

### Optional Base mainnet after phase-1

```bash
npx hardhat run scripts/deploy-create2.ts --network base
npx hardhat run scripts/deploy-amm.ts --network base
npx hardhat run scripts/deploy-perps.ts --network base
node --import tsx scripts/verify-deployment.ts --network base
```

## Registry And Evidence

After final mainnet verification succeeds:

1. Update `packages/hyperbet-chain-registry/src/index.ts` from final receipts
   only.
2. Archive deployment receipts and verify outputs.
3. Capture staged proof and soak evidence against the promoted environment.
4. Record governance transfer and freeze transaction hashes.

For the current production-readiness path, only the BSC outputs above are
blocking. AVAX outputs remain preserved follow-on artifacts unless the lane is
explicitly reactivated.
