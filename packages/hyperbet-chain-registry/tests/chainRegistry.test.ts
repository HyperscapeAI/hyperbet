import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  BETTING_EVM_CHAIN_ORDER,
  defaultRpcUrlForEvmNetwork,
  getMissingBettingEvmCanonicalFields,
  isBettingEvmDeploymentCanonicalReady,
  normalizeChainKey,
  normalizeSolanaCluster,
  parseBettingEvmChainList,
  resolveBettingEvmDefaults,
  resolveBettingEvmDeploymentForChain,
  resolveBettingEvmRuntimeEnv,
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

  test("reports canonical readiness for shared mainnet EVM deployments", () => {
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.bsc),
    ).toBe(true);
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.base),
    ).toBe(true);
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.avax),
    ).toBe(false);
    expect(getMissingBettingEvmCanonicalFields(BETTING_DEPLOYMENTS.evm.avax))
      .toEqual([
        "duelOracleAddress",
        "lvrRouterAddress",
        "adminAddress",
        "marketOperatorAddress",
        "treasuryAddress",
        "marketMakerAddress",
      ]);
  });

  test("treats fully populated AVAX deployments as canonical-ready", () => {
    const mainnetReady = {
      ...BETTING_DEPLOYMENTS.evm.avax,
      duelOracleAddress: "0x1111111111111111111111111111111111111111",
      lvrRouterAddress: "0x2222222222222222222222222222222222222222",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
    };
    const fujiReady = {
      ...BETTING_DEPLOYMENTS.evm.avaxFuji,
      duelOracleAddress: "0x1111111111111111111111111111111111111111",
      lvrRouterAddress: "0x2222222222222222222222222222222222222222",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
    };

    expect(isBettingEvmDeploymentCanonicalReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentCanonicalReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(fujiReady)).toEqual([]);
  });

  test("reports AVAX Fuji as incomplete until canonical values exist", () => {
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.avaxFuji),
    ).toBe(false);
    expect(getMissingBettingEvmCanonicalFields(BETTING_DEPLOYMENTS.evm.avaxFuji))
      .toEqual([
        "duelOracleAddress",
        "lvrRouterAddress",
        "adminAddress",
        "marketOperatorAddress",
        "treasuryAddress",
        "marketMakerAddress",
      ]);
  });

  test("resolves EVM runtime env with shared override precedence", () => {
    const runtime = resolveBettingEvmRuntimeEnv("avax", "testnet", {
      EVM_AVAX_RPC_URL: "https://override.example/rpc",
      AVAX_DUEL_ORACLE_ADDRESS: "0x1111111111111111111111111111111111111111",
      AVAX_LVR_ROUTER_ADDRESS: "0x2222222222222222222222222222222222222222",
      AVAX_FUJI_RPC: "https://ignored.example/fuji",
    });
    expect(runtime.rpcUrl).toBe("https://override.example/rpc");
    expect(runtime.duelOracleAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(runtime.lvrRouterAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  test("parses configurable EVM keeper chain lists without duplicates", () => {
    expect(parseBettingEvmChainList("avax, base bsc avax")).toEqual([
      "avax",
      "base",
      "bsc",
    ]);
    expect(parseBettingEvmChainList("")).toEqual(BETTING_EVM_CHAIN_ORDER);
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
