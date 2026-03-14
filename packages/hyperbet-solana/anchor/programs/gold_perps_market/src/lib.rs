#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::cmp;
use std::str::FromStr;

declare_id!("EoZdHN8U3qWQje48ToxB1SLWjucsFGqcWaRUJQYX3eoT");

const FUNDING_RATE_PRECISION: i128 = 1_000_000_000;
const BPS_DENOMINATOR: u64 = 10_000;
const DEFAULT_BOOTSTRAP_AUTHORITY: &str = "DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn";
const MARKET_STATUS_ACTIVE: u8 = 0;
const MARKET_STATUS_CLOSE_ONLY: u8 = 1;
const MARKET_STATUS_ARCHIVED: u8 = 2;
const FEE_BUCKET_TREASURY: u8 = 0;
const FEE_BUCKET_MARKET_MAKER: u8 = 1;

fn bootstrap_authority() -> Pubkey {
    if let Some(value) = option_env!("HYPERSCAPE_BOOTSTRAP_AUTHORITY") {
        Pubkey::from_str(value).expect("invalid HYPERSCAPE_BOOTSTRAP_AUTHORITY")
    } else {
        Pubkey::from_str(DEFAULT_BOOTSTRAP_AUTHORITY).expect("invalid default bootstrap authority")
    }
}

