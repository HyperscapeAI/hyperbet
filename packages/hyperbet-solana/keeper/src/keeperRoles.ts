import type { PublicKey } from "@solana/web3.js";

export type KeeperRoleRefs = {
  feePayerKeypair: string;
  oracleReporterKeypair: string;
  oracleFinalizerKeypair: string;
  oracleChallengerWallet: string;
  clobMarketOperatorKeypair: string;
  marketMakerKeypair: string;
  oracleConfigAuthorityKeypair: string | null;
  clobConfigAuthorityKeypair: string | null;
};

export type KeeperRolePublicKeys = {
  feePayer: PublicKey;
  oracleReporter: PublicKey;
  oracleFinalizer: PublicKey;
  oracleChallenger: PublicKey;
  clobMarketOperator: PublicKey;
  marketMaker: PublicKey;
  oracleConfigAuthority: PublicKey | null;
  clobConfigAuthority: PublicKey | null;
};

const REQUIRED_ROLE_ENV = {
  feePayerKeypair: "KEEPER_FEE_PAYER_KEYPAIR",
  oracleReporterKeypair: "ORACLE_REPORTER_KEYPAIR",
  oracleFinalizerKeypair: "ORACLE_FINALIZER_KEYPAIR",
  oracleChallengerWallet: "ORACLE_CHALLENGER_WALLET",
  clobMarketOperatorKeypair: "CLOB_MARKET_OPERATOR_KEYPAIR",
  marketMakerKeypair: "MARKET_MAKER_KEYPAIR",
} as const;

function requiredValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalValue(
  env: Record<string, string | undefined>,
  name: string,
): string | null {
  return env[name]?.trim() || null;
}

export function resolveKeeperRoleRefs(
  env: Record<string, string | undefined>,
): KeeperRoleRefs {
  return {
    feePayerKeypair: requiredValue(env, REQUIRED_ROLE_ENV.feePayerKeypair),
    oracleReporterKeypair: requiredValue(
      env,
      REQUIRED_ROLE_ENV.oracleReporterKeypair,
    ),
    oracleFinalizerKeypair: requiredValue(
      env,
      REQUIRED_ROLE_ENV.oracleFinalizerKeypair,
    ),
    oracleChallengerWallet: requiredValue(
      env,
      REQUIRED_ROLE_ENV.oracleChallengerWallet,
    ),
    clobMarketOperatorKeypair: requiredValue(
      env,
      REQUIRED_ROLE_ENV.clobMarketOperatorKeypair,
    ),
    marketMakerKeypair: requiredValue(
      env,
      REQUIRED_ROLE_ENV.marketMakerKeypair,
    ),
    oracleConfigAuthorityKeypair: optionalValue(
      env,
      "ORACLE_CONFIG_AUTHORITY_KEYPAIR",
    ),
    clobConfigAuthorityKeypair: optionalValue(
      env,
      "CLOB_CONFIG_AUTHORITY_KEYPAIR",
    ),
  };
}

function isMainnetCluster(cluster: string): boolean {
  const normalized = cluster.trim().toLowerCase();
  return normalized === "mainnet" || normalized === "mainnet-beta";
}

export function validateKeeperRoleSeparation(
  cluster: string,
  roles: KeeperRolePublicKeys,
): void {
  if (!isMainnetCluster(cluster)) return;

  const automatedRoles: Array<[string, PublicKey]> = [
    ["fee payer", roles.feePayer],
    ["oracle reporter", roles.oracleReporter],
    ["oracle finalizer", roles.oracleFinalizer],
    ["CLOB market operator", roles.clobMarketOperator],
    ["market maker", roles.marketMaker],
  ];
  const seen = new Map<string, string>();
  for (const [label, key] of automatedRoles) {
    const address = key.toBase58();
    const previous = seen.get(address);
    if (previous) {
      throw new Error(
        `Mainnet keeper roles must use distinct wallets: ${previous} and ${label} both resolve to ${address}`,
      );
    }
    seen.set(address, label);
  }

  const challengerAddress = roles.oracleChallenger.toBase58();
  const challengerCollision = seen.get(challengerAddress);
  if (challengerCollision) {
    throw new Error(
      `Mainnet oracle challenger must be independent from automated keeper roles: it matches ${challengerCollision}`,
    );
  }

  for (const [label, key] of [
    ["oracle config authority", roles.oracleConfigAuthority],
    ["CLOB config authority", roles.clobConfigAuthority],
  ] as Array<[string, PublicKey | null]>) {
    if (!key) continue;
    const address = key.toBase58();
    const runtimeCollision = seen.get(address);
    if (runtimeCollision || address === challengerAddress) {
      throw new Error(
        `Mainnet ${label} must be independent from runtime and challenger wallets: it matches ${runtimeCollision ?? "oracle challenger"}`,
      );
    }
  }
}
