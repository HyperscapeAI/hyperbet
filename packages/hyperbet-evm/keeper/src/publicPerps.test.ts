import { describe, expect, test } from "bun:test";

import {
  adaptLegacySolanaPerpsMarketsPayload,
  adaptLegacySolanaPerpsOracleHistoryPayload,
  buildExternalPerpsUrl,
  normalizePublicPerpsChainKeyParam,
  resolvePublicEvmPerpsChains,
} from "./publicPerps";

describe("public perps helpers", () => {
  test("normalizes supported public chain keys", () => {
    expect(normalizePublicPerpsChainKeyParam("solana")).toBe("solana");
    expect(normalizePublicPerpsChainKeyParam("bsc")).toBe("bsc");
    expect(normalizePublicPerpsChainKeyParam("base")).toBe("base");
    expect(normalizePublicPerpsChainKeyParam("avax")).toBe("avax");
    expect(normalizePublicPerpsChainKeyParam("ethereum")).toBeNull();
  });

  test("builds external Solana perps urls without forwarding chainKey", () => {
    const searchParams = new URLSearchParams({
      chainKey: "solana",
      characterId: "agent-a",
      limit: "24",
    });
    expect(
      buildExternalPerpsUrl({
        baseUrl: "https://solana-keeper.example",
        pathname: "/api/perps/oracle-history",
        searchParams,
      }),
    ).toBe(
      "https://solana-keeper.example/api/perps/oracle-history?characterId=agent-a&limit=24",
    );
  });

  test("defaults public EVM perps publishing to BSC only", () => {
    expect(
      resolvePublicEvmPerpsChains({
        configuredChains: ["bsc", "base", "avax"],
        publicChains: undefined,
      }),
    ).toEqual(["bsc"]);
  });

  test("publishes only explicitly configured public EVM perps chains", () => {
    expect(
      resolvePublicEvmPerpsChains({
        configuredChains: ["bsc", "base", "avax"],
        publicChains: "base,avax",
      }),
    ).toEqual(["base", "avax"]);
    expect(
      resolvePublicEvmPerpsChains({
        configuredChains: ["base", "avax"],
        publicChains: undefined,
      }),
    ).toEqual([]);
  });

  test("adapts legacy Solana markets responses into chain-scoped payloads", () => {
    const adapted = adaptLegacySolanaPerpsMarketsPayload({
      markets: [
        {
          characterId: "agent-a",
          marketId: 7,
          rank: 1,
        },
      ],
      updatedAt: 2,
    });

    expect(adapted).toEqual({
      chainKey: "solana",
      markets: [
        {
          chainKey: "solana",
          characterId: "agent-a",
          marketId: 7,
          rank: 1,
        },
      ],
      updatedAt: 2,
    });
  });

  test("adapts legacy Solana oracle history responses into chain-scoped payloads", () => {
    const adapted = adaptLegacySolanaPerpsOracleHistoryPayload({
      characterId: "agent-a",
      marketId: 7,
      snapshots: [{ recordedAt: 1 }],
      updatedAt: 2,
    });

    expect(adapted).toEqual({
      chainKey: "solana",
      characterId: "agent-a",
      marketId: 7,
      snapshots: [{ recordedAt: 1 }],
      updatedAt: 2,
    });
  });
});
