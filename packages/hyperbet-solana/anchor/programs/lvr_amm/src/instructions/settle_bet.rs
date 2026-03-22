use anchor_lang::prelude::*;

use crate::{
    error::PredictionMarketError,
    state::{admin::Admin, bet::Bet, config::AmmConfig},
};

const DUEL_STATE_DISCRIMINATOR: [u8; 8] = [0x95, 0xd5, 0x3b, 0xa5, 0x7c, 0x74, 0x91, 0x78];
const DUEL_KEY_OFFSET: usize = 8;
const DUEL_KEY_END: usize = DUEL_KEY_OFFSET + 32;
const STATUS_OFFSET: usize = 104;
const WINNER_OFFSET: usize = 105;
const MIN_DUEL_STATE_LEN: usize = 106;

/// Oracle DuelStatus — mirrored from fight_oracle for deserialization.
/// Must stay in sync with fight_oracle::DuelStatus discriminant order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OracleDuelStatus {
    Scheduled,
    BettingOpen,
    Locked,
    Proposed,
    Challenged,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OracleMarketSide {
    None,
    A,
    B,
}

/// Minimal deserialization of fight_oracle DuelState (first fields only).
/// We only need status + winner which sit at fixed offsets after the 8-byte discriminator.
fn read_oracle_duel(data: &[u8]) -> Result<(OracleDuelStatus, OracleMarketSide)> {
    // Layout after 8-byte Anchor discriminator:
    //   duel_key: [u8; 32]            offset 8..40
    //   participant_a_hash: [u8; 32]   offset 40..72
    //   participant_b_hash: [u8; 32]   offset 72..104
    //   status: u8 (enum)              offset 104
    //   winner: u8 (enum)              offset 105
    require!(data.len() >= MIN_DUEL_STATE_LEN, PredictionMarketError::InvalidOracleAccount);
    require!(
        data[..8] == DUEL_STATE_DISCRIMINATOR,
        PredictionMarketError::InvalidOracleAccount
    );

    let status = OracleDuelStatus::try_from_slice(&data[STATUS_OFFSET..STATUS_OFFSET + 1])
        .map_err(|_| error!(PredictionMarketError::InvalidOracleAccount))?;
    let winner = OracleMarketSide::try_from_slice(&data[WINNER_OFFSET..WINNER_OFFSET + 1])
        .map_err(|_| error!(PredictionMarketError::InvalidOracleAccount))?;

    Ok((status, winner))
}

fn read_oracle_duel_key(data: &[u8]) -> Result<[u8; 32]> {
    require!(data.len() >= DUEL_KEY_END, PredictionMarketError::InvalidOracleAccount);
    let mut duel_key = [0_u8; 32];
    duel_key.copy_from_slice(&data[DUEL_KEY_OFFSET..DUEL_KEY_END]);
    Ok(duel_key)
}

pub fn settle_bet_instruction(ctx: Context<SettleBet>, _bet_id: u64, side_won: u8) -> Result<()> {
    require!(
        ctx.accounts.bet.is_initialized,
        PredictionMarketError::BetNotInitialized
    );

    // If an oracle duel_state is provided, read winner from oracle (trustless path)
    let final_side_won = if let Some(duel_account) = &ctx.accounts.duel_state {
        let amm_config = ctx.accounts.amm_config.as_ref()
            .ok_or(error!(PredictionMarketError::MissingAmmConfig))?;
        require_keys_eq!(
            *duel_account.owner,
            amm_config.fight_oracle_program,
            PredictionMarketError::InvalidFightOracleProgram
        );

        let data = duel_account.try_borrow_data()?;
        let duel_key = read_oracle_duel_key(&data)?;
        // Compare full 32-byte duel key if set, otherwise fall back to first 8 bytes (bet_id)
        if ctx.accounts.bet.duel_key != [0u8; 32] {
            require!(
                duel_key == ctx.accounts.bet.duel_key,
                PredictionMarketError::OracleBetMismatch
            );
        } else {
            require!(
                duel_key[..8] == ctx.accounts.bet.bet_id.to_le_bytes(),
                PredictionMarketError::OracleBetMismatch
            );
        }
        let (status, winner) = read_oracle_duel(&data)?;

        require!(
            status == OracleDuelStatus::Resolved || status == OracleDuelStatus::Cancelled,
            PredictionMarketError::BetNotExpired
        );

        if status == OracleDuelStatus::Cancelled {
            // Cancelled = no winner, use sentinel 2
            2u8
        } else {
            match winner {
                OracleMarketSide::A => 0u8,
                OracleMarketSide::B => 1u8,
                OracleMarketSide::None => return err!(PredictionMarketError::InvalidOracleAccount),
            }
        }
    } else {
        // Fallback: admin-only settlement (legacy path)
        require!(
            ctx.accounts.signer.key() == ctx.accounts.admin_state.admin.key(),
            PredictionMarketError::SignerIsNotSettlePubKey
        );
        require!(
            side_won <= 2,
            PredictionMarketError::InvalidSettlementOutcome
        );
        side_won
    };

    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    require!(
        current_time > ctx.accounts.bet.expiration_at,
        PredictionMarketError::BetNotExpired
    );

    let bet = &mut ctx.accounts.bet;
    bet.side_won = Some(final_side_won);

    Ok(())
}

#[derive(Accounts)]
#[instruction(bet_id: u64)]
pub struct SettleBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [b"admin_state"],
        bump
    )]
    pub admin_state: Account<'info, Admin>,

    #[account(
        mut,
        seeds = [b"bet", bet_id.to_le_bytes().as_ref(), bet.creator.as_ref()],
        bump,
    )]
    pub bet: Account<'info, Bet>,

    /// Optional: AmmConfig for oracle program ID validation (required when duel_state is provided)
    #[account(
        seeds = [b"amm_config"],
        bump = amm_config.bump,
    )]
    pub amm_config: Option<Account<'info, AmmConfig>>,

    /// Optional: fight_oracle DuelState account. When provided, winner is read
    /// from the oracle rather than trusting the caller's `side_won` argument.
    /// CHECK: We manually deserialize the data at known offsets.
    pub duel_state: Option<UncheckedAccount<'info>>,
}
