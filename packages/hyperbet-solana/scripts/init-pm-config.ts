import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from "@solana/web3.js";

import {
  resolveBettingSolanaDeployment,
  type BettingSolanaCluster,
} from "../deployments";
import { resolveStageAWalletPath } from "./stage-a-identity";

const { Program } = anchor;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

interface OracleConfigAccount {
  authority: PublicKey;
  reporter: PublicKey;
  finalizer: PublicKey;
  challenger: PublicKey;
  disputeWindowSecs: BN;
  paused: boolean;
  configFrozen: boolean;
}

interface MarketConfigAccount {
  authority: PublicKey;
  marketOperator: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
  winningsMarketMakerFeeBps: number;
  orderPlacementPaused: boolean;
  marketCreationPaused: boolean;
  configFrozen: boolean;
}

interface AmmAdminAccount {
  admin: PublicKey;
  isInitialized: boolean;
}

interface AmmConfigAccount {
  authority: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
  fightOracleProgram: PublicKey;
  feeBps: number;
  configFrozen: boolean;
  paused: boolean;
}

interface PerpsConfigAccount {
  authority: PublicKey;
  keeperAuthority: PublicKey;
  treasuryAuthority: PublicKey;
  marketMakerAuthority: PublicKey;
  defaultSkewScale: BN;
  defaultFundingVelocity: BN;
  maxOracleStalenessSeconds: BN;
  minOracleSpotIndex: BN;
  maxOracleSpotIndex: BN;
  maxOraclePriceDeltaBps: number;
  maxLeverage: BN;
  minMarginLamports: BN;
  maxMarketOpenInterest: BN;
  minMarketInsuranceLamports: BN;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
  configFrozen: boolean;
  paused: boolean;
}

interface PerpsLaunchConfig {
  defaultSkewScale: number;
  defaultFundingVelocity: number;
  maxOracleStalenessSeconds: number;
  minOracleSpotIndex: number;
  maxOracleSpotIndex: number;
  maxOraclePriceDeltaBps: number;
  maxLeverage: number;
  minMarginLamports: number;
  maxMarketOpenInterest: number;
  minMarketInsuranceLamports: number;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
  tradeTreasuryFeeBps: number;
  tradeMarketMakerFeeBps: number;
}

function parseArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseCluster(): BettingSolanaCluster {
  const value = parseArg("--cluster") ?? "devnet";
  switch (value) {
    case "localnet":
    case "devnet":
    case "testnet":
    case "mainnet-beta":
      return value;
    default:
      throw new Error(`Unsupported --cluster value '${value}'`);
  }
}

function usage(): never {
  console.log(`usage: node --import tsx packages/hyperbet-solana/scripts/init-pm-config.ts \\
  [--cluster devnet|testnet|mainnet-beta|localnet] [--pm-only] [--freeze] [--out <path>]

env:
  DISPUTE_WINDOW_SECONDS          default 3600; must be >= 60
  SOLANA_AMM_FEE_BPS             default 200

optional PM role overrides (default = deployer):
  SOLANA_PM_REPORTER_PUBKEY
  SOLANA_PM_FINALIZER_PUBKEY
  SOLANA_PM_CHALLENGER_PUBKEY
  SOLANA_PM_MARKET_OPERATOR_PUBKEY
  SOLANA_PM_TREASURY_PUBKEY
  SOLANA_PM_MARKET_MAKER_PUBKEY

optional AMM role overrides:
  SOLANA_AMM_TREASURY_PUBKEY
  SOLANA_AMM_MARKET_MAKER_PUBKEY

optional perps role overrides:
  SOLANA_PERPS_KEEPER_PUBKEY
  SOLANA_PERPS_TREASURY_PUBKEY
  SOLANA_PERPS_MARKET_MAKER_PUBKEY

optional perps config overrides:
  SOLANA_PERPS_DEFAULT_SKEW_SCALE
  SOLANA_PERPS_DEFAULT_FUNDING_VELOCITY
  SOLANA_PERPS_MAX_ORACLE_STALENESS_SECONDS
  SOLANA_PERPS_MIN_ORACLE_SPOT_INDEX
  SOLANA_PERPS_MAX_ORACLE_SPOT_INDEX
  SOLANA_PERPS_MAX_ORACLE_PRICE_DELTA_BPS
  SOLANA_PERPS_MAX_LEVERAGE
  SOLANA_PERPS_MIN_MARGIN_LAMPORTS
  SOLANA_PERPS_MAX_MARKET_OPEN_INTEREST
  SOLANA_PERPS_MIN_MARKET_INSURANCE_LAMPORTS
  SOLANA_PERPS_MAINTENANCE_MARGIN_BPS
  SOLANA_PERPS_LIQUIDATION_FEE_BPS
  SOLANA_PERPS_TRADE_TREASURY_FEE_BPS
  SOLANA_PERPS_TRADE_MARKET_MAKER_FEE_BPS
`);
  process.exit(0);
}

