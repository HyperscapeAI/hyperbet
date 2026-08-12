import { describe, expect, it } from "vitest";

import duelMarketIdl from "../src/solana/idl/duel_market.json";

describe("published duel-market IDL contract", () => {
  it("keeps transaction builders aligned with the canonical instruction graph", () => {
    const expected: Record<string, { args: string[]; accounts: string[] }> = {
      place_order: {
        args: ["order_id", "side", "price", "amount", "order_behavior"],
        accounts: [
          "market_state",
          "duel_state",
          "user_balance",
          "new_order",
          "resting_level",
          "config",
          "treasury",
          "market_maker",
          "vault",
          "user",
          "system_program",
        ],
      },
      cancel_order: {
        args: ["order_id", "side", "price"],
        accounts: [
          "market_state",
          "duel_state",
          "order",
          "price_level",
          "vault",
          "user",
          "system_program",
        ],
      },
      reclaim_resting_order: {
        args: ["order_id", "side", "price"],
        accounts: [
          "market_state",
          "duel_state",
          "order",
          "price_level",
          "vault",
          "user",
          "system_program",
        ],
      },
      close_filled_order: {
        args: ["order_id"],
        accounts: ["market_state", "order", "user"],
      },
      claim: {
        args: [],
        accounts: [
          "market_state",
          "duel_state",
          "user_balance",
          "config",
          "market_maker",
          "vault",
          "user",
          "system_program",
        ],
      },
      close_losing_balance: {
        args: [],
        accounts: ["market_state", "duel_state", "user_balance", "user"],
      },
    };

    for (const [name, shape] of Object.entries(expected)) {
      const instruction = duelMarketIdl.instructions.find(
        (candidate) => candidate.name === name,
      );
      expect(instruction, name).toBeDefined();
      expect(
        instruction?.args.map((arg) => arg.name),
        name,
      ).toEqual(shape.args);
      expect(
        instruction?.accounts.map((account) => account.name),
        name,
      ).toEqual(shape.accounts);
    }
  });
});
