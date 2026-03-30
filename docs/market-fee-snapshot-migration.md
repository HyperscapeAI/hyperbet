# Market Fee Snapshot Migration Notes

## Settlement-critical fee fields

For settlement determinism, the **winnings market maker fee** is settlement-critical and must be snapshotted per market at market creation. This is the fee consumed by `claim()` when a resolved market pays out winning shares.

For accounting consistency and forensic reconciliation, this change also snapshots the **trade fee fields** at market creation:

- `tradeTreasuryFeeBps`
- `tradeMarketMakerFeeBps`

These trade snapshots are persisted on market state and ABI/IDL surfaces for observability, while current execution paths for order placement still use the active config values.

## EVM (`GoldClob`)

- `Market` now includes immutable per-market fee snapshots:
  - `tradeTreasuryFeeBpsSnapshot`
  - `tradeMarketMakerFeeBpsSnapshot`
  - `winningsMarketMakerFeeBpsSnapshot`
- Snapshots are initialized in `createMarketForDuel` from global fee config at creation time.
- `claim()` now computes winner fee from `winningsMarketMakerFeeBpsSnapshot`.

### Existing deployed markets

Existing markets on already-deployed contracts keep their original storage layout and behavior. The new snapshot fields apply to markets created after deploying this contract version.

## Solana (`gold_clob_market`)

- `MarketState` now includes per-market fee snapshots:
  - `trade_treasury_fee_bps_snapshot`
  - `trade_market_maker_fee_bps_snapshot`
  - `winnings_market_maker_fee_bps_snapshot`
- Snapshots are initialized in `initialize_market` from `MarketConfig`.
- `claim()` now computes winner fee from `market_state.winnings_market_maker_fee_bps_snapshot`.

### Existing market accounts

This is an account layout change. Existing `MarketState` accounts created under the prior layout are not in-place upgradable and should be treated as legacy state.

Recommended rollout:

1. Deploy updated program and publish updated IDL.
2. Create new markets under the new layout for post-upgrade operation.
3. Keep legacy markets claimable under the legacy program deployment path, or settle and retire them prior to cutover.

## ABI / IDL versioning

- EVM ABI for `getMarket` tuple is expanded with snapshot fields.
- Solana IDL `marketState` account type is expanded with snapshot fee fields.

Consumers should refresh generated clients/types before release.
