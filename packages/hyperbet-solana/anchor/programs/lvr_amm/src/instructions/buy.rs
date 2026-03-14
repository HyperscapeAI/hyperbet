use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction::transfer;

use crate::error::PredictionMarketError;
use crate::state::bet::Bet;
use crate::math;

use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, TokenAccount, Token};

pub fn buy_instruction(ctx: Context<Buy>, bet_id: u64, outcome: u8, amount_in: u64) -> Result<()> {
    require!(
        outcome == 0 || outcome == 1,
        PredictionMarketError::OutComeCanOnlyBe01
    );
    require!(amount_in > 0, PredictionMarketError::QuantityMustBeGreaterThanZero);

    let bet = &mut ctx.accounts.bet;

    require!(
        bet.side_won.is_none(),
        PredictionMarketError::BetAlreadySettled
    );
    
    let is_buy_yes = outcome == 0;
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Check deadline
    if current_time >= bet.expiration_at {
        // Market expired, could revert here depending on logic, but EVM allows but liquidity might scale to zero
        // In EVM `deadline` was used as hard revert in `_swap`
        return err!(PredictionMarketError::MathErr); // or create custom MarketExpired error
    }

    let liq = if bet.is_dynamic { 
        math::calc_liquidity(bet.initial_liq, bet.expiration_at, current_time) 
    } else {
        bet.initial_liq
    };
    
    let fee_amount = (amount_in as u128 * bet.fee_bps as u128 / 10000) as u64;
    let net_amount_in = amount_in - fee_amount;

    let amount_out = math::get_swap_amount(
        !is_buy_yes, 
        bet.reserves[0], 
        bet.reserves[1], 
        liq, 
        net_amount_in
    );

    // Update Virtual Reserves
    // EVM:
    // Mints yesToken + noToken (amountIn) into Market
    // Returns `amountIn + amountOut` to the User.
    // So Market Reserve increases by `amountIn` for the OPPOSITE token, and decreases by `amountOut` for the REQUESTED token.
    if is_buy_yes {
        require!(bet.reserves[0] >= amount_out, PredictionMarketError::MathErr);
        bet.reserves[0] -= amount_out;
        bet.reserves[1] += net_amount_in;
    } else {
        require!(bet.reserves[1] >= amount_out, PredictionMarketError::MathErr);
        bet.reserves[1] -= amount_out;
        bet.reserves[0] += net_amount_in;
    }

    // Transfer fee to treasury if exists
    if fee_amount > 0 {
        let fee_transfer_instruction = transfer(
            ctx.accounts.signer.key,
            &ctx.accounts.treasury.key(),
            fee_amount,
        );
        invoke_signed(
            &fee_transfer_instruction,
            &[
                ctx.accounts.signer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;
    }

    // Transfer net_amount_in lamports from signer to bet account as Collateral
    let transfer_instruction = transfer(
        ctx.accounts.signer.key,
        &bet.key(),
        net_amount_in,
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

    // Mint amount_in + amount_out tokens to the buyer
    let (seeds, bump) = if outcome == 0 {
        (b"mint_yes".as_ref(), ctx.bumps.mint_yes)
    } else {
        (b"mint_no".as_ref(), ctx.bumps.mint_no)
    };
    let (destination_account, mint) = if outcome == 0 {
        (
            ctx.accounts.destination_yes.to_account_info(),
            ctx.accounts.mint_yes.to_account_info(),
        )
    } else {
        (
            ctx.accounts.destination_no.to_account_info(),
            ctx.accounts.mint_no.to_account_info(),
        )
    };

    let bet_id_bytes = bet_id.to_le_bytes();

    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds,
        &bet_id_bytes,
        &ctx.accounts.bet.creator.key().to_bytes(),
        &[bump],
    ]];

    let cpi_accounts = MintTo {
        mint: mint.clone(),
        to: destination_account,
        authority: mint,
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_context = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
    token::mint_to(cpi_context, net_amount_in + amount_out)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct Buy<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bet", bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
    )]
    pub bet: Box<Account<'info, Bet>>,

    /// CHECK: Validate treasury matches bet state
    #[account(mut, address = bet.treasury)]
    pub treasury: UncheckedAccount<'info>,

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
        mut,
        associated_token::mint = mint_yes,
        associated_token::authority = signer,
    )]
    pub destination_yes: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_no,
        associated_token::authority = signer,
    )]
    pub destination_no: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
