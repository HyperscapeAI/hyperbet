use anchor_lang::prelude::*;

use crate::{
    error::PredictionMarketError,
    state::{admin::Admin, bet::Bet},
};

pub fn settle_bet_instruction(ctx: Context<SettleBet>, _bet_id: u64, side_won: u8) -> Result<()> {
    require!(
        ctx.accounts.signer.key() == ctx.accounts.admin_state.admin.key(),
        PredictionMarketError::SignerIsNotSettlePubKey
    );
    require!(
        side_won == 0 || side_won == 1 || side_won == 2,
        PredictionMarketError::OutComeCanOnlyBe01
    );
    require!(
        ctx.accounts.bet.side_won.is_none(),
        PredictionMarketError::BetAlreadySettled
    );

    let bet = &mut ctx.accounts.bet;
    bet.side_won = Some(side_won);

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct SettleBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [b"admin_state"],
        bump
    )]
    pub admin_state: Account<'info, Admin>,

    #[account(
        mut,
        seeds = [b"bet", bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
    )]
    pub bet: Account<'info, Bet>,
}
