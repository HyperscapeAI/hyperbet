import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  BETTING_EVM_CHAIN_ORDER,
  defaultRpcUrlForEvmNetwork,
  getMissingBettingEvmCanonicalFields,
  getMissingBettingEvmGovernanceFields,
  isPredictionMarketInFlightResolutionStatus,
  isPredictionMarketLifecycleStatus,
  isPredictionMarketQuotableStatus,
  isPredictionMarketTerminalStatus,
  isBettingEvmDeploymentCanonicalReady,
  isBettingEvmDeploymentGovernanceReady,
  normalizeChainKey,
  normalizePredictionMarketDuelKeyHex,
  normalizePredictionMarketLifecycleMetadata,
  normalizePredictionMarketLifecycleRecord,
  normalizeSolanaCluster,
  parseBettingEvmChainList,
  resolveBettingEvmDefaults,
  resolveBettingEvmDeploymentForChain,
  resolveBettingEvmRuntimeEnv,
  resolveLifecycleFromEvmDuelStatus,
  resolveLifecycleFromEvmStatus,
  resolveLifecycleFromSolanaDuelStatus,
  resolveLifecycleFromSolanaMarketStatus,
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
    const avaxMainnet = resolveBettingEvmDeploymentForChain("avax", "mainnet-beta");
    expect(avaxMainnet.chainId).toBe(BETTING_DEPLOYMENTS.evm.avax.chainId);
    expect(avaxMainnet.networkKey).toBe("avax");
    expect(defaultRpcUrlForEvmNetwork(avaxMainnet.networkKey)).toContain("avax");

    const avaxFuji = resolveBettingEvmDeploymentForChain("avax", "testnet");
    expect(avaxFuji.networkKey).toBe("avaxFuji");
    expect(defaultRpcUrlForEvmNetwork(avaxFuji.networkKey)).toContain("avax");
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
        "goldClobAddress",
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
      goldClobAddress: "0x2222222222222222222222222222222222222222",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
      reporterAddress: "0x7777777777777777777777777777777777777777",
      finalizerAddress: "0x8888888888888888888888888888888888888888",
      challengerAddress: "0x9999999999999999999999999999999999999999",
      timelockAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      multisigAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      emergencyCouncilAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    };
    const fujiReady = {
      ...BETTING_DEPLOYMENTS.evm.avaxFuji,
      duelOracleAddress: "0x1111111111111111111111111111111111111111",
      goldClobAddress: "0x2222222222222222222222222222222222222222",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
      reporterAddress: "0x7777777777777777777777777777777777777777",
      finalizerAddress: "0x8888888888888888888888888888888888888888",
      challengerAddress: "0x9999999999999999999999999999999999999999",
      timelockAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      multisigAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      emergencyCouncilAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    };

    expect(isBettingEvmDeploymentCanonicalReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentGovernanceReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmGovernanceFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentCanonicalReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentGovernanceReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmGovernanceFields(fujiReady)).toEqual([]);
  });

  test("tracks AVAX mainnet as pending and AVAX Fuji as canonically addressed", () => {
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.avaxFuji),
    ).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(BETTING_DEPLOYMENTS.evm.avaxFuji))
      .toEqual([]);
    expect(
      isBettingEvmDeploymentGovernanceReady(BETTING_DEPLOYMENTS.evm.avaxFuji),
    ).toBe(false);
    expect(
      getMissingBettingEvmGovernanceFields(BETTING_DEPLOYMENTS.evm.avaxFuji),
    ).toEqual(["timelockAddress", "multisigAddress"]);
    expect(
      isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.avax),
    ).toBe(false);
    expect(getMissingBettingEvmCanonicalFields(BETTING_DEPLOYMENTS.evm.avax))
      .toEqual([
        "duelOracleAddress",
        "goldClobAddress",
        "adminAddress",
        "marketOperatorAddress",
        "treasuryAddress",
        "marketMakerAddress",
      ]);
  });

  test("tracks governance readiness separately from canonical address readiness", () => {
    expect(
      isBettingEvmDeploymentGovernanceReady(BETTING_DEPLOYMENTS.evm.avax),
    ).toBe(false);
    expect(getMissingBettingEvmGovernanceFields(BETTING_DEPLOYMENTS.evm.avax))
      .toEqual([
        "reporterAddress",
        "finalizerAddress",
        "challengerAddress",
        "timelockAddress",
        "multisigAddress",
        "emergencyCouncilAddress",
      ]);
  });

  test("allows non-production runtime address overrides for shared EVM tooling", () => {
    const runtime = resolveBettingEvmRuntimeEnv("avax", "testnet", {
      EVM_AVAX_RPC_URL: "https://override.example/rpc",
      AVAX_DUEL_ORACLE_ADDRESS: "0x1111111111111111111111111111111111111111",
      AVAX_GOLD_CLOB_ADDRESS: "0x2222222222222222222222222222222222222222",
      AVAX_FUJI_RPC: "https://ignored.example/fuji",
    });
    expect(runtime.rpcUrl).toBe("https://override.example/rpc");
    expect(runtime.duelOracleAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(runtime.goldClobAddress).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  test("ignores production address overrides and fails closed for incomplete canonical deployments", () => {
    const baseRuntime = resolveBettingEvmRuntimeEnv("base", "mainnet-beta", {
      BASE_MAINNET_RPC: "https://override.example/base",
      BASE_DUEL_ORACLE_ADDRESS: "0x1111111111111111111111111111111111111111",
      BASE_GOLD_CLOB_ADDRESS: "0x2222222222222222222222222222222222222222",
    });
    expect(baseRuntime.rpcUrl).toBe("https://override.example/base");
    expect(baseRuntime.duelOracleAddress).toBe(
      BETTING_DEPLOYMENTS.evm.base.duelOracleAddress,
    );
    expect(baseRuntime.goldClobAddress).toBe(
      BETTING_DEPLOYMENTS.evm.base.goldClobAddress,
    );

    expect(() =>
      resolveBettingEvmRuntimeEnv("avax", "mainnet-beta", {
        AVAX_MAINNET_RPC: "https://override.example/avax",
        AVAX_DUEL_ORACLE_ADDRESS: "0x1111111111111111111111111111111111111111",
        AVAX_GOLD_CLOB_ADDRESS: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(/Canonical Avalanche C-Chain deployment is incomplete/);
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
    expect(resolveLifecycleFromEvmDuelStatus(4)).toBe("PROPOSED");
    expect(resolveLifecycleFromEvmDuelStatus(5)).toBe("CHALLENGED");
    expect(resolveLifecycleFromSolanaDuelStatus("proposed")).toBe("PROPOSED");
    expect(resolveLifecycleFromSolanaMarketStatus("locked")).toBe("LOCKED");
    expect(resolveLifecycleFromStreamPhase("COUNTDOWN")).toBe("LOCKED");
    expect(resolveLifecycleFromStreamPhase("IDLE")).toBe("PENDING");
  });

  test("normalizes shared lifecycle records and reserved metadata keys", () => {
    expect(normalizePredictionMarketDuelKeyHex(`0x${"ab".repeat(32)}`)).toBe(
      "ab".repeat(32),
    );
    expect(
      normalizePredictionMarketLifecycleMetadata({
        proposalId: 123,
        challengeWindowEndsAt: 456,
        finalizedAt: "bad",
        cancellationReason: "oracle-cancelled",
        extra: true,
      }),
    ).toEqual({
      proposalId: null,
      challengeWindowEndsAt: 456,
      finalizedAt: null,
      cancellationReason: "oracle-cancelled",
      extra: true,
    });
    expect(
      normalizePredictionMarketLifecycleRecord(
        {
          chainKey: "Avalanche",
          duelKey: `0x${"cd".repeat(32)}`,
          duelId: "duel-99",
          marketId: "market-1",
          marketRef: "market-1",
          lifecycleStatus: "PROPOSED",
          winner: "A",
          betCloseTime: 999,
          contractAddress: "0x123",
          programId: null,
          txRef: null,
          syncedAt: 1000,
          metadata: {
            proposalId: "proposal-1",
            challengeWindowEndsAt: 1234,
            finalizedAt: "bad",
            cancellationReason: null,
          },
        },
        { duelKeyPrefix: true },
      ),
    ).toEqual({
      chainKey: "avax",
      duelKey: `0x${"cd".repeat(32)}`,
      duelId: "duel-99",
      marketId: "market-1",
      marketRef: "market-1",
      lifecycleStatus: "PROPOSED",
      winner: "A",
      betCloseTime: 999,
      contractAddress: "0x123",
      programId: null,
      txRef: null,
      syncedAt: 1000,
      metadata: {
        proposalId: "proposal-1",
        challengeWindowEndsAt: 1234,
        finalizedAt: null,
        cancellationReason: null,
      },
    });
  });

  test("exposes shared lifecycle helpers for quotable and terminal states", () => {
    expect(isPredictionMarketLifecycleStatus("PROPOSED")).toBe(true);
    expect(isPredictionMarketLifecycleStatus("CHALLENGED")).toBe(true);
    expect(isPredictionMarketLifecycleStatus("BAD_STATUS")).toBe(false);
    expect(isPredictionMarketQuotableStatus("OPEN")).toBe(true);
    expect(isPredictionMarketQuotableStatus("PROPOSED")).toBe(false);
    expect(isPredictionMarketTerminalStatus("RESOLVED")).toBe(true);
    expect(isPredictionMarketTerminalStatus("CANCELLED")).toBe(true);
    expect(isPredictionMarketTerminalStatus("CHALLENGED")).toBe(false);
    expect(isPredictionMarketInFlightResolutionStatus("PROPOSED")).toBe(true);
    expect(isPredictionMarketInFlightResolutionStatus("CHALLENGED")).toBe(true);
    expect(isPredictionMarketInFlightResolutionStatus("LOCKED")).toBe(false);
  });
});
