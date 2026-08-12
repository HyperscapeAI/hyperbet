import "./setup";
import { describe, expect, it } from "bun:test";

import { resolveSolanaSettlementInstruction } from "../src/lib/solanaSettlementAction";

describe("Solana settlement instruction routing", () => {
  it("routes payouts and cancellation refunds through claim", () => {
    expect(resolveSolanaSettlementInstruction("WINNER_A")).toBe("claim");
    expect(resolveSolanaSettlementInstruction("WINNER_B")).toBe("claim");
    expect(resolveSolanaSettlementInstruction("REFUND")).toBe("claim");
  });

  it("routes loser-only state through the no-payout cleanup instruction", () => {
    expect(resolveSolanaSettlementInstruction("LOSER_CLEANUP")).toBe(
      "closeLosingBalance",
    );
  });

  it("does not create a settlement instruction without an entitlement", () => {
    expect(resolveSolanaSettlementInstruction("NONE")).toBeNull();
  });
});