/// Native-SOL isolated perpetual markets for model ranking derivatives.
///
/// Each model gets its own MarketState PDA which holds:
/// - oracle inputs (synthetic spot index, mu, sigma)
/// - market risk configuration (skew scale, funding velocity)
/// - isolated liquidity/insurance for that model only
/// - long/short open interest and funding accumulator
///
/// Positions are managed with signed size deltas through `modify_position`,
/// which supports opening, increasing, reducing, flipping, depositing margin,
/// withdrawing margin, and fully closing the account.
#[program]
pub mod gold_perps_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        keeper_authority: Pubkey,
        treasury_authority: Pubkey,
        market_maker_authority: Pubkey,
        default_skew_scale: u64,
        default_funding_velocity: u64,
        max_oracle_staleness_seconds: i64,
        min_oracle_spot_index: u64,
        max_oracle_spot_index: u64,
        max_oracle_price_delta_bps: u16,
        max_leverage: u64,
        min_margin_lamports: u64,
        max_market_open_interest: u64,
        min_market_insurance_lamports: u64,
        maintenance_margin_bps: u16,
        liquidation_fee_bps: u16,
        trade_treasury_fee_bps: u16,
        trade_market_maker_fee_bps: u16,
    ) -> Result<()> {
        validate_config_inputs(
            default_skew_scale,
            max_oracle_staleness_seconds,
            min_oracle_spot_index,
            max_oracle_spot_index,
            max_oracle_price_delta_bps,
            max_leverage,
            min_margin_lamports,
            max_market_open_interest,
            min_market_insurance_lamports,
            maintenance_margin_bps,
            liquidation_fee_bps,
            trade_treasury_fee_bps,
            trade_market_maker_fee_bps,
        )?;

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.keeper_authority = keeper_authority;
        config.treasury_authority = treasury_authority;
        config.market_maker_authority = market_maker_authority;
        config.default_skew_scale = default_skew_scale;
        config.default_funding_velocity = default_funding_velocity;
        config.max_oracle_staleness_seconds = max_oracle_staleness_seconds;
        config.min_oracle_spot_index = min_oracle_spot_index;
        config.max_oracle_spot_index = max_oracle_spot_index;
        config.max_oracle_price_delta_bps = max_oracle_price_delta_bps;
        config.max_leverage = max_leverage;
        config.min_margin_lamports = min_margin_lamports;
        config.max_market_open_interest = max_market_open_interest;
        config.min_market_insurance_lamports = min_market_insurance_lamports;
        config.maintenance_margin_bps = maintenance_margin_bps;
        config.liquidation_fee_bps = liquidation_fee_bps;
        config.trade_treasury_fee_bps = trade_treasury_fee_bps;
        config.trade_market_maker_fee_bps = trade_market_maker_fee_bps;
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        keeper_authority: Pubkey,
        treasury_authority: Pubkey,
        market_maker_authority: Pubkey,
        default_skew_scale: u64,
        default_funding_velocity: u64,
        max_oracle_staleness_seconds: i64,
        min_oracle_spot_index: u64,
        max_oracle_spot_index: u64,
        max_oracle_price_delta_bps: u16,
        max_leverage: u64,
        min_margin_lamports: u64,
        max_market_open_interest: u64,
        min_market_insurance_lamports: u64,
        maintenance_margin_bps: u16,
        liquidation_fee_bps: u16,
        trade_treasury_fee_bps: u16,
        trade_market_maker_fee_bps: u16,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            PerpsError::InvalidAuthority
        );
        validate_config_inputs(
            default_skew_scale,
            max_oracle_staleness_seconds,
            min_oracle_spot_index,
            max_oracle_spot_index,
            max_oracle_price_delta_bps,
            max_leverage,
            min_margin_lamports,
            max_market_open_interest,
            min_market_insurance_lamports,
            maintenance_margin_bps,
            liquidation_fee_bps,
            trade_treasury_fee_bps,
            trade_market_maker_fee_bps,
        )?;

        let config = &mut ctx.accounts.config;
        config.keeper_authority = keeper_authority;
        config.treasury_authority = treasury_authority;
        config.market_maker_authority = market_maker_authority;
        config.default_skew_scale = default_skew_scale;
        config.default_funding_velocity = default_funding_velocity;
        config.max_oracle_staleness_seconds = max_oracle_staleness_seconds;
        config.min_oracle_spot_index = min_oracle_spot_index;
        config.max_oracle_spot_index = max_oracle_spot_index;
        config.max_oracle_price_delta_bps = max_oracle_price_delta_bps;
        config.max_leverage = max_leverage;
        config.min_margin_lamports = min_margin_lamports;
        config.max_market_open_interest = max_market_open_interest;
        config.min_market_insurance_lamports = min_market_insurance_lamports;
        config.maintenance_margin_bps = maintenance_margin_bps;
        config.liquidation_fee_bps = liquidation_fee_bps;
        config.trade_treasury_fee_bps = trade_treasury_fee_bps;
        config.trade_market_maker_fee_bps = trade_market_maker_fee_bps;
        Ok(())
    }

    pub fn update_market_oracle(
        ctx: Context<UpdateMarketOracle>,
        market_id: u64,
        spot_index: u64,
        mu: u64,
        sigma: u64,
    ) -> Result<()> {
        require_operator(&ctx.accounts.config, ctx.accounts.authority.key())?;
        require!(spot_index > 0, PerpsError::InvalidSpotIndex);
        require_oracle_spot_index_bounds(&ctx.accounts.config, spot_index)?;

        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        if !market.initialized {
            market.initialized = true;
            market.market_id = market_id;
            market.status = MARKET_STATUS_ACTIVE;
            market.skew_scale = ctx.accounts.config.default_skew_scale;
            market.funding_velocity = ctx.accounts.config.default_funding_velocity;
            market.spot_index = spot_index;
            market.mu = mu;
            market.sigma = sigma;
            market.oracle_last_updated = now;
            market.last_funding_time = now;
            return Ok(());
        }

        require_market(market, market_id)?;
        require!(
            market.status == MARKET_STATUS_ACTIVE,
            PerpsError::MarketNotActive
        );
        drift_funding(market, now)?;
        require_oracle_price_step(
            market.spot_index,
            spot_index,
            ctx.accounts.config.max_oracle_price_delta_bps,
        )?;

        market.spot_index = spot_index;
        market.mu = mu;
        market.sigma = sigma;
        market.oracle_last_updated = now;
        Ok(())
    }

    pub fn deposit_insurance(
        ctx: Context<DepositInsurance>,
        market_id: u64,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, PerpsError::InvalidInsuranceDeposit);
        require_market(&ctx.accounts.market, market_id)?;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, amount)?;

        let market = &mut ctx.accounts.market;
        market.insurance_fund = market
            .insurance_fund
            .checked_add(amount)
            .ok_or(PerpsError::Overflow)?;
        Ok(())
    }

    pub fn modify_position(
        ctx: Context<ModifyPosition>,
        market_id: u64,
        margin_delta: i64,
        size_delta: i64,
        acceptable_price: u64,
    ) -> Result<()> {
        require!(
            margin_delta != 0 || size_delta != 0,
            PerpsError::NoopPositionUpdate
        );

        let config = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let position_exists = ctx.accounts.position.initialized;
        let trader_key = ctx.accounts.trader.key();
        let old_owner = ctx.accounts.position.owner;
        let old_market_id = ctx.accounts.position.market_id;
        let old_margin = ctx.accounts.position.margin as i128;
        let old_size = ctx.accounts.position.size as i128;
        let old_entry_price = ctx.accounts.position.entry_price;
        let old_last_funding_rate = ctx.accounts.position.last_funding_rate as i128;
        let new_size = old_size
            .checked_add(size_delta as i128)
            .ok_or(PerpsError::Overflow)?;

        {
            let market = &mut ctx.accounts.market;
            require_market(market, market_id)?;
            match market.status {
                MARKET_STATUS_ACTIVE => {
                    if size_delta != 0 || margin_delta < 0 {
                        require_fresh_market(market, config, now)?;
                    }
                    drift_funding(market, now)?;
                }
                MARKET_STATUS_CLOSE_ONLY => {
                    require!(
                        size_delta == 0 || is_reduce_only_change(old_size, new_size),
                        PerpsError::MarketCloseOnly
                    );
                    require!(
                        market_index_price(market)? > 0,
                        PerpsError::InvalidSpotIndex
                    );
                }
                MARKET_STATUS_ARCHIVED => return err!(PerpsError::MarketArchived),
                _ => return err!(PerpsError::InvalidMarketStatus),
            }
        }

        if position_exists {
            require!(old_owner == trader_key, PerpsError::InvalidPositionOwner);
            require!(old_market_id == market_id, PerpsError::InvalidMarket);
        } else {
            require!(size_delta != 0, PerpsError::NoOpenPosition);
        }

        let deposit_amount = margin_delta.max(0) as u64;
        if deposit_amount > 0 {
            let transfer_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            );
            system_program::transfer(transfer_ctx, deposit_amount)?;
        }

        let current_funding_rate = ctx.accounts.market.current_funding_rate;
        let funding_delta = (current_funding_rate as i128)
            .checked_sub(old_last_funding_rate)
            .ok_or(PerpsError::Overflow)?;
        let funding_pnl = calculate_funding_pnl(old_size, funding_delta)?;

        let execution_price = if size_delta != 0 {
            execution_price(&ctx.accounts.market, size_delta as i128)?
        } else {
            market_index_price(&ctx.accounts.market)?
        };
        require_acceptable_price(execution_price, size_delta as i128, acceptable_price)?;

        let realized_trade_pnl = calculate_realized_trade_pnl(
            old_size,
            old_entry_price,
            execution_price,
            size_delta as i128,
        )?;

        let (treasury_fee, market_maker_fee) = calculate_trade_fees(
            size_delta as i128,
            config.trade_treasury_fee_bps,
            config.trade_market_maker_fee_bps,
        )?;
        let total_trade_fee = i128::from(treasury_fee)
            .checked_add(i128::from(market_maker_fee))
            .ok_or(PerpsError::Overflow)?;
        let next_margin = old_margin
            .checked_add(funding_pnl)
            .and_then(|value| value.checked_add(realized_trade_pnl))
            .and_then(|value| value.checked_add(margin_delta as i128))
            .and_then(|value| value.checked_sub(total_trade_fee))
            .ok_or(PerpsError::Overflow)?;

        let next_entry_price = calculate_next_entry_price(
            old_size,
            old_entry_price,
            size_delta as i128,
            new_size,
            execution_price,
        )?;
        let (next_long_oi, next_short_oi) =
            projected_open_interest(&ctx.accounts.market, old_size, new_size)?;
        let increases_market_oi = next_long_oi > ctx.accounts.market.total_long_oi
            || next_short_oi > ctx.accounts.market.total_short_oi;
        if increases_market_oi {
            require!(
                next_long_oi <= config.max_market_open_interest
                    && next_short_oi <= config.max_market_open_interest,
                PerpsError::OpenInterestLimitExceeded
            );
            require!(
                ctx.accounts.market.insurance_fund >= config.min_market_insurance_lamports,
                PerpsError::MarketInsufficientInsurance
            );
        }

        {
            let market = &mut ctx.accounts.market;
            update_market_open_interest(market, old_size, new_size)?;
            market.treasury_fee_balance = market
                .treasury_fee_balance
                .checked_add(treasury_fee)
                .ok_or(PerpsError::Overflow)?;
            market.market_maker_fee_balance = market
                .market_maker_fee_balance
                .checked_add(market_maker_fee)
                .ok_or(PerpsError::Overflow)?;
            if !position_exists && new_size != 0 {
                market.open_positions = market
                    .open_positions
                    .checked_add(1)
                    .ok_or(PerpsError::Overflow)?;
            } else if position_exists && old_size != 0 && new_size == 0 {
                market.open_positions = market
                    .open_positions
                    .checked_sub(1)
                    .ok_or(PerpsError::Overflow)?;
            }
        }

        if new_size == 0 {
            let settlement = cmp::max(0, next_margin);
            let payout = u64::try_from(settlement).map_err(|_| PerpsError::Overflow)?;
            transfer_from_market(
                &mut ctx.accounts.market,
                &ctx.accounts.trader.to_account_info(),
                payout,
                true,
            )?;
            ctx.accounts
                .position
                .close(ctx.accounts.trader.to_account_info())?;
            return Ok(());
        }

        require!(next_margin > 0, PerpsError::InvalidMargin);
        let next_margin_u64 = u64::try_from(next_margin).map_err(|_| PerpsError::Overflow)?;
        require!(
            next_margin_u64 >= config.min_margin_lamports,
            PerpsError::InvalidMargin
        );
        require_leverage(next_margin_u64, new_size, config.max_leverage)?;

        if margin_delta < 0 {
            transfer_from_market(
                &mut ctx.accounts.market,
                &ctx.accounts.trader.to_account_info(),
                margin_delta.unsigned_abs(),
                false,
            )?;
        }

        let position = &mut ctx.accounts.position;
        position.initialized = true;
        position.owner = trader_key;
        position.market_id = market_id;
        position.margin = next_margin_u64;
        position.size = i64::try_from(new_size).map_err(|_| PerpsError::Overflow)?;
        position.entry_price = next_entry_price;
        position.last_funding_rate = current_funding_rate;
        Ok(())
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>, market_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        let market = &mut ctx.accounts.market;
        require_market(market, market_id)?;

        let position = &ctx.accounts.position;

        let now = Clock::get()?.unix_timestamp;
        match market.status {
            MARKET_STATUS_ACTIVE => {
                require_fresh_market(market, config, now)?;
                drift_funding(market, now)?;
            }
            MARKET_STATUS_CLOSE_ONLY => {
                require!(
                    market_index_price(market)? > 0,
                    PerpsError::InvalidSpotIndex
                );
            }
            MARKET_STATUS_ARCHIVED => return err!(PerpsError::MarketArchived),
            _ => return err!(PerpsError::InvalidMarketStatus),
        }

        let old_size = position.size as i128;
        require!(old_size != 0, PerpsError::NoOpenPosition);

        let close_size_delta = -old_size;
        let exit_price = execution_price(market, close_size_delta)?;
        let equity = calculate_position_equity(
            position.margin as i128,
            old_size,
            position.entry_price,
            exit_price,
            (market.current_funding_rate as i128)
                .checked_sub(position.last_funding_rate as i128)
                .ok_or(PerpsError::Overflow)?,
        )?;
        let maintenance_margin =
            calculate_maintenance_margin(old_size, config.maintenance_margin_bps)?;
        require!(equity < maintenance_margin, PerpsError::NotLiquidatable);

        update_market_open_interest(market, old_size, 0)?;
        market.open_positions = market
            .open_positions
            .checked_sub(1)
            .ok_or(PerpsError::Overflow)?;

        let positive_equity = cmp::max(0, equity);
        let positive_equity_u64 =
            u64::try_from(positive_equity).map_err(|_| PerpsError::Overflow)?;
        let target_liquidation_fee =
            calculate_liquidation_fee(old_size, config.liquidation_fee_bps)?;
        let available_payout = available_liquidity_including_insurance(market)?;
        let liquidation_fee = cmp::min(target_liquidation_fee, available_payout);
        let owner_remainder = positive_equity_u64
            .saturating_sub(target_liquidation_fee)
            .min(available_payout.saturating_sub(liquidation_fee));

        transfer_from_market(
            &mut ctx.accounts.market,
            &ctx.accounts.liquidator.to_account_info(),
            liquidation_fee,
            true,
        )?;
        transfer_from_market(
            &mut ctx.accounts.market,
            &ctx.accounts.owner.to_account_info(),
            owner_remainder,
            true,
        )?;
        Ok(())
    }

    pub fn set_market_status(
        ctx: Context<SetMarketStatus>,
        market_id: u64,
        next_status: u8,
        settlement_spot_index: u64,
    ) -> Result<()> {
        require_operator(&ctx.accounts.config, ctx.accounts.authority.key())?;

        let market = &mut ctx.accounts.market;
        require_market(market, market_id)?;

        let now = Clock::get()?.unix_timestamp;
        match next_status {
            MARKET_STATUS_ACTIVE => {
                market.status = MARKET_STATUS_ACTIVE;
                market.settlement_spot_index = 0;
                market.last_funding_time = now;
            }
            MARKET_STATUS_CLOSE_ONLY => {
                let frozen_price = if settlement_spot_index > 0 {
                    settlement_spot_index
                } else {
                    market_index_price(market)?
                };
                require!(frozen_price > 0, PerpsError::InvalidSpotIndex);
                market.status = MARKET_STATUS_CLOSE_ONLY;
                market.settlement_spot_index = frozen_price;
                market.last_funding_time = now;
            }
            MARKET_STATUS_ARCHIVED => {
                require!(
                    market.total_long_oi == 0
                        && market.total_short_oi == 0
                        && market.open_positions == 0,
                    PerpsError::MarketHasOpenPositions
                );
                market.status = MARKET_STATUS_ARCHIVED;
                if settlement_spot_index > 0 {
                    market.settlement_spot_index = settlement_spot_index;
                }
            }
            _ => return err!(PerpsError::InvalidMarketStatus),
        }
        Ok(())
    }

    pub fn recycle_market_maker_fees(
        ctx: Context<RecycleMarketMakerFees>,
        market_id: u64,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, PerpsError::InvalidFeeWithdrawal);
        require_market_maker(&ctx.accounts.config, ctx.accounts.authority.key())?;

        let market = &mut ctx.accounts.market;
        require_market(market, market_id)?;

        market.market_maker_fee_balance = market
            .market_maker_fee_balance
            .checked_sub(amount)
            .ok_or(PerpsError::InvalidFeeWithdrawal)?;
        market.insurance_fund = market
            .insurance_fund
            .checked_add(amount)
            .ok_or(PerpsError::Overflow)?;
        Ok(())
    }

    pub fn withdraw_fee_balance(
        ctx: Context<WithdrawFeeBalance>,
        market_id: u64,
        fee_bucket: u8,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, PerpsError::InvalidFeeWithdrawal);

        let market = &mut ctx.accounts.market;
        require_market(market, market_id)?;

        match fee_bucket {
            FEE_BUCKET_TREASURY => {
                require_treasury(&ctx.accounts.config, ctx.accounts.authority.key())?;
                require!(
                    ctx.accounts.recipient.key() == ctx.accounts.config.treasury_authority,
                    PerpsError::InvalidFeeRecipient
                );
                market.treasury_fee_balance = market
                    .treasury_fee_balance
                    .checked_sub(amount)
                    .ok_or(PerpsError::InvalidFeeWithdrawal)?;
            }
            FEE_BUCKET_MARKET_MAKER => {
                require_market_maker(&ctx.accounts.config, ctx.accounts.authority.key())?;
                require!(
                    ctx.accounts.recipient.key() == ctx.accounts.config.market_maker_authority,
                    PerpsError::InvalidFeeRecipient
                );
                market.market_maker_fee_balance = market
                    .market_maker_fee_balance
                    .checked_sub(amount)
                    .ok_or(PerpsError::InvalidFeeWithdrawal)?;
            }
            _ => return err!(PerpsError::InvalidFeeBucket),
        }

        transfer_from_market(
            market,
            &ctx.accounts.recipient.to_account_info(),
            amount,
            false,
        )?;
        Ok(())
    }
}

