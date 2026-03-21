use anchor_lang::prelude::*;

use crate::{error::PredictionMarketError, state::config::AmmConfig};

pub fn initialize_amm_config(
    ctx: Context<InitializeAmmConfig>,
    treasury: Pubkey,
    market_maker: Pubkey,
    fight_oracle_program: Pubkey,
    fee_bps: u16,
) -> Result<()> {
    require!(treasury != Pubkey::default(), PredictionMarketError::InvalidAddress);
    require!(market_maker != Pubkey::default(), PredictionMarketError::InvalidAddress);
    require!(fight_oracle_program != Pubkey::default(), PredictionMarketError::InvalidAddress);
    require!(fee_bps <= 1000, PredictionMarketError::FeeTooHigh);

    let config = &mut ctx.accounts.amm_config;
    config.authority = ctx.accounts.signer.key();
    config.treasury = treasury;
    config.market_maker = market_maker;
    config.fight_oracle_program = fight_oracle_program;
    config.fee_bps = fee_bps;
    config.config_frozen = false;
    config.paused = false;
    config.bump = ctx.bumps.amm_config;

    emit!(AmmConfigInitialized {
        authority: config.authority,
        treasury: config.treasury,
        fight_oracle_program: config.fight_oracle_program,
        fee_bps: config.fee_bps,
    });

    Ok(())
}

pub fn freeze_amm_config(ctx: Context<FreezeAmmConfig>) -> Result<()> {
    let config = &mut ctx.accounts.amm_config;
    require!(
        ctx.accounts.signer.key() == config.authority,
        PredictionMarketError::SignerIsNotSettlePubKey
    );
    config.config_frozen = true;

    emit!(AmmConfigFrozen {
        authority: config.authority,
    });

    Ok(())
}

pub fn set_amm_paused(ctx: Context<SetAmmPaused>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.amm_config;
    require!(
        ctx.accounts.signer.key() == config.authority,
        PredictionMarketError::SignerIsNotSettlePubKey
    );
    config.paused = paused;

    emit!(AmmPausedChanged {
        paused,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAmmConfig<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + AmmConfig::INIT_SPACE,
        seeds = [b"amm_config"],
        bump
    )]
    pub amm_config: Account<'info, AmmConfig>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FreezeAmmConfig<'info> {
    #[account(
        mut,
        seeds = [b"amm_config"],
        bump = amm_config.bump,
    )]
    pub amm_config: Account<'info, AmmConfig>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAmmPaused<'info> {
    #[account(
        mut,
        seeds = [b"amm_config"],
        bump = amm_config.bump,
    )]
    pub amm_config: Account<'info, AmmConfig>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

#[event]
pub struct AmmConfigInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fight_oracle_program: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct AmmConfigFrozen {
    pub authority: Pubkey,
}

#[event]
pub struct AmmPausedChanged {
    pub paused: bool,
}
