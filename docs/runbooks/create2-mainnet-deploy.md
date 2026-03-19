# CREATE2 Deterministic Deployment — Mainnet Runbook

> **Version**: v3 — CREATE2 redeployment  
> **Factory**: Arachnid Deterministic Deployment Proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`)

## Pre-flight (all chains)

### 1. Compute deterministic addresses
```bash
npx hardhat run scripts/predict-create2-addresses.ts
```
Record both predicted addresses — they will be identical on every chain.

### 2. Verify Arachnid proxy exists on target chain
```bash
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url $RPC_URL
# Must return non-empty bytecode
```

### 3. Fund deployer wallet
- Same deployer EOA on all chains
- Required: ~0.1 native token per chain for gas

### 4. Prepare governance wallet addresses
All addresses **must be identical** across chains for CREATE2 address parity:

| Role | Env Var |
|---|---|
| Admin/Timelock | `ADMIN_ADDRESS` |
| Reporter | `REPORTER_ADDRESS` |
| Finalizer | `FINALIZER_ADDRESS` |
| Challenger | `CHALLENGER_ADDRESS` |
| Pauser | `PAUSER_ADDRESS` |
| Market Operator | `MARKET_OPERATOR_ADDRESS` |
| Treasury | `TREASURY_ADDRESS` |
| Market Maker | `MARKET_MAKER_ADDRESS` |
| Dispute Window | `DISPUTE_WINDOW_SECONDS` (default: 3600) |

---

## Rehearsal: Testnet Deploy

### 5. Deploy to AVAX Fuji
```bash
ADMIN_ADDRESS=0x... REPORTER_ADDRESS=0x... FINALIZER_ADDRESS=0x... \
CHALLENGER_ADDRESS=0x... MARKET_OPERATOR_ADDRESS=0x... \
TREASURY_ADDRESS=0x... MARKET_MAKER_ADDRESS=0x... \
npx hardhat run scripts/deploy-create2.ts --network avaxFuji
```

### 6. Deploy to BSC Testnet
```bash
# Same governance vars as step 5
npx hardhat run scripts/deploy-create2.ts --network bscTestnet
```

### 7. Deploy to Base Sepolia
```bash
npx hardhat run scripts/deploy-create2.ts --network baseSepolia
```

### 8. Verify address parity across testnets
```bash
diff <(jq .duelOracleAddress deployments/avaxFuji.json) \
     <(jq .duelOracleAddress deployments/bscTestnet.json)
diff <(jq .duelOracleAddress deployments/avaxFuji.json) \
     <(jq .duelOracleAddress deployments/baseSepolia.json)
# Both diffs must be empty
```

### 9. Run bootstrap smoke on each testnet
```bash
# Verify full lifecycle: upsert → bet → propose → finalize → claim
node packages/hyperbet-avax/keeper/avax-fuji-bootstrap.mjs --scenario unmatched-gtc
```

### 10. Signoff checkpoint
- [ ] All testnet addresses match
- [ ] Bootstrap smoke passes on all testnets
- [ ] Parity tests pass in CI
- [ ] Governance roles confirmed on-chain via block explorer

---

## Mainnet Deploy

### 11. Deploy to BSC Mainnet
```bash
npx hardhat run scripts/deploy-create2.ts --network bsc
```

### 12. Deploy to Base Mainnet
```bash
npx hardhat run scripts/deploy-create2.ts --network base
```

### 13. Deploy to AVAX Mainnet
```bash
npx hardhat run scripts/deploy-create2.ts --network avax
```

### 14. Verify mainnet address parity
Same diff checks as testnet step 8.

### 15. Update chain registry
Verify the deployment receipts match and update `hyperbet-chain-registry` with v3 addresses.

### 16. Block explorer verification
For each chain, verify:
- [ ] Contract source matches committed Solidity
- [ ] Constructor args decode correctly
- [ ] Roles assigned as expected
- [ ] `duelOracle` on GoldClob points to correct oracle

### 17. Staged live proof
```bash
gh workflow run staged-live-proof.yml -f target=all -f mode=read-only
# After review:
gh workflow run staged-live-proof.yml -f target=all -f mode=canary-write
```

---

## Post-deploy

### 18. Archive old addresses
Update `docs/release/deprecated-v2-addresses.md` with deprecation date.

### 19. Update downstream consumers
- Chain registry ✅ (step 15)
- Keeper configs
- UI contract references
- Block explorer links in docs

---

## Adding a New Chain (Post-Refactor)

After the data-driven refactor, extending to a new EVM chain requires:

1. Add network block to `hardhat.config.ts` (6 lines)
2. Add deployment entry to chain registry `EVM_DEPLOYMENTS` (25 lines)
3. Run `npx hardhat run scripts/deploy-create2.ts --network newChain`

**Addresses will be identical** — CREATE2 guarantees same address from same args.
