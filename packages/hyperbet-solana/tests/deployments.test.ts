import { describe, expect, test } from "bun:test";

import {
  SOLANA_V1_DEPLOYMENTS,
  normalizeSolanaV1Cluster,
  resolveSolanaV1Deployment,
} from "../deployments/v1";

describe("betting deployment manifest", () => {
  test("normalizes build/runtime cluster aliases", () => {
    expect(normalizeSolanaV1Cluster("mainnet")).toBe("mainnet-beta");
    expect(normalizeSolanaV1Cluster("production")).toBe("mainnet-beta");
    expect(normalizeSolanaV1Cluster("e2e")).toBe("localnet");
    expect(normalizeSolanaV1Cluster("stream-ui")).toBe("devnet");
  });

  test("resolves Solana deployments from the dedicated v1 manifest", () => {
    const testnet = resolveSolanaV1Deployment("testnet");
    expect(testnet.fightOracleProgramId).toBe(
      SOLANA_V1_DEPLOYMENTS.solana.testnet.fightOracleProgramId,
    );
    expect(testnet.duelMarketProgramId).toBe(
      SOLANA_V1_DEPLOYMENTS.solana.testnet.duelMarketProgramId,
    );
  });

  test("requires non-empty Solana program ids for every cluster", () => {
    for (const deployment of Object.values(SOLANA_V1_DEPLOYMENTS.solana)) {
      expect(deployment.fightOracleProgramId.length).toBeGreaterThan(0);
      expect(deployment.duelMarketProgramId.length).toBeGreaterThan(0);
    }
  });
});