fn require_market(market: &MarketState, market_id: u64) -> Result<()> {
    require!(market.initialized, PerpsError::InvalidMarket);
    require!(market.market_id == market_id, PerpsError::InvalidMarket);
    Ok(())
}

fn validate_config_inputs(
    default_skew_scale: u64,
    max_oracle_staleness_seconds: i64,
    min_oracle_spot_index: u64,
    max_oracle_spot_index: u64,
    max_oracle_price_delta_bps: u16,
    max_leverage: u64,
    min_margin_lamports: u64,
    max_market_open_interest: u64,
    min_market_insurance_lamports: u64,
    maintenance_margin_bps: u16,
    liquidation_fee_bps: u16,
    trade_treasury_fee_bps: u16,
    trade_market_maker_fee_bps: u16,
) -> Result<()> {
    require!(default_skew_scale > 0, PerpsError::InvalidRiskConfig);
    require!(
        max_oracle_staleness_seconds > 0,
        PerpsError::InvalidRiskConfig
    );
    require!(
        min_oracle_spot_index > 0
            && max_oracle_spot_index >= min_oracle_spot_index
            && u64::from(max_oracle_price_delta_bps) > 0
            && u64::from(max_oracle_price_delta_bps) < BPS_DENOMINATOR,
        PerpsError::InvalidRiskConfig
    );
    require!(
        max_leverage > 0 && max_leverage <= 20,
        PerpsError::InvalidRiskConfig
    );
    require!(min_margin_lamports > 0, PerpsError::InvalidRiskConfig);
    require!(max_market_open_interest > 0, PerpsError::InvalidRiskConfig);
    require!(
        min_market_insurance_lamports > 0,
        PerpsError::InvalidRiskConfig
    );
    require!(
        maintenance_margin_bps > 0 && u64::from(maintenance_margin_bps) < BPS_DENOMINATOR,
        PerpsError::InvalidRiskConfig
    );
    require!(
        u64::from(liquidation_fee_bps) < BPS_DENOMINATOR,
        PerpsError::InvalidRiskConfig
    );
    require!(
        u64::from(trade_treasury_fee_bps) + u64::from(trade_market_maker_fee_bps) < BPS_DENOMINATOR,
        PerpsError::InvalidRiskConfig
    );

    let initial_margin_bps = BPS_DENOMINATOR
        .checked_div(max_leverage)
        .ok_or(PerpsError::InvalidRiskConfig)?;
    require!(
        u64::from(maintenance_margin_bps) < initial_margin_bps,
        PerpsError::InvalidRiskConfig
    );
    Ok(())
}

