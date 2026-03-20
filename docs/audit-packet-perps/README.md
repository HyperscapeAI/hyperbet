# Perps Audit Packet

Audit handoff for Hyperbet perpetuals contracts. Branch: `feature/perps-hardening-v1`.

## Scope

### EVM Contracts (Solidity 0.8.20+)

| Contract | Path | Lines | Description |
|----------|------|-------|-------------|
| SkillOracle | `packages/evm-contracts/contracts/perps/SkillOracle.sol` | ~120 | Agent skill oracle with AccessControl, staleness, delta caps, pause |
| AgentPerpEngine | `packages/evm-contracts/contracts/perps/AgentPerpEngine.sol` | ~1030 | ERC20-margined perp engine with partial liquidation, insurance waterfall, fee splitting |
| AgentPerpEngineNative | `packages/evm-contracts/contracts/perps/AgentPerpEngineNative.sol` | ~620 | Native ETH-margined perp engine (same feature set) |

### Solana Program (Anchor/Rust)

| Program | Path | Lines | Description |
|---------|------|-------|-------------|
| gold_perps_market | `packages/hyperbet-solana/anchor/programs/gold_perps_market/src/lib.rs` | ~1100 | Full perps engine with config freeze, trading pause, fee splitting, OI caps |

## Threat Model

### Critical Assets
- Trader margin deposits (ERC20 or native ETH/SOL)
- Insurance fund balances (per-market)
- Fee balances (treasury + market maker)
- Oracle price data integrity

### Attack Surfaces
1. **Oracle manipulation**: Skill oracle accepts mu/sigma updates from REPORTER_ROLE. Mitigations: delta caps (500 mu, 300 sigma), staleness check, oracle pause.
2. **Price manipulation via skew**: Large positions shift execution price via skew premium. Mitigation: skewScale parameter, OI caps.
3. **Liquidation MEV**: Liquidators extract reward proportional to margin. Mitigation: partial liquidation (2x maintenance target, 10% min close), proportional reward.
4. **Insurance fund drain**: Bad debt from underwater positions. Mitigation: socialized loss cap (50bps per position), insurance waterfall, bad debt tracking.
5. **Governance takeover**: Role mutation after deployment. Mitigation: PM20 governance freeze — grantRole/revokeRole revert for all roles except PAUSER_ROLE.
6. **Reentrancy**: External calls (token transfers, native sends). Mitigation: ReentrancyGuard on all state-mutating externals.
7. **Slippage attacks**: Sandwich attacks on large trades. Mitigation: acceptablePrice parameter on modifyPosition.
8. **Config re-initialization (Solana)**: Re-calling initialize_config to bypass freeze. Mitigation: config_frozen check in both initialize_config and update_config.

### Trust Assumptions
- REPORTER_ROLE (EVM) / authority (Solana) provides honest oracle data within delta caps
- MARKET_OPERATOR_ROLE manages market lifecycle honestly
- PAUSER_ROLE is the only mutable role post-freeze (emergency response)
- CREATE2 factory at 0x4e59b44847b379578588920cA78FbF26c0B4956C is trusted

## Known Issues

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| KI-1 | Low | EVM ARCHIVED market does not enforce zero OI before archiving (Solana does) | Accepted — operator manages wind-down |
| KI-2 | Low | Native engine funding settlement uses simple margin deduction (no pool-backed credit) | Accepted — simpler model for native margin |
| KI-3 | Info | Oracle price step validation (`max_oracle_price_delta_bps`) exists only in Solana | Accepted — EVM has delta caps in SkillOracle |
| KI-4 | Info | Conservative skill score (mu - 3*sigma) tracked in ERC20 engine only, not in Native | Informational only |

## Test Evidence

### Forge Tests (EVM)
- 34 unit tests in `AgentPerpEngine.t.sol`
- 2 fuzz tests in `AgentPerpEngineFuzz.t.sol` (512 runs each)
- Balance sheet invariant: engine balance == sum(trader margins) + insurance + vault + fees
- Liquidation bad debt invariant: tracked bad debt matches actual deficit

### Coverage Areas
- Oracle: convergence, delta caps, staleness, pause, first-update bypass
- Governance: freeze on grantRole/revokeRole, frozen setters, PAUSER_ROLE allowed
- Risk: partial liquidation, insurance waterfall, close-only mode, archived market
- Parity: slippage protection, fee splitting, OI caps, settlement price freeze
- Fuzz: balance sheet conservation across random trade sequences

### CI
- `ci.yml`: perps-contract-tests job (forge test with fuzz 512)
- `prediction-market-gates.yml`: perps-forge-gate + perps-solana-gate

## Parity Matrix

See `docs/perps-parity-matrix.md` for full EVM/SVM feature comparison.

## Deployment

- EVM: CREATE2 via `scripts/deploy-perps-create2.ts` for deterministic addresses
- Solana: Program ID `HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik`
- Chain registry: `skillOracleAddress` + `perpEngineAddress` fields in BettingEvmDeployment

## Dependencies

- OpenZeppelin Contracts 5.x (AccessControl, ReentrancyGuard, SafeERC20, Math)
- Anchor 0.32.x (Solana)
- Foundry (testing)
