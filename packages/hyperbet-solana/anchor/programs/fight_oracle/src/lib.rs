#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("B5mRCRDJk9BrnH7regMWW5mpTQ8QG1CcCGSnDxMt8hmo");

pub const ORACLE_CONFIG_SEED: &[u8] = b"oracle_config";
pub const DUEL_SEED: &[u8] = b"duel";

#[program]
pub mod fight_oracle {
    use super::*;

    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        reporter: Pubkey,
        finalizer: Pubkey,
        challenger: Pubkey,
        dispute_window_secs: i64,
    ) -> Result<()> {
        let program_data = &ctx.accounts.program_data;
        let upgrade_authority = program_data
            .upgrade_authority_address
            .ok_or(ErrorCode::UnauthorizedInitializer)?;
        require!(
            upgrade_authority != Pubkey::default(),
            ErrorCode::UnauthorizedInitializer
        );
        require_keys_eq!(
            upgrade_authority,
            ctx.accounts.authority.key(),
            ErrorCode::UnauthorizedInitializer
        );

        let oracle_config = &mut ctx.accounts.oracle_config;
        // WS2: One-time initialization only. No bootstrap fallback pattern.
        require!(
            oracle_config.authority == Pubkey::default(),
            ErrorCode::AlreadyInitialized
        );
        oracle_config.authority = upgrade_authority;
        oracle_config.bump = ctx.bumps.oracle_config;

        require!(reporter != Pubkey::default(), ErrorCode::InvalidReporter);
        require!(finalizer != Pubkey::default(), ErrorCode::InvalidFinalizer);
        require!(
            challenger != Pubkey::default(),
            ErrorCode::InvalidChallenger
        );
        require!(dispute_window_secs >= 60, ErrorCode::InvalidDisputeWindow);

        oracle_config.reporter = reporter;
        oracle_config.finalizer = finalizer;
        oracle_config.challenger = challenger;
        oracle_config.dispute_window_secs = dispute_window_secs;
        Ok(())
    }

    pub fn update_oracle_config(
        ctx: Context<UpdateOracleConfig>,
        authority: Pubkey,
        reporter: Pubkey,
        finalizer: Pubkey,
        challenger: Pubkey,
        dispute_window_secs: i64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        require!(!ctx.accounts.oracle_config.config_frozen, ErrorCode::ConfigFrozen);
        require!(authority == ctx.accounts.oracle_config.authority, ErrorCode::ConfigAuthorityImmutable);
        require!(authority != Pubkey::default(), ErrorCode::InvalidAuthority);
        require!(reporter != Pubkey::default(), ErrorCode::InvalidReporter);
        require!(finalizer != Pubkey::default(), ErrorCode::InvalidFinalizer);
        require!(
            challenger != Pubkey::default(),
            ErrorCode::InvalidChallenger
        );
        require!(dispute_window_secs >= 60, ErrorCode::InvalidDisputeWindow);

        let oracle_config = &mut ctx.accounts.oracle_config;
        oracle_config.reporter = reporter;
        oracle_config.finalizer = finalizer;
        oracle_config.challenger = challenger;
        oracle_config.dispute_window_secs = dispute_window_secs;
        Ok(())
    }

    /// One-way config freeze — after calling, update_oracle_config reverts permanently.
    /// Pause controls remain functional.
    pub fn freeze_oracle_config(ctx: Context<UpdateOracleConfig>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        require!(!ctx.accounts.oracle_config.config_frozen, ErrorCode::ConfigFrozen);
        ctx.accounts.oracle_config.config_frozen = true;
        Ok(())
    }

    /// Emergency pause/unpause — remains functional even after config freeze.
    pub fn set_oracle_paused(ctx: Context<UpdateOracleConfig>, paused: bool) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        ctx.accounts.oracle_config.paused = paused;
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
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
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
        if status == DuelStatus::Locked {
            require!(
                Clock::get()?.unix_timestamp >= bet_close_ts,
                ErrorCode::BettingWindowActive
            );
        }

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

        // FIX-4: Lock participant identity and bet timing once betting opens
        if is_initialized && duel_status_rank(duel_state.status) >= duel_status_rank(DuelStatus::BettingOpen) {
            require!(participant_a_hash == duel_state.participant_a_hash, ErrorCode::ParticipantHashImmutable);
            require!(participant_b_hash == duel_state.participant_b_hash, ErrorCode::ParticipantHashImmutable);
            require!(bet_open_ts == duel_state.bet_open_ts, ErrorCode::TimingImmutable);
            require!(bet_close_ts == duel_state.bet_close_ts, ErrorCode::TimingImmutable);
        }

        duel_state.duel_key = duel_key;
        duel_state.participant_a_hash = participant_a_hash;
        duel_state.participant_b_hash = participant_b_hash;
        duel_state.bet_open_ts = bet_open_ts;
        duel_state.bet_close_ts = bet_close_ts;
        duel_state.duel_start_ts = duel_start_ts;
        duel_state.status = status;
        duel_state.active_proposal = [0_u8; 32];
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
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
        let duel_state = &mut ctx.accounts.duel_state;
        require!(
            duel_state.status != DuelStatus::Resolved && duel_state.status != DuelStatus::Cancelled,
            ErrorCode::DuelAlreadyFinalized
        );
        duel_state.status = DuelStatus::Cancelled;
        duel_state.active_proposal = [0_u8; 32];
        emit!(DuelCancelled {
            duel_key: duel_state.duel_key,
            metadata_uri: metadata_uri.clone(),
        });
        duel_state.metadata_uri = metadata_uri;
        Ok(())
    }

    pub fn propose_result(
        ctx: Context<ProposeResult>,
        _duel_key: [u8; 32],
        winner: MarketSide,
        seed: u64,
        replay_hash: [u8; 32],
        result_hash: [u8; 32],
        duel_end_ts: i64,
        metadata_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
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
            duel_state.status == DuelStatus::Locked,
            ErrorCode::InvalidLifecycleTransition
        );
        require!(
            duel_end_ts >= duel_state.bet_close_ts,
            ErrorCode::InvalidLifecycleTransition
        );

        // FIX-6: Parity with EVM — block proposals while betting window is still active
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= duel_state.bet_close_ts,
            ErrorCode::BettingWindowActive
        );

        let proposal_id = proposal_id_for(duel_state.duel_key, result_hash, replay_hash);
        duel_state.status = DuelStatus::Proposed;
        duel_state.active_proposal = proposal_id;
        duel_state.pending_winner = winner;
        duel_state.pending_seed = seed;
        duel_state.pending_result_hash = result_hash;
        duel_state.pending_replay_hash = replay_hash;
        duel_state.pending_duel_end_ts = duel_end_ts;
        duel_state.pending_proposed_at = Clock::get()?.unix_timestamp;
        duel_state.pending_challenged = false;

        emit!(ResultProposed {
            duel_key: duel_state.duel_key,
            proposal_id,
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

    pub fn challenge_result(
        ctx: Context<ChallengeResult>,
        _duel_key: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
        let duel_state = &mut ctx.accounts.duel_state;
        let oracle_config = &ctx.accounts.oracle_config;
        require!(
            duel_state.status == DuelStatus::Proposed,
            ErrorCode::NotProposed
        );
        require!(!duel_state.pending_challenged, ErrorCode::AlreadyChallenged);

        let now = Clock::get()?.unix_timestamp;
        let challenge_deadline = duel_state
            .pending_proposed_at
            .checked_add(oracle_config.dispute_window_secs)
            .ok_or(ErrorCode::InvalidDisputeWindow)?;
        require!(now < challenge_deadline, ErrorCode::ChallengeWindowExpired);

        duel_state.pending_challenged = true;
        duel_state.status = DuelStatus::Challenged;

        emit!(ResultChallenged {
            duel_key: duel_state.duel_key,
            proposal_id: duel_state.active_proposal,
            metadata_uri: metadata_uri.clone(),
        });
        duel_state.metadata_uri = metadata_uri;
        Ok(())
    }

    // FIX-3: Resolution path for challenged duels — reporter submits new proposal
    pub fn repropose_result(
        ctx: Context<ReproposeResult>,
        _duel_key: [u8; 32],
        winner: MarketSide,
        seed: u64,
        replay_hash: [u8; 32],
        result_hash: [u8; 32],
        duel_end_ts: i64,
        metadata_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
        let duel_state = &mut ctx.accounts.duel_state;
        require!(
            duel_state.status == DuelStatus::Challenged,
            ErrorCode::NotChallenged
        );
        require!(
            duel_state.status != DuelStatus::Resolved,
            ErrorCode::DuelAlreadyFinalized
        );
        require!(
            duel_state.status != DuelStatus::Cancelled,
            ErrorCode::DuelAlreadyCancelled
        );
        require!(
            winner == MarketSide::A || winner == MarketSide::B,
            ErrorCode::InvalidWinner
        );
        require!(duel_end_ts > 0, ErrorCode::InvalidLifecycleTransition);
        require!(
            duel_end_ts >= duel_state.bet_close_ts,
            ErrorCode::InvalidLifecycleTransition
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= duel_state.bet_close_ts,
            ErrorCode::BettingWindowActive
        );

        let proposal_id = proposal_id_for(duel_state.duel_key, result_hash, replay_hash);
        duel_state.status = DuelStatus::Proposed;
        duel_state.active_proposal = proposal_id;
        duel_state.pending_winner = winner;
        duel_state.pending_seed = seed;
        duel_state.pending_result_hash = result_hash;
        duel_state.pending_replay_hash = replay_hash;
        duel_state.pending_duel_end_ts = duel_end_ts;
        duel_state.pending_proposed_at = clock.unix_timestamp;
        duel_state.pending_challenged = false;

        emit!(ResultProposed {
            duel_key: duel_state.duel_key,
            proposal_id,
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

    pub fn finalize_result(
        ctx: Context<FinalizeResult>,
        _duel_key: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.oracle_config.paused, ErrorCode::OraclePaused);
        let duel_state = &mut ctx.accounts.duel_state;
        let oracle_config = &ctx.accounts.oracle_config;
        require!(
            duel_state.status == DuelStatus::Proposed,
            ErrorCode::NotProposed
        );
        require!(!duel_state.pending_challenged, ErrorCode::AlreadyChallenged);

        let now = Clock::get()?.unix_timestamp;
        let finalizable_at = duel_state
            .pending_proposed_at
            .checked_add(oracle_config.dispute_window_secs)
            .ok_or(ErrorCode::InvalidDisputeWindow)?;
        require!(now >= finalizable_at, ErrorCode::DisputeWindowActive);

        duel_state.status = DuelStatus::Resolved;
        duel_state.winner = duel_state.pending_winner;
        duel_state.seed = duel_state.pending_seed;
        duel_state.result_hash = duel_state.pending_result_hash;
        duel_state.replay_hash = duel_state.pending_replay_hash;
        duel_state.duel_end_ts = duel_state.pending_duel_end_ts;

        emit!(DuelResolved {
            duel_key: duel_state.duel_key,
            proposal_id: duel_state.active_proposal,
            winner: duel_state.winner,
            seed: duel_state.seed,
            duel_end_ts: duel_state.duel_end_ts,
            result_hash: duel_state.result_hash,
            replay_hash: duel_state.replay_hash,
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
        DuelStatus::Proposed => 3,
        DuelStatus::Challenged => 4,
        DuelStatus::Resolved => 5,
        DuelStatus::Cancelled => 6,
    }
}

fn proposal_id_for(duel_key: [u8; 32], result_hash: [u8; 32], replay_hash: [u8; 32]) -> [u8; 32] {
    solana_keccak_hasher::hashv(&[&duel_key, &result_hash, &replay_hash]).to_bytes()
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
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracleConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [ORACLE_CONFIG_SEED], bump = oracle_config.bump)]
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
    pub authority: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.authority == authority.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut, seeds = [DUEL_SEED, duel_key.as_ref()], bump = duel_state.bump)]
    pub duel_state: Account<'info, DuelState>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct ProposeResult<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.reporter == reporter.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut, seeds = [DUEL_SEED, duel_key.as_ref()], bump = duel_state.bump)]
    pub duel_state: Account<'info, DuelState>,
}

// FIX-3: Accounts for reproposing after a challenge
#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct ReproposeResult<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.reporter == reporter.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut, seeds = [DUEL_SEED, duel_key.as_ref()], bump = duel_state.bump)]
    pub duel_state: Account<'info, DuelState>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct ChallengeResult<'info> {
    pub challenger: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.challenger == challenger.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut, seeds = [DUEL_SEED, duel_key.as_ref()], bump = duel_state.bump)]
    pub duel_state: Account<'info, DuelState>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32])]
