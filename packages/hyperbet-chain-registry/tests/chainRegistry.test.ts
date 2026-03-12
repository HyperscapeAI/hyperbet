import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  BETTING_EVM_CHAIN_ORDER,
  defaultRpcUrlForEvmNetwork,
  normalizeChainKey,
  normalizeSolanaCluster,
  resolveBettingEvmDefaults,
  resolveBettingEvmDeploymentForChain,
  resolveLifecycleFromEvmStatus,
  resolveLifecycleFromStreamPhase,
  toRecordedBetChain,
} from "../src/index";

describe("chain registry", () => {
  test("normalizes Solana cluster aliases", () => {
    expect(normalizeSolanaCluster("mainnet")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("production")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("e2e")).toBe("localnet");
    expect(normalizeSolanaCluster("stream-ui")).toBe("devnet");
  });

  test("maps defaults for every primary EVM chain", () => {
    const testnetDefaults = resolveBettingEvmDefaults("testnet");
    expect(testnetDefaults.bsc.networkKey).toBe("bscTestnet");
    expect(testnetDefaults.base.networkKey).toBe("baseSepolia");
    expect(testnetDefaults.avax.networkKey).toBe("avaxFuji");

    const mainnetDefaults = resolveBettingEvmDefaults("mainnet-beta");
    expect(mainnetDefaults.bsc.networkKey).toBe("bsc");
    expect(mainnetDefaults.base.networkKey).toBe("base");
    expect(mainnetDefaults.avax.networkKey).toBe("avax");
  });

  test("exposes a canonical chain order for shared UI iteration", () => {
    expect(BETTING_EVM_CHAIN_ORDER).toEqual(["bsc", "base", "avax"]);
  });

  test("resolves deployments by chain without package-local branching", () => {
    const avax = resolveBettingEvmDeploymentForChain("avax", "mainnet-beta");
    expect(avax.chainId).toBe(BETTING_DEPLOYMENTS.evm.avax.chainId);
    expect(defaultRpcUrlForEvmNetwork(avax.networkKey)).toContain("avax");
  });

  test("normalizes chain keys and recorded chain names", () => {
    expect(normalizeChainKey("SOLANA")).toBe("solana");
    expect(normalizeChainKey("bNb")).toBe("bsc");
    expect(normalizeChainKey("Avalanche")).toBe("avax");
    expect(toRecordedBetChain("base")).toBe("BASE");
  });

  test("maps lifecycle status consistently", () => {
    expect(resolveLifecycleFromEvmStatus(1)).toBe("OPEN");
    expect(resolveLifecycleFromEvmStatus(3)).toBe("RESOLVED");
    expect(resolveLifecycleFromStreamPhase("COUNTDOWN")).toBe("LOCKED");
    expect(resolveLifecycleFromStreamPhase("IDLE")).toBe("PENDING");
  });
});
