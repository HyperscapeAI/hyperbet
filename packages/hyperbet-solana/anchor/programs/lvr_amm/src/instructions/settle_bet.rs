use anchor_lang::prelude::*;

use crate::{
    error::PredictionMarketError,
    state::{admin::Admin, bet::Bet},
};

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
    require!(data.len() >= 106, PredictionMarketError::MathErr);

    let status = OracleDuelStatus::try_from_slice(&data[104..105])
        .map_err(|_| error!(PredictionMarketError::MathErr))?;
    let winner = OracleMarketSide::try_from_slice(&data[105..106])
        .map_err(|_| error!(PredictionMarketError::MathErr))?;

    Ok((status, winner))
}

pub fn settle_bet_instruction(ctx: Context<SettleBet>, _bet_id: u64, side_won: u8) -> Result<()> {
    // If an oracle duel_state is provided, read winner from oracle (trustless path)
    let final_side_won = if let Some(duel_account) = &ctx.accounts.duel_state {
        let data = duel_account.try_borrow_data()?;
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
                OracleMarketSide::None => return err!(PredictionMarketError::MathErr),
            }
        }
    } else {
        // Fallback: admin-only settlement (legacy path)
        require!(
            ctx.accounts.signer.key() == ctx.accounts.admin_state.admin.key(),
            PredictionMarketError::SignerIsNotSettlePubKey
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

    /// Optional: fight_oracle DuelState account. When provided, winner is read
    /// from the oracle rather than trusting the caller's `side_won` argument.
    /// CHECK: We manually deserialize the data at known offsets.
    pub duel_state: Option<UncheckedAccount<'info>>,
}