fn require_oracle_spot_index_bounds(config: &ConfigState, spot_index: u64) -> Result<()> {
    require!(
        spot_index >= config.min_oracle_spot_index && spot_index <= config.max_oracle_spot_index,
        PerpsError::OracleSpotIndexOutOfBounds
    );
    Ok(())
}

fn require_oracle_price_step(
    previous_spot_index: u64,
    next_spot_index: u64,
    max_oracle_price_delta_bps: u16,
) -> Result<()> {
    require!(previous_spot_index > 0, PerpsError::InvalidSpotIndex);
    let price_delta = u128::from(next_spot_index.abs_diff(previous_spot_index));
    let max_delta = u128::from(previous_spot_index)
        .checked_mul(u128::from(max_oracle_price_delta_bps))
        .ok_or(PerpsError::Overflow)?;
    require!(
        price_delta
            .checked_mul(u128::from(BPS_DENOMINATOR))
            .ok_or(PerpsError::Overflow)?
            <= max_delta,
        PerpsError::OraclePriceDeltaTooLarge
    );
    Ok(())
}

fn require_operator(config: &ConfigState, signer: Pubkey) -> Result<()> {
    require!(
        signer == config.authority || signer == config.keeper_authority,
        PerpsError::InvalidAuthority
    );
    Ok(())
}

