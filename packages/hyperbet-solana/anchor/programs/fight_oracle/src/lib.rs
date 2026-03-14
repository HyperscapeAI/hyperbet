#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo");

pub const ORACLE_CONFIG_SEED: &[u8] = b"oracle_config";
pub const DUEL_SEED: &[u8] = b"duel";

const DEFAULT_BOOTSTRAP_AUTHORITY: &str = "DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn";

fn bootstrap_authority() -> Pubkey {
    use std::str::FromStr;
    if let Some(value) = option_env!("HYPERSCAPE_BOOTSTRAP_AUTHORITY") {
        Pubkey::from_str(value).expect("invalid HYPERSCAPE_BOOTSTRAP_AUTHORITY")
    } else {
        Pubkey::from_str(DEFAULT_BOOTSTRAP_AUTHORITY).expect("invalid default bootstrap authority")
    }
}

#[program]
pub mod fight_oracle {
    use super::*;

    pub fn initialize_oracle(ctx: Context<InitializeOracle>, reporter: Pubkey) -> Result<()> {
        let oracle_config = &mut ctx.accounts.oracle_config;

        if oracle_config.authority != Pubkey::default() {
            require_keys_eq!(
                oracle_config.authority,
                ctx.accounts.authority.key(),
                ErrorCode::Unauthorized
            );
        } else {
            oracle_config.authority = ctx.accounts.authority.key();
            oracle_config.bump = ctx.bumps.oracle_config;
        }

        require!(reporter != Pubkey::default(), ErrorCode::InvalidReporter);
        oracle_config.reporter = reporter;
        Ok(())
    }

    pub fn update_oracle_config(
        ctx: Context<UpdateOracleConfig>,
        authority: Pubkey,
        reporter: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        require!(authority != Pubkey::default(), ErrorCode::InvalidAuthority);
        require!(reporter != Pubkey::default(), ErrorCode::InvalidReporter);

        let oracle_config = &mut ctx.accounts.oracle_config;
        oracle_config.authority = authority;
        oracle_config.reporter = reporter;
        Ok(())
    }

    pub fn upsert_duel(
        ctx: Context<UpsertDuel>,
        duel_key: [u8; 32],
        participant_a_hash: [u8; 32],
        participant_b_hash: [u8; 32],
        bet_open_ts: i64,
        bet_close_ts: i64,
        duel_start_ts: i64,
        metadata_uri: String,
        status: DuelStatus,
    ) -> Result<()> {
        require!(
            status == DuelStatus::Scheduled
                || status == DuelStatus::BettingOpen
                || status == DuelStatus::Locked,
            ErrorCode::InvalidLifecycleTransition
        );
        require!(
            participant_a_hash != [0_u8; 32] && participant_b_hash != [0_u8; 32],
            ErrorCode::InvalidParticipants
        );
        require!(
            participant_a_hash != participant_b_hash,
            ErrorCode::InvalidParticipants
        );
        require!(bet_open_ts > 0, ErrorCode::InvalidBetWindow);
        require!(bet_close_ts > bet_open_ts, ErrorCode::InvalidBetWindow);
        require!(
            duel_start_ts >= bet_close_ts,
            ErrorCode::InvalidLifecycleTransition
        );

        let duel_state = &mut ctx.accounts.duel_state;
        let is_initialized = duel_state.bump != 0;
        if is_initialized {
            require!(duel_state.duel_key == duel_key, ErrorCode::DuelKeyMismatch);
            require!(
                duel_state.status != DuelStatus::Resolved
                    && duel_state.status != DuelStatus::Cancelled,
                ErrorCode::DuelAlreadyFinalized
            );
            require!(
                duel_status_rank(status) >= duel_status_rank(duel_state.status),
                ErrorCode::InvalidLifecycleTransition
            );
        } else {
            duel_state.bump = ctx.bumps.duel_state;
            duel_state.winner = MarketSide::None;
        }

        duel_state.duel_key = duel_key;
        duel_state.participant_a_hash = participant_a_hash;
        duel_state.participant_b_hash = participant_b_hash;
        duel_state.bet_open_ts = bet_open_ts;
        duel_state.bet_close_ts = bet_close_ts;
        duel_state.duel_start_ts = duel_start_ts;
        duel_state.status = status;
        emit!(DuelUpserted {
            duel_key,
            status,
            bet_open_ts,
            bet_close_ts,
            duel_start_ts,
            metadata_uri: metadata_uri.clone(),
        });
        duel_state.metadata_uri = metadata_uri;

        Ok(())
    }

    pub fn cancel_duel(
        ctx: Context<CancelDuel>,
        _duel_key: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        let duel_state = &mut ctx.accounts.duel_state;
        require!(
            duel_state.status != DuelStatus::Resolved
                && duel_state.status != DuelStatus::Cancelled,
            ErrorCode::DuelAlreadyFinalized
        );
        duel_state.status = DuelStatus::Cancelled;
        emit!(DuelCancelled {
            duel_key: duel_state.duel_key,
            metadata_uri: metadata_uri.clone(),
        });
        duel_state.metadata_uri = metadata_uri;

        Ok(())
    }

