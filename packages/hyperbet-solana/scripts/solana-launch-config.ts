import { PublicKey } from "@solana/web3.js";

import {
  resolveLaunchFeePolicy,
  type LaunchFeePolicy,
} from "../keeper/src/feePolicy";

export const SOLANA_LAUNCH_ROLE_ENV_NAMES = [
  "SOLANA_PM_REPORTER_PUBKEY",
  "SOLANA_PM_FINALIZER_PUBKEY",
  "SOLANA_PM_CHALLENGER_PUBKEY",
  "SOLANA_PM_MARKET_OPERATOR_PUBKEY",
  "SOLANA_PM_TREASURY_PUBKEY",
  "SOLANA_PM_MARKET_MAKER_PUBKEY",
] as const;

export type SolanaLaunchRoleEnvName =
  (typeof SOLANA_LAUNCH_ROLE_ENV_NAMES)[number];

export type SolanaDuelLaunchConfig = LaunchFeePolicy & {
  disputeWindowSecs: number;
  reporter: PublicKey;
  finalizer: PublicKey;
  challenger: PublicKey;
  marketOperator: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
};

function requireValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be explicitly configured`);
  }
  return value;
}

function requireInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  minimum: number,
): number {
  const raw = requireValue(env, name);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function requirePublicKey(
  env: Readonly<Record<string, string | undefined>>,
  name: SolanaLaunchRoleEnvName,
): PublicKey {
  let value: PublicKey;
  try {
    value = new PublicKey(requireValue(env, name));
  } catch {
    throw new Error(`${name} must be a valid base58 Solana public key`);
  }
  if (value.equals(PublicKey.default)) {
    throw new Error(`${name} cannot be the zero public key`);
  }
  return value;
}

export function resolveSolanaDuelLaunchConfig(input: {
  env: Readonly<Record<string, string | undefined>>;
  configAuthority: PublicKey;
}): SolanaDuelLaunchConfig {
  if (input.env.SOLANA_LAUNCH_FEE_POLICY_APPROVED?.trim() !== "true") {
    throw new Error(
      "SOLANA_LAUNCH_FEE_POLICY_APPROVED must be exactly 'true' before configuration",
    );
  }

  const tradeTreasuryFeeBps = requireInteger(
    input.env,
    "TRADE_TREASURY_FEE_BPS",
    1,
  );
  const tradeMarketMakerFeeBps = requireInteger(
    input.env,
    "TRADE_MARKET_MAKER_FEE_BPS",
    0,
  );
  const winningsMarketMakerFeeBps = requireInteger(
    input.env,
    "WINNINGS_MARKET_MAKER_FEE_BPS",
    0,
  );
  const fees = resolveLaunchFeePolicy({
    tradeTreasuryFeeBps,
    tradeMarketMakerFeeBps,
    winningsMarketMakerFeeBps,
  });
  const disputeWindowSecs = requireInteger(
    input.env,
    "SOLANA_ORACLE_DISPUTE_WINDOW_SECS",
    60,
  );

  const roleValues = Object.fromEntries(
    SOLANA_LAUNCH_ROLE_ENV_NAMES.map((name) => [
      name,
      requirePublicKey(input.env, name),
    ]),
  ) as Record<SolanaLaunchRoleEnvName, PublicKey>;
  const identities = [
    ["config authority", input.configAuthority] as const,
    ...SOLANA_LAUNCH_ROLE_ENV_NAMES.map(
      (name) => [name, roleValues[name]] as const,
    ),
  ];
  const identityOwner = new Map<string, string>();
  for (const [label, identity] of identities) {
    if (identity.equals(PublicKey.default)) {
      throw new Error(`${label} cannot be the zero public key`);
    }
    const encoded = identity.toBase58();
    const previous = identityOwner.get(encoded);
    if (previous) {
      throw new Error(
        `Solana launch roles must be distinct: ${label} duplicates ${previous}`,
      );
    }
    identityOwner.set(encoded, label);
  }

  return {
    ...fees,
    disputeWindowSecs,
    reporter: roleValues.SOLANA_PM_REPORTER_PUBKEY,
    finalizer: roleValues.SOLANA_PM_FINALIZER_PUBKEY,
    challenger: roleValues.SOLANA_PM_CHALLENGER_PUBKEY,
    marketOperator: roleValues.SOLANA_PM_MARKET_OPERATOR_PUBKEY,
    treasury: roleValues.SOLANA_PM_TREASURY_PUBKEY,
    marketMaker: roleValues.SOLANA_PM_MARKET_MAKER_PUBKEY,
  };
}

export function serializeSolanaDuelLaunchConfig(
  config: SolanaDuelLaunchConfig,
): Record<string, string | number> {
  return {
    disputeWindowSecs: config.disputeWindowSecs,
    reporter: config.reporter.toBase58(),
    finalizer: config.finalizer.toBase58(),
    challenger: config.challenger.toBase58(),
    marketOperator: config.marketOperator.toBase58(),
    treasury: config.treasury.toBase58(),
    marketMaker: config.marketMaker.toBase58(),
    tradeTreasuryFeeBps: config.tradeTreasuryFeeBps,
    tradeMarketMakerFeeBps: config.tradeMarketMakerFeeBps,
    winningsMarketMakerFeeBps: config.winningsMarketMakerFeeBps,
  };
}