fn require_treasury(config: &ConfigState, signer: Pubkey) -> Result<()> {
    require!(
        signer == config.authority || signer == config.treasury_authority,
        PerpsError::InvalidAuthority
    );
    Ok(())
}

fn require_market_maker(config: &ConfigState, signer: Pubkey) -> Result<()> {
    require!(
        signer == config.authority || signer == config.market_maker_authority,
        PerpsError::InvalidAuthority
    );
    Ok(())
}

fn require_fresh_market(market: &MarketState, config: &ConfigState, now: i64) -> Result<()> {
    require!(market.spot_index > 0, PerpsError::InvalidSpotIndex);
    require!(market.oracle_last_updated > 0, PerpsError::StaleOracle);
    let age = now.saturating_sub(market.oracle_last_updated);
    require!(
        age <= config.max_oracle_staleness_seconds,
        PerpsError::StaleOracle
    );
    Ok(())
}

fn drift_funding(market: &mut MarketState, now: i64) -> Result<()> {
    require!(market.skew_scale > 0, PerpsError::InvalidRiskConfig);
    if market.status != MARKET_STATUS_ACTIVE {
        return Ok(());
    }
    if market.last_funding_time == 0 {
        market.last_funding_time = now;
        return Ok(());
    }
    if now <= market.last_funding_time {
        return Ok(());
    }

    let elapsed = (now - market.last_funding_time) as i128;
    let skew = market.total_long_oi as i128 - market.total_short_oi as i128;
    let drift = skew
        .checked_mul(market.funding_velocity as i128)
        .ok_or(PerpsError::Overflow)?
        .checked_mul(elapsed)
        .ok_or(PerpsError::Overflow)?
        .checked_div(market.skew_scale as i128)
        .ok_or(PerpsError::Overflow)?;
    let next_rate = (market.current_funding_rate as i128)
        .checked_add(drift)
        .ok_or(PerpsError::Overflow)?;
    market.current_funding_rate = i64::try_from(next_rate).map_err(|_| PerpsError::Overflow)?;
    market.last_funding_time = now;
    Ok(())
}

fn execution_price(market: &MarketState, size_delta: i128) -> Result<u64> {
    let index_price = market_index_price(market)?;
    require!(market.skew_scale > 0, PerpsError::InvalidRiskConfig);

    let skew = market.total_long_oi as i128 - market.total_short_oi as i128;
    let d = market.skew_scale as i128;
    let y1 = d.checked_add(skew).ok_or(PerpsError::Overflow)?;
    let y2 = y1.checked_add(size_delta).ok_or(PerpsError::Overflow)?;
    require!(y1 > 0 && y2 > 0, PerpsError::InvalidPositionState);

    let part1 = (index_price as i128)
        .checked_mul(y1)
        .ok_or(PerpsError::Overflow)?
        .checked_div(d)
        .ok_or(PerpsError::Overflow)?;
    let exec = part1
        .checked_mul(y2)
        .ok_or(PerpsError::Overflow)?
        .checked_div(d)
        .ok_or(PerpsError::Overflow)?;
    u64::try_from(exec).map_err(|_| PerpsError::Overflow.into())
}

fn market_index_price(market: &MarketState) -> Result<u64> {
    let price = if market.status == MARKET_STATUS_CLOSE_ONLY && market.settlement_spot_index > 0 {
        market.settlement_spot_index
    } else {
        market.spot_index
    };
    require!(price > 0, PerpsError::InvalidSpotIndex);
    Ok(price)
}

fn calculate_funding_pnl(size: i128, funding_delta: i128) -> Result<i128> {
    size.checked_mul(funding_delta)
        .ok_or(PerpsError::Overflow)?
        .checked_div(FUNDING_RATE_PRECISION)
        .map(|value| -value)
        .ok_or(PerpsError::Overflow.into())
}

