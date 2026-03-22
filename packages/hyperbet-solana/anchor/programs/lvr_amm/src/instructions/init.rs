use anchor_lang::prelude::*;

use crate::{error::PredictionMarketError, state::admin::Admin};

pub fn init_admin_state(ctx: Context<InitializeAdmin>) -> Result<()> {
    let admin = &mut ctx.accounts.admin_state;

    require!(
        !admin.is_initialized,
        PredictionMarketError::AdminStateAlreadyInitialized
    );

    admin.admin = ctx.accounts.signer.key();
    admin.is_initialized = true;

    emit!(AdminStateInitialized {
        admin: admin.admin,
        is_initialized: admin.is_initialized,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + Admin::INIT_SPACE,
        seeds = [b"admin_state"],
        bump
    )]
    pub admin_state: Account<'info, Admin>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AdminStateInitialized {
    pub admin: Pubkey,
    pub is_initialized: bool,
}
