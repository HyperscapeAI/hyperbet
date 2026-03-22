import type { PredictionMarketClaimKind } from "./predictionMarketUiState";

export type PredictionMarketClaimCopy = {
  claimWinningsTitle: string;
  claimRefundTitle: string;
  claimLocked: string;
  claimHelp: string;
  claimRefundHelp: string;
  claimCleanupTitle: string;
  claimCleanupHelp: string;
  claim: string;
  clearPosition: string;
};

export function derivePredictionMarketClaimUi(
  copy: PredictionMarketClaimCopy,
  claimKind: PredictionMarketClaimKind,
  canClaim: boolean,
) {
  if (!canClaim) {
    return {
      title: copy.claimLocked,
      buttonLabel: copy.claim,
      helpText: copy.claimHelp,
    };
  }

  if (claimKind === "LOSER_CLEANUP") {
    return {
      title: copy.claimCleanupTitle,
      buttonLabel: copy.clearPosition,
      helpText: copy.claimCleanupHelp,
    };
  }

  if (claimKind === "REFUND") {
    return {
      title: copy.claimRefundTitle,
      buttonLabel: copy.claim,
      helpText: copy.claimRefundHelp,
    };
  }

  return {
    title: copy.claimWinningsTitle,
    buttonLabel: copy.claim,
    helpText: copy.claimHelp,
  };
}
