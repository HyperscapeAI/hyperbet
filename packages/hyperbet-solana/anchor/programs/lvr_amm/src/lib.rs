pub mod error;
pub mod instructions;
pub mod state;

pub mod math;

use anchor_lang::prelude::*;

use instructions::*;

declare_id!("Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5");

#[program]
pub mod lvr_amm {
    use super::*;

    pub fn initialize(ctx: Context<InitializeAdmin>) -> Result<()> {
        init_admin_state(ctx)
    }

    pub fn initialize_config(
        ctx: Context<InitializeAmmConfig>,
        treasury: Pubkey,
        market_maker: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        initialize_amm_config(ctx, treasury, market_maker, fee_bps)
    }

    pub fn freeze_config(ctx: Context<FreezeAmmConfig>) -> Result<()> {
        freeze_amm_config(ctx)
    }

    pub fn set_paused(ctx: Context<SetAmmPaused>, paused: bool) -> Result<()> {
        set_amm_paused(ctx, paused)
    }

    pub fn create_bet_account(
        ctx: Context<CreateBet>,
        bet_id: u64,
        initial_liq: u64,
        is_dynamic: bool,
        bet_prompt: String,
        expiration_at: i64,
        duel_key: [u8; 32],
    ) -> Result<()> {
        create_bet(ctx, bet_id, initial_liq, is_dynamic, bet_prompt, expiration_at, duel_key)
    }

    pub fn init_bet_account(ctx: Context<InitBet>, bet_id: u64) -> Result<()> {
        init_bet(ctx, bet_id)
    }

    pub fn get_price(ctx: Context<GetPrice>, outcome: u8) -> Result<u64> {
        get_price_instruction(ctx, outcome)
    }

    pub fn buy(ctx: Context<Buy>, bet_id: u64, outcome: u8, amount_in: u64) -> Result<()> {
        buy_instruction(ctx, bet_id, outcome, amount_in)
    }

    pub fn sell(ctx: Context<Sell>, bet_id: u64, outcome: u8, amount_in: u64) -> Result<()> {
        sell_instruction(ctx, bet_id, outcome, amount_in)
    }

    pub fn settle_bet(ctx: Context<SettleBet>, bet_id: u64, side_won: u8) -> Result<()> {
        settle_bet_instruction(ctx, bet_id, side_won)
    }

    pub fn withdraw_post_settle(
        ctx: Context<WithdrawPostSettle>,
        bet_id: u64,
        outcome: u8,
        q: u64,
    ) -> Result<()> {
        withdraw_post_settle_instruction(ctx, bet_id, outcome, q)
    }
}
