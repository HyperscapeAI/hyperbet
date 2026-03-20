# Perps EVM/SVM Parity Matrix

Feature parity status between EVM perps engines and Solana `gold_perps_market`.

## Legend

- **G** = Implemented (green)
- **Y** = Partial / variant implementation (yellow)
- **R** = Not implemented (red)

## Core Trading

| Feature | AgentPerpEngine (ERC20) | AgentPerpEngineNative (Native ETH) | gold_perps_market (Solana) |
|---------|:-:|:-:|:-:|
| Open/close long & short positions | G | G | G |
| Skew-based execution pricing | G | G | G |
| Margin deposit & withdrawal | G | G | G |
| Funding rate accrual (skew × velocity) | G | G | G |
| Slippage protection (`acceptablePrice`) | G | G | G |

## Market Lifecycle

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Market creation (operator-gated) | G | G | G |
| ACTIVE → CLOSE_ONLY → ARCHIVED lifecycle | G | G | G |
| CLOSE_ONLY allows position reductions only | G | G | G |
| ARCHIVED blocks all trades | G | G | G |
| Settlement price frozen on CLOSE_ONLY | G | G | G |
| Archive requires zero OI / zero positions | R | R | G |

## Risk Engine

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Maintenance margin check | G | G | G |
| Max leverage enforcement | G | G | G |
| Partial liquidation (2x maintenance target) | G | G | R |
| Full liquidation fallback | G | G | G |
| Liquidation reward (proportional to closed size) | G | G | G |
| Insurance waterfall (socialized loss cap 50bps) | G | Y | R |
| Bad debt tracking | G | Y | R |
| Oracle staleness blocks new positions | G | G | G |
| Open interest caps (`maxOpenInterest`) | G | G | G |

## Fee Model

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Treasury fee (per-trade, bps on notional) | G | G | G |
| Market maker fee (per-trade, bps on notional) | G | G | G |
| Per-market fee balance tracking | G | G | G |
| Fee withdrawal by bucket (treasury/MM) | G | G | G |
| MM fee recycle to insurance | G | G | G |

## Insurance

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Per-market insurance fund isolation | G | G | G |
| Insurance deposit (admin, repays bad debt first) | G | G | G |
| Insurance withdrawal (admin) | G | G | R |
| Minimum market insurance requirement | R | R | G |

## Oracle

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Staleness check (`maxOracleDelay`) | G | G | G |
| Mu/sigma delta caps per update | G | G | Y |
| Oracle pause mechanism | G | G | R |
| Oracle price step validation (`max_oracle_price_delta_bps`) | R | R | G |
| Conservative skill score (mu - 3σ) | G | R | R |

## Governance

| Feature | ERC20 | Native | Solana |
|---------|:-:|:-:|:-:|
| Role-based access (Admin/Operator/Pauser) | G | G | G |
| Governance surface freeze (PM20 pattern) | G | G | G |
| Config freeze (one-way) | G | G | G |
| Trading pause (PAUSER_ROLE / authority) | G | G | G |
| Market creation pause | G | R | R |

## Known Gaps (Deferred)

| Gap | Risk | Notes |
|-----|------|-------|
| Oracle price step validation (EVM) | Low | Delta caps in SkillOracle provide similar protection |
| Archive requires zero positions (EVM) | Low | Operator must manage position wind-down manually |
| Minimum market insurance (EVM) | Low | Admin controls deposits; can enforce off-chain |
| Conservative skill score (Native) | Low | Not used for pricing; informational in ERC20 engine |
| Partial liquidation (Solana) | Medium | Solana uses full liquidation only; viable for v1 |
