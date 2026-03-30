import rawManifest from "./contracts.json";

import {
  BETTING_DEPLOYMENTS as REGISTRY_BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingEvmDefaults as resolveRegistryBettingEvmDefaults,
  resolveBettingSolanaDeployment,
  type BettingAppEnvironment,
  type BettingDeploymentManifest as RegistryBettingDeploymentManifest,
  type BettingEvmChain,
  type BettingEvmDeployment as RegistryBettingEvmDeployment,
  type BettingEvmNetwork,
  type BettingSolanaCluster,
  type BettingSolanaDeployment,
  type BettingTargetKind,
} from "../hyperbet-chain-registry/src/index";

export type {
  BettingAppEnvironment,
  BettingEvmChain,
  BettingEvmNetwork,
  BettingSolanaCluster,
  BettingSolanaDeployment,
  BettingTargetKind,
} from "../hyperbet-chain-registry/src/index";

export interface BettingEvmMaterializedFields {
  skillOracleAddress: string;
  perpEngineAddress: string;
  perpMarginTokenAddress: string;
}

export type BettingEvmDeployment = RegistryBettingEvmDeployment &
  BettingEvmMaterializedFields;

export interface BettingDeploymentManifest
  extends Omit<RegistryBettingDeploymentManifest, "evm"> {
  evm: Record<BettingEvmNetwork, BettingEvmDeployment>;
}

type ManifestRecord = Record<string, unknown>;

const EVM_NETWORKS: BettingEvmNetwork[] = [
  "bscTestnet",
  "bsc",
  "baseSepolia",
  "base",
  "avaxFuji",
  "avax",
] as const;

function isRecord(value: unknown): value is ManifestRecord {
  return typeof value === "object" && value !== null;
}

function readOptionalString(record: ManifestRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function validateMaterializedEvmFields(
  manifest: unknown,
): Record<BettingEvmNetwork, BettingEvmMaterializedFields> {
  if (!isRecord(manifest) || !isRecord(manifest.evm)) {
    throw new Error(
      "Deployment materialization manifest must include an evm section",
    );
  }

  const evmRaw = manifest.evm;
  const fields = {} as Record<BettingEvmNetwork, BettingEvmMaterializedFields>;
  for (const network of EVM_NETWORKS) {
    const networkValue = evmRaw[network];
    if (!isRecord(networkValue)) {
      throw new Error(
        `Deployment materialization missing EVM network '${network}'`,
      );
    }
    fields[network] = {
      skillOracleAddress: readOptionalString(networkValue, "skillOracleAddress"),
      perpEngineAddress: readOptionalString(networkValue, "perpEngineAddress"),
      perpMarginTokenAddress: readOptionalString(
        networkValue,
        "perpMarginTokenAddress",
      ),
    };
  }

  return fields;
}

export const MATERIALIZED_BETTING_EVM_FIELDS =
  validateMaterializedEvmFields(rawManifest);

export const BETTING_DEPLOYMENTS: BettingDeploymentManifest = {
  solana: REGISTRY_BETTING_DEPLOYMENTS.solana,
  evm: Object.fromEntries(
    EVM_NETWORKS.map((network) => [
      network,
      {
        ...REGISTRY_BETTING_DEPLOYMENTS.evm[network],
        ...MATERIALIZED_BETTING_EVM_FIELDS[network],
      },
    ]),
  ) as Record<BettingEvmNetwork, BettingEvmDeployment>,
};

export { normalizeSolanaCluster, resolveBettingSolanaDeployment };

export function resolveBettingEvmDeployment(
  network: BettingEvmNetwork,
): BettingEvmDeployment {
  return BETTING_DEPLOYMENTS.evm[network];
}

export function resolveBettingEvmDefaults(environment: BettingAppEnvironment): {
  bsc: BettingEvmDeployment;
  base: BettingEvmDeployment;
  avax: BettingEvmDeployment;
} {
  const defaults = resolveRegistryBettingEvmDefaults(environment);
  return {
    bsc: BETTING_DEPLOYMENTS.evm[defaults.bsc.networkKey],
    base: BETTING_DEPLOYMENTS.evm[defaults.base.networkKey],
    avax: BETTING_DEPLOYMENTS.evm[defaults.avax.networkKey],
  };
}
