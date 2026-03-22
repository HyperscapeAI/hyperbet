use crate::state::bet::Bet;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction::transfer;

pub fn init_bet(ctx: Context<InitBet>, _bet_id: u64) -> Result<()> {
    let bet = &mut ctx.accounts.bet;

    let transfer_instruction = transfer(
        ctx.accounts.signer.key,
        &bet.key(),
        bet.reserves[0], // which holds collateralIn initially
    );
    invoke_signed(
        &transfer_instruction,
        &[
            ctx.accounts.signer.to_account_info(),
            bet.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[],
    )?;

    bet.is_initialized = true;

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct InitBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bet".as_ref(), bet_id.to_le_bytes().as_ref(), signer.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,

    pub system_program: Program<'info, System>,
}
