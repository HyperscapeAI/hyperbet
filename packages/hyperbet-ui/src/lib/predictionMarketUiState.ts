import type {
  PredictionMarketLifecycleRecord,
  PredictionMarketLifecycleStatus,
  PredictionMarketWinner,
} from "@hyperbet/chain-registry";

export type PredictionMarketWalletSnapshot = {
  aShares: bigint;
  bShares: bigint;
  aStake: bigint;
  bStake: bigint;
  refundableAmount: bigint;
};

export type PredictionMarketUiFallbackState = {
  lifecycleStatus: PredictionMarketLifecycleStatus;
  winner: PredictionMarketWinner;
};

export type PredictionMarketClaimKind =
  | "NONE"
  | "WINNER_A"
  | "WINNER_B"
  | "REFUND"
  | "LOSER_CLEANUP";

export type PredictionMarketUiState = {
  hasCanonicalLifecycle: boolean;
  lifecycleStatus: PredictionMarketLifecycleStatus;
  winner: PredictionMarketWinner;
  canTrade: boolean;
  canClaim: boolean;
  claimableAmount: bigint;
  claimKind: PredictionMarketClaimKind;
};

export const EMPTY_PREDICTION_MARKET_WALLET_SNAPSHOT: PredictionMarketWalletSnapshot =
  {
    aShares: 0n,
    bShares: 0n,
    aStake: 0n,
    bStake: 0n,
    refundableAmount: 0n,
  };

export function derivePredictionMarketUiState(
  record: PredictionMarketLifecycleRecord | null,
  wallet: PredictionMarketWalletSnapshot,
  fallback: PredictionMarketUiFallbackState | null = null,
): PredictionMarketUiState {
  const source = record
    ? {
        hasCanonicalLifecycle: true,
        lifecycleStatus: record.lifecycleStatus,
        winner: record.winner,
      }
    : fallback
      ? {
          hasCanonicalLifecycle: false,
          lifecycleStatus: fallback.lifecycleStatus,
          winner: fallback.winner,
        }
      : {
          hasCanonicalLifecycle: false,
          lifecycleStatus: "UNKNOWN" as const,
          winner: "NONE" as const,
        };

  let claimableAmount = 0n;
  let claimKind: PredictionMarketClaimKind = "NONE";

  switch (source.lifecycleStatus) {
    case "RESOLVED":
      if (source.winner === "A" && wallet.aShares > 0n) {
        claimableAmount = wallet.aShares;
        claimKind = "WINNER_A";
      } else if (source.winner === "B" && wallet.bShares > 0n) {
        claimableAmount = wallet.bShares;
        claimKind = "WINNER_B";
      } else if (
        wallet.aShares > 0n ||
        wallet.bShares > 0n ||
        wallet.aStake > 0n ||
        wallet.bStake > 0n
      ) {
        claimKind = "LOSER_CLEANUP";
      }
      break;
    case "CANCELLED":
      if (wallet.refundableAmount > 0n) {
        claimableAmount = wallet.refundableAmount;
        claimKind = "REFUND";
      }
      break;
    default:
      break;
  }

  return {
    ...source,
    canTrade: source.lifecycleStatus === "OPEN",
    canClaim: claimableAmount > 0n || claimKind === "LOSER_CLEANUP",
    claimableAmount,
    claimKind,
  };
}
