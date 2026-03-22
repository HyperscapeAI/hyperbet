import { describe, expect, it } from "bun:test";

import { derivePredictionMarketClaimUi } from "../src/lib/predictionMarketClaimUi";

const copy = {
  claimWinningsTitle: "Claim winnings",
  claimRefundTitle: "Claim refund",
  claimLocked: "Nothing claimable yet",
  claimHelp: "Claim winning shares here.",
  claimRefundHelp: "Claim cancelled stake here.",
  claimCleanupTitle: "Clear resolved position",
  claimCleanupHelp: "Clear the stale losing position state.",
  claim: "Claim",
  clearPosition: "Clear position",
};

describe("derivePredictionMarketClaimUi", () => {
  it("uses winnings copy for winner claims", () => {
    expect(derivePredictionMarketClaimUi(copy, "WINNER_A", true)).toEqual({
      title: "Claim winnings",
      buttonLabel: "Claim",
      helpText: "Claim winning shares here.",
    });
  });

  it("uses refund copy for cancelled markets", () => {
    expect(derivePredictionMarketClaimUi(copy, "REFUND", true)).toEqual({
      title: "Claim refund",
      buttonLabel: "Claim",
      helpText: "Claim cancelled stake here.",
    });
  });

  it("uses cleanup copy for losing settlements", () => {
    expect(derivePredictionMarketClaimUi(copy, "LOSER_CLEANUP", true)).toEqual({
      title: "Clear resolved position",
      buttonLabel: "Clear position",
      helpText: "Clear the stale losing position state.",
    });
  });
});
