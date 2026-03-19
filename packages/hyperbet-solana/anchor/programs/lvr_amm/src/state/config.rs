use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AmmConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub market_maker: Pubkey,
    pub fee_bps: u16,
    pub config_frozen: bool,
    pub paused: bool,
    pub bump: u8,
}
