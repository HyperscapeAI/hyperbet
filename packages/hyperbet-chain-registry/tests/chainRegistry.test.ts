import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  BETTING_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_EVM_CHAIN_ORDER,
  BETTING_LAUNCH_SOLANA_CLUSTER,
  defaultRpcUrlForEvmNetwork,
  getMissingBettingEvmAmmFields,
  getMissingBettingEvmCanonicalFields,
  getMissingBettingEvmFullProductFields,
  getMissingBettingEvmGovernanceFields,
  getMissingBettingEvmPerpsFields,
  getMissingBettingEvmReleaseFields,
  getMissingBettingSolanaAmmFields,
  getMissingBettingSolanaCanonicalFields,
  getMissingBettingSolanaFullProductFields,
  getMissingBettingSolanaPerpsFields,
  getMissingBettingSolanaReleaseFields,
  isBettingEvmDeploymentAmmReady,
  isPredictionMarketInFlightResolutionStatus,
  isPredictionMarketLifecycleStatus,
  isPredictionMarketQuotableStatus,
  isPredictionMarketTerminalStatus,
  isBettingEvmDeploymentCanonicalReady,
  isBettingEvmDeploymentFullProductReady,
  isBettingEvmDeploymentGovernanceReady,
  isBettingEvmDeploymentPerpsReady,
  isBettingEvmDeploymentReleaseReady,
  isBettingSolanaDeploymentAmmReady,
  isBettingSolanaDeploymentCanonicalReady,
  isBettingSolanaDeploymentFullProductReady,
  isBettingSolanaDeploymentPerpsReady,
  isBettingSolanaDeploymentReleaseReady,
  normalizeChainKey,
  normalizePredictionMarketDuelKeyHex,
  normalizePredictionMarketLifecycleMetadata,
  normalizePredictionMarketLifecycleRecord,
  normalizeSolanaCluster,
  parseBettingEvmChainList,
  resolveBettingEvmDefaults,
  resolveBettingEvmDeploymentForChain,
  resolveBettingEvmRuntimeEnv,
  resolveBettingSolanaDeployment,
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

  test("separates launch-blocking chains from later add-chain promotion", () => {
    expect(BETTING_LAUNCH_SOLANA_CLUSTER).toBe("mainnet-beta");
    expect(BETTING_LAUNCH_EVM_CHAIN_ORDER).toEqual(["bsc", "avax"]);
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

  test("tracks full-product readiness separately from PM-core canonical readiness", () => {
    expect(isBettingEvmDeploymentCanonicalReady(BETTING_DEPLOYMENTS.evm.bsc)).toBe(
      true,
    );
    expect(isBettingEvmDeploymentAmmReady(BETTING_DEPLOYMENTS.evm.bsc)).toBe(
      false,
    );
    expect(isBettingEvmDeploymentPerpsReady(BETTING_DEPLOYMENTS.evm.bsc)).toBe(
      false,
    );
    expect(
      getMissingBettingEvmAmmFields(BETTING_DEPLOYMENTS.evm.bsc),
    ).toEqual(["goldAmmRouterAddress", "mUsdTokenAddress"]);
    expect(
      getMissingBettingEvmPerpsFields(BETTING_DEPLOYMENTS.evm.bsc),
    ).toEqual(["goldTokenAddress", "skillOracleAddress", "perpEngineAddress"]);
    expect(
      isBettingEvmDeploymentFullProductReady(BETTING_DEPLOYMENTS.evm.base),
    ).toBe(false);
    expect(
      getMissingBettingEvmFullProductFields(BETTING_DEPLOYMENTS.evm.base),
    ).toEqual([
      "goldAmmRouterAddress",
      "mUsdTokenAddress",
      "goldTokenAddress",
      "skillOracleAddress",
      "perpEngineAddress",
    ]);
    expect(
      isBettingEvmDeploymentReleaseReady(BETTING_DEPLOYMENTS.evm.avax),
    ).toBe(false);
    expect(
      getMissingBettingEvmReleaseFields(BETTING_DEPLOYMENTS.evm.avax),
    ).toEqual([
      "duelOracleAddress",
      "goldClobAddress",
      "adminAddress",
      "marketOperatorAddress",
      "treasuryAddress",
      "marketMakerAddress",
      "goldAmmRouterAddress",
      "mUsdTokenAddress",
      "goldTokenAddress",
      "skillOracleAddress",
      "perpEngineAddress",
      "reporterAddress",
      "finalizerAddress",
      "challengerAddress",
      "timelockAddress",
      "multisigAddress",
      "emergencyCouncilAddress",
    ]);
  });

  test("tracks Solana full-product readiness separately from PM-core readiness", () => {
    const solanaMainnet = resolveBettingSolanaDeployment("mainnet-beta");
    expect(isBettingSolanaDeploymentCanonicalReady(solanaMainnet)).toBe(true);
    expect(getMissingBettingSolanaCanonicalFields(solanaMainnet)).toEqual([]);
    expect(isBettingSolanaDeploymentAmmReady(solanaMainnet)).toBe(false);
    expect(getMissingBettingSolanaAmmFields(solanaMainnet)).toEqual([
      "goldAmmMarketProgramId",
    ]);
    expect(isBettingSolanaDeploymentPerpsReady(solanaMainnet)).toBe(true);
    expect(getMissingBettingSolanaPerpsFields(solanaMainnet)).toEqual([]);
    expect(isBettingSolanaDeploymentFullProductReady(solanaMainnet)).toBe(
      false,
    );
    expect(getMissingBettingSolanaFullProductFields(solanaMainnet)).toEqual([
      "goldAmmMarketProgramId",
    ]);
    expect(isBettingSolanaDeploymentReleaseReady(solanaMainnet)).toBe(false);
    expect(getMissingBettingSolanaReleaseFields(solanaMainnet)).toEqual([
      "goldAmmMarketProgramId",
    ]);
  });

  test("treats fully populated Solana mainnet deployments as launch-ready", () => {
    const solanaMainnetReady = {
      ...BETTING_DEPLOYMENTS.solana["mainnet-beta"],
      goldAmmMarketProgramId: "BGmzj676aVzRaJ3Hb9BJRYrjtXuhzoc1YTFA6wcucUNF",
    };

    expect(isBettingSolanaDeploymentCanonicalReady(solanaMainnetReady)).toBe(
      true,
    );
    expect(getMissingBettingSolanaCanonicalFields(solanaMainnetReady)).toEqual(
      [],
    );
    expect(isBettingSolanaDeploymentAmmReady(solanaMainnetReady)).toBe(true);
    expect(getMissingBettingSolanaAmmFields(solanaMainnetReady)).toEqual([]);
    expect(isBettingSolanaDeploymentPerpsReady(solanaMainnetReady)).toBe(true);
    expect(getMissingBettingSolanaPerpsFields(solanaMainnetReady)).toEqual([]);
    expect(isBettingSolanaDeploymentFullProductReady(solanaMainnetReady)).toBe(
      true,
    );
    expect(getMissingBettingSolanaFullProductFields(solanaMainnetReady)).toEqual(
      [],
    );
    expect(isBettingSolanaDeploymentReleaseReady(solanaMainnetReady)).toBe(
      true,
    );
    expect(getMissingBettingSolanaReleaseFields(solanaMainnetReady)).toEqual(
      [],
    );
  });

  test("treats fully populated AVAX deployments as canonical-ready", () => {
    const mainnetReady = {
      ...BETTING_DEPLOYMENTS.evm.avax,
      duelOracleAddress: "0x1111111111111111111111111111111111111111",
      goldClobAddress: "0x2222222222222222222222222222222222222222",
      goldAmmRouterAddress: "0x2323232323232323232323232323232323232323",
      mUsdTokenAddress: "0x2424242424242424242424242424242424242424",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
      goldTokenAddress: "0x6767676767676767676767676767676767676767",
      skillOracleAddress: "0x6868686868686868686868686868686868686868",
      perpEngineAddress: "0x6969696969696969696969696969696969696969",
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
      goldAmmRouterAddress: "0x2323232323232323232323232323232323232323",
      mUsdTokenAddress: "0x2424242424242424242424242424242424242424",
      adminAddress: "0x3333333333333333333333333333333333333333",
      marketOperatorAddress: "0x4444444444444444444444444444444444444444",
      treasuryAddress: "0x5555555555555555555555555555555555555555",
      marketMakerAddress: "0x6666666666666666666666666666666666666666",
      goldTokenAddress: "0x6767676767676767676767676767676767676767",
      skillOracleAddress: "0x6868686868686868686868686868686868686868",
      perpEngineAddress: "0x6969696969696969696969696969696969696969",
      reporterAddress: "0x7777777777777777777777777777777777777777",
      finalizerAddress: "0x8888888888888888888888888888888888888888",
      challengerAddress: "0x9999999999999999999999999999999999999999",
      timelockAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      multisigAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      emergencyCouncilAddress: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    };

    expect(isBettingEvmDeploymentCanonicalReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentAmmReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmAmmFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentPerpsReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmPerpsFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentFullProductReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmFullProductFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentGovernanceReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmGovernanceFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentReleaseReady(mainnetReady)).toBe(true);
    expect(getMissingBettingEvmReleaseFields(mainnetReady)).toEqual([]);
    expect(isBettingEvmDeploymentCanonicalReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmCanonicalFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentAmmReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmAmmFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentPerpsReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmPerpsFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentFullProductReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmFullProductFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentGovernanceReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmGovernanceFields(fujiReady)).toEqual([]);
    expect(isBettingEvmDeploymentReleaseReady(fujiReady)).toBe(true);
    expect(getMissingBettingEvmReleaseFields(fujiReady)).toEqual([]);
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
