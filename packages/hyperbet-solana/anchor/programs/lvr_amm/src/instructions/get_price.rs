use anchor_lang::prelude::*;

use crate::{error::PredictionMarketError, state::bet::Bet, math};

pub fn get_price_instruction(ctx: Context<GetPrice>, outcome: u8) -> Result<u64> {
    require!(
        outcome == 0 || outcome == 1,
        PredictionMarketError::OutComeCanOnlyBe01
    );
    let bet = &ctx.accounts.bet;

    let current_time = Clock::get()?.unix_timestamp;
    let liq = if bet.is_dynamic {
        math::calc_liquidity(bet.initial_liq, bet.expiration_at, current_time)
    } else {
        bet.initial_liq
    };

    let price_yes = math::calc_price(bet.reserves[0], bet.reserves[1], liq)?;

    if outcome == 0 {
        Ok(price_yes)
    } else {
        Ok(1_000_000u64.saturating_sub(price_yes))
    }
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(mut)]
    pub bet: Account<'info, Bet>,
}
