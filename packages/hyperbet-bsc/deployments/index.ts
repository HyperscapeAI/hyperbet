import {
  BETTING_DEPLOYMENTS as SHARED_BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingEvmDefaults as resolveSharedBettingEvmDefaults,
  resolveBettingSolanaDeployment,
  type BettingAppEnvironment,
  type BettingEvmDeployment as SharedBettingEvmDeployment,
  type BettingSolanaDeployment,
  type BettingSolanaCluster,
} from "@hyperbet/chain-registry";

export type {
  BettingAppEnvironment,
  BettingSolanaDeployment,
  BettingSolanaCluster,
} from "@hyperbet/chain-registry";

export type BettingEvmNetwork = "bscTestnet" | "bsc" | "baseSepolia" | "base";
export type BettingEvmChain = "bsc" | "base";
export type BettingTargetKind = "testnet" | "mainnet";
export type BettingEvmDeployment = SharedBettingEvmDeployment & {
  networkKey: BettingEvmNetwork;
  chainKey: BettingEvmChain;
};
type BscBettingEvmDeployment = SharedBettingEvmDeployment & {
  networkKey: "bscTestnet" | "bsc";
  chainKey: "bsc";
};
type BaseBettingEvmDeployment = SharedBettingEvmDeployment & {
  networkKey: "baseSepolia" | "base";
  chainKey: "base";
};

export interface BettingDeploymentManifest {
  solana: Record<BettingSolanaCluster, BettingSolanaDeployment>;
  evm: Record<BettingEvmNetwork, BettingEvmDeployment>;
}

export const BETTING_DEPLOYMENTS: BettingDeploymentManifest = {
  solana: SHARED_BETTING_DEPLOYMENTS.solana,
  evm: {
    bscTestnet:
      SHARED_BETTING_DEPLOYMENTS.evm.bscTestnet as BscBettingEvmDeployment,
    bsc: SHARED_BETTING_DEPLOYMENTS.evm.bsc as BscBettingEvmDeployment,
    baseSepolia:
      SHARED_BETTING_DEPLOYMENTS.evm.baseSepolia as BaseBettingEvmDeployment,
    base: SHARED_BETTING_DEPLOYMENTS.evm.base as BaseBettingEvmDeployment,
  },
};

export { normalizeSolanaCluster, resolveBettingSolanaDeployment };

export function resolveBettingEvmDeployment(
  network: BettingEvmNetwork,
): BettingEvmDeployment {
  return BETTING_DEPLOYMENTS.evm[network];
}

export function resolveBettingEvmDefaults(environment: BettingAppEnvironment): {
  bsc: BscBettingEvmDeployment;
  base: BaseBettingEvmDeployment;
} {
  const defaults = resolveSharedBettingEvmDefaults(environment);
  return {
    bsc: defaults.bsc as BscBettingEvmDeployment,
    base: defaults.base as BaseBettingEvmDeployment,
  };
}
