use anchor_lang::prelude::*;

#[account]
pub struct Bet {
    pub bet_id: u64,
    pub initial_liq: u64, // Initial Liquidity exactly matching EVM model
    pub is_dynamic: bool,
    pub reserves: [u64; 2], // 0 for Yes, 1 for No. These are virtual reserves.
    pub bet_prompt: String,
    pub is_initialized: bool,
    // by default none
    pub side_won: Option<u8>,
    pub expiration_at: i64,
    pub created_at: i64,
    pub creator: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    /// Full 32-byte duel key for oracle cross-reference (0 if not set)
    pub duel_key: [u8; 32],
}