    pub fn report_result(
        ctx: Context<ReportResult>,
        _duel_key: [u8; 32],
        winner: MarketSide,
        seed: u64,
        replay_hash: [u8; 32],
        result_hash: [u8; 32],
        duel_end_ts: i64,
        metadata_uri: String,
    ) -> Result<()> {
        require!(
            winner == MarketSide::A || winner == MarketSide::B,
            ErrorCode::InvalidWinner
        );
        require!(duel_end_ts > 0, ErrorCode::InvalidLifecycleTransition);

        let duel_state = &mut ctx.accounts.duel_state;
        require!(
            duel_state.status != DuelStatus::Cancelled,
            ErrorCode::DuelAlreadyCancelled
        );
        require!(
            duel_state.status != DuelStatus::Resolved,
            ErrorCode::DuelAlreadyFinalized
        );
        require!(
            duel_end_ts >= duel_state.bet_close_ts,
            ErrorCode::InvalidLifecycleTransition
        );

        duel_state.status = DuelStatus::Resolved;
        duel_state.winner = winner;
        duel_state.seed = seed;
        duel_state.result_hash = result_hash;
        duel_state.replay_hash = replay_hash;
        duel_state.duel_end_ts = duel_end_ts;
        emit!(DuelResolved {
            duel_key: duel_state.duel_key,
            winner,
            seed,
            duel_end_ts,
            result_hash,
            replay_hash,
            metadata_uri: metadata_uri.clone(),
        });
        duel_state.metadata_uri = metadata_uri;

        Ok(())
    }
}

fn duel_status_rank(status: DuelStatus) -> u8 {
    match status {
        DuelStatus::Scheduled => 0,
        DuelStatus::BettingOpen => 1,
        DuelStatus::Locked => 2,
        DuelStatus::Resolved => 3,
        DuelStatus::Cancelled => 4,
    }
}

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OracleConfig::INIT_SPACE,
        seeds = [ORACLE_CONFIG_SEED],
        bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::UnauthorizedInitializer
    )]
    pub program: Program<'info, crate::program::FightOracle>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            || ((program_data.upgrade_authority_address.is_none()
                || program_data.upgrade_authority_address == Some(Pubkey::default()))
                && authority.key() == bootstrap_authority()) @ ErrorCode::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracleConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct UpsertDuel<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.reporter == reporter.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(
        init_if_needed,
        payer = reporter,
        space = 8 + DuelState::INIT_SPACE,
        seeds = [DUEL_SEED, duel_key.as_ref()],
        bump,
    )]
    pub duel_state: Account<'info, DuelState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct CancelDuel<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.reporter == reporter.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(
        mut,
        seeds = [DUEL_SEED, duel_key.as_ref()],
        bump = duel_state.bump,
    )]
    pub duel_state: Account<'info, DuelState>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct ReportResult<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.reporter == reporter.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(
        mut,
        seeds = [DUEL_SEED, duel_key.as_ref()],
        bump = duel_state.bump,
    )]
    pub duel_state: Account<'info, DuelState>,
}

#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    pub authority: Pubkey,
    pub reporter: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DuelState {
    pub duel_key: [u8; 32],
    pub participant_a_hash: [u8; 32],
    pub participant_b_hash: [u8; 32],
    pub status: DuelStatus,
    pub winner: MarketSide,
    pub bet_open_ts: i64,
    pub bet_close_ts: i64,
    pub duel_start_ts: i64,
    pub duel_end_ts: i64,
    pub seed: u64,
    pub result_hash: [u8; 32],
    pub replay_hash: [u8; 32],
    #[max_len(200)]
    pub metadata_uri: String,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum DuelStatus {
    Scheduled,
    BettingOpen,
    Locked,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum MarketSide {
    None,
    A,
    B,
}

#[event]
pub struct DuelUpserted {
    pub duel_key: [u8; 32],
    pub status: DuelStatus,
    pub bet_open_ts: i64,
    pub bet_close_ts: i64,
    pub duel_start_ts: i64,
    pub metadata_uri: String,
}

#[event]
pub struct DuelCancelled {
    pub duel_key: [u8; 32],
    pub metadata_uri: String,
}

#[event]
pub struct DuelResolved {
    pub duel_key: [u8; 32],
    pub winner: MarketSide,
    pub seed: u64,
    pub duel_end_ts: i64,
    pub result_hash: [u8; 32],
    pub replay_hash: [u8; 32],
    pub metadata_uri: String,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized oracle action")]
    Unauthorized,
    #[msg("Only the current upgrade authority can initialize the oracle")]
    UnauthorizedInitializer,
    #[msg("Reporter pubkey cannot be the default address")]
    InvalidReporter,
    #[msg("Authority pubkey cannot be the default address")]
    InvalidAuthority,
    #[msg("Betting window is invalid")]
    InvalidBetWindow,
    #[msg("Participants must be present and distinct")]
    InvalidParticipants,
    #[msg("Duel lifecycle transition is invalid")]
    InvalidLifecycleTransition,
    #[msg("The provided duel key does not match the stored duel")]
    DuelKeyMismatch,
    #[msg("The duel is already finalized")]
    DuelAlreadyFinalized,
    #[msg("The duel was cancelled and cannot be resolved")]
    DuelAlreadyCancelled,
    #[msg("Winner must be side A or side B")]
    InvalidWinner,
}
