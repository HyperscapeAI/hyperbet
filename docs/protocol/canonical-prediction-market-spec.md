# Canonical Prediction Market Protocol Spec (EVM + SVM)

## Scope

This specification defines the canonical behaviors for the duel-winner CLOB market implemented by:

- EVM: `DuelOutcomeOracle` + `GoldClob`
- SVM (Solana): `fight_oracle` + `gold_clob_market`

The spec covers:

1. lifecycle transitions
2. order semantics
3. settlement and fee math
4. cancellation and refund behavior

## 1) Lifecycle Transitions

### 1.1 Oracle duel lifecycle

Canonical duel states:

- `SCHEDULED`
- `BETTING_OPEN`
- `LOCKED`
- `RESOLVED`
- `CANCELLED`

Valid transitions:

- `NULL -> {SCHEDULED|BETTING_OPEN|LOCKED}` (first upsert)
- `SCHEDULED -> BETTING_OPEN|LOCKED`
- `BETTING_OPEN -> LOCKED`
- `LOCKED -> RESOLVED|CANCELLED`
- `SCHEDULED|BETTING_OPEN -> CANCELLED`

Forbidden transitions:

- any transition out of `RESOLVED`
- any transition out of `CANCELLED`
- backward transitions (e.g., `LOCKED -> BETTING_OPEN`)

Required guards:

- participants must be present and distinct
- `bet_open_ts > 0`
- `bet_close_ts > bet_open_ts`
- `duel_start_ts >= bet_close_ts`
- `duel_end_ts >= bet_close_ts` for resolution
- `winner ∈ {A, B}` for resolution

### 1.2 Market lifecycle

Canonical market statuses:

- `OPEN`
- `LOCKED`
- `RESOLVED`
- `CANCELLED`

Oracle-to-market mapping:

- `BETTING_OPEN -> OPEN`
- `LOCKED -> LOCKED`
- `RESOLVED -> RESOLVED`
- `CANCELLED -> CANCELLED`
- `SCHEDULED -> LOCKED` on SVM (fail-closed pre-open behavior)

Market creation is allowed only when duel lifecycle is marketable:

- EVM: `BETTING_OPEN` or `LOCKED`
- SVM: `BettingOpen` or `Locked`

## 2) Order Semantics

### 2.1 Market kind and side model

Canonical market kind:

- duel winner only (`market_kind = 0` on EVM, `market_kind = 1` on SVM instruction surface)

Canonical side encoding:

- Bid / Buy side (`BUY_SIDE` / `SIDE_BID`) = 1
- Ask / Sell side (`SELL_SIDE` / `SIDE_ASK`) = 2

### 2.2 Price and amount domain

Canonical price domain:

- integer ticks in `(0, 1000)`

Canonical amount domain:

- share quantity represented in integer units
- EVM requires `amount % 1000 == 0`
- SVM enforces exact divisibility through `quote_cost` precision check (`amount * price_component` must divide by `1000`)

### 2.3 Matching and resting

- Orders may cross and match immediately against the opposite side FIFO queue at each price level.
- Remaining unmatched quantity rests on-book at the submitted limit price.
- Best bid / best ask are derived from side bitmaps.
- Matching is bounded per transaction:
  - EVM loop safety bound: 100 iterations
  - SVM loop safety bound: 50 matches per instruction

### 2.4 Order cancellation

- Only maker may cancel an active order.
- Filled or inactive orders cannot be cancelled.
- Remaining notional is refunded from escrow/vault.

## 3) Settlement + Fee Math

## 3.1 Quote cost

Let:

- `P = price` in ticks
- `A = amount` in shares
- `MAX_PRICE = 1000`

Then:

- Bid-side lock/cost: `cost_bid = A * P / 1000`
- Ask-side lock/cost: `cost_ask = A * (1000 - P) / 1000`

Both chains enforce:

- non-zero cost (`CostTooLow` equivalent)
- exact integer arithmetic over 1000-tick domain

## 3.2 Trade-time fees

Trade fees are charged only on executed taker cost:

- treasury fee = `executed_cost * trade_treasury_fee_bps / 10_000`
- market-maker fee = `executed_cost * trade_market_maker_fee_bps / 10_000`

Funding semantics:

- resting GTC size leaves only quote cost locked in the book;
- IOC remainders, post-only rejections, and cancel-taker STP remainders refund unused value immediately;
- user-initiated cancels refund the full unfilled quote cost with no execution fee on the cancelled size.

Fee cap invariants:

- `trade_treasury_fee_bps + trade_market_maker_fee_bps <= 10_000`
- `winnings_market_maker_fee_bps <= 10_000`

## 3.3 Claim settlement

When market is `RESOLVED`:

- payout base = winning shares only
- winnings fee = `winning_shares * winnings_market_maker_fee_bps / 10_000`
- net payout = `winning_shares - winnings_fee`

When market is `CANCELLED`:

- payout = locked stake on both sides (`a_stake + b_stake` / `a_locked + b_locked`)

No payout is allowed in non-final states.

## 4) Cancellation Behavior

### 4.1 Duel cancellation

Oracle reporter role/authority can cancel a duel unless finalized.

Effects:

- duel state transitions to `CANCELLED`
- metadata URI may be updated
- market sync maps duel to `CANCELLED`
- winner is reset to `NONE`

### 4.2 Market-level implications of cancellation

- Trading is blocked by non-`OPEN` status.
- Claim path switches from winner-takes-all to refund mode.
- Refund amount equals locked user stake; shares and lock accounting are zeroed after claim.

## 5) Protocol Invariants

- Finalized duel states (`RESOLVED`, `CANCELLED`) are immutable.
- Settlement cannot occur before lock close semantics (`duel_end_ts >= bet_close_ts`).
- Claim is idempotent after first successful payout (position/balance cleared).
- Market winner can only be `A/B` when resolved, otherwise `NONE`.
- All fee paths and refunds are arithmetic-safe and bounded by basis points limits.
