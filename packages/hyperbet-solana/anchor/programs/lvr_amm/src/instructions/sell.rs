use crate::math;
use crate::{error::PredictionMarketError, state::bet::Bet};
use anchor_lang::prelude::*;

use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, TokenAccount, Token};

// / Sell shares of a bet, 0 for yes, 1 for no
pub fn sell_instruction(ctx: Context<Sell>, bet_id: u64, outcome: u8, amount_in: u64) -> Result<()> {
    require!(
        outcome == 0 || outcome == 1,
        PredictionMarketError::OutComeCanOnlyBe01
    );
    require!(amount_in > 0, PredictionMarketError::QuantityMustBeGreaterThanZero);

    let user_share_balance = if outcome == 0 {
        ctx.accounts.destination_yes.amount
    } else {
        ctx.accounts.destination_no.amount
    };

    require!(user_share_balance >= amount_in, PredictionMarketError::SignerDoesntHaveEnoughTokens);

    let bet = &mut ctx.accounts.bet;
    require!(bet.side_won.is_none(), PredictionMarketError::BetAlreadySettled);

    let is_sell_yes = outcome == 0;
    let current_time = Clock::get()?.unix_timestamp;

    if current_time >= bet.expiration_at {
        return err!(PredictionMarketError::MathErr);
    }

    let liq = if bet.is_dynamic { 
        math::calc_liquidity(bet.initial_liq, bet.expiration_at, current_time) 
    } else {
        bet.initial_liq
    };
    
    let fee_amount = (amount_in as u128 * bet.fee_bps as u128 / 10000) as u64;
    let net_amount_in = amount_in - fee_amount;

    let amount_out = math::get_swap_amount(
        is_sell_yes, 
        bet.reserves[0], 
        bet.reserves[1], 
        liq, 
        net_amount_in
    );

    // Update Virtual Reserves
    if is_sell_yes {
        require!(bet.reserves[1] >= amount_out, PredictionMarketError::MathErr);
        bet.reserves[0] += net_amount_in;
        bet.reserves[1] -= amount_out;
    } else {
        require!(bet.reserves[0] >= amount_out, PredictionMarketError::MathErr);
        bet.reserves[1] += net_amount_in;
        bet.reserves[0] -= amount_out;
    }

    // Burn the net amount being sold (rest is transferred as fee)
    let (burn_destination, burn_mint) = if outcome == 0 {
        (ctx.accounts.destination_yes.to_account_info(), ctx.accounts.mint_yes.to_account_info())
    } else {
        (ctx.accounts.destination_no.to_account_info(), ctx.accounts.mint_no.to_account_info())
    };

    let cpi_accounts_burn = Burn {
        mint: burn_mint.clone(),
        from: burn_destination.clone(),
        authority: ctx.accounts.signer.to_account_info()
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_context_burn = CpiContext::new(cpi_program.clone(), cpi_accounts_burn);
    token::burn(cpi_context_burn, net_amount_in)?;

    // Transfer fee to treasury ATA
    if fee_amount > 0 {
        let expected_treasury_ata = if outcome == 0 {
            anchor_spl::associated_token::get_associated_token_address(
                &ctx.accounts.treasury.key(),
                &ctx.accounts.mint_yes.key(),
            )
        } else {
            anchor_spl::associated_token::get_associated_token_address(
                &ctx.accounts.treasury.key(),
                &ctx.accounts.mint_no.key(),
            )
        };

        let treasury_ata = if outcome == 0 {
            ctx.accounts.treasury_yes_ata.to_account_info()
        } else {
            ctx.accounts.treasury_no_ata.to_account_info()
        };

        require_keys_eq!(treasury_ata.key(), expected_treasury_ata, PredictionMarketError::InvalidTreasuryATA);

        let cpi_accounts_transfer = token::Transfer {
            from: burn_destination,
            to: treasury_ata,
            authority: ctx.accounts.signer.to_account_info(),
        };
        let cpi_context_transfer = CpiContext::new(cpi_program.clone(), cpi_accounts_transfer);
        token::transfer(cpi_context_transfer, fee_amount)?;
    }

    // mint the received tokens
    let (seeds, bump) = if outcome == 1 {
        // if sold NO, receive YES
        (b"mint_yes".as_ref(), ctx.bumps.mint_yes)
    } else {
        // if sold YES, receive NO
        (b"mint_no".as_ref(), ctx.bumps.mint_no)
    };
    
    let (mint_destination, receive_mint) = if outcome == 1 {
        (ctx.accounts.destination_yes.to_account_info(), ctx.accounts.mint_yes.to_account_info())
    } else {
        (ctx.accounts.destination_no.to_account_info(), ctx.accounts.mint_no.to_account_info())
    };

    let bet_id_bytes = bet_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds,
        &bet_id_bytes,
        &ctx.accounts.bet.creator.key().to_bytes(),
        &[bump],
    ]];

    let cpi_accounts_mint = MintTo {
        mint: receive_mint.clone(),
        to: mint_destination,
        authority: receive_mint,
    };
    let cpi_context_mint = CpiContext::new(cpi_program, cpi_accounts_mint).with_signer(signer_seeds);
    token::mint_to(cpi_context_mint, amount_out)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct Sell<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut, 
        seeds = [b"bet", bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
    )]
    pub bet: Box<Account<'info, Bet>>,

    #[account(
        mut,
        seeds = [b"mint_yes", bet.bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
        mint::authority = mint_yes
    )]
    pub mint_yes: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"mint_no", bet.bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
        mint::authority = mint_no
    )]
    pub mint_no: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint_yes,
        associated_token::authority = signer,
    )]
    pub destination_yes: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint_no,
        associated_token::authority = signer,
    )]
    pub destination_no: Box<Account<'info, TokenAccount>>,

    /// CHECK: Validate treasury matched bet state
    #[account(mut, address = bet.treasury)]
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: Manual validation in instruction
    #[account(mut)]
    pub treasury_yes_ata: UncheckedAccount<'info>,

    /// CHECK: Manual validation in instruction
    #[account(mut)]
    pub treasury_no_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