fn calculate_realized_trade_pnl(
    old_size: i128,
    old_entry_price: u64,
    execution_price: u64,
    size_delta: i128,
) -> Result<i128> {
    if old_size == 0 || size_delta == 0 || old_size.signum() == size_delta.signum() {
        return Ok(0);
    }

    require!(old_entry_price > 0, PerpsError::InvalidPositionState);
    let close_size = cmp::min(old_size.abs(), size_delta.abs());
    let pnl = if old_size > 0 {
        (execution_price as i128 - old_entry_price as i128)
            .checked_mul(close_size)
            .ok_or(PerpsError::Overflow)?
            .checked_div(old_entry_price as i128)
            .ok_or(PerpsError::Overflow)?
    } else {
        (old_entry_price as i128 - execution_price as i128)
            .checked_mul(close_size)
            .ok_or(PerpsError::Overflow)?
            .checked_div(old_entry_price as i128)
            .ok_or(PerpsError::Overflow)?
    };
    Ok(pnl)
}

fn calculate_next_entry_price(
    old_size: i128,
    old_entry_price: u64,
    size_delta: i128,
    new_size: i128,
    execution_price: u64,
) -> Result<u64> {
    if new_size == 0 {
        return Ok(0);
    }
    if old_size == 0 {
        return Ok(execution_price);
    }
    if size_delta == 0 {
        return Ok(old_entry_price);
    }
    if old_size.signum() != new_size.signum() {
        return Ok(execution_price);
    }
    if old_size.signum() != size_delta.signum() {
        return Ok(old_entry_price);
    }

    require!(old_entry_price > 0, PerpsError::InvalidPositionState);
    let old_abs = old_size.abs();
    let delta_abs = size_delta.abs();
    let new_abs = new_size.abs();
    let weighted = (old_entry_price as i128)
        .checked_mul(old_abs)
        .and_then(|value| value.checked_add((execution_price as i128) * delta_abs))
        .ok_or(PerpsError::Overflow)?
        .checked_div(new_abs)
        .ok_or(PerpsError::Overflow)?;
    u64::try_from(weighted).map_err(|_| PerpsError::Overflow.into())
}

fn calculate_position_equity(
    margin: i128,
    size: i128,
    entry_price: u64,
    exit_price: u64,
    funding_delta: i128,
) -> Result<i128> {
    let funding_pnl = calculate_funding_pnl(size, funding_delta)?;
    let trade_pnl = calculate_realized_trade_pnl(size, entry_price, exit_price, -size)?;
    margin
        .checked_add(funding_pnl)
        .and_then(|value| value.checked_add(trade_pnl))
        .ok_or(PerpsError::Overflow.into())
}

fn calculate_maintenance_margin(size: i128, maintenance_margin_bps: u16) -> Result<i128> {
    size.abs()
        .checked_mul(i128::from(maintenance_margin_bps))
        .ok_or(PerpsError::Overflow)?
        .checked_div(BPS_DENOMINATOR as i128)
        .ok_or(PerpsError::Overflow.into())
}

fn calculate_liquidation_fee(size: i128, liquidation_fee_bps: u16) -> Result<u64> {
    let fee = size.abs()
        .checked_mul(i128::from(liquidation_fee_bps))
        .ok_or(PerpsError::Overflow)?
        .checked_div(BPS_DENOMINATOR as i128)
        .ok_or(PerpsError::Overflow)?;
    u64::try_from(fee).map_err(|_| PerpsError::Overflow.into())
}

fn calculate_trade_fees(
    size_delta: i128,
    treasury_fee_bps: u16,
    market_maker_fee_bps: u16,
) -> Result<(u64, u64)> {
    let abs_size = size_delta.abs();
    if abs_size == 0 {
        return Ok((0, 0));
    }

    let treasury_fee = abs_size
        .checked_mul(i128::from(treasury_fee_bps))
        .ok_or(PerpsError::Overflow)?
        .checked_div(BPS_DENOMINATOR as i128)
        .ok_or(PerpsError::Overflow)?;
    let market_maker_fee = abs_size
        .checked_mul(i128::from(market_maker_fee_bps))
        .ok_or(PerpsError::Overflow)?
        .checked_div(BPS_DENOMINATOR as i128)
        .ok_or(PerpsError::Overflow)?;
    Ok((to_u64(treasury_fee)?, to_u64(market_maker_fee)?))
}

fn require_acceptable_price(
    execution_price: u64,
    size_delta: i128,
    acceptable_price: u64,
) -> Result<()> {
    if size_delta == 0 || acceptable_price == 0 {
        return Ok(());
    }

    if size_delta > 0 {
        require!(
            execution_price <= acceptable_price,
            PerpsError::SlippageExceeded
        );
    } else {
        require!(
            execution_price >= acceptable_price,
            PerpsError::SlippageExceeded
        );
    }
    Ok(())
}

fn require_leverage(margin: u64, size: i128, max_leverage: u64) -> Result<()> {
    let margin_i128 = i128::from(margin);
    let leverage_capacity = margin_i128
        .checked_mul(max_leverage as i128)
        .ok_or(PerpsError::Overflow)?;
    require!(
        leverage_capacity >= size.abs(),
        PerpsError::InvalidLeverage
    );
    Ok(())
}

fn apply_oi_delta(
    long_oi: u64,
    short_oi: u64,
    remove_size: i128,
    add_size: i128,
) -> Result<(u64, u64)> {
    let mut next_long = long_oi;
    let mut next_short = short_oi;
    match remove_size.cmp(&0) {
        cmp::Ordering::Greater => {
            next_long = next_long
                .checked_sub(to_u64(remove_size.abs())?)
                .ok_or(PerpsError::Overflow)?;
        }
        cmp::Ordering::Less => {
            next_short = next_short
                .checked_sub(to_u64(remove_size.abs())?)
                .ok_or(PerpsError::Overflow)?;
        }
        cmp::Ordering::Equal => {}
    }
    match add_size.cmp(&0) {
        cmp::Ordering::Greater => {
            next_long = next_long
                .checked_add(to_u64(add_size.abs())?)
                .ok_or(PerpsError::Overflow)?;
        }
        cmp::Ordering::Less => {
            next_short = next_short
                .checked_add(to_u64(add_size.abs())?)
                .ok_or(PerpsError::Overflow)?;
        }
        cmp::Ordering::Equal => {}
    }
    Ok((next_long, next_short))
}

