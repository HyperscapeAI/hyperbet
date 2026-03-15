use anchor_lang::prelude::*;

use crate::{error::PredictionMarketError, math, state::bet::Bet};

pub fn get_price_instruction(ctx: Context<GetPrice>, outcome: u8) -> Result<u64> {
    require!(
        outcome == 0 || outcome == 1,
        PredictionMarketError::OutComeCanOnlyBe01
    );
    let bet = &ctx.accounts.bet;

    // Calculates price using Gaussian CDF math from reserves
    let price_yes = math::calc_price(bet.reserves[0], bet.reserves[1], bet.initial_liq);

    if outcome == 0 {
        Ok(price_yes)
    } else {
        // Price of NO is 1 - Price of YES.  Since price is scaled by 1,000,000...
        Ok(1_000_000u64.saturating_sub(price_yes))
    }
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    pub bet: Account<'info, Bet>,
}
