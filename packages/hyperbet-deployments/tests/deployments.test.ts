import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS as REGISTRY_BETTING_DEPLOYMENTS,
  resolveBettingEvmDefaults as resolveRegistryBettingEvmDefaults,
} from "../../hyperbet-chain-registry/src/index.ts";

import rawManifest from "../contracts.json";
import {
  BETTING_DEPLOYMENTS,
  MATERIALIZED_BETTING_EVM_FIELDS,
  resolveBettingEvmDefaults,
  resolveBettingSolanaDeployment,
} from "../index";

describe("@hyperbet/deployments materialization", () => {
  test("preserves registry authority for solana and core evm fields", () => {
    const testnet = resolveBettingSolanaDeployment("testnet");
    expect(testnet).toEqual(REGISTRY_BETTING_DEPLOYMENTS.solana.testnet);

    expect(BETTING_DEPLOYMENTS.evm.bsc.duelOracleAddress).toBe(
      REGISTRY_BETTING_DEPLOYMENTS.evm.bsc.duelOracleAddress,
    );
    expect(BETTING_DEPLOYMENTS.evm.base.goldClobAddress).toBe(
      REGISTRY_BETTING_DEPLOYMENTS.evm.base.goldClobAddress,
    );
    expect(BETTING_DEPLOYMENTS.evm.avax.chainId).toBe(
      REGISTRY_BETTING_DEPLOYMENTS.evm.avax.chainId,
    );
  });

  test("materializes only additive perps fields from contracts.json", () => {
    expect(MATERIALIZED_BETTING_EVM_FIELDS.bsc.skillOracleAddress).toBe(
      (rawManifest as any).evm.bsc.skillOracleAddress,
    );
    expect(BETTING_DEPLOYMENTS.evm.bsc.skillOracleAddress).toBe(
      (rawManifest as any).evm.bsc.skillOracleAddress,
    );
    expect(BETTING_DEPLOYMENTS.evm.base.perpEngineAddress).toBe(
      (rawManifest as any).evm.base.perpEngineAddress,
    );
    expect(BETTING_DEPLOYMENTS.evm.avaxFuji.perpMarginTokenAddress).toBe(
      (rawManifest as any).evm.avaxFuji.perpMarginTokenAddress,
    );
  });

  test("keeps governance metadata keys in the committed deployment manifest", () => {
    expect((rawManifest as any).evm.bsc).toHaveProperty("reporterAddress");
    expect((rawManifest as any).evm.bsc).toHaveProperty("finalizerAddress");
    expect((rawManifest as any).evm.bsc).toHaveProperty("challengerAddress");
    expect((rawManifest as any).evm.bsc).toHaveProperty("timelockAddress");
    expect((rawManifest as any).evm.bsc).toHaveProperty("multisigAddress");
    expect((rawManifest as any).evm.bsc).toHaveProperty(
      "emergencyCouncilAddress",
    );
  });

  test("defaults delegate through registry network selection while preserving additive fields", () => {
    const registryTestnet = resolveRegistryBettingEvmDefaults("testnet");
    const testnet = resolveBettingEvmDefaults("testnet");
    expect(testnet.bsc.networkKey).toBe(registryTestnet.bsc.networkKey);
    expect(testnet.base.networkKey).toBe(registryTestnet.base.networkKey);
    expect(testnet.avax.networkKey).toBe(registryTestnet.avax.networkKey);
    expect(testnet.avax.perpMarginTokenAddress).toBe(
      MATERIALIZED_BETTING_EVM_FIELDS[registryTestnet.avax.networkKey]
        .perpMarginTokenAddress,
    );

    const registryMainnet = resolveRegistryBettingEvmDefaults("mainnet-beta");
    const mainnet = resolveBettingEvmDefaults("mainnet-beta");
    expect(mainnet.bsc.networkKey).toBe(registryMainnet.bsc.networkKey);
    expect(mainnet.base.networkKey).toBe(registryMainnet.base.networkKey);
    expect(mainnet.avax.networkKey).toBe(registryMainnet.avax.networkKey);
    expect(mainnet.base.skillOracleAddress).toBe(
      MATERIALIZED_BETTING_EVM_FIELDS[registryMainnet.base.networkKey]
        .skillOracleAddress,
    );
  });
});