fn update_market_open_interest(
    market: &mut MarketState,
    old_size: i128,
    new_size: i128,
) -> Result<()> {
    let (next_long, next_short) =
        apply_oi_delta(market.total_long_oi, market.total_short_oi, old_size, new_size)?;
    market.total_long_oi = next_long;
    market.total_short_oi = next_short;
    Ok(())
}

fn projected_open_interest(
    market: &MarketState,
    old_size: i128,
    new_size: i128,
) -> Result<(u64, u64)> {
    apply_oi_delta(market.total_long_oi, market.total_short_oi, old_size, new_size)
}

fn is_reduce_only_change(old_size: i128, new_size: i128) -> bool {
    if old_size == 0 {
        return false;
    }
    if new_size == 0 {
        return true;
    }
    if old_size.signum() != new_size.signum() {
        return false;
    }
    new_size.abs() <= old_size.abs()
}

fn transfer_from_market<'info>(
    market: &mut Account<'info, MarketState>,
    recipient: &AccountInfo<'info>,
    amount: u64,
    allow_insurance: bool,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let market_info = market.to_account_info();
    let rent_floor = Rent::get()?.minimum_balance(MarketState::SIZE);
    let available_after_rent = market_info.lamports().saturating_sub(rent_floor);
    let reserved_non_insurance = market
        .treasury_fee_balance
        .checked_add(market.market_maker_fee_balance)
        .ok_or(PerpsError::Overflow)?;

    let insurance_used = if allow_insurance {
        calculate_insurance_usage(
            amount,
            available_after_rent,
            reserved_non_insurance,
            market.insurance_fund,
        )?
    } else {
        let reserved_total = reserved_non_insurance
            .checked_add(market.insurance_fund)
            .ok_or(PerpsError::Overflow)?;
        let free_liquidity = available_after_rent.saturating_sub(reserved_total);
        require!(free_liquidity >= amount, PerpsError::InsufficientLiquidity);
        0
    };

    if insurance_used > 0 {
        market.insurance_fund = market
            .insurance_fund
            .checked_sub(insurance_used)
            .ok_or(PerpsError::Overflow)?;
    }

    **market_info.try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;
    Ok(())
}

fn available_liquidity_including_insurance(market: &Account<MarketState>) -> Result<u64> {
    let market_info = market.to_account_info();
    let rent_floor = Rent::get()?.minimum_balance(MarketState::SIZE);
    let available_after_rent = market_info.lamports().saturating_sub(rent_floor);
    let reserved_non_insurance = market
        .treasury_fee_balance
        .checked_add(market.market_maker_fee_balance)
        .ok_or(PerpsError::Overflow)?;
    Ok(available_after_rent.saturating_sub(reserved_non_insurance))
}

fn calculate_insurance_usage(
    settlement: u64,
    available_after_rent: u64,
    reserved_non_insurance: u64,
    insurance_fund: u64,
) -> Result<u64> {
    require!(
        available_after_rent >= settlement,
        PerpsError::InsufficientLiquidity
    );
    let reserved_total = reserved_non_insurance
        .checked_add(insurance_fund)
        .ok_or(PerpsError::Overflow)?;
    let free_liquidity = available_after_rent.saturating_sub(reserved_total);
    let insurance_used = settlement.saturating_sub(free_liquidity);
    require!(
        insurance_used <= insurance_fund,
        PerpsError::InsufficientLiquidity
    );
    Ok(insurance_used)
}

fn to_u64(value: i128) -> Result<u64> {
    u64::try_from(value).map_err(|_| PerpsError::Overflow.into())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = ConfigState::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ConfigState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ PerpsError::UnauthorizedInitializer
    )]
    pub program: Program<'info, crate::program::GoldPerpsMarket>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            || ((program_data.upgrade_authority_address.is_none()
                || program_data.upgrade_authority_address == Some(Pubkey::default()))
                && authority.key() == bootstrap_authority()) @ PerpsError::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, ConfigState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct UpdateMarketOracle<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        init_if_needed,
        payer = authority,
        space = MarketState::SIZE,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct DepositInsurance<'info> {
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ModifyPosition<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    #[account(
        init_if_needed,
        payer = trader,
        space = PositionState::SIZE,
        seeds = [b"position", trader.key().as_ref(), market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub trader: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct LiquidatePosition<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    #[account(
        mut,
        close = owner,
        constraint = position.initialized @ PerpsError::NoOpenPosition,
        constraint = position.market_id == market_id @ PerpsError::InvalidMarket,
        constraint = position.owner == owner.key() @ PerpsError::InvalidPositionOwner
    )]
    pub position: Account<'info, PositionState>,
    #[account(mut)]
    pub owner: SystemAccount<'info>,
    #[account(mut)]
    pub liquidator: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SetMarketStatus<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct RecycleMarketMakerFees<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct WithdrawFeeBalance<'info> {
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, ConfigState>,
    #[account(
        mut,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, MarketState>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct ConfigState {
    pub authority: Pubkey,
    pub keeper_authority: Pubkey,
    pub treasury_authority: Pubkey,
    pub market_maker_authority: Pubkey,
    pub default_skew_scale: u64,
    pub default_funding_velocity: u64,
    pub max_oracle_staleness_seconds: i64,
    pub min_oracle_spot_index: u64,
    pub max_oracle_spot_index: u64,
    pub max_oracle_price_delta_bps: u16,
    pub max_leverage: u64,
    pub min_margin_lamports: u64,
    pub max_market_open_interest: u64,
    pub min_market_insurance_lamports: u64,
    pub maintenance_margin_bps: u16,
    pub liquidation_fee_bps: u16,
    pub trade_treasury_fee_bps: u16,
    pub trade_market_maker_fee_bps: u16,
}