function resolveRpcUrl(cluster: BettingSolanaCluster): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(cluster === "mainnet-beta" ? "mainnet-beta" : cluster);
}

function resolveWalletPath(): string {
  return resolveStageAWalletPath();
}

function readKeypair(filepath: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(filepath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

function deriveOracleConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    programId,
  )[0];
}

function deriveMarketConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

function deriveAmmAdminPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("admin_state")],
    programId,
  )[0];
}

function deriveAmmConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("amm_config")],
    programId,
  )[0];
}

function derivePerpsConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

function loadIdl(filepath: string): Idl {
  return JSON.parse(fs.readFileSync(filepath, "utf8")) as Idl;
}

function loadIdlWithAddress(filepath: string, address: PublicKey): Idl {
  const idl = loadIdl(filepath) as Idl & { address?: string };
  idl.address = address.toBase58();
  return idl;
}

function writeSummary(outPath: string | undefined, payload: unknown): void {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
}

function optionalSolanaPubkey(
  envName: string,
  fallback: PublicKey,
): PublicKey {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`${envName} must be a valid base58 Solana public key`);
  }
}

function fallbackSolanaPubkey(
  envNames: Array<string>,
  fallback: PublicKey,
): PublicKey {
  for (const envName of envNames) {
    const raw = process.env[envName]?.trim();
    if (!raw) continue;
    try {
      return new PublicKey(raw);
    } catch {
      throw new Error(`${envName} must be a valid base58 Solana public key`);
    }
  }
  return fallback;
}

