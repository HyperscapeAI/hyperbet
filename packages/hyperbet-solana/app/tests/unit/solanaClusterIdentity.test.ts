import { describe, expect, mock, test } from "bun:test";

import {
  inspectSolanaClusterIdentity,
  matchesSolanaClusterGenesisHash,
} from "../../src/lib/solanaClusterIdentity";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

describe("Solana cluster identity", () => {
  test("matches each public cluster only to its exact genesis hash", () => {
    expect(
      matchesSolanaClusterGenesisHash("mainnet-beta", MAINNET_GENESIS),
    ).toBe(true);
    expect(matchesSolanaClusterGenesisHash("devnet", DEVNET_GENESIS)).toBe(
      true,
    );
    expect(matchesSolanaClusterGenesisHash("testnet", TESTNET_GENESIS)).toBe(
      true,
    );
    expect(
      matchesSolanaClusterGenesisHash("mainnet-beta", DEVNET_GENESIS),
    ).toBe(false);
    expect(matchesSolanaClusterGenesisHash("devnet", TESTNET_GENESIS)).toBe(
      false,
    );
    expect(matchesSolanaClusterGenesisHash("testnet", MAINNET_GENESIS)).toBe(
      false,
    );
    expect(matchesSolanaClusterGenesisHash("devnet", " ")).toBe(false);
  });

  test("accepts any non-empty local validator identity", () => {
    expect(matchesSolanaClusterGenesisHash("localnet", "local-genesis")).toBe(
      true,
    );
    expect(matchesSolanaClusterGenesisHash("localnet", "")).toBe(false);
  });

  test("inspects the configured RPC without mutating wallet state", async () => {
    const getGenesisHash = mock(async () => DEVNET_GENESIS);
    await expect(
      inspectSolanaClusterIdentity({ getGenesisHash } as never, "devnet"),
    ).resolves.toEqual({
      expectedCluster: "devnet",
      genesisHash: DEVNET_GENESIS,
      matches: true,
    });
    expect(getGenesisHash).toHaveBeenCalledTimes(1);
  });
});