impl ConfigState {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub initialized: bool,
    pub market_id: u64,
    pub status: u8,
    pub insurance_fund: u64,
    pub treasury_fee_balance: u64,
    pub market_maker_fee_balance: u64,
    pub open_positions: u32,
    pub skew_scale: u64,
    pub funding_velocity: u64,
    pub spot_index: u64,
    pub settlement_spot_index: u64,
    pub mu: u64,
    pub sigma: u64,
    pub oracle_last_updated: i64,
    pub last_funding_time: i64,
    pub current_funding_rate: i64,
    pub total_long_oi: u64,
    pub total_short_oi: u64,
}

impl MarketState {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct PositionState {
    pub initialized: bool,
    pub owner: Pubkey,
    pub market_id: u64,
    pub margin: u64,
    pub size: i64,
    pub entry_price: u64,
    pub last_funding_rate: i64,
}

impl PositionState {
    pub const SIZE: usize = 8 + Self::INIT_SPACE;
}

#[error_code]
pub enum PerpsError {
    #[msg("Operator is not authorized to manage perps markets")]
    InvalidAuthority,
    #[msg("Only the configured bootstrap authority can initialize the config")]
    UnauthorizedInitializer,
    #[msg("Risk configuration is invalid")]
    InvalidRiskConfig,
    #[msg("Market does not exist or does not match the requested id")]
    InvalidMarket,
    #[msg("Oracle price is stale and cannot be used for trading")]
    StaleOracle,
    #[msg("Oracle spot index must be greater than zero")]
    InvalidSpotIndex,
    #[msg("Oracle spot index is outside the configured market bounds")]
    OracleSpotIndexOutOfBounds,
    #[msg("Oracle price move exceeds the configured maximum step")]
    OraclePriceDeltaTooLarge,
    #[msg("Position update must change margin or size")]
    NoopPositionUpdate,
    #[msg("No open position exists for this trader and market")]
    NoOpenPosition,
    #[msg("Position owner does not match the provided signer")]
    InvalidPositionOwner,
    #[msg("Margin is invalid for the requested trade")]
    InvalidMargin,
    #[msg("Requested leverage exceeds the configured maximum")]
    InvalidLeverage,
    #[msg("Projected market open interest exceeds the configured cap")]
    OpenInterestLimitExceeded,
    #[msg("Market does not have enough isolated insurance to grow open interest")]
    MarketInsufficientInsurance,
    #[msg("Market account has insufficient liquidity to settle this payout")]
    InsufficientLiquidity,
    #[msg("Position is not undercollateralized; cannot liquidate")]
    NotLiquidatable,
    #[msg("Market is not active for new oracle updates")]
    MarketNotActive,
    #[msg("Market is close-only; only reductions and closes are allowed")]
    MarketCloseOnly,
    #[msg("Market is archived and cannot be traded")]
    MarketArchived,
    #[msg("Market status transition is invalid")]
    InvalidMarketStatus,
    #[msg("Market still has open positions or open interest")]
    MarketHasOpenPositions,
    #[msg("Insurance deposit amount must be greater than zero")]
    InvalidInsuranceDeposit,
    #[msg("Trade execution exceeded the caller's acceptable price")]
    SlippageExceeded,
    #[msg("Fee balance or fee withdrawal is invalid")]
    InvalidFeeWithdrawal,
    #[msg("Fee recipient does not match the configured authority")]
    InvalidFeeRecipient,
    #[msg("Fee bucket is invalid")]
    InvalidFeeBucket,
    #[msg("Position state is invalid")]
    InvalidPositionState,
    #[msg("Numeric overflow in perps calculation")]
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realized_pnl_on_partial_reduction_matches_direction() {
        let pnl = calculate_realized_trade_pnl(10_000, 100, 120, -4_000).unwrap();
        assert_eq!(pnl, 800);

        let short_pnl = calculate_realized_trade_pnl(-10_000, 100, 80, 4_000).unwrap();
        assert_eq!(short_pnl, 800);
    }

    #[test]
    fn insurance_usage_only_consumes_reserved_balance_when_needed() {
        assert_eq!(calculate_insurance_usage(400, 1_000, 100, 250).unwrap(), 0);
        assert_eq!(
            calculate_insurance_usage(900, 1_000, 100, 250).unwrap(),
            250
        );
    }

    #[test]
    fn weighted_entry_price_only_changes_when_increasing_same_side() {
        let same_side = calculate_next_entry_price(2_000, 100, 1_000, 3_000, 130).unwrap();
        assert_eq!(same_side, 110);

        let reduced = calculate_next_entry_price(2_000, 100, -500, 1_500, 130).unwrap();
        assert_eq!(reduced, 100);

        let flipped = calculate_next_entry_price(2_000, 100, -3_000, -1_000, 130).unwrap();
        assert_eq!(flipped, 130);
    }

    #[test]
    fn reduce_only_logic_rejects_flips_and_new_positions() {
        assert!(is_reduce_only_change(10, 5));
        assert!(is_reduce_only_change(-10, -4));
        assert!(is_reduce_only_change(10, 0));
        assert!(!is_reduce_only_change(0, 5));
        assert!(!is_reduce_only_change(10, -1));
        assert!(!is_reduce_only_change(10, 15));
    }
}
