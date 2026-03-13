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

    #[msg("Bet not settled")]
    BetNotSettled,

    #[msg("Bet not expired")]
    BetNotExpired,

    #[msg("Overflow or Underflow")]
    MathErr,
}
