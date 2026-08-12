import { PublicKey } from "@solana/web3.js";
import {
  SOLANA_V1_DEPLOYMENTS,
  type SolanaV1Cluster,
} from "../packages/hyperbet-solana/deployments/v1";

const expectedClusters: SolanaV1Cluster[] = [
  "localnet",
  "devnet",
  "testnet",
  "mainnet-beta",
];
const expectedFields = [
  "cluster",
  "duelMarketProgramId",
  "fightOracleProgramId",
];
const failures: string[] = [];

for (const cluster of expectedClusters) {
  const deployment = SOLANA_V1_DEPLOYMENTS.solana[cluster];
  if (!deployment) {
    failures.push(`${cluster}: deployment is missing`);
    continue;
  }

  const actualFields = Object.keys(deployment).sort();
  if (actualFields.join(",") !== expectedFields.join(",")) {
    failures.push(
      `${cluster}: expected only ${expectedFields.join(", ")}; found ${actualFields.join(", ")}`,
    );
  }
  if (deployment.cluster !== cluster) {
    failures.push(`${cluster}: embedded cluster is ${deployment.cluster}`);
  }

  const parsed = new Map<string, PublicKey>();
  for (const [name, value] of [
    ["fightOracleProgramId", deployment.fightOracleProgramId],
    ["duelMarketProgramId", deployment.duelMarketProgramId],
  ] as const) {
    try {
      const publicKey = new PublicKey(value);
      if (publicKey.equals(PublicKey.default)) {
        failures.push(`${cluster}: ${name} is the default public key`);
      }
      parsed.set(name, publicKey);
    } catch {
      failures.push(`${cluster}: ${name} is not a valid Solana public key`);
    }
  }
  if (
    parsed
      .get("fightOracleProgramId")
      ?.equals(parsed.get("duelMarketProgramId") ?? PublicKey.default)
  ) {
    failures.push(`${cluster}: oracle and duel market program IDs must differ`);
  }
}

const unexpectedClusters = Object.keys(SOLANA_V1_DEPLOYMENTS.solana).filter(
  (cluster) => !expectedClusters.includes(cluster as SolanaV1Cluster),
);
if (unexpectedClusters.length > 0) {
  failures.push(`unexpected clusters: ${unexpectedClusters.join(", ")}`);
}

if (failures.length > 0) {
  console.error("Solana v1 deployment registry gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Solana v1 deployment registry gate passed: four clusters, two distinct program identities, no token or non-duel fields.",
);
