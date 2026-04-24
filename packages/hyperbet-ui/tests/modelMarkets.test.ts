import "./setup";
import { describe, expect, it } from "bun:test";

import {
  buildPerpsMarketsEndpoint,
  buildPerpsOracleHistoryEndpoint,
  sanitizePerpsMarketsResponse,
} from "../src/lib/modelMarkets";

describe("modelMarkets helpers", () => {
  it("builds chain-scoped perps endpoints", () => {
    expect(
      buildPerpsMarketsEndpoint("https://keeper.example", "solana"),
    ).toBe("https://keeper.example/api/perps/markets?chainKey=solana");
    expect(
      buildPerpsOracleHistoryEndpoint({
        gameApiUrl: "https://keeper.example",
        chainKey: "bsc",
        characterId: "agent-a",
        limit: 24,
      }),
    ).toBe(
      "https://keeper.example/api/perps/oracle-history?chainKey=bsc&characterId=agent-a&limit=24",
    );
  });

  it("hydrates legacy Solana market rows with the expected chain key", () => {
    const response = sanitizePerpsMarketsResponse(
      {
        markets: [
          {
            characterId: "agent-a",
            marketId: 7,
            rank: 1,
            name: "Agent A",
            provider: "OpenAI",
            model: "gpt-5",
            wins: 12,
            losses: 3,
            winRate: 80,
            combatLevel: 99,
            currentStreak: 4,
            status: "ACTIVE",
            lastSeenAt: 1,
            deprecatedAt: null,
            updatedAt: 2,
          },
        ],
        updatedAt: 2,
      },
      "solana",
    );

    expect(response).toEqual({
      chainKey: "solana",
      markets: [
        {
          chainKey: "solana",
          characterId: "agent-a",
          marketId: 7,
          rank: 1,
          name: "Agent A",
          provider: "OpenAI",
          model: "gpt-5",
          wins: 12,
          losses: 3,
          winRate: 80,
          combatLevel: 99,
          currentStreak: 4,
          status: "ACTIVE",
          lastSeenAt: 1,
          deprecatedAt: null,
          updatedAt: 2,
        },
      ],
      updatedAt: 2,
    });
  });
});
