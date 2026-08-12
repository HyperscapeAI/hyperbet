import type { PredictionMarketClaimKind } from "./predictionMarketUiState";

export type SolanaSettlementInstruction = "claim" | "closeLosingBalance";

export function resolveSolanaSettlementInstruction(
  claimKind: PredictionMarketClaimKind,
): SolanaSettlementInstruction | null {
  switch (claimKind) {
    case "WINNER_A":
    case "WINNER_B":
    case "REFUND":
      return "claim";
    case "LOSER_CLEANUP":
      return "closeLosingBalance";
    case "NONE":
      return null;
    default: {
      const exhaustive: never = claimKind;
      return exhaustive;
    }
  }
}