function integerEnv(
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function toBn(value: number): BN {
  return new BN(Math.round(value));
}

function resolveOracleRoleKeys(authority: PublicKey): {
  reporter: PublicKey;
  finalizer: PublicKey;
  challenger: PublicKey;
} {
  return {
    reporter: optionalSolanaPubkey("SOLANA_PM_REPORTER_PUBKEY", authority),
    finalizer: optionalSolanaPubkey("SOLANA_PM_FINALIZER_PUBKEY", authority),
    challenger: optionalSolanaPubkey("SOLANA_PM_CHALLENGER_PUBKEY", authority),
  };
}

function resolveMarketRoleKeys(authority: PublicKey): {
  marketOperator: PublicKey;
  treasury: PublicKey;
  marketMaker: PublicKey;
} {
  return {
    marketOperator: optionalSolanaPubkey(
      "SOLANA_PM_MARKET_OPERATOR_PUBKEY",
      authority,
    ),
    treasury: optionalSolanaPubkey("SOLANA_PM_TREASURY_PUBKEY", authority),
    marketMaker: optionalSolanaPubkey(
      "SOLANA_PM_MARKET_MAKER_PUBKEY",
      authority,
    ),
  };
}

function resolveAmmRoleKeys(authority: PublicKey): {
  treasury: PublicKey;
  marketMaker: PublicKey;
} {
  return {
    treasury: fallbackSolanaPubkey(
      ["SOLANA_AMM_TREASURY_PUBKEY", "SOLANA_PM_TREASURY_PUBKEY"],
      authority,
    ),
    marketMaker: fallbackSolanaPubkey(
      ["SOLANA_AMM_MARKET_MAKER_PUBKEY", "SOLANA_PM_MARKET_MAKER_PUBKEY"],
      authority,
    ),
  };
}

function resolvePerpsRoleKeys(authority: PublicKey): {
  keeperAuthority: PublicKey;
  treasuryAuthority: PublicKey;
  marketMakerAuthority: PublicKey;
} {
  return {
    keeperAuthority: optionalSolanaPubkey(
      "SOLANA_PERPS_KEEPER_PUBKEY",
      authority,
    ),
    treasuryAuthority: fallbackSolanaPubkey(
      ["SOLANA_PERPS_TREASURY_PUBKEY", "SOLANA_PM_TREASURY_PUBKEY"],
      authority,
    ),
    marketMakerAuthority: fallbackSolanaPubkey(
      ["SOLANA_PERPS_MARKET_MAKER_PUBKEY", "SOLANA_PM_MARKET_MAKER_PUBKEY"],
      authority,
    ),
  };
}

const DEFAULT_TRADE_TREASURY_FEE_BPS = 100;
const DEFAULT_TRADE_MM_FEE_BPS = 100;
const DEFAULT_WINNINGS_MM_FEE_BPS = 200;
const DEFAULT_AMM_FEE_BPS = 200;

function resolvePerpsLaunchConfig(): PerpsLaunchConfig {
  const defaultMaxOracleStalenessSeconds = integerEnv(
    "HYPERSCAPE_MAX_ORACLE_STALENESS_SECONDS",
    5,
    1,
  );

  return {
    defaultSkewScale: integerEnv(
      "SOLANA_PERPS_DEFAULT_SKEW_SCALE",
      100 * LAMPORTS_PER_SOL,
      1,
    ),
    defaultFundingVelocity: integerEnv(
      "SOLANA_PERPS_DEFAULT_FUNDING_VELOCITY",
      1_000,
      1,
    ),
    maxOracleStalenessSeconds: integerEnv(
      "SOLANA_PERPS_MAX_ORACLE_STALENESS_SECONDS",
      defaultMaxOracleStalenessSeconds,
      1,
    ),
    minOracleSpotIndex: integerEnv(
      "SOLANA_PERPS_MIN_ORACLE_SPOT_INDEX",
      80 * LAMPORTS_PER_SOL,
      1,
    ),
    maxOracleSpotIndex: integerEnv(
      "SOLANA_PERPS_MAX_ORACLE_SPOT_INDEX",
      120 * LAMPORTS_PER_SOL,
      1,
    ),
    maxOraclePriceDeltaBps: integerEnv(
      "SOLANA_PERPS_MAX_ORACLE_PRICE_DELTA_BPS",
      2_500,
      1,
    ),
    maxLeverage: integerEnv("SOLANA_PERPS_MAX_LEVERAGE", 5, 1),
    minMarginLamports: integerEnv(
      "SOLANA_PERPS_MIN_MARGIN_LAMPORTS",
      Math.floor(0.1 * LAMPORTS_PER_SOL),
      1,
    ),
    maxMarketOpenInterest: integerEnv(
      "SOLANA_PERPS_MAX_MARKET_OPEN_INTEREST",
      25 * LAMPORTS_PER_SOL,
      1,
    ),
    minMarketInsuranceLamports: integerEnv(
      "SOLANA_PERPS_MIN_MARKET_INSURANCE_LAMPORTS",
      12 * LAMPORTS_PER_SOL,
      0,
    ),
    maintenanceMarginBps: integerEnv(
      "SOLANA_PERPS_MAINTENANCE_MARGIN_BPS",
      500,
      1,
    ),
    liquidationFeeBps: integerEnv(
      "SOLANA_PERPS_LIQUIDATION_FEE_BPS",
      100,
      1,
    ),
    tradeTreasuryFeeBps: integerEnv(
      "SOLANA_PERPS_TRADE_TREASURY_FEE_BPS",
      25,
      0,
    ),
    tradeMarketMakerFeeBps: integerEnv(
      "SOLANA_PERPS_TRADE_MARKET_MAKER_FEE_BPS",
      25,
      0,
    ),
  };
}

function oracleStateMatches(
  existing: OracleConfigAccount,
  reporter: PublicKey,
  finalizer: PublicKey,
  challenger: PublicKey,
  disputeWindowSecs: number,
): boolean {
  return (
    existing.reporter.equals(reporter) &&
    existing.finalizer.equals(finalizer) &&
    existing.challenger.equals(challenger) &&
    existing.disputeWindowSecs.toNumber() === disputeWindowSecs
  );
}

function marketStateMatches(
  existing: MarketConfigAccount,
  authority: PublicKey,
  marketOperator: PublicKey,
  treasury: PublicKey,
  marketMaker: PublicKey,
): boolean {
  return (
    existing.authority.equals(authority) &&
    existing.marketOperator.equals(marketOperator) &&
    existing.treasury.equals(treasury) &&
    existing.marketMaker.equals(marketMaker) &&
    existing.tradeTreasuryFeeBps === DEFAULT_TRADE_TREASURY_FEE_BPS &&
    existing.tradeMarketMakerFeeBps === DEFAULT_TRADE_MM_FEE_BPS &&
    existing.winningsMarketMakerFeeBps === DEFAULT_WINNINGS_MM_FEE_BPS
  );
}

function ammStateMatches(
  existing: AmmConfigAccount,
  authority: PublicKey,
  treasury: PublicKey,
  marketMaker: PublicKey,
  fightOracleProgram: PublicKey,
  feeBps: number,
): boolean {
  return (
    existing.authority.equals(authority) &&
    existing.treasury.equals(treasury) &&
    existing.marketMaker.equals(marketMaker) &&
    existing.fightOracleProgram.equals(fightOracleProgram) &&
    existing.feeBps === feeBps
  );
}

function perpsStateMatches(
  existing: PerpsConfigAccount,
  authority: PublicKey,
  keeperAuthority: PublicKey,
  treasuryAuthority: PublicKey,
  marketMakerAuthority: PublicKey,
  config: PerpsLaunchConfig,
): boolean {
  return (
    existing.authority.equals(authority) &&
    existing.keeperAuthority.equals(keeperAuthority) &&
    existing.treasuryAuthority.equals(treasuryAuthority) &&
    existing.marketMakerAuthority.equals(marketMakerAuthority) &&
    existing.defaultSkewScale.toNumber() === config.defaultSkewScale &&
    existing.defaultFundingVelocity.toNumber() ===
      config.defaultFundingVelocity &&
    existing.maxOracleStalenessSeconds.toNumber() ===
      config.maxOracleStalenessSeconds &&
    existing.minOracleSpotIndex.toNumber() === config.minOracleSpotIndex &&
    existing.maxOracleSpotIndex.toNumber() === config.maxOracleSpotIndex &&
    existing.maxOraclePriceDeltaBps === config.maxOraclePriceDeltaBps &&
    existing.maxLeverage.toNumber() === config.maxLeverage &&
    existing.minMarginLamports.toNumber() === config.minMarginLamports &&
    existing.maxMarketOpenInterest.toNumber() ===
      config.maxMarketOpenInterest &&
    existing.minMarketInsuranceLamports.toNumber() ===
      config.minMarketInsuranceLamports &&
    existing.maintenanceMarginBps === config.maintenanceMarginBps &&
    existing.liquidationFeeBps === config.liquidationFeeBps &&
    existing.tradeTreasuryFeeBps === config.tradeTreasuryFeeBps &&
    existing.tradeMarketMakerFeeBps === config.tradeMarketMakerFeeBps
  );
}

async function ensureOracleConfig(
  program: Program,
  authority: Keypair,
  disputeWindowSecs: number,
): Promise<PublicKey> {
  const { reporter, finalizer, challenger } = resolveOracleRoleKeys(
    authority.publicKey,
  );
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const accountManager = program.account.oracleConfig as unknown as {
    fetchNullable: (address: PublicKey) => Promise<OracleConfigAccount | null>;
  };
  const existing = await accountManager.fetchNullable(oracleConfig);
  if (!existing) {
    await program.methods
      .initializeOracle(
        reporter,
        finalizer,
        challenger,
        new BN(disputeWindowSecs),
      )
      .accountsPartial({
        authority: authority.publicKey,
        oracleConfig,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return oracleConfig;
  }

  if (existing.configFrozen) return oracleConfig;

  if (oracleStateMatches(existing, reporter, finalizer, challenger, disputeWindowSecs)) {
    return oracleConfig;
  }

  await program.methods
    .updateOracleConfig(
      authority.publicKey,
      reporter,
      finalizer,
      challenger,
      new BN(disputeWindowSecs),
    )
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig,
    })
    .signers([authority])
    .rpc();
  return oracleConfig;
}

async function ensureMarketConfig(
  program: Program,
  authority: Keypair,
): Promise<PublicKey> {
  const { marketOperator, treasury, marketMaker } = resolveMarketRoleKeys(
    authority.publicKey,
  );
  const config = deriveMarketConfigPda(program.programId);
  const accountManager = program.account.marketConfig as unknown as {
    fetchNullable: (address: PublicKey) => Promise<MarketConfigAccount | null>;
  };
  const existing = await accountManager.fetchNullable(config);
  if (!existing) {
    await program.methods
      .initializeConfig(
        marketOperator,
        treasury,
        marketMaker,
        DEFAULT_TRADE_TREASURY_FEE_BPS,
        DEFAULT_TRADE_MM_FEE_BPS,
        DEFAULT_WINNINGS_MM_FEE_BPS,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return config;
  }

  if (existing.configFrozen) return config;

  if (marketStateMatches(existing, authority.publicKey, marketOperator, treasury, marketMaker)) {
    return config;
  }

  await program.methods
    .updateConfig(
      authority.publicKey,
      marketOperator,
      treasury,
      marketMaker,
      DEFAULT_TRADE_TREASURY_FEE_BPS,
      DEFAULT_TRADE_MM_FEE_BPS,
      DEFAULT_WINNINGS_MM_FEE_BPS,
    )
    .accountsPartial({
      authority: authority.publicKey,
      config,
    })
    .signers([authority])
    .rpc();
  return config;
}

async function ensureAmmAdmin(
  program: Program,
  authority: Keypair,
): Promise<PublicKey> {
  const adminState = deriveAmmAdminPda(program.programId);
  const accountManager = program.account as unknown as {
    admin: {
      fetchNullable: (address: PublicKey) => Promise<AmmAdminAccount | null>;
    };
  };
  const existing = await accountManager.admin.fetchNullable(adminState);
  if (!existing) {
    await program.methods
      .initialize()
      .accountsPartial({
        adminState,
        signer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }
  return adminState;
}

async function ensureAmmConfig(
  program: Program,
  authority: Keypair,
  fightOracleProgramId: PublicKey,
): Promise<PublicKey> {
  const { treasury, marketMaker } = resolveAmmRoleKeys(authority.publicKey);
  const feeBps = integerEnv("SOLANA_AMM_FEE_BPS", DEFAULT_AMM_FEE_BPS, 0);
  const ammConfig = deriveAmmConfigPda(program.programId);
  const accountManager = program.account as unknown as {
    ammConfig: {
      fetchNullable: (address: PublicKey) => Promise<AmmConfigAccount | null>;
    };
  };
  const existing = await accountManager.ammConfig.fetchNullable(ammConfig);

  if (!existing) {
    await program.methods
      .initializeConfig(treasury, marketMaker, fightOracleProgramId, feeBps)
      .accountsPartial({
        ammConfig,
        signer: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return ammConfig;
  }

  if (
    !ammStateMatches(
      existing,
      authority.publicKey,
      treasury,
      marketMaker,
      fightOracleProgramId,
      feeBps,
    )
  ) {
    throw new Error(
      `Existing AMM config ${ammConfig.toBase58()} does not match the launch configuration and cannot be updated in-place`,
    );
  }

  return ammConfig;
}

async function ensurePerpsConfig(
  program: Program,
  authority: Keypair,
  configValues: PerpsLaunchConfig,
): Promise<PublicKey> {
  const { keeperAuthority, treasuryAuthority, marketMakerAuthority } =
    resolvePerpsRoleKeys(authority.publicKey);
  const config = derivePerpsConfigPda(program.programId);
  const accountManager = program.account.configState as unknown as {
    fetchNullable: (address: PublicKey) => Promise<PerpsConfigAccount | null>;
  };
  const existing = await accountManager.fetchNullable(config);

  if (!existing) {
    await program.methods
      .initializeConfig(
        keeperAuthority,
        treasuryAuthority,
        marketMakerAuthority,
        toBn(configValues.defaultSkewScale),
        toBn(configValues.defaultFundingVelocity),
        new BN(configValues.maxOracleStalenessSeconds),
        toBn(configValues.minOracleSpotIndex),
        toBn(configValues.maxOracleSpotIndex),
        configValues.maxOraclePriceDeltaBps,
        toBn(configValues.maxLeverage),
        toBn(configValues.minMarginLamports),
        toBn(configValues.maxMarketOpenInterest),
        toBn(configValues.minMarketInsuranceLamports),
        configValues.maintenanceMarginBps,
        configValues.liquidationFeeBps,
        configValues.tradeTreasuryFeeBps,
        configValues.tradeMarketMakerFeeBps,
      )
      .accountsPartial({
        config,
        authority: authority.publicKey,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return config;
  }

  if (
    perpsStateMatches(
      existing,
      authority.publicKey,
      keeperAuthority,
      treasuryAuthority,
      marketMakerAuthority,
      configValues,
    )
  ) {
    return config;
  }

  if (existing.configFrozen) {
    throw new Error(
      `Existing perps config ${config.toBase58()} is frozen but does not match the launch configuration`,
    );
  }

  await program.methods
    .updateConfig(
      keeperAuthority,
      treasuryAuthority,
      marketMakerAuthority,
      toBn(configValues.defaultSkewScale),
      toBn(configValues.defaultFundingVelocity),
      new BN(configValues.maxOracleStalenessSeconds),
      toBn(configValues.minOracleSpotIndex),
      toBn(configValues.maxOracleSpotIndex),
      configValues.maxOraclePriceDeltaBps,
      toBn(configValues.maxLeverage),
      toBn(configValues.minMarginLamports),
      toBn(configValues.maxMarketOpenInterest),
      toBn(configValues.minMarketInsuranceLamports),
      configValues.maintenanceMarginBps,
      configValues.liquidationFeeBps,
      configValues.tradeTreasuryFeeBps,
      configValues.tradeMarketMakerFeeBps,
    )
    .accountsPartial({
      config,
      authority: authority.publicKey,
    })
    .signers([authority])
    .rpc();
  return config;
}

async function maybeFreezeOracle(
  program: Program,
  authority: Keypair,
  oracleConfig: PublicKey,
): Promise<string | null> {
  const accountManager = program.account.oracleConfig as unknown as {
    fetch: (address: PublicKey) => Promise<OracleConfigAccount>;
  };
  const account = await accountManager.fetch(oracleConfig);
  if (account.configFrozen) return null;
  return program.methods
    .freezeOracleConfig()
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig,
    })
    .signers([authority])
    .rpc();
}

async function maybeFreezeMarket(
  program: Program,
  authority: Keypair,
  config: PublicKey,
): Promise<string | null> {
  const accountManager = program.account.marketConfig as unknown as {
    fetch: (address: PublicKey) => Promise<MarketConfigAccount>;
  };
  const account = await accountManager.fetch(config);
  if (account.configFrozen) return null;
  return program.methods
    .freezeConfig()
    .accountsPartial({
      authority: authority.publicKey,
      config,
    })
    .signers([authority])
    .rpc();
}

async function maybeFreezeAmm(
  program: Program,
  authority: Keypair,
  ammConfig: PublicKey,
): Promise<string | null> {
  const accountManager = program.account as unknown as {
    ammConfig: {
      fetch: (address: PublicKey) => Promise<AmmConfigAccount>;
    };
  };
  const account = await accountManager.ammConfig.fetch(ammConfig);
  if (account.configFrozen) return null;
  return program.methods
    .freezeConfig()
    .accountsPartial({
      ammConfig,
      signer: authority.publicKey,
    })
    .signers([authority])
    .rpc();
}

async function maybeFreezePerps(
  program: Program,
  authority: Keypair,
  config: PublicKey,
): Promise<string | null> {
  const accountManager = program.account.configState as unknown as {
    fetch: (address: PublicKey) => Promise<PerpsConfigAccount>;
  };
  const account = await accountManager.fetch(config);
  if (account.configFrozen) return null;
  return program.methods
    .freezeConfig()
    .accountsPartial({
      config,
      authority: authority.publicKey,
    })
    .signers([authority])
    .rpc();
}

async function main(): Promise<void> {
  if (hasFlag("--help")) usage();

  const cluster = parseCluster();
  const pmOnly = hasFlag("--pm-only");
  const freeze = hasFlag("--freeze");
  const outPath = parseArg("--out");
  const disputeWindowSecs = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  if (!Number.isFinite(disputeWindowSecs) || disputeWindowSecs <= 0) {
    throw new Error(
      `Invalid DISPUTE_WINDOW_SECONDS '${process.env.DISPUTE_WINDOW_SECONDS ?? ""}'`,
    );
  }
  if (disputeWindowSecs < 60) {
    throw new Error(
      `DISPUTE_WINDOW_SECONDS must be >= 60 (on-chain fight_oracle minimum); got ${disputeWindowSecs}`,
    );
  }

  const walletPath = resolveWalletPath();
  const authority = readKeypair(walletPath);
  const rpcUrl = resolveRpcUrl(cluster);
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(authority),
    { commitment: "confirmed" },
  );

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(__dirname, "..");
  const anchorRoot = path.join(packageRoot, "anchor");
  const deployment = resolveBettingSolanaDeployment(cluster);
  const oracleProgramId = new PublicKey(deployment.fightOracleProgramId);
  const clobProgramId = new PublicKey(deployment.goldClobMarketProgramId);

  const oracleProgram = new Program(
    loadIdlWithAddress(
      path.join(anchorRoot, "target", "idl", "fight_oracle.json"),
      oracleProgramId,
    ),
    provider,
  );
  const clobProgram = new Program(
    loadIdlWithAddress(
      path.join(anchorRoot, "target", "idl", "gold_clob_market.json"),
      clobProgramId,
    ),
    provider,
  );

  const oracleConfig = await ensureOracleConfig(
    oracleProgram,
    authority,
    disputeWindowSecs,
  );
  const marketConfig = await ensureMarketConfig(clobProgram, authority);
  const freezeOracleTx = freeze
    ? await maybeFreezeOracle(oracleProgram, authority, oracleConfig)
    : null;
  const freezeMarketTx = freeze
    ? await maybeFreezeMarket(clobProgram, authority, marketConfig)
    : null;

  const oracleAccount = await (
    oracleProgram.account.oracleConfig as unknown as {
      fetch: (address: PublicKey) => Promise<OracleConfigAccount>;
    }
  ).fetch(oracleConfig);
  const marketAccount = await (
    clobProgram.account.marketConfig as unknown as {
      fetch: (address: PublicKey) => Promise<MarketConfigAccount>;
    }
  ).fetch(marketConfig);

  let ammSummary: Record<string, unknown> | null = null;
  let perpsSummary: Record<string, unknown> | null = null;

  if (!pmOnly) {
    const ammProgramId = new PublicKey(deployment.goldAmmMarketProgramId);
    const perpsProgramId = new PublicKey(deployment.goldPerpsMarketProgramId);
    const ammProgram = new Program(
      loadIdlWithAddress(
        path.join(anchorRoot, "target", "idl", "lvr_amm.json"),
        ammProgramId,
      ),
      provider,
    );
    const perpsProgram = new Program(
      loadIdlWithAddress(
        path.join(anchorRoot, "target", "idl", "gold_perps_market.json"),
        perpsProgramId,
      ),
      provider,
    );

    const adminState = await ensureAmmAdmin(ammProgram, authority);
    const ammConfig = await ensureAmmConfig(
      ammProgram,
      authority,
      oracleProgramId,
    );
    const perpsConfigValues = resolvePerpsLaunchConfig();
    const perpsConfig = await ensurePerpsConfig(
      perpsProgram,
      authority,
      perpsConfigValues,
    );
    const freezeAmmTx = freeze
      ? await maybeFreezeAmm(ammProgram, authority, ammConfig)
      : null;
    const freezePerpsTx = freeze
      ? await maybeFreezePerps(perpsProgram, authority, perpsConfig)
      : null;
    const adminAccount = await (
      ammProgram.account as unknown as {
        admin: {
          fetch: (address: PublicKey) => Promise<AmmAdminAccount>;
        };
      }
    ).admin.fetch(adminState);
    const ammAccount = await (
      ammProgram.account as unknown as {
        ammConfig: {
          fetch: (address: PublicKey) => Promise<AmmConfigAccount>;
        };
      }
    ).ammConfig.fetch(ammConfig);
    const perpsAccount = await (
      perpsProgram.account.configState as unknown as {
        fetch: (address: PublicKey) => Promise<PerpsConfigAccount>;
      }
    ).fetch(perpsConfig);

    ammSummary = {
      goldAmmProgramId: ammProgramId.toBase58(),
      adminState: adminState.toBase58(),
      ammConfig: ammConfig.toBase58(),
      freezeAmmTx,
      adminStateValue: {
        admin: adminAccount.admin.toBase58(),
        isInitialized: adminAccount.isInitialized,
      },
      ammConfigState: {
        authority: ammAccount.authority.toBase58(),
        treasury: ammAccount.treasury.toBase58(),
        marketMaker: ammAccount.marketMaker.toBase58(),
        fightOracleProgram: ammAccount.fightOracleProgram.toBase58(),
        feeBps: ammAccount.feeBps,
        paused: ammAccount.paused,
        configFrozen: ammAccount.configFrozen,
      },
    };

    perpsSummary = {
      goldPerpsProgramId: perpsProgramId.toBase58(),
      perpsConfig: perpsConfig.toBase58(),
      freezePerpsTx,
      perpsConfigState: {
        authority: perpsAccount.authority.toBase58(),
        keeperAuthority: perpsAccount.keeperAuthority.toBase58(),
        treasuryAuthority: perpsAccount.treasuryAuthority.toBase58(),
        marketMakerAuthority: perpsAccount.marketMakerAuthority.toBase58(),
        defaultSkewScale: perpsAccount.defaultSkewScale.toString(),
        defaultFundingVelocity:
          perpsAccount.defaultFundingVelocity.toString(),
        maxOracleStalenessSeconds:
          perpsAccount.maxOracleStalenessSeconds.toString(),
        minOracleSpotIndex: perpsAccount.minOracleSpotIndex.toString(),
        maxOracleSpotIndex: perpsAccount.maxOracleSpotIndex.toString(),
        maxOraclePriceDeltaBps: perpsAccount.maxOraclePriceDeltaBps,
        maxLeverage: perpsAccount.maxLeverage.toString(),
        minMarginLamports: perpsAccount.minMarginLamports.toString(),
        maxMarketOpenInterest:
          perpsAccount.maxMarketOpenInterest.toString(),
        minMarketInsuranceLamports:
          perpsAccount.minMarketInsuranceLamports.toString(),
        maintenanceMarginBps: perpsAccount.maintenanceMarginBps,
        liquidationFeeBps: perpsAccount.liquidationFeeBps,
        tradeTreasuryFeeBps: perpsAccount.tradeTreasuryFeeBps,
        tradeMarketMakerFeeBps: perpsAccount.tradeMarketMakerFeeBps,
        paused: perpsAccount.paused,
        configFrozen: perpsAccount.configFrozen,
      },
    };
  }

  const summary = {
    cluster,
    scope: pmOnly ? "pm-only" : "full-product",
    rpcUrl,
    authority: authority.publicKey.toBase58(),
    freezeRequested: freeze,
    oracleProgramId: oracleProgramId.toBase58(),
    goldClobProgramId: clobProgramId.toBase58(),
    oracleConfig: oracleConfig.toBase58(),
    marketConfig: marketConfig.toBase58(),
    freezeOracleTx,
    freezeMarketTx,
    oracleState: {
      authority: oracleAccount.authority.toBase58(),
      reporter: oracleAccount.reporter.toBase58(),
      finalizer: oracleAccount.finalizer.toBase58(),
      challenger: oracleAccount.challenger.toBase58(),
      disputeWindowSecs: oracleAccount.disputeWindowSecs.toString(),
      paused: oracleAccount.paused,
      configFrozen: oracleAccount.configFrozen,
    },
    marketState: {
      authority: marketAccount.authority.toBase58(),
      marketOperator: marketAccount.marketOperator.toBase58(),
      treasury: marketAccount.treasury.toBase58(),
      marketMaker: marketAccount.marketMaker.toBase58(),
      tradeTreasuryFeeBps: marketAccount.tradeTreasuryFeeBps,
      tradeMarketMakerFeeBps: marketAccount.tradeMarketMakerFeeBps,
      winningsMarketMakerFeeBps: marketAccount.winningsMarketMakerFeeBps,
      orderPlacementPaused: marketAccount.orderPlacementPaused,
      marketCreationPaused: marketAccount.marketCreationPaused,
      configFrozen: marketAccount.configFrozen,
    },
    amm: ammSummary,
    perps: perpsSummary,
  };

  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