pub struct FinalizeResult<'info> {
    pub finalizer: Signer<'info>,
    #[account(
        seeds = [ORACLE_CONFIG_SEED],
        bump = oracle_config.bump,
        constraint = oracle_config.finalizer == finalizer.key() @ ErrorCode::Unauthorized,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut, seeds = [DUEL_SEED, duel_key.as_ref()], bump = duel_state.bump)]
    pub duel_state: Account<'info, DuelState>,
}

#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    pub authority: Pubkey,
    pub reporter: Pubkey,
    pub finalizer: Pubkey,
    pub challenger: Pubkey,
    pub dispute_window_secs: i64,
    pub paused: bool,
    pub config_frozen: bool,
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
    pub active_proposal: [u8; 32],
    pub pending_winner: MarketSide,
    pub pending_seed: u64,
    pub pending_result_hash: [u8; 32],
    pub pending_replay_hash: [u8; 32],
    pub pending_duel_end_ts: i64,
    pub pending_proposed_at: i64,
    pub pending_challenged: bool,
    #[max_len(200)]
    pub metadata_uri: String,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum DuelStatus {
    Scheduled,
    BettingOpen,
    Locked,
    Proposed,
    Challenged,
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
pub struct ResultProposed {
    pub duel_key: [u8; 32],
    pub proposal_id: [u8; 32],
    pub winner: MarketSide,
    pub seed: u64,
    pub duel_end_ts: i64,
    pub result_hash: [u8; 32],
    pub replay_hash: [u8; 32],
    pub metadata_uri: String,
}

#[event]
pub struct ResultChallenged {
    pub duel_key: [u8; 32],
    pub proposal_id: [u8; 32],
    pub metadata_uri: String,
}

#[event]
pub struct DuelResolved {
    pub duel_key: [u8; 32],
    pub proposal_id: [u8; 32],
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
    #[msg("Finalizer pubkey cannot be the default address")]
    InvalidFinalizer,
    #[msg("Challenger pubkey cannot be the default address")]
    InvalidChallenger,
    #[msg("Dispute window must be positive")]
    InvalidDisputeWindow,
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
    #[msg("No active proposal exists")]
    NotProposed,
    #[msg("Proposal already challenged")]
    AlreadyChallenged,
    #[msg("Challenge window already expired")]
    ChallengeWindowExpired,
    #[msg("Dispute window still active")]
    DisputeWindowActive,
    #[msg("Config authority is immutable")]
    ConfigAuthorityImmutable,
    #[msg("Cannot propose result while betting window is still active")]
    BettingWindowActive,
    #[msg("Duel must be in Challenged status for reproposal")]
    NotChallenged,
    #[msg("Participant hashes are immutable after betting opens")]
    ParticipantHashImmutable,
    #[msg("Bet timing is immutable after betting opens")]
    TimingImmutable,
    #[msg("Config is already initialized")]
    AlreadyInitialized,
    #[msg("Oracle operations are paused")]
    OraclePaused,
    #[msg("Config is permanently frozen")]
    ConfigFrozen,
}
