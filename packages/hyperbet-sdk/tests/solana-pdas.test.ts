import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import {
  duelKeyHexToBytes,
  findDuelStatePda,
  findMarketStatePda,
} from "../src/solana/client";
import { MARKET_KIND_DUEL_WINNER } from "../src/types";

describe("canonical SOL duel PDAs", () => {
  it("uses the on-chain duel-winner market kind and exact launch seeds", () => {
    expect(MARKET_KIND_DUEL_WINNER).toBe(1);
    const oracle = new PublicKey(
      "GFdnu7kUnZGiXh4ejWiJSBCUxvq4UfdEeUv9jjFzr5EM",
    );
    const marketProgram = new PublicKey(
      "3QUVoaKJqo1rg9eXe7vyFewJrY75NWdtH8JZfvTb79Uy",
    );
    const duelKey = duelKeyHexToBytes(
      "1f1e1d1c1b1a19181716151413121110f1e2d3c4b5a697887766554433221100",
    );
    const duel = findDuelStatePda(oracle, duelKey);
    expect(duel.toBase58()).toBe(
      "GmerjoLcRoN5hW9f7KPNgyq6Wty6RABUGsSfZtfZNXoR",
    );
    expect(findMarketStatePda(marketProgram, duel).toBase58()).toBe(
      "3e8TxCCftPmKCML7rHZJM21ebFkzohnSEP7Z8mb7Cvzv",
    );
  });
});
