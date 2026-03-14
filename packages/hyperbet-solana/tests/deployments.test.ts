import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingSolanaDeployment,
} from "../deployments";

describe("betting deployment manifest", () => {
  test("normalizes build/runtime cluster aliases", () => {
    expect(normalizeSolanaCluster("mainnet")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("production")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("e2e")).toBe("localnet");
    expect(normalizeSolanaCluster("stream-ui")).toBe("devnet");
  });

  test("resolves solana deployments from the shared manifest", () => {
    const testnet = resolveBettingSolanaDeployment("testnet");
    expect(testnet.fightOracleProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.fightOracleProgramId,
    );
    expect(testnet.lvrMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.lvrMarketProgramId,
    );
    expect(testnet.goldPerpsMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.goldPerpsMarketProgramId,
    );
  });

  test("requires non-empty Solana program ids for every cluster", () => {
    for (const deployment of Object.values(BETTING_DEPLOYMENTS.solana)) {
      expect(deployment.fightOracleProgramId.length).toBeGreaterThan(0);
      expect(deployment.lvrMarketProgramId.length).toBeGreaterThan(0);
      expect(deployment.goldPerpsMarketProgramId.length).toBeGreaterThan(0);
    }
  });
});
