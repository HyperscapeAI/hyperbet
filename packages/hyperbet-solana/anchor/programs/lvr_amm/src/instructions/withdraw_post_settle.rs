use anchor_lang::prelude::*;

use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::{error::PredictionMarketError, state::bet::Bet};

pub fn withdraw_post_settle_instruction(
    ctx: Context<WithdrawPostSettle>,
    _bet_id: u64,
    outcome: u8,
    q: u64,
) -> Result<()> {
    let bet = &ctx.accounts.bet;

    require!(bet.is_initialized, PredictionMarketError::BetNotInitialized);
    require!(bet.side_won.is_some(), PredictionMarketError::BetNotSettled);
    require!(
        outcome == 0 || outcome == 1,
        PredictionMarketError::OutComeCanOnlyBe01
    );

    let user_share_balance = if outcome == 0 {
        ctx.accounts.destination_yes.amount
    } else {
        ctx.accounts.destination_no.amount
    };

    require!(
        user_share_balance >= q,
        PredictionMarketError::SignerDoesntHaveEnoughTokens
    );

    // Burn the tokens
    let (burn_destination, burn_mint) = if outcome == 0 {
        (ctx.accounts.destination_yes.to_account_info(), ctx.accounts.mint_yes.to_account_info())
    } else {
        (ctx.accounts.destination_no.to_account_info(), ctx.accounts.mint_no.to_account_info())
    };

    let cpi_accounts = Burn {
        mint: burn_mint.clone(),
        from: burn_destination,
        authority: ctx.accounts.signer.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
    token_interface::burn(cpi_context, q)?;

    // Only pay if the user holds the winning shares (or cancelled market)
    let resolved_side = bet.side_won.unwrap();
    if resolved_side == 2 || resolved_side == outcome {
        // Cancellation (side==2): each token redeems at 0.5 to maintain solvency.
        // Winning side: redeem 1:1 for collateral.
        let payout = if resolved_side == 2 { q / 2 } else { q };

        let rent_balance = Rent::get()?.minimum_balance(bet.to_account_info().data_len());
        let bet_sol_balance = **bet.to_account_info().lamports.borrow() - rent_balance;

        require!(
            bet_sol_balance >= payout,
            PredictionMarketError::NotEnoughLamports
        );

        let bet = &mut ctx.accounts.bet;
        bet.sub_lamports(payout)?;
        ctx.accounts.signer.add_lamports(payout)?;
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct WithdrawPostSettle<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bet", bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
    )]
    pub bet: Account<'info, Bet>,

    #[account(
        mut,
        seeds = [b"mint_yes", bet.bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
        mint::authority = mint_yes
    )]
    pub mint_yes: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"mint_no", bet.bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
        mint::authority = mint_no
    )]
    pub mint_no: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_yes,
        associated_token::authority = signer,
    )]
    pub destination_yes: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_no,
        associated_token::authority = signer,
    )]
    pub destination_no: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
