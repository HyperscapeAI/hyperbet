import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";

import {
  resolveBettingSolanaDeployment,
  type BettingSolanaCluster,
} from "../deployments";
import { resolveStageAWalletPath } from "./stage-a-identity";

const execFile = promisify(execFileCb);

interface OracleConfigAccount {
  authority: PublicKey;
  reporter: PublicKey;
  finalizer: PublicKey;
  challenger: PublicKey;
  disputeWindowSecs: anchor.BN;
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
  defaultSkewScale: anchor.BN;
  defaultFundingVelocity: anchor.BN;
  maxOracleStalenessSeconds: anchor.BN;
  minOracleSpotIndex: anchor.BN;
  maxOracleSpotIndex: anchor.BN;
  maxOraclePriceDeltaBps: number;
  maxLeverage: anchor.BN;
  minMarginLamports: anchor.BN;
  maxMarketOpenInterest: anchor.BN;
  minMarketInsuranceLamports: anchor.BN;
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

function usage(): never {
  console.log(
    "usage: node --import tsx packages/hyperbet-solana/scripts/verify-deployment.ts [--cluster devnet|testnet|mainnet-beta|localnet] [--pm-only] [--out <path>]",
  );
  process.exit(0);
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

function resolveRpcUrl(cluster: BettingSolanaCluster): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(cluster === "mainnet-beta" ? "mainnet-beta" : cluster);
}

function resolveWalletPath(): string | null {
  return resolveStageAWalletPath();
}

function readKeypairPubkey(filepath: string): PublicKey {
  const raw = JSON.parse(fs.readFileSync(filepath, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey;
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

function appendCheck(
  ok: boolean,
  message: string,
  failures: Array<string>,
  warnings: Array<string>,
  warning = false,
): void {
  const prefix = ok ? "[ok]" : warning ? "[warn]" : "[fail]";
  console.log(`${prefix} ${message}`);
  if (ok) return;
  if (warning) warnings.push(message);
  else failures.push(message);
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

function integerEnv(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
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

async function readUpgradeAuthority(
  programId: string,
  cluster: BettingSolanaCluster,
  walletPath: string | null,
): Promise<string | null> {
  try {
    const args = ["program", "show", "--url", cluster];
    if (walletPath) {
      args.push("--keypair", walletPath);
    }
    args.push(programId);
    const { stdout } = await execFile("solana", args, { env: process.env });
    const match = stdout.match(/Authority:\s+([1-9A-HJ-NP-Za-km-z]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (hasFlag("--help")) usage();

  const cluster = parseCluster();
  const pmOnly = hasFlag("--pm-only");
  const outPath = parseArg("--out");
  const walletPath = resolveWalletPath();
  const expectedDisputeWindow = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  const walletAuthority = walletPath ? readKeypairPubkey(walletPath) : null;
  const expectedAuthorityRaw =
    process.env.SOLANA_EXPECTED_AUTHORITY?.trim() ||
    walletAuthority?.toBase58() ||
    null;
  const expectedUpgradeAuthority =
    process.env.SOLANA_EXPECTED_UPGRADE_AUTHORITY?.trim() ||
    walletAuthority?.toBase58() ||
    null;
  const expectedAmmFeeBps = integerEnv("SOLANA_AMM_FEE_BPS", 200, 0);
  const expectedAuthority = expectedAuthorityRaw
    ? new PublicKey(expectedAuthorityRaw)
    : null;

  const deployment = resolveBettingSolanaDeployment(cluster);
  const rpcUrl = resolveRpcUrl(cluster);
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const dummyWallet = new anchor.Wallet(anchor.web3.Keypair.generate());
  const provider = new anchor.AnchorProvider(connection, dummyWallet, {
    commitment: "confirmed",
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(__dirname, "..");
  const anchorRoot = path.join(packageRoot, "anchor");

  const failures: Array<string> = [];
  const warnings: Array<string> = [];

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

  const oracleProgramInfo = await connection.getAccountInfo(oracleProgramId);
  appendCheck(
    oracleProgramInfo !== null && oracleProgramInfo.executable,
    `fight_oracle program is deployed at ${oracleProgramId.toBase58()}`,
    failures,
    warnings,
  );

  const clobProgramInfo = await connection.getAccountInfo(clobProgramId);
  appendCheck(
    clobProgramInfo !== null && clobProgramInfo.executable,
    `gold_clob_market program is deployed at ${clobProgramId.toBase58()}`,
    failures,
    warnings,
  );

  const oracleConfigPda = deriveOracleConfigPda(oracleProgramId);
  const marketConfigPda = deriveMarketConfigPda(clobProgramId);
  const oracleConfig = await (
    oracleProgram.account.oracleConfig as unknown as {
      fetchNullable: (address: PublicKey) => Promise<OracleConfigAccount | null>;
    }
  ).fetchNullable(oracleConfigPda);
  const marketConfig = await (
    clobProgram.account.marketConfig as unknown as {
      fetchNullable: (address: PublicKey) => Promise<MarketConfigAccount | null>;
    }
  ).fetchNullable(marketConfigPda);

  appendCheck(
    oracleConfig !== null,
    `oracle config exists at ${oracleConfigPda.toBase58()}`,
    failures,
    warnings,
  );
  appendCheck(
    marketConfig !== null,
    `market config exists at ${marketConfigPda.toBase58()}`,
    failures,
    warnings,
  );

  if (oracleConfig) {
    appendCheck(
      Number(oracleConfig.disputeWindowSecs.toString()) === expectedDisputeWindow,
      `oracle dispute window is ${expectedDisputeWindow}`,
      failures,
      warnings,
    );
    appendCheck(
      oracleConfig.paused === false,
      "oracle config is not paused",
      failures,
      warnings,
    );
    appendCheck(
      oracleConfig.configFrozen === true,
      "oracle config is frozen",
      failures,
      warnings,
      pmOnly,
    );
    if (expectedAuthority) {
      appendCheck(
        oracleConfig.authority.equals(expectedAuthority),
        `oracle authority matches expected ${expectedAuthority.toBase58()}`,
        failures,
        warnings,
      );
    } else {
      appendCheck(
        oracleConfig.authority.toBase58().length > 0,
        `oracle authority is ${oracleConfig.authority.toBase58()}`,
        failures,
        warnings,
        true,
      );
    }
  }

  if (marketConfig) {
    appendCheck(
      marketConfig.tradeTreasuryFeeBps === 100,
      "market trade treasury fee bps is 100",
      failures,
      warnings,
    );
    appendCheck(
      marketConfig.tradeMarketMakerFeeBps === 100,
      "market trade market-maker fee bps is 100",
      failures,
      warnings,
    );
    appendCheck(
      marketConfig.winningsMarketMakerFeeBps === 200,
      "market winnings market-maker fee bps is 200",
      failures,
      warnings,
    );
    appendCheck(
      marketConfig.orderPlacementPaused === false,
      "market order placement is not paused",
      failures,
      warnings,
    );
    appendCheck(
      marketConfig.marketCreationPaused === false,
      "market creation is not paused",
      failures,
      warnings,
    );
    appendCheck(
      marketConfig.configFrozen === true,
      "market config is frozen",
      failures,
      warnings,
      pmOnly,
    );
    if (expectedAuthority) {
      appendCheck(
        marketConfig.authority.equals(expectedAuthority),
        `market config authority matches expected ${expectedAuthority.toBase58()}`,
        failures,
        warnings,
      );
    } else {
      appendCheck(
        marketConfig.authority.toBase58().length > 0,
        `market config authority is ${marketConfig.authority.toBase58()}`,
        failures,
        warnings,
        true,
      );
    }
  }

  const fightUpgradeAuthority = await readUpgradeAuthority(
    oracleProgramId.toBase58(),
    cluster,
    walletPath,
  );
  const clobUpgradeAuthority = await readUpgradeAuthority(
    clobProgramId.toBase58(),
    cluster,
    walletPath,
  );
  if (expectedUpgradeAuthority) {
    appendCheck(
      fightUpgradeAuthority === expectedUpgradeAuthority,
      `fight_oracle upgrade authority matches expected ${expectedUpgradeAuthority}`,
      failures,
      warnings,
    );
    appendCheck(
      clobUpgradeAuthority === expectedUpgradeAuthority,
      `gold_clob_market upgrade authority matches expected ${expectedUpgradeAuthority}`,
      failures,
      warnings,
    );
  } else {
    appendCheck(
      Boolean(fightUpgradeAuthority),
      `fight_oracle upgrade authority is ${fightUpgradeAuthority ?? "unavailable"}`,
      failures,
      warnings,
      true,
    );
    appendCheck(
      Boolean(clobUpgradeAuthority),
      `gold_clob_market upgrade authority is ${clobUpgradeAuthority ?? "unavailable"}`,
      failures,
      warnings,
      true,
    );
  }

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
    const ammProgramInfo = await connection.getAccountInfo(ammProgramId);
    const perpsProgramInfo = await connection.getAccountInfo(perpsProgramId);
    appendCheck(
      ammProgramInfo !== null && ammProgramInfo.executable,
      `lvr_amm program is deployed at ${ammProgramId.toBase58()}`,
      failures,
      warnings,
    );
    appendCheck(
      perpsProgramInfo !== null && perpsProgramInfo.executable,
      `gold_perps_market program is deployed at ${perpsProgramId.toBase58()}`,
      failures,
      warnings,
    );

    const ammAdminPda = deriveAmmAdminPda(ammProgramId);
    const ammConfigPda = deriveAmmConfigPda(ammProgramId);
    const perpsConfigPda = derivePerpsConfigPda(perpsProgramId);
    const ammAdmin = await (
      ammProgram.account as unknown as {
        admin: {
          fetchNullable: (address: PublicKey) => Promise<AmmAdminAccount | null>;
        };
      }
    ).admin.fetchNullable(ammAdminPda);
    const ammConfig = await (
      ammProgram.account as unknown as {
        ammConfig: {
          fetchNullable: (address: PublicKey) => Promise<AmmConfigAccount | null>;
        };
      }
    ).ammConfig.fetchNullable(ammConfigPda);
    const perpsConfig = await (
      perpsProgram.account.configState as unknown as {
        fetchNullable: (address: PublicKey) => Promise<PerpsConfigAccount | null>;
      }
    ).fetchNullable(perpsConfigPda);

    appendCheck(
      ammAdmin !== null,
      `amm admin state exists at ${ammAdminPda.toBase58()}`,
      failures,
      warnings,
    );
    appendCheck(
      ammConfig !== null,
      `amm config exists at ${ammConfigPda.toBase58()}`,
      failures,
      warnings,
    );
    appendCheck(
      perpsConfig !== null,
      `perps config exists at ${perpsConfigPda.toBase58()}`,
      failures,
      warnings,
    );

    if (ammAdmin) {
      appendCheck(
        ammAdmin.isInitialized === true,
        "amm admin state is initialized",
        failures,
        warnings,
      );
      if (expectedAuthority) {
        appendCheck(
          ammAdmin.admin.equals(expectedAuthority),
          `amm admin matches expected ${expectedAuthority.toBase58()}`,
          failures,
          warnings,
        );
      }
    }

    if (ammConfig) {
      const expectedAmmRoles = resolveAmmRoleKeys(
        expectedAuthority ?? ammConfig.authority,
      );
      appendCheck(
        ammConfig.authority.equals(expectedAuthority ?? ammConfig.authority),
        `amm authority is ${ammConfig.authority.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.treasury.equals(expectedAmmRoles.treasury),
        `amm treasury matches expected ${expectedAmmRoles.treasury.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.marketMaker.equals(expectedAmmRoles.marketMaker),
        `amm market maker matches expected ${expectedAmmRoles.marketMaker.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.fightOracleProgram.equals(oracleProgramId),
        `amm oracle program matches ${oracleProgramId.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.feeBps === expectedAmmFeeBps,
        `amm fee bps is ${expectedAmmFeeBps}`,
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.paused === false,
        "amm config is not paused",
        failures,
        warnings,
      );
      appendCheck(
        ammConfig.configFrozen === true,
        "amm config is frozen",
        failures,
        warnings,
      );
    }

    if (perpsConfig) {
      const expectedPerpsRoles = resolvePerpsRoleKeys(
        expectedAuthority ?? perpsConfig.authority,
      );
      const expectedPerpsConfig = resolvePerpsLaunchConfig();
      appendCheck(
        perpsConfig.authority.equals(expectedAuthority ?? perpsConfig.authority),
        `perps authority is ${perpsConfig.authority.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.keeperAuthority.equals(expectedPerpsRoles.keeperAuthority),
        `perps keeper matches expected ${expectedPerpsRoles.keeperAuthority.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.treasuryAuthority.equals(expectedPerpsRoles.treasuryAuthority),
        `perps treasury matches expected ${expectedPerpsRoles.treasuryAuthority.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.marketMakerAuthority.equals(
          expectedPerpsRoles.marketMakerAuthority,
        ),
        `perps market maker matches expected ${expectedPerpsRoles.marketMakerAuthority.toBase58()}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.defaultSkewScale.toNumber() ===
          expectedPerpsConfig.defaultSkewScale,
        `perps default skew scale is ${expectedPerpsConfig.defaultSkewScale}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.defaultFundingVelocity.toNumber() ===
          expectedPerpsConfig.defaultFundingVelocity,
        `perps default funding velocity is ${expectedPerpsConfig.defaultFundingVelocity}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maxOracleStalenessSeconds.toNumber() ===
          expectedPerpsConfig.maxOracleStalenessSeconds,
        `perps max oracle staleness seconds is ${expectedPerpsConfig.maxOracleStalenessSeconds}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.minOracleSpotIndex.toNumber() ===
          expectedPerpsConfig.minOracleSpotIndex,
        `perps min oracle spot index is ${expectedPerpsConfig.minOracleSpotIndex}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maxOracleSpotIndex.toNumber() ===
          expectedPerpsConfig.maxOracleSpotIndex,
        `perps max oracle spot index is ${expectedPerpsConfig.maxOracleSpotIndex}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maxOraclePriceDeltaBps ===
          expectedPerpsConfig.maxOraclePriceDeltaBps,
        `perps max oracle price delta bps is ${expectedPerpsConfig.maxOraclePriceDeltaBps}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maxLeverage.toNumber() === expectedPerpsConfig.maxLeverage,
        `perps max leverage is ${expectedPerpsConfig.maxLeverage}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.minMarginLamports.toNumber() ===
          expectedPerpsConfig.minMarginLamports,
        `perps min margin lamports is ${expectedPerpsConfig.minMarginLamports}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maxMarketOpenInterest.toNumber() ===
          expectedPerpsConfig.maxMarketOpenInterest,
        `perps max market open interest is ${expectedPerpsConfig.maxMarketOpenInterest}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.minMarketInsuranceLamports.toNumber() ===
          expectedPerpsConfig.minMarketInsuranceLamports,
        `perps min market insurance is ${expectedPerpsConfig.minMarketInsuranceLamports}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.maintenanceMarginBps ===
          expectedPerpsConfig.maintenanceMarginBps,
        `perps maintenance margin bps is ${expectedPerpsConfig.maintenanceMarginBps}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.liquidationFeeBps ===
          expectedPerpsConfig.liquidationFeeBps,
        `perps liquidation fee bps is ${expectedPerpsConfig.liquidationFeeBps}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.tradeTreasuryFeeBps ===
          expectedPerpsConfig.tradeTreasuryFeeBps,
        `perps trade treasury fee bps is ${expectedPerpsConfig.tradeTreasuryFeeBps}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.tradeMarketMakerFeeBps ===
          expectedPerpsConfig.tradeMarketMakerFeeBps,
        `perps trade market maker fee bps is ${expectedPerpsConfig.tradeMarketMakerFeeBps}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.paused === false,
        "perps config is not paused",
        failures,
        warnings,
      );
      appendCheck(
        perpsConfig.configFrozen === true,
        "perps config is frozen",
        failures,
        warnings,
      );
    }

    const ammUpgradeAuthority = await readUpgradeAuthority(
      ammProgramId.toBase58(),
      cluster,
      walletPath,
    );
    const perpsUpgradeAuthority = await readUpgradeAuthority(
      perpsProgramId.toBase58(),
      cluster,
      walletPath,
    );
    if (expectedUpgradeAuthority) {
      appendCheck(
        ammUpgradeAuthority === expectedUpgradeAuthority,
        `lvr_amm upgrade authority matches expected ${expectedUpgradeAuthority}`,
        failures,
        warnings,
      );
      appendCheck(
        perpsUpgradeAuthority === expectedUpgradeAuthority,
        `gold_perps_market upgrade authority matches expected ${expectedUpgradeAuthority}`,
        failures,
        warnings,
      );
    } else {
      appendCheck(
        Boolean(ammUpgradeAuthority),
        `lvr_amm upgrade authority is ${ammUpgradeAuthority ?? "unavailable"}`,
        failures,
        warnings,
        true,
      );
      appendCheck(
        Boolean(perpsUpgradeAuthority),
        `gold_perps_market upgrade authority is ${perpsUpgradeAuthority ?? "unavailable"}`,
        failures,
        warnings,
        true,
      );
    }

    ammSummary = {
      ammProgramId: ammProgramId.toBase58(),
      ammAdminPda: ammAdminPda.toBase58(),
      ammConfigPda: ammConfigPda.toBase58(),
      ammUpgradeAuthority,
    };
    perpsSummary = {
      perpsProgramId: perpsProgramId.toBase58(),
      perpsConfigPda: perpsConfigPda.toBase58(),
      perpsUpgradeAuthority,
    };
  }

  const summary = {
    cluster,
    scope: pmOnly ? "pm-only" : "full-product",
    rpcUrl,
    oracleProgramId: oracleProgramId.toBase58(),
    goldClobProgramId: clobProgramId.toBase58(),
    oracleConfigPda: oracleConfigPda.toBase58(),
    marketConfigPda: marketConfigPda.toBase58(),
    fightUpgradeAuthority,
    goldClobUpgradeAuthority: clobUpgradeAuthority,
    amm: ammSummary,
    perps: perpsSummary,
    failures,
    warnings,
  };

  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
