import manifest from "./solana-v1.json";

export type SolanaV1Cluster =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta";
export type SolanaV1Environment = SolanaV1Cluster | "e2e" | "stream-ui";

export interface SolanaV1Deployment {
  cluster: SolanaV1Cluster;
  fightOracleProgramId: string;
  duelMarketProgramId: string;
}

export interface SolanaV1DeploymentManifest {
  solana: Record<SolanaV1Cluster, SolanaV1Deployment>;
}

export const SOLANA_V1_DEPLOYMENTS = manifest as SolanaV1DeploymentManifest;

export function normalizeSolanaV1Cluster(
  value: string | null | undefined,
): SolanaV1Cluster {
  switch (value?.trim().toLowerCase()) {
    case "local":
    case "localnet":
    case "e2e":
      return "localnet";
    case "testnet":
      return "testnet";
    case "mainnet":
    case "mainnet-beta":
    case "prod":
    case "production":
      return "mainnet-beta";
    case "stream-ui":
    case "dev":
    case "development":
    case "devnet":
    default:
      return "devnet";
  }
}

export function resolveSolanaV1Deployment(
  environment: SolanaV1Environment | string,
): SolanaV1Deployment {
  return SOLANA_V1_DEPLOYMENTS.solana[normalizeSolanaV1Cluster(environment)];
}
