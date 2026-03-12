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

export type BettingEvmNetwork = "avaxFuji" | "avax";
export type BettingEvmChain = "avax";
export type BettingTargetKind = "testnet" | "mainnet";
export type BettingEvmDeployment = SharedBettingEvmDeployment & {
  networkKey: BettingEvmNetwork;
  chainKey: BettingEvmChain;
};

export interface BettingDeploymentManifest {
  solana: Record<BettingSolanaCluster, BettingSolanaDeployment>;
  evm: Record<BettingEvmNetwork, BettingEvmDeployment>;
}

export const BETTING_DEPLOYMENTS: BettingDeploymentManifest = {
  solana: SHARED_BETTING_DEPLOYMENTS.solana,
  evm: {
    avaxFuji: SHARED_BETTING_DEPLOYMENTS.evm.avaxFuji as BettingEvmDeployment,
    avax: SHARED_BETTING_DEPLOYMENTS.evm.avax as BettingEvmDeployment,
  },
};

export { normalizeSolanaCluster, resolveBettingSolanaDeployment };

export function resolveBettingEvmDeployment(
  network: BettingEvmNetwork,
): BettingEvmDeployment {
  return BETTING_DEPLOYMENTS.evm[network];
}

export function resolveBettingEvmDefaults(environment: BettingAppEnvironment): {
  avax: BettingEvmDeployment;
} {
  const defaults = resolveSharedBettingEvmDefaults(environment);
  return {
    avax: defaults.avax as BettingEvmDeployment,
  };
}
