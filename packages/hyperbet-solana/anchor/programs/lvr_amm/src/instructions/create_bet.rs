use anchor_lang::prelude::*;
use std::mem::size_of;

use crate::{error::PredictionMarketError, state::bet::Bet};
use crate::math;

use anchor_spl::token::{Mint, Token};

pub fn create_bet(
    ctx: Context<CreateBet>,
    bet_id: u64,
    initial_liq: u64, // Collateral In
    is_dynamic: bool,
    bet_prompt: String,
    expiration: i64,
    fee_bps: u16,
    treasury: Pubkey,
) -> Result<()> {
    require!(
        initial_liq > 0,
        PredictionMarketError::InvalidInitialLiq
    );
    let bet = &mut ctx.accounts.bet;

    let clock = Clock::get()?;

    bet.bet_id = bet_id;
    bet.is_dynamic = is_dynamic;
    
    // Calculates L = collateral / pdf(0)
    bet.initial_liq = math::calc_initial_liquidity(initial_liq);
    
    // Set Virtual Reserves of YES and NO to collateral initially
    bet.reserves = [initial_liq, initial_liq];

    bet.bet_prompt = bet_prompt;
    bet.created_at = clock.unix_timestamp;
    bet.creator = *ctx.accounts.signer.key;
    bet.expiration_at = expiration;
    bet.is_initialized = false;
    bet.side_won = None;
    bet.treasury = treasury;
    bet.fee_bps = fee_bps;

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct CreateBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = size_of::<Bet>() + 8 + 128, // Extra buffer for string and safety
        seeds = [b"bet".as_ref(), bet_id.to_le_bytes().as_ref(), signer.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,

    #[account(
        init,
        seeds = [b"mint_yes", bet_id.to_le_bytes().as_ref(), signer.key().as_ref()],
        bump,
        payer = signer,
        mint::decimals = 9,
        mint::authority = mint_yes.key(),
    )]
    pub mint_yes: Account<'info, Mint>,

    #[account(
        init,
        seeds = [b"mint_no", bet_id.to_le_bytes().as_ref(), signer.key().as_ref()],
        bump,
        payer = signer,
        mint::decimals = 9,
        mint::authority = mint_no.key(),
    )]
    pub mint_no: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
