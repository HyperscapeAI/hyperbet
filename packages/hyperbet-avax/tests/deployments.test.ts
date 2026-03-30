import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingEvmDefaults,
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
    expect(testnet.goldClobMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.goldClobMarketProgramId,
    );
    expect(testnet.goldPerpsMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.goldPerpsMarketProgramId,
    );
  });

  test("maps app environments to the correct default evm networks", () => {
    const testnetDefaults = resolveBettingEvmDefaults("testnet");
    expect(testnetDefaults.avax.networkKey).toBe("avaxFuji");

    const mainnetDefaults = resolveBettingEvmDefaults("mainnet-beta");
    expect(mainnetDefaults.avax.networkKey).toBe("avax");
  });

  test("tracks governance metadata keys in the chain registry", () => {
    const avax = BETTING_DEPLOYMENTS.evm.avax;
    expect(avax).toHaveProperty("reporterAddress");
    expect(avax).toHaveProperty("finalizerAddress");
    expect(avax).toHaveProperty("challengerAddress");
    expect(avax).toHaveProperty("timelockAddress");
    expect(avax).toHaveProperty("multisigAddress");
    expect(avax).toHaveProperty("emergencyCouncilAddress");
  });
});
