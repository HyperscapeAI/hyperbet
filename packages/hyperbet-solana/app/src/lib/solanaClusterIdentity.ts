import type { Connection } from "@solana/web3.js";

import type { SolanaCluster } from "./config";

const PUBLIC_CLUSTER_GENESIS_HASHES: Record<
  Exclude<SolanaCluster, "localnet">,
  string
> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
};

export type SolanaClusterIdentity = {
  expectedCluster: SolanaCluster;
  genesisHash: string;
  matches: boolean;
};

export function matchesSolanaClusterGenesisHash(
  cluster: SolanaCluster,
  genesisHash: string,
): boolean {
  const normalizedHash = genesisHash.trim();
  if (!normalizedHash) return false;
  if (cluster === "localnet") return true;
  return PUBLIC_CLUSTER_GENESIS_HASHES[cluster] === normalizedHash;
}

export async function inspectSolanaClusterIdentity(
  connection: Pick<Connection, "getGenesisHash">,
  expectedCluster: SolanaCluster,
): Promise<SolanaClusterIdentity> {
  const genesisHash = (await connection.getGenesisHash()).trim();
  return {
    expectedCluster,
    genesisHash,
    matches: matchesSolanaClusterGenesisHash(expectedCluster, genesisHash),
  };
}
