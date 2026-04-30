use anchor_lang::prelude::*;

#[error_code]
pub enum PredictionMarketError {
    #[msg("Can only be initialized by owner")]
    CanOnlyBeInitializedByOwner,

    #[msg("outcome can only be 0 for yes or 1 for no")]
    OutComeCanOnlyBe01,

    #[msg("initial liq must be greater than 100000")]
    InvalidInitialLiq,

    #[msg("quantity must be greater than zero")]
    QuantityMustBeGreaterThanZero,

    #[msg("Signer doesn't have enough tokens")]
    SignerDoesntHaveEnoughTokens,

    #[msg("Bet account doesn't have enough lamports")]
    NotEnoughLamports,

    #[msg("Bet account doesn't have enough shares")]
    NotEnoughSharesToReduce,

    #[msg("Admin state already initialized")]
    AdminStateAlreadyInitialized,

    #[msg("Signer is not the settle pub key")]
    SignerIsNotSettlePubKey,

    #[msg("Bet already settled")]
    BetAlreadySettled,

    #[msg("Bet not initialized")]
    BetNotInitialized,

    #[msg("Bet not settled")]
    BetNotSettled,

    #[msg("Bet not expired")]
    BetNotExpired,

    #[msg("Invalid oracle account")]
    InvalidOracleAccount,

    #[msg("Oracle duel does not match bet")]
    OracleBetMismatch,

    #[msg("Overflow or Underflow")]
    MathErr,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Insufficient reserves for swap")]
    InsufficientReserves,

    #[msg("Market has expired")]
    MarketExpired,

    #[msg("Invalid settlement outcome")]
    InvalidSettlementOutcome,

    #[msg("Invalid address (zero/default)")]
    InvalidAddress,

    #[msg("Fee BPS exceeds maximum (1000 = 10%)")]
    FeeTooHigh,

    #[msg("Market is paused")]
    MarketPaused,

    #[msg("Config is frozen")]
    ConfigFrozen,

    #[msg("Invalid duel state account")]
    InvalidDuelState,

    #[msg("AMM config account required for oracle settlement")]
    MissingAmmConfig,

    #[msg("Fight oracle program mismatch")]
    InvalidFightOracleProgram,

    #[msg("AMM Newton-Raphson solver did not converge")]
    MathConvergenceError,

    #[msg("AMM fixed-point overflow")]
    MathFixedPointOverflow,

    #[msg("Initializer must be the program upgrade authority")]
    UnauthorizedInitializer,
}
