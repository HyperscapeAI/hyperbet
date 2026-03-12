import { createHash } from "node:crypto";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  buildQuotePlan,
  DEFAULT_MARKET_MAKER_CONFIG,
  evaluateQuoteDecision,
  type KeeperBotHealthSnapshot,
  type KeeperMarketHealthRecord,
  type KeeperRecoveryState,
  type MarketSnapshot,
  type QuotePlan,
} from "@hyperbet/mm-core";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  createPrograms,
  duelKeyHexToBytes,
  DUEL_WINNER_MARKET_KIND,
  enumIs,
  findClobVaultPda,
  findDuelStatePda,
  findMarketConfigPda,
  findMarketPda,
  findOracleConfigPda,
  findOrderPda,
  findPriceLevelPda,
  findUserBalancePda,
  SIDE_ASK,
  SIDE_BID,
  readKeypair,
  requireEnv,
} from "./common";
import { buildResultHash } from "./resultHash";

function asNum(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (value && typeof value === "object" && "toString" in value) {
    try {
      return BigInt((value as { toString: () => string }).toString());
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function clampPerpsOracleSpotIndex(
  nextSpotIndex: number,
  previousSpotIndex: number | null,
): number {
  const boundedSpotIndex = Math.min(
    PERPS_CONFIG_MAX_ORACLE_SPOT_INDEX,
    Math.max(PERPS_CONFIG_MIN_ORACLE_SPOT_INDEX, nextSpotIndex),
  );
  if (
    previousSpotIndex === null ||
    !Number.isFinite(previousSpotIndex) ||
    previousSpotIndex <= 0
  ) {
    return boundedSpotIndex;
  }

  const maxStepRatio = PERPS_CONFIG_MAX_ORACLE_PRICE_DELTA_BPS / 10_000;
  const minAllowed = Math.max(
    PERPS_CONFIG_MIN_ORACLE_SPOT_INDEX,
    previousSpotIndex * (1 - maxStepRatio),
  );
  const maxAllowed = Math.min(
    PERPS_CONFIG_MAX_ORACLE_SPOT_INDEX,
    previousSpotIndex * (1 + maxStepRatio),
  );
  return Math.min(maxAllowed, Math.max(minAllowed, boundedSpotIndex));
}

function hashParticipant(agent: { id?: string; name?: string } | null): number[] {
  const id = agent?.id ?? agent?.name ?? "unknown";
  return Array.from(createHash("sha256").update(id).digest());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTxSignature(error: unknown): string | null {
  const message = (error as Error)?.message ?? "";
  const match = message.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{32,88})/i);
  return match?.[1] ?? null;
}

function isIgnorableRaceError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return (
    message.includes("MarketNotOpen") ||
    message.includes("BettingClosed") ||
    message.includes("MarketAlreadyResolved") ||
    message.includes("OracleNotResolved") ||
    message.includes("MatchAlreadyResolved") ||
    message.includes("BetWindowStillOpen") ||
    message.includes("MarketAlreadyHasUserBets") ||
    message.includes("LiquidityAlreadySeeded") ||
    message.includes("SeedWindowNotReached")
  );
}

function isFundingError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes(
      "attempt to debit an account but found no record of a prior credit",
    ) ||
    message.includes("insufficient funds") ||
    message.includes("insufficient lamports") ||
    message.includes("fee payer")
  );
}

function isRpcConnectivityError(error: unknown): boolean {
  const message = ((error as Error)?.message ?? "").toLowerCase();
  return (
    message.includes("unable to connect") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    message.includes("connection reset") ||
    message.includes("network request failed") ||
    message.includes("timed out") ||
    message.includes("socket hang up")
  );
}

async function waitForTxBySignature(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status) {
      if (status.err) return false;
      if (status.confirmationStatus) return true;
    }
    await sleep(2_000);
  }
  return false;
}

async function runWithRecovery<T>(
  fn: () => Promise<T>,
  connection: Connection,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const signature = extractTxSignature(error);
    if (!signature) throw error;
    const ok = await waitForTxBySignature(connection, signature);
    if (!ok) throw error;
    return undefined as T;
  }
}

const args = await yargs(hideBin(process.argv))
  .option("once", {
    type: "boolean",
    default: process.env.BOT_LOOP !== "true",
    describe: "Run one cycle and exit",
  })
  .option("poll-seconds", {
    type: "number",
    default: Number(process.env.BOT_POLL_SECONDS || 5),
    describe: "Delay between loop cycles",
  })
  .option("bet-window-seconds", {
    type: "number",
    default: Number(process.env.BET_WINDOW_SECONDS || 300),
    describe: "Bet window for newly created rounds",
  })
  .option("auto-seed-delay-seconds", {
    type: "number",
    default: Number(process.env.AUTO_SEED_DELAY_SECONDS || 10),
    describe: "Auto-seed delay for new markets",
  })
  .option("seed-sol", {
    type: "number",
    default: Number(
      process.env.MARKET_MAKER_SEED_SOL ||
        process.env.MARKET_MAKER_SEED_GOLD ||
        1,
    ),
    describe: "Target seed SOL on each side",
  })
  .option("seed-gold", {
    type: "number",
    default: undefined,
    describe: "Deprecated alias for --seed-sol",
  })
  .option("fee-bps", {
    type: "number",
    default: undefined,
    describe: "Legacy total trade fee in basis points (deprecated)",
  })
  .option("trade-treasury-fee-bps", {
    type: "number",
    default: Number(process.env.TRADE_TREASURY_FEE_BPS || 100),
    describe: "Trade fee in basis points routed to treasury wallet",
  })
  .option("trade-market-maker-fee-bps", {
    type: "number",
    default: Number(process.env.TRADE_MARKET_MAKER_FEE_BPS || 100),
    describe: "Trade fee in basis points routed to market maker wallet",
  })
  .option("winnings-market-maker-fee-bps", {
    type: "number",
    default: Number(process.env.WINNINGS_MARKET_MAKER_FEE_BPS || 200),
    describe: "Winnings fee in basis points routed to market maker wallet",
  })
  .option("market-mint", {
    type: "string",
    default:
      process.env.MARKET_MINT || "So11111111111111111111111111111111111111112",
    describe: "Deprecated no-op; prediction markets settle in native SOL",
  })
  .option("game-url", {
    type: "string",
    default: process.env.GAME_URL || "http://localhost:3000",
    describe: "URL of the Hyperscape game server",
  })
  .strict()
  .parse();

import { type DuelLifecycleEvent, GameClient } from "./game-client";

import { Program } from "@coral-xyz/anchor";
import { type FightOracle } from "../../anchor/target/types/fight_oracle";
import { type GoldClobMarket } from "../../anchor/target/types/gold_clob_market";
import { type GoldPerpsMarket } from "../../anchor/target/types/gold_perps_market";
import {
  updateRatings,
  createInitialRating,
  type AgentRating,
} from "./trueskill";
import {
  calculateSyntheticSpotIndex,
  conservativeSkill,
  MAX_INDEX as MODEL_MARKET_MAX_INDEX,
  MIN_INDEX as MODEL_MARKET_MIN_INDEX,
  modelMarketIdFromCharacterId,
} from "./modelMarkets";
import {
  calculateMaintenanceMarginLamports,
  estimatePositionEquityLamports,
  resolveOracleMaxAgeSeconds,
} from "./perpsMath";
import path from "node:path";
import fs_node from "node:fs";
import {
  loadAgentRatings,
  loadPerpsMarkets,
  saveAgentRating,
  saveAgentRatings,
  savePerpsMarket,
  savePerpsOracleSnapshot,
  type DbPerpsMarketRecord,
  type DbPerpsMarketStatus,
} from "./db";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

function encodePerpsMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

function derivePerpsConfigPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    perpsProgram.programId,
  )[0];
}

function derivePerpsMarketPda(marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), encodePerpsMarketId(marketId)],
    perpsProgram.programId,
  )[0];
}

const botKeypair = readKeypair(
  process.env.BOT_KEYPAIR ||
    process.env.ORACLE_AUTHORITY_KEYPAIR ||
    process.env.MARKET_MAKER_KEYPAIR ||
    requireEnv("ORACLE_AUTHORITY_KEYPAIR"),
);
const { connection, provider, fightOracle, goldClobMarket, goldPerpsMarket } =
  createPrograms(botKeypair);
const fightProgram = fightOracle as unknown as Program<FightOracle>;
const marketProgram = goldClobMarket as unknown as Program<GoldClobMarket>;
const perpsProgram = goldPerpsMarket as unknown as Program<GoldPerpsMarket>;
type DuelStatusArg = Parameters<typeof fightProgram.methods.upsertDuel>[7];
type ReportWinnerArg = Parameters<typeof fightProgram.methods.reportResult>[1];

function hasProgramMethod(
  program: { methods?: Record<string, unknown> },
  method: string,
): boolean {
  return typeof program?.methods?.[method] === "function";
}

const RATINGS_FILE = path.resolve(__dirname, "agent_ratings.json");
const BOT_HEALTH_FILE = (
  process.env.KEEPER_BOT_HEALTH_FILE ||
  path.resolve(__dirname, "..", ".status", "keeper-bot-health.json")
).trim();
const MARKET_HEALTH_RETENTION_MS = Math.max(
  60_000,
  Number(process.env.KEEPER_MARKET_HEALTH_RETENTION_MS || 15 * 60_000),
);
let agentRatings: Record<string, AgentRating> = loadAgentRatings();
if (
  Object.keys(agentRatings).length === 0 &&
  fs_node.existsSync(RATINGS_FILE)
) {
  try {
    agentRatings = JSON.parse(fs_node.readFileSync(RATINGS_FILE, "utf8"));
    saveAgentRatings(agentRatings);
    console.log(
      `[Keeper] Migrated ${Object.keys(agentRatings).length} agent ratings from legacy JSON into SQLite`,
    );
  } catch (e) {
    console.error("Failed to load legacy ratings", e);
  }
}

function saveRatings() {
  saveAgentRatings(agentRatings);
}

function getRating(agentId: string): AgentRating {
  if (!agentRatings[agentId]) {
    agentRatings[agentId] = createInitialRating();
    saveAgentRating(agentId, agentRatings[agentId]);
  }
  return agentRatings[agentId];
}

// Perps oracle updates are disabled - the Gold Perps Market program is not deployed on devnet
// Set ENABLE_PERPS_ORACLE=true to re-enable once deployed
const PERPS_ORACLE_ENABLED = process.env.ENABLE_PERPS_ORACLE === "true";
const PERPS_LIQUIDATOR_ENABLED = process.env.ENABLE_PERPS_LIQUIDATOR
  ? process.env.ENABLE_PERPS_LIQUIDATOR === "true"
  : PERPS_ORACLE_ENABLED;
const PERPS_MAX_ORACLE_STALENESS_SECONDS = Math.max(
  10,
  Number(process.env.PERPS_MAX_ORACLE_STALENESS_SECONDS || 120),
);
const PERPS_CONFIG_MIN_ORACLE_SPOT_INDEX = Math.max(
  MODEL_MARKET_MIN_INDEX,
  Number(
    process.env.PERPS_MIN_ORACLE_SPOT_INDEX || String(MODEL_MARKET_MIN_INDEX),
  ),
);
const PERPS_CONFIG_MAX_ORACLE_SPOT_INDEX = Math.max(
  PERPS_CONFIG_MIN_ORACLE_SPOT_INDEX,
  Number(
    process.env.PERPS_MAX_ORACLE_SPOT_INDEX || String(MODEL_MARKET_MAX_INDEX),
  ),
);
const PERPS_CONFIG_MAX_ORACLE_PRICE_DELTA_BPS = Math.max(
  1,
  Number(process.env.PERPS_MAX_ORACLE_PRICE_DELTA_BPS || 2_500),
);
const PERPS_MARKET_STATUS_ACTIVE: DbPerpsMarketStatus = "ACTIVE";
const PERPS_MARKET_STATUS_CLOSE_ONLY: DbPerpsMarketStatus = "CLOSE_ONLY";
const PERPS_MARKET_STATUS_ARCHIVED: DbPerpsMarketStatus = "ARCHIVED";
const PERPS_CONFIG_DEFAULT_SKEW_SCALE_SOL = Math.max(
  1,
  Number(process.env.PERPS_DEFAULT_SKEW_SCALE_SOL || 100),
);
const PERPS_CONFIG_DEFAULT_FUNDING_VELOCITY = Math.max(
  1,
  Number(process.env.PERPS_DEFAULT_FUNDING_VELOCITY || 1_000),
);
const PERPS_CONFIG_MAX_LEVERAGE = Math.max(
  1,
  Number(process.env.PERPS_MAX_LEVERAGE || 5),
);
const PERPS_CONFIG_MIN_MARGIN_SOL = Math.max(
  0.001,
  Number(process.env.PERPS_MIN_MARGIN_SOL || 0.01),
);
const PERPS_CONFIG_MAX_MARKET_OI_SOL = Math.max(
  PERPS_CONFIG_MIN_MARGIN_SOL,
  Number(process.env.PERPS_MAX_MARKET_OI_SOL || 25),
);
const PERPS_CONFIG_MAINTENANCE_MARGIN_BPS = Math.max(
  1,
  Number(process.env.PERPS_MAINTENANCE_MARGIN_BPS || 500),
);
const PERPS_CONFIG_LIQUIDATION_FEE_BPS = Math.max(
  0,
  Number(process.env.PERPS_LIQUIDATION_FEE_BPS || 100),
);
const PERPS_TRADE_TREASURY_FEE_BPS = Math.max(
  0,
  Number(process.env.PERPS_TRADE_TREASURY_FEE_BPS || 25),
);
const PERPS_TRADE_MARKET_MAKER_FEE_BPS = Math.max(
  0,
  Number(process.env.PERPS_TRADE_MARKET_MAKER_FEE_BPS || 25),
);
const PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL = Math.max(
  0,
  Number(process.env.PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL || 12),
);
const PERPS_CONFIG_MIN_MARKET_INSURANCE_SOL = Math.max(
  0.001,
  Number(
    process.env.PERPS_MIN_MARKET_INSURANCE_SOL ||
      process.env.PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL ||
      12,
  ),
);
const PERPS_MARKET_DEPRECATION_MS = Math.max(
  60_000,
  Number(process.env.PERPS_MARKET_DEPRECATION_MS || 5 * 60 * 1000),
);
const PERPS_MARKET_MAKER_RECYCLE_ENABLED =
  process.env.ENABLE_PERPS_MARKET_MAKER_RECYCLE !== "false";
const PERPS_MARKET_MAKER_RECYCLE_MIN_SOL = Math.max(
  0,
  Number(process.env.PERPS_MARKET_MAKER_RECYCLE_MIN_SOL || 0.25),
);

if (PERPS_ORACLE_ENABLED && !PERPS_LIQUIDATOR_ENABLED) {
  console.warn(
    "[Keeper] ENABLE_PERPS_ORACLE=true while liquidations are disabled. Open positions can become unserviceable without an active liquidator.",
  );
}

if (
  PERPS_ORACLE_ENABLED &&
  (PERPS_CONFIG_DEFAULT_SKEW_SCALE_SOL > 10_000 ||
    PERPS_CONFIG_DEFAULT_FUNDING_VELOCITY > 100_000 ||
    PERPS_CONFIG_DEFAULT_FUNDING_VELOCITY < 10)
) {
  console.warn(
    `[Keeper] Perps defaults are extremely soft (skewScale=${PERPS_CONFIG_DEFAULT_SKEW_SCALE_SOL} SOL, fundingVelocity=${PERPS_CONFIG_DEFAULT_FUNDING_VELOCITY}). Check env overrides before launch.`,
  );
}

if (
  PERPS_ORACLE_ENABLED &&
  PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL < PERPS_CONFIG_MIN_MARKET_INSURANCE_SOL
) {
  console.warn(
    `[Keeper] Bootstrap insurance (${PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL} SOL) is below the on-chain minimum insurance gate (${PERPS_CONFIG_MIN_MARKET_INSURANCE_SOL} SOL). New OI will be rejected until insurance is topped up.`,
  );
}

function lamportsBnFromSol(solAmount: number): BN {
  return new BN(Math.round(solAmount * LAMPORTS_PER_SOL));
}

async function ensurePerpsConfigReady(): Promise<void> {
  if (!PERPS_ORACLE_ENABLED && !PERPS_LIQUIDATOR_ENABLED) {
    return;
  }

  const configPda = derivePerpsConfigPda();
  const existingConfig =
    await perpsProgram.account.configState.fetchNullable(configPda);
  const expectedConfig = {
    keeperAuthority: botKeypair.publicKey,
    treasuryAuthority: configuredPerpsTreasuryWallet,
    marketMakerAuthority: configuredPerpsMarketMakerWallet,
    defaultSkewScale: lamportsBnFromSol(PERPS_CONFIG_DEFAULT_SKEW_SCALE_SOL),
    defaultFundingVelocity: new BN(PERPS_CONFIG_DEFAULT_FUNDING_VELOCITY),
    maxOracleStalenessSeconds: new BN(PERPS_MAX_ORACLE_STALENESS_SECONDS),
    minOracleSpotIndex: lamportsBnFromSol(PERPS_CONFIG_MIN_ORACLE_SPOT_INDEX),
    maxOracleSpotIndex: lamportsBnFromSol(PERPS_CONFIG_MAX_ORACLE_SPOT_INDEX),
    maxOraclePriceDeltaBps: PERPS_CONFIG_MAX_ORACLE_PRICE_DELTA_BPS,
    maxLeverage: new BN(PERPS_CONFIG_MAX_LEVERAGE),
    minMarginLamports: lamportsBnFromSol(PERPS_CONFIG_MIN_MARGIN_SOL),
    maxMarketOpenInterest: lamportsBnFromSol(PERPS_CONFIG_MAX_MARKET_OI_SOL),
    minMarketInsuranceLamports: lamportsBnFromSol(
      PERPS_CONFIG_MIN_MARKET_INSURANCE_SOL,
    ),
    maintenanceMarginBps: PERPS_CONFIG_MAINTENANCE_MARGIN_BPS,
    liquidationFeeBps: PERPS_CONFIG_LIQUIDATION_FEE_BPS,
    tradeTreasuryFeeBps: PERPS_TRADE_TREASURY_FEE_BPS,
    tradeMarketMakerFeeBps: PERPS_TRADE_MARKET_MAKER_FEE_BPS,
  };

  if (!existingConfig) {
    await runWithRecovery(
      () =>
        perpsProgram.methods
          .initializeConfig(
            expectedConfig.keeperAuthority,
            expectedConfig.treasuryAuthority,
            expectedConfig.marketMakerAuthority,
            expectedConfig.defaultSkewScale,
            expectedConfig.defaultFundingVelocity,
            expectedConfig.maxOracleStalenessSeconds,
            expectedConfig.minOracleSpotIndex,
            expectedConfig.maxOracleSpotIndex,
            expectedConfig.maxOraclePriceDeltaBps,
            expectedConfig.maxLeverage,
            expectedConfig.minMarginLamports,
            expectedConfig.maxMarketOpenInterest,
            expectedConfig.minMarketInsuranceLamports,
            expectedConfig.maintenanceMarginBps,
            expectedConfig.liquidationFeeBps,
            expectedConfig.tradeTreasuryFeeBps,
            expectedConfig.tradeMarketMakerFeeBps,
          )
          .accountsPartial({
            config: configPda,
            authority: botKeypair.publicKey,
            program: perpsProgram.programId,
            programData: deriveProgramDataAddress(perpsProgram.programId),
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      connection,
    );

    console.log(`[Keeper] Initialized perps config ${configPda.toBase58()}`);
    return;
  }

  const configNeedsUpdate =
    !(existingConfig.keeperAuthority as PublicKey).equals(
      expectedConfig.keeperAuthority,
    ) ||
    !(existingConfig.treasuryAuthority as PublicKey).equals(
      expectedConfig.treasuryAuthority,
    ) ||
    !(existingConfig.marketMakerAuthority as PublicKey).equals(
      expectedConfig.marketMakerAuthority,
    ) ||
    asNum(existingConfig.defaultSkewScale) !==
      expectedConfig.defaultSkewScale.toNumber() ||
    asNum(existingConfig.defaultFundingVelocity) !==
      expectedConfig.defaultFundingVelocity.toNumber() ||
    asNum(existingConfig.maxOracleStalenessSeconds) !==
      expectedConfig.maxOracleStalenessSeconds.toNumber() ||
    asNum(existingConfig.minOracleSpotIndex) !==
      expectedConfig.minOracleSpotIndex.toNumber() ||
    asNum(existingConfig.maxOracleSpotIndex) !==
      expectedConfig.maxOracleSpotIndex.toNumber() ||
    asNum(existingConfig.maxOraclePriceDeltaBps) !==
      expectedConfig.maxOraclePriceDeltaBps ||
    asNum(existingConfig.maxLeverage) !== expectedConfig.maxLeverage.toNumber() ||
    asNum(existingConfig.minMarginLamports) !==
      expectedConfig.minMarginLamports.toNumber() ||
    asNum(existingConfig.maxMarketOpenInterest) !==
      expectedConfig.maxMarketOpenInterest.toNumber() ||
    asNum(existingConfig.minMarketInsuranceLamports) !==
      expectedConfig.minMarketInsuranceLamports.toNumber() ||
    asNum(existingConfig.maintenanceMarginBps) !==
      expectedConfig.maintenanceMarginBps ||
    asNum(existingConfig.liquidationFeeBps) !==
      expectedConfig.liquidationFeeBps ||
    asNum(existingConfig.tradeTreasuryFeeBps) !==
      expectedConfig.tradeTreasuryFeeBps ||
    asNum(existingConfig.tradeMarketMakerFeeBps) !==
      expectedConfig.tradeMarketMakerFeeBps;

  if (!configNeedsUpdate) {
    return;
  }

  await runWithRecovery(
    () =>
      perpsProgram.methods
        .updateConfig(
          expectedConfig.keeperAuthority,
          expectedConfig.treasuryAuthority,
          expectedConfig.marketMakerAuthority,
          expectedConfig.defaultSkewScale,
          expectedConfig.defaultFundingVelocity,
          expectedConfig.maxOracleStalenessSeconds,
          expectedConfig.minOracleSpotIndex,
          expectedConfig.maxOracleSpotIndex,
          expectedConfig.maxOraclePriceDeltaBps,
          expectedConfig.maxLeverage,
          expectedConfig.minMarginLamports,
          expectedConfig.maxMarketOpenInterest,
          expectedConfig.minMarketInsuranceLamports,
          expectedConfig.maintenanceMarginBps,
          expectedConfig.liquidationFeeBps,
          expectedConfig.tradeTreasuryFeeBps,
          expectedConfig.tradeMarketMakerFeeBps,
        )
        .accountsPartial({
          config: configPda,
          authority: botKeypair.publicKey,
        })
        .rpc(),
    connection,
  );

  console.log(`[Keeper] Updated perps config ${configPda.toBase58()}`);
}

async function maybeSetPerpsMarketStatus(
  marketId: number,
  nextStatus: 0 | 1 | 2,
  settlementSpotLamports = 0,
): Promise<void> {
  if (!PERPS_ORACLE_ENABLED) return;
  const marketIdBn = new BN(String(marketId));

  await runWithRecovery(
    () =>
      perpsProgram.methods
        .setMarketStatus(
          marketIdBn,
          nextStatus,
          new BN(String(settlementSpotLamports)),
        )
        .accountsPartial({
          config: derivePerpsConfigPda(),
          market: derivePerpsMarketPda(marketId),
          authority: botKeypair.publicKey,
        })
        .rpc(),
    connection,
  );
}

async function ensurePerpsMarketBootstrapInsurance(
  marketId: number,
): Promise<void> {
  if (!PERPS_ORACLE_ENABLED || PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL <= 0) {
    return;
  }

  const marketPda = derivePerpsMarketPda(marketId);
  const marketAcc =
    await perpsProgram.account.marketState.fetchNullable(marketPda);
  if (!marketAcc?.initialized) {
    return;
  }

  const targetInsuranceLamports = Math.round(
    PERPS_MARKET_BOOTSTRAP_INSURANCE_SOL * LAMPORTS_PER_SOL,
  );
  const currentInsuranceLamports = asNum(marketAcc.insuranceFund);
  if (currentInsuranceLamports >= targetInsuranceLamports) {
    return;
  }

  const depositLamports = targetInsuranceLamports - currentInsuranceLamports;
  const marketIdBn = new BN(String(marketId));
  await runWithRecovery(
    () =>
      perpsProgram.methods
        .depositInsurance(marketIdBn, new BN(String(depositLamports)))
        .accountsPartial({
          market: marketPda,
          payer: botKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );
}

async function maybeRecyclePerpsMarketMakerFees(
  marketId: number,
): Promise<void> {
  if (!PERPS_MARKET_MAKER_RECYCLE_ENABLED) {
    return;
  }

  const thresholdLamports = Math.round(
    PERPS_MARKET_MAKER_RECYCLE_MIN_SOL * LAMPORTS_PER_SOL,
  );
  const marketAcc = await perpsProgram.account.marketState.fetchNullable(
    derivePerpsMarketPda(marketId),
  );
  if (!marketAcc?.initialized) {
    return;
  }

  const pendingFeesLamports = asNum(marketAcc.marketMakerFeeBalance);
  if (pendingFeesLamports < thresholdLamports || pendingFeesLamports <= 0) {
    return;
  }

  const marketIdBn = new BN(String(marketId));
  await runWithRecovery(
    () =>
      perpsProgram.methods
        .recycleMarketMakerFees(marketIdBn, new BN(String(pendingFeesLamports)))
        .accountsPartial({
          config: derivePerpsConfigPda(),
          market: derivePerpsMarketPda(marketId),
          authority: botKeypair.publicKey,
        })
        .rpc(),
    connection,
  );
}

async function maybeArchiveSettledPerpsMarkets(): Promise<void> {
  if (!PERPS_ORACLE_ENABLED) {
    return;
  }

  const now = Date.now();
  const closableMarkets = loadPerpsMarkets().filter(
    (record) => record.status === PERPS_MARKET_STATUS_CLOSE_ONLY,
  );

  for (const record of closableMarkets) {
    const marketPda = derivePerpsMarketPda(record.marketId);
    const marketAcc =
      await perpsProgram.account.marketState.fetchNullable(marketPda);
    if (!marketAcc?.initialized) {
      continue;
    }

    if (
      asNum(marketAcc.openPositions) !== 0 ||
      asNum(marketAcc.totalLongOi) !== 0 ||
      asNum(marketAcc.totalShortOi) !== 0
    ) {
      continue;
    }

    const pendingMarketMakerFees = asNum(marketAcc.marketMakerFeeBalance);
    if (pendingMarketMakerFees > 0) {
      await runWithRecovery(
        () =>
          perpsProgram.methods
            .recycleMarketMakerFees(
              new BN(String(record.marketId)),
              new BN(String(pendingMarketMakerFees)),
            )
            .accountsPartial({
              config: derivePerpsConfigPda(),
              market: marketPda,
              authority: botKeypair.publicKey,
            })
            .rpc(),
        connection,
      );
    }

    const settlementSpotLamports = (() => {
      const settlement = asNum(marketAcc.settlementSpotIndex);
      if (settlement > 0) {
        return settlement;
      }
      const liveSpot = asNum(marketAcc.spotIndex);
      return liveSpot > 0 ? liveSpot : 0;
    })();

    try {
      await maybeSetPerpsMarketStatus(
        record.marketId,
        2,
        settlementSpotLamports,
      );
    } catch (error) {
      console.error(
        `[Keeper] Failed to archive settled perps market ${record.marketId} (${record.agentId})`,
        error,
      );
      continue;
    }

    savePerpsMarket({
      ...record,
      status: PERPS_MARKET_STATUS_ARCHIVED,
      updatedAt: now,
    });
    console.log(
      `[Keeper] Archived perps market ${record.marketId} for ${record.agentId}`,
    );
  }
}

async function deprecateMissingPerpsMarkets(
  trackedEntries: readonly TrackedModelEntry[],
): Promise<void> {
  if (!PERPS_ORACLE_ENABLED) return;

  const now = Date.now();
  const trackedIds = new Set(trackedEntries.map((entry) => entry.characterId));
  const allMarkets = loadPerpsMarkets();

  for (const record of allMarkets) {
    if (record.status !== PERPS_MARKET_STATUS_ACTIVE) {
      continue;
    }
    if (trackedIds.has(record.agentId)) {
      continue;
    }
    if (now - record.lastSeenAt < PERPS_MARKET_DEPRECATION_MS) {
      continue;
    }

    const marketAcc = await perpsProgram.account.marketState.fetchNullable(
      derivePerpsMarketPda(record.marketId),
    );
    const frozenSpotLamports = marketAcc
      ? asNum(marketAcc.settlementSpotIndex)
      : 0;
    const settlementSpotLamports =
      frozenSpotLamports > 0
        ? frozenSpotLamports
        : marketAcc
          ? asNum(marketAcc.spotIndex)
          : 0;

    try {
      await maybeSetPerpsMarketStatus(
        record.marketId,
        1,
        settlementSpotLamports,
      );
    } catch (error) {
      console.error(
        `[Keeper] Failed to deprecate perps market ${record.marketId} (${record.agentId})`,
        error,
      );
      continue;
    }

    savePerpsMarket({
      ...record,
      status: PERPS_MARKET_STATUS_CLOSE_ONLY,
      deprecatedAt: now,
      updatedAt: now,
    });
    console.log(
      `[Keeper] Deprecated perps market ${record.marketId} for ${record.agentId}`,
    );
  }
}

async function updatePerpsOracle(
  agentId: string,
  rating: AgentRating,
): Promise<boolean> {
  // Skip if perps oracle is disabled (program not deployed)
  if (!PERPS_ORACLE_ENABLED) return false;

  try {
    const marketId = modelMarketIdFromCharacterId(agentId);
    const marketIdBn = new BN(String(marketId));
    const registeredMarket = loadPerpsMarkets().find(
      (record) => record.agentId === agentId,
    );
    if (
      registeredMarket?.status === PERPS_MARKET_STATUS_CLOSE_ONLY ||
      registeredMarket?.status === PERPS_MARKET_STATUS_ARCHIVED
    ) {
      await maybeSetPerpsMarketStatus(marketId, 0, 0);
    }

    const population = Object.values(agentRatings);
    const configPda = derivePerpsConfigPda();
    const marketPda = derivePerpsMarketPda(marketId);
    const rawSpotIndex = calculateSyntheticSpotIndex(rating, population);
    const marketAccount =
      await perpsProgram.account.marketState.fetchNullable(marketPda);
    const previousSpotIndex = marketAccount
      ? asNum(marketAccount.spotIndex) / LAMPORTS_PER_SOL
      : null;
    const spotIndex = clampPerpsOracleSpotIndex(
      rawSpotIndex,
      previousSpotIndex,
    );
    const spotIndexScaled = new BN(Math.floor(spotIndex * LAMPORTS_PER_SOL));
    const muScaled = new BN(Math.floor(rating.mu * 1_000_000));
    const sigmaScaled = new BN(Math.floor(rating.sigma * 1_000_000));

    if (spotIndex !== rawSpotIndex) {
      console.warn(
        `[Keeper] Clamped perps oracle step for ${agentId} (${marketId}) from ${rawSpotIndex.toFixed(2)} to ${spotIndex.toFixed(2)} to stay within on-chain oracle guardrails.`,
      );
    }

    await runWithRecovery(
      () =>
        perpsProgram.methods
          .updateMarketOracle(
            marketIdBn,
            spotIndexScaled,
            muScaled,
            sigmaScaled,
          )
          .accountsPartial({
            config: configPda,
            market: marketPda,
            authority: botKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      connection,
    );
    savePerpsOracleSnapshot({
      agentId,
      marketId,
      spotIndex,
      conservativeSkill: conservativeSkill(rating),
      mu: rating.mu,
      sigma: rating.sigma,
      recordedAt: Date.now(),
    });
    await ensurePerpsMarketBootstrapInsurance(marketId);
    await maybeRecyclePerpsMarketMakerFees(marketId);
    console.log(
      "[Keeper] Updated Perps Oracle for agent",
      agentId,
      "(market",
      marketId,
      ") to spot",
      spotIndex,
    );
    return true;
  } catch (e) {
    console.error("Failed to update perps oracle", e);
    return false;
  }
}

interface LeaderboardApiEntry {
  rank?: number;
  characterId?: string;
  name?: string;
  provider?: string;
  model?: string;
  wins?: number;
  losses?: number;
  winRate?: number;
  combatLevel?: number;
  currentStreak?: number;
}

interface TrackedModelEntry {
  rank: number | null;
  characterId: string;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
}

interface LeaderboardApiResponse {
  leaderboard?: LeaderboardApiEntry[];
}

function normalizeTrackedModelEntry(
  entry: LeaderboardApiEntry,
): TrackedModelEntry | null {
  if (typeof entry.characterId !== "string" || entry.characterId.length === 0) {
    return null;
  }

  return {
    rank:
      typeof entry.rank === "number" && Number.isFinite(entry.rank)
        ? Math.floor(entry.rank)
        : null,
    characterId: entry.characterId,
    name: typeof entry.name === "string" ? entry.name : entry.characterId,
    provider: typeof entry.provider === "string" ? entry.provider : "",
    model: typeof entry.model === "string" ? entry.model : "",
    wins: asNum(entry.wins),
    losses: asNum(entry.losses),
    winRate:
      typeof entry.winRate === "number" && Number.isFinite(entry.winRate)
        ? entry.winRate
        : 0,
    combatLevel: asNum(entry.combatLevel),
    currentStreak: asNum(entry.currentStreak),
  };
}

async function fetchTrackedModels(): Promise<TrackedModelEntry[]> {
  try {
    const response = await fetch(
      `${args["game-url"]}/api/streaming/leaderboard/details?historyLimit=1`,
      {
        cache: "no-store",
        headers: {
          connection: "close",
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as LeaderboardApiResponse;
    if (!Array.isArray(payload.leaderboard)) {
      return [];
    }

    return payload.leaderboard
      .map(normalizeTrackedModelEntry)
      .filter((value): value is TrackedModelEntry => value !== null);
  } catch {
    return [];
  }
}

function toPerpsMarketRecord(
  entry: TrackedModelEntry,
  status: DbPerpsMarketStatus,
  now: number,
  previous?: DbPerpsMarketRecord,
): DbPerpsMarketRecord {
  return {
    agentId: entry.characterId,
    marketId: modelMarketIdFromCharacterId(entry.characterId),
    rank: entry.rank,
    name: entry.name,
    provider: entry.provider,
    model: entry.model,
    wins: entry.wins,
    losses: entry.losses,
    winRate: entry.winRate,
    combatLevel: entry.combatLevel,
    currentStreak: entry.currentStreak,
    status,
    lastSeenAt: now,
    deprecatedAt:
      status === PERPS_MARKET_STATUS_ACTIVE
        ? null
        : (previous?.deprecatedAt ?? now),
    updatedAt: now,
  };
}

async function syncPerpsOracles(
  entries: readonly TrackedModelEntry[],
): Promise<void> {
  if (!PERPS_ORACLE_ENABLED) return;

  const uniqueEntries = [
    ...new Map(entries.map((entry) => [entry.characterId, entry])).values(),
  ];
  if (uniqueEntries.length === 0) return;
  const now = Date.now();
  const knownMarkets = loadPerpsMarkets();
  const marketByAgentId = new Map(
    knownMarkets.map((record) => [record.agentId, record]),
  );
  const agentIdByMarketId = new Map<number, string>();

  for (const record of knownMarkets) {
    agentIdByMarketId.set(record.marketId, record.agentId);
  }

  for (const entry of uniqueEntries) {
    const marketId = modelMarketIdFromCharacterId(entry.characterId);
    const existingAgentForMarket = agentIdByMarketId.get(marketId);
    if (
      existingAgentForMarket &&
      existingAgentForMarket !== entry.characterId
    ) {
      console.error(
        `[Keeper] Refusing to sync perps market ${marketId}: collision between ${entry.characterId} and ${existingAgentForMarket}`,
      );
      continue;
    }

    getRating(entry.characterId);
  }

  for (const entry of uniqueEntries) {
    const previous = marketByAgentId.get(entry.characterId);
    const synced = await updatePerpsOracle(
      entry.characterId,
      getRating(entry.characterId),
    );
    if (!synced) {
      continue;
    }

    savePerpsMarket(
      toPerpsMarketRecord(entry, PERPS_MARKET_STATUS_ACTIVE, now, previous),
    );
    agentIdByMarketId.set(
      modelMarketIdFromCharacterId(entry.characterId),
      entry.characterId,
    );
  }

  await deprecateMissingPerpsMarkets(uniqueEntries);
}

async function syncPerpsOraclesFromLeaderboard(): Promise<void> {
  const trackedModels = await fetchTrackedModels();
  if (trackedModels.length === 0) return;

  await syncPerpsOracles(trackedModels);
  saveRatings();
}

const missingKeeperMethods: string[] = [];
for (const method of [
  "initializeOracle",
  "updateOracleConfig",
  "upsertDuel",
  "cancelDuel",
  "reportResult",
]) {
  if (!hasProgramMethod(fightProgram, method)) {
    missingKeeperMethods.push(`fightOracle.${method}`);
  }
}
for (const method of [
  "initializeConfig",
  "updateConfig",
  "initializeMarket",
  "syncMarketFromDuel",
  "placeOrder",
  "cancelOrder",
  "claim",
]) {
  if (!hasProgramMethod(marketProgram, method)) {
    missingKeeperMethods.push(`goldClobMarket.${method}`);
  }
}

const keeperProgramApiReady = missingKeeperMethods.length === 0;
let warnedMissingKeeperMethods = false;

function warnMissingKeeperMethodsOnce(): void {
  if (keeperProgramApiReady || warnedMissingKeeperMethods) return;
  warnedMissingKeeperMethods = true;
  console.warn(
    `[bot] keeper disabled: IDL/program methods missing (${missingKeeperMethods.join(", ")}).`,
  );
}

const botCluster = (
  process.env.SOLANA_CLUSTER ||
  process.env.CLUSTER ||
  "mainnet-beta"
)
  .toLowerCase()
  .trim();

function readConfiguredWallet(
  envName: string,
  fallback: PublicKey,
): PublicKey {
  const configured = process.env[envName]?.trim();
  if (configured) {
    return new PublicKey(configured);
  }
  if (botCluster === "mainnet-beta") {
    throw new Error(`Missing required environment variable: ${envName}`);
  }
  return fallback;
}

const minSignerLamports = Math.max(
  5_000,
  Number(process.env.BOT_MIN_BALANCE_LAMPORTS || 100_000),
);
const fundingBackoffMs = Math.max(
  10_000,
  Number(process.env.BOT_FUNDING_CHECK_COOLDOWN_MS || 60_000),
);
const airdropRateLimitCooldownMs = Math.max(
  fundingBackoffMs,
  Number(process.env.BOT_AIRDROP_RATE_LIMIT_COOLDOWN_MS || 15 * 60 * 1000),
);
const rpcBackoffMs = Math.max(
  fundingBackoffMs,
  Number(process.env.BOT_RPC_CHECK_COOLDOWN_MS || 60_000),
);
const chainCheckCooldownMs = Math.max(
  rpcBackoffMs,
  Number(process.env.BOT_CHAIN_CHECK_COOLDOWN_MS || 120_000),
);
let fundingBlockedUntil = 0;
let lastFundingWarningAt = 0;
let airdropBlockedUntil = 0;
let rpcBlockedUntil = 0;
let lastRpcWarningAt = 0;
let chainCheckBlockedUntil = 0;
let lastChainWarningAt = 0;
const botBootedAtMs = Date.now();
let lastSuccessfulRpcAtMs: number | null = null;
let lastStreamEventAtMs: number | null = null;
let restartRecoveryObservedAtMs: number | null = null;
let restartRecoveryDetails: string | null = null;

const oracleConfigPda = findOracleConfigPda(fightOracle.programId);
const marketConfigPda = findMarketConfigPda(goldClobMarket.programId);

const legacyFeeBps = Number(args["fee-bps"]);
const tradeTreasuryFeeBps = Number.isFinite(legacyFeeBps)
  ? Math.max(0, Math.floor(legacyFeeBps / 2))
  : Math.max(0, Math.floor(Number(args["trade-treasury-fee-bps"])));
const tradeMarketMakerFeeBps = Number.isFinite(legacyFeeBps)
  ? Math.max(0, Math.ceil(legacyFeeBps / 2))
  : Math.max(0, Math.floor(Number(args["trade-market-maker-fee-bps"])));
const winningsMarketMakerFeeBps = Number.isFinite(legacyFeeBps)
  ? Math.max(0, Math.floor(legacyFeeBps))
  : Math.max(0, Math.floor(Number(args["winnings-market-maker-fee-bps"])));
const configuredTradeTreasuryWallet = readConfiguredWallet(
  "TRADE_TREASURY_WALLET",
  botKeypair.publicKey,
);
const configuredTradeMarketMakerWallet = readConfiguredWallet(
  "TRADE_MARKET_MAKER_WALLET",
  botKeypair.publicKey,
);
const configuredPerpsTreasuryWallet = readConfiguredWallet(
  "PERPS_TREASURY_WALLET",
  botKeypair.publicKey,
);
const configuredPerpsMarketMakerWallet = readConfiguredWallet(
  "PERPS_MARKET_MAKER_WALLET",
  botKeypair.publicKey,
);
const configuredSeedSol = Number.isFinite(Number(args["seed-gold"]))
  ? Number(args["seed-gold"])
  : Number(args["seed-sol"]);
const marketMakerSeedLamports = Math.max(
  1_000,
  Math.floor(configuredSeedSol * LAMPORTS_PER_SOL),
);
const autoSeedDelayMs = Math.max(
  0,
  Math.floor(Number(args["auto-seed-delay-seconds"]) * 1000),
);
const configuredBidPrice = Math.max(
  1,
  Math.min(999, Math.floor(Number(process.env.MARKET_MAKER_BID_PRICE || 400))),
);
const configuredAskPrice = Math.max(
  configuredBidPrice + 1,
  Math.min(999, Math.floor(Number(process.env.MARKET_MAKER_ASK_PRICE || 600))),
);
const configuredMidPrice = Math.max(
  1,
  Math.round((configuredBidPrice + configuredAskPrice) / 2),
);
const configuredSpreadBps = Math.max(
  DEFAULT_MARKET_MAKER_CONFIG.targetSpreadBps,
  Math.round(
    ((configuredAskPrice - configuredBidPrice) * 10_000) /
      Math.max(1, configuredMidPrice),
  ),
);
const managedClobQuoteConfig = {
  ...DEFAULT_MARKET_MAKER_CONFIG,
  targetSpreadBps: configuredSpreadBps,
  minQuoteUnits: Math.max(1, Math.floor(marketMakerSeedLamports / 4)),
  maxQuoteUnits: marketMakerSeedLamports,
  maxInventoryPerSide: Math.max(
    DEFAULT_MARKET_MAKER_CONFIG.maxInventoryPerSide,
    marketMakerSeedLamports * 4,
  ),
  maxNetExposure: Math.max(
    DEFAULT_MARKET_MAKER_CONFIG.maxNetExposure,
    marketMakerSeedLamports * 2,
  ),
  maxGrossExposure: Math.max(
    DEFAULT_MARKET_MAKER_CONFIG.maxGrossExposure,
    marketMakerSeedLamports * 6,
  ),
};

const requiredPrograms = [
  {
    label: "fight oracle",
    programId: fightProgram.programId,
  },
  {
    label: "gold clob market",
    programId: marketProgram.programId,
  },
  ...(PERPS_ORACLE_ENABLED || PERPS_LIQUIDATOR_ENABLED
    ? [
        {
          label: "gold perps market",
          programId: perpsProgram.programId,
        },
      ]
    : []),
];

const canRequestAirdrop =
  botCluster === "testnet" ||
  botCluster === "devnet" ||
  botCluster === "localnet";

async function ensureBotSignerFunding(): Promise<boolean> {
  const now = Date.now();
  if (now < fundingBlockedUntil || now < rpcBlockedUntil) {
    return false;
  }

  let lamports: number;
  try {
    lamports = await connection.getBalance(botKeypair.publicKey, "confirmed");
  } catch (error) {
    if (isRpcConnectivityError(error)) {
      if (Date.now() - lastRpcWarningAt > 10_000) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[bot] solana rpc unavailable at ${connection.rpcEndpoint}: ${message}. Backing off for ${Math.round(
            rpcBackoffMs / 1000,
          )}s.`,
        );
        lastRpcWarningAt = Date.now();
      }
      rpcBlockedUntil = Date.now() + rpcBackoffMs;
      return false;
    }
    throw error;
  }
  if (lamports >= minSignerLamports) {
    markRpcSuccess();
    return true;
  }

  if (canRequestAirdrop && now >= airdropBlockedUntil) {
    try {
      const airdropSig = await connection.requestAirdrop(
        botKeypair.publicKey,
        1 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(airdropSig, "confirmed");
      lamports = await connection.getBalance(botKeypair.publicKey, "confirmed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited =
        message.includes("429") || /too many requests/i.test(message);
      const isRpcError = isRpcConnectivityError(error);
      if (isRateLimited) {
        airdropBlockedUntil = Date.now() + airdropRateLimitCooldownMs;
      }
      if (isRpcError) {
        rpcBlockedUntil = Date.now() + rpcBackoffMs;
      }
      if (Date.now() - lastFundingWarningAt > 10_000) {
        console.warn(`[bot] airdrop attempt failed: ${message}`);
        if (isRateLimited) {
          console.warn(
            `[bot] faucet rate-limited; pausing airdrop attempts for ${Math.round(
              airdropRateLimitCooldownMs / 1000,
            )}s`,
          );
        }
        lastFundingWarningAt = Date.now();
      }
    }
  }

  if (lamports >= minSignerLamports) {
    markRpcSuccess();
    return true;
  }

  if (Date.now() - lastFundingWarningAt > 10_000) {
    console.warn(
      `[bot] bot wallet ${botKeypair.publicKey.toBase58()} has ${(
        lamports / LAMPORTS_PER_SOL
      ).toFixed(
        6,
      )} SOL (< ${(minSignerLamports / LAMPORTS_PER_SOL).toFixed(6)} required). ` +
        `Skipping keeper cycle for ${Math.round(fundingBackoffMs / 1000)}s.`,
    );
    lastFundingWarningAt = Date.now();
  }
  fundingBlockedUntil = Date.now() + fundingBackoffMs;
  return false;
}

async function ensureKeeperChainReady(): Promise<boolean> {
  const now = Date.now();
  if (now < chainCheckBlockedUntil || now < rpcBlockedUntil) {
    return false;
  }

  try {
    await connection.getLatestBlockhash("confirmed");
    const infos = await connection.getMultipleAccountsInfo(
      requiredPrograms.map((program) => program.programId),
      "confirmed",
    );
    const missingPrograms = requiredPrograms
      .filter((program, index) => !infos[index]?.executable)
      .map((program) => `${program.label}:${program.programId.toBase58()}`);

    if (missingPrograms.length === 0) {
      markRpcSuccess();
      return true;
    }

    if (Date.now() - lastChainWarningAt > 10_000) {
      console.warn(
        `[bot] keeper chain not ready on ${connection.rpcEndpoint}: ${missingPrograms.join(
          ", ",
        )}. Backing off for ${Math.round(chainCheckCooldownMs / 1000)}s.`,
      );
      lastChainWarningAt = Date.now();
    }
    chainCheckBlockedUntil = Date.now() + chainCheckCooldownMs;
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (Date.now() - lastRpcWarningAt > 10_000) {
      console.warn(
        `[bot] failed keeper chain readiness check against ${connection.rpcEndpoint}: ${message}. Backing off for ${Math.round(
          rpcBackoffMs / 1000,
        )}s.`,
      );
      lastRpcWarningAt = Date.now();
    }
    rpcBlockedUntil = Date.now() + rpcBackoffMs;
    return false;
  }
}

async function ensureWalletAccountReady(
  wallet: PublicKey,
  label: string,
): Promise<void> {
  const existingAccount = await connection.getAccountInfo(wallet, "confirmed");
  if (existingAccount) {
    return;
  }

  if (!canRequestAirdrop) {
    throw new Error(
      `[bot] ${label} wallet ${wallet.toBase58()} does not exist on-chain`,
    );
  }

  const signature = await connection.requestAirdrop(wallet, minSignerLamports);
  await connection.confirmTransaction(signature, "confirmed");
  const fundedAccount = await connection.getAccountInfo(wallet, "confirmed");
  if (!fundedAccount) {
    throw new Error(
      `[bot] failed to initialize ${label} wallet ${wallet.toBase58()} on-chain`,
    );
  }

  console.log(
    `[bot] Initialized ${label} wallet ${wallet.toBase58()} with ${minSignerLamports} lamports`,
  );
}

const ensureOracleReady = async (): Promise<void> => {
  let config =
    await fightProgram.account.oracleConfig.fetchNullable(oracleConfigPda);
  if (!config) {
    await runWithRecovery(
      () =>
        fightProgram.methods
          .initializeOracle(botKeypair.publicKey)
          .accountsPartial({
            authority: botKeypair.publicKey,
            oracleConfig: oracleConfigPda,
            program: fightProgram.programId,
            programData: deriveProgramDataAddress(fightProgram.programId),
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      connection,
    );
    config =
      await fightProgram.account.oracleConfig.fetchNullable(oracleConfigPda);
  }
  if (!config) {
    throw new Error(
      `Oracle config ${oracleConfigPda.toBase58()} was not created`,
    );
  }
  if (!(config.authority as PublicKey).equals(botKeypair.publicKey)) {
    throw new Error(
      `Bot wallet ${botKeypair.publicKey.toBase58()} is not oracle authority`,
    );
  }
  if (!(config.reporter as PublicKey).equals(botKeypair.publicKey)) {
    await runWithRecovery(
      () =>
        fightProgram.methods
          .updateOracleConfig(botKeypair.publicKey, botKeypair.publicKey)
          .accountsPartial({
            authority: botKeypair.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc(),
      connection,
    );
  }
};

const ensureMarketConfigReady = async (): Promise<void> => {
  await Promise.all([
    ensureWalletAccountReady(configuredTradeTreasuryWallet, "trade treasury"),
    ensureWalletAccountReady(
      configuredTradeMarketMakerWallet,
      "trade market maker",
    ),
  ]);

  const existingConfig =
    await marketProgram.account.marketConfig.fetchNullable(marketConfigPda);
  const expectedConfig = {
    treasury: configuredTradeTreasuryWallet,
    marketMaker: configuredTradeMarketMakerWallet,
    tradeTreasuryFeeBps,
    tradeMarketMakerFeeBps,
    winningsMarketMakerFeeBps,
  };

  if (!existingConfig) {
    await runWithRecovery(
      () =>
        marketProgram.methods
          .initializeConfig(
            botKeypair.publicKey,
            expectedConfig.treasury,
            expectedConfig.marketMaker,
            expectedConfig.tradeTreasuryFeeBps,
            expectedConfig.tradeMarketMakerFeeBps,
            expectedConfig.winningsMarketMakerFeeBps,
          )
          .accountsPartial({
            authority: botKeypair.publicKey,
            config: marketConfigPda,
            program: marketProgram.programId,
            programData: deriveProgramDataAddress(marketProgram.programId),
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      connection,
    );
    console.log(
      `[bot] CLOB market config initialized at ${marketConfigPda.toBase58()}`,
    );
    return;
  }

  const configNeedsUpdate =
    !(existingConfig.treasury as PublicKey).equals(expectedConfig.treasury) ||
    !(existingConfig.marketMaker as PublicKey).equals(
      expectedConfig.marketMaker,
    ) ||
    asNum(existingConfig.tradeTreasuryFeeBps) !==
      expectedConfig.tradeTreasuryFeeBps ||
    asNum(existingConfig.tradeMarketMakerFeeBps) !==
      expectedConfig.tradeMarketMakerFeeBps ||
    asNum(existingConfig.winningsMarketMakerFeeBps) !==
      expectedConfig.winningsMarketMakerFeeBps;

  if (configNeedsUpdate) {
    await runWithRecovery(
      () =>
        marketProgram.methods
          .updateConfig(
            botKeypair.publicKey,
            botKeypair.publicKey,
            expectedConfig.treasury,
            expectedConfig.marketMaker,
            expectedConfig.tradeTreasuryFeeBps,
            expectedConfig.tradeMarketMakerFeeBps,
            expectedConfig.winningsMarketMakerFeeBps,
          )
          .accountsPartial({
            authority: botKeypair.publicKey,
            config: marketConfigPda,
          })
          .rpc(),
      connection,
    );
    console.log(
      `[bot] CLOB market config updated at ${marketConfigPda.toBase58()} treasury=${expectedConfig.treasury.toBase58()} marketMaker=${expectedConfig.marketMaker.toBase58()}`,
    );
  } else {
    console.log(
      `[bot] CLOB market config already exists at ${marketConfigPda.toBase58()}`,
    );
  }
};

async function getDuelState(
  duelStatePda: PublicKey,
): Promise<Record<string, unknown> | null> {
  const duelState = await fightProgram.account.duelState.fetchNullable(duelStatePda);
  markRpcSuccess();
  return duelState;
}

async function getClobMarketState(
  marketStatePda: PublicKey,
): Promise<Record<string, unknown> | null> {
  const marketState =
    await marketProgram.account.marketState.fetchNullable(marketStatePda);
  markRpcSuccess();
  return marketState;
}

type ManagedClobOrder = {
  orderId: number;
  side: number;
  price: number;
  amountLamports: number;
  placedAtMs: number;
};

type ActiveClobMatch = {
  duelId: string;
  duelKeyHex: string;
  duelState: PublicKey;
  marketState: PublicKey;
  vault: PublicKey;
  createdAt: number;
  lastStreamAtMs: number | null;
  lastOracleAtMs: number | null;
  lastRpcAtMs: number | null;
  lastSyncedAtMs: number | null;
  lastResolvedAtMs: number | null;
  lastClaimAtMs: number | null;
  lastQuoteSnapshot: MarketSnapshot | null;
  lastQuotePlan: QuotePlan | null;
  yesBidOrder: ManagedClobOrder | null;
  noAskOrder: ManagedClobOrder | null;
};

type ManagedOrderState = ManagedClobOrder & {
  remainingLamports: number;
};

type ManagedClobQuoteContext = {
  snapshot: MarketSnapshot;
  yesBidOrder: ManagedOrderState | null;
  noAskOrder: ManagedOrderState | null;
};

function markRpcSuccess(trackedMatch?: ActiveClobMatch | null): number {
  const now = Date.now();
  lastSuccessfulRpcAtMs = now;
  if (trackedMatch) {
    trackedMatch.lastRpcAtMs = now;
  }
  return now;
}

function markStreamEvent(trackedMatch?: ActiveClobMatch | null): number {
  const now = Date.now();
  lastStreamEventAtMs = now;
  if (trackedMatch) {
    trackedMatch.lastStreamAtMs = now;
  }
  return now;
}

function buildManagedClobSignal(snapshot: MarketSnapshot): {
  signalPrice: number;
  signalWeight: number;
} | {} {
  return snapshot.bestBid == null && snapshot.bestAsk == null
    ? {
        signalPrice: configuredMidPrice,
        signalWeight: 1,
      }
    : {};
}

async function ensureClobVaultReady(vault: PublicKey): Promise<void> {
  const minimumLamports = await connection.getMinimumBalanceForRentExemption(
    0,
    "confirmed",
  );
  const currentLamports = await connection.getBalance(vault, "confirmed");
  if (currentLamports >= minimumLamports) {
    return;
  }

  const topUpLamports = minimumLamports - currentLamports;
  const topUpTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: botKeypair.publicKey,
      toPubkey: vault,
      lamports: topUpLamports,
    }),
  );
  await provider.sendAndConfirm(topUpTx, [botKeypair]);
}

function buildDuelMetadata(data: DuelLifecycleEvent): string {
  return JSON.stringify({
    cycleId: data.cycleId,
    duelId: data.duelId,
    duelKeyHex: data.duelKeyHex,
    agent1: data.agent1?.name ?? "Agent A",
    agent2: data.agent2?.name ?? "Agent B",
  });
}

function duelStatusEnum(
  status: "scheduled" | "bettingOpen" | "locked",
): DuelStatusArg {
  if (status === "scheduled") {
    return { scheduled: {} } as DuelStatusArg;
  }
  if (status === "locked") {
    return { locked: {} } as DuelStatusArg;
  }
  return { bettingOpen: {} } as DuelStatusArg;
}

function winnerSideEnum(side: "A" | "B"): ReportWinnerArg {
  return (side === "A" ? { a: {} } : { b: {} }) as ReportWinnerArg;
}

async function upsertDuelLifecycle(
  data: DuelLifecycleEvent,
  status: "scheduled" | "bettingOpen" | "locked",
): Promise<PublicKey> {
  const duelKey = duelKeyHexToBytes(data.duelKeyHex);
  const duelState = findDuelStatePda(fightProgram.programId, duelKey);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const betOpenTs = Math.floor((data.betOpenTime ?? Date.now()) / 1000);
  const betCloseTs = Math.max(
    betOpenTs + 1,
    Math.floor(
      (data.betCloseTime ?? data.fightStartTime ?? Date.now() + 1_000) / 1000,
    ),
  );
  const duelStartTs = Math.max(
    betCloseTs,
    Math.floor((data.fightStartTime ?? data.betCloseTime ?? Date.now()) / 1000),
  );
  const requestedStatus =
    status === "scheduled" && betOpenTs <= nowSeconds ? "bettingOpen" : status;

  await runWithRecovery(
    () =>
      fightProgram.methods
        .upsertDuel(
          Array.from(duelKey),
          hashParticipant(data.agent1),
          hashParticipant(data.agent2),
          new BN(betOpenTs),
          new BN(betCloseTs),
          new BN(duelStartTs),
          buildDuelMetadata(data),
          duelStatusEnum(requestedStatus),
        )
        .accountsPartial({
          reporter: botKeypair.publicKey,
          oracleConfig: oracleConfigPda,
          duelState,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );
  markRpcSuccess();

  return duelState;
}

async function syncTrackedMarketFromOracle(
  trackedMatch: ActiveClobMatch,
): Promise<void> {
  await runWithRecovery(
    () =>
      marketProgram.methods
        .syncMarketFromDuel()
        .accountsPartial({
          marketState: trackedMatch.marketState,
          duelState: trackedMatch.duelState,
        })
        .rpc(),
    connection,
  );
  const now = markRpcSuccess(trackedMatch);
  trackedMatch.lastOracleAtMs = now;
  trackedMatch.lastSyncedAtMs = now;
}

function toManagedClobOrder(order: ManagedOrderState): ManagedClobOrder {
  return {
    orderId: order.orderId,
    side: order.side,
    price: order.price,
    amountLamports: order.amountLamports,
    placedAtMs: order.placedAtMs,
  };
}

function mapClobLifecycleStatus(
  marketState: Record<string, unknown> | null,
): MarketSnapshot["lifecycleStatus"] {
  if (!marketState) return "UNKNOWN";
  if (enumIs(marketState.status, "open")) return "OPEN";
  if (enumIs(marketState.status, "locked")) return "LOCKED";
  if (enumIs(marketState.status, "resolved")) return "RESOLVED";
  if (enumIs(marketState.status, "cancelled")) return "CANCELLED";
  return "UNKNOWN";
}

function normalizeClobBestBid(value: number): number | null {
  return value > 0 ? value : null;
}

function normalizeClobBestAsk(value: number): number | null {
  if (value <= 0 || value >= 1_000) {
    return null;
  }
  return value;
}

async function getManagedOrderState(
  trackedMatch: ActiveClobMatch,
  trackedOrder: ManagedClobOrder | null,
): Promise<ManagedOrderState | null> {
  if (!trackedOrder) {
    return null;
  }

  const orderPda = findOrderPda(
    marketProgram.programId,
    trackedMatch.marketState,
    BigInt(trackedOrder.orderId),
  );
  const orderAccount = await marketProgram.account.order.fetchNullable(orderPda);
  if (!orderAccount || !Boolean(orderAccount.active)) {
    return null;
  }

  const amountLamports = asNum(orderAccount.amount, trackedOrder.amountLamports);
  const remainingLamports = Math.max(
    0,
    amountLamports - asNum(orderAccount.filled),
  );
  if (remainingLamports <= 0) {
    return null;
  }

  return {
    orderId: trackedOrder.orderId,
    side: trackedOrder.side,
    price: asNum(orderAccount.price, trackedOrder.price),
    amountLamports,
    placedAtMs: trackedOrder.placedAtMs,
    remainingLamports,
  };
}

async function buildManagedClobQuoteContext(
  trackedMatch: ActiveClobMatch,
  marketState: Record<string, unknown> | null,
  now = Date.now(),
): Promise<ManagedClobQuoteContext> {
  const [duelState, userBalance, yesBidOrder, noAskOrder] = await Promise.all([
    getDuelState(trackedMatch.duelState),
    marketProgram.account.userBalance.fetchNullable(
      findUserBalancePda(
        marketProgram.programId,
        trackedMatch.marketState,
        botKeypair.publicKey,
      ),
    ),
    getManagedOrderState(trackedMatch, trackedMatch.yesBidOrder),
    getManagedOrderState(trackedMatch, trackedMatch.noAskOrder),
  ]);

  const activeOrders = [yesBidOrder, noAskOrder].filter(
    (order): order is ManagedOrderState => order !== null,
  );
  const quoteAgeMs =
    activeOrders.length > 0
      ? now - Math.min(...activeOrders.map((order) => order.placedAtMs))
      : null;

  return {
    snapshot: {
      chainKey: "solana",
      lifecycleStatus: mapClobLifecycleStatus(marketState),
      duelKey: trackedMatch.duelKeyHex,
      marketRef: trackedMatch.marketState.toBase58(),
      bestBid: normalizeClobBestBid(asNum(marketState?.bestBid)),
      bestAsk: normalizeClobBestAsk(asNum(marketState?.bestAsk, 1_000)),
      betCloseTimeMs: duelState ? asNum(duelState.betCloseTs) * 1_000 : null,
      lastStreamAtMs: trackedMatch.lastStreamAtMs ?? lastStreamEventAtMs ?? now,
      lastOracleAtMs: trackedMatch.lastOracleAtMs ?? now,
      lastRpcAtMs: trackedMatch.lastRpcAtMs ?? lastSuccessfulRpcAtMs ?? now,
      quoteAgeMs,
      exposure: {
        yes: asNum(userBalance?.aShares),
        no: asNum(userBalance?.bShares),
        openYes: yesBidOrder?.remainingLamports ?? 0,
        openNo: noAskOrder?.remainingLamports ?? 0,
      },
    },
    yesBidOrder,
    noAskOrder,
  };
}

async function refreshManagedClobHealth(
  trackedMatch: ActiveClobMatch,
  marketState: Record<string, unknown> | null,
  now = Date.now(),
): Promise<{ quoteContext: ManagedClobQuoteContext; plan: QuotePlan }> {
  const quoteContext = await buildManagedClobQuoteContext(
    trackedMatch,
    marketState,
    now,
  );
  const plan = buildQuotePlan(
    quoteContext.snapshot,
    buildManagedClobSignal(quoteContext.snapshot),
    managedClobQuoteConfig,
    now,
  );
  trackedMatch.lastQuoteSnapshot = quoteContext.snapshot;
  trackedMatch.lastQuotePlan = plan;
  trackedMatch.lastSyncedAtMs = now;
  trackedMatch.lastStreamAtMs =
    quoteContext.snapshot.lastStreamAtMs ?? trackedMatch.lastStreamAtMs;
  trackedMatch.lastOracleAtMs =
    quoteContext.snapshot.lastOracleAtMs ?? trackedMatch.lastOracleAtMs;
  trackedMatch.lastRpcAtMs =
    quoteContext.snapshot.lastRpcAtMs ?? trackedMatch.lastRpcAtMs;
  return { quoteContext, plan };
}

async function cancelManagedClobOrder(
  trackedMatch: ActiveClobMatch,
  trackedOrder: ManagedOrderState,
  reason: string,
): Promise<void> {
  const order = findOrderPda(
    marketProgram.programId,
    trackedMatch.marketState,
    BigInt(trackedOrder.orderId),
  );
  const priceLevel = findPriceLevelPda(
    marketProgram.programId,
    trackedMatch.marketState,
    trackedOrder.side,
    trackedOrder.price,
  );

  await runWithRecovery(
    () =>
      marketProgram.methods
        .cancelOrder(
          new BN(trackedOrder.orderId),
          trackedOrder.side,
          trackedOrder.price,
        )
        .accountsPartial({
          marketState: trackedMatch.marketState,
          duelState: trackedMatch.duelState,
          order,
          priceLevel,
          vault: trackedMatch.vault,
          user: botKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  console.log(
    `[bot] Cancelled ${
      trackedOrder.side === SIDE_BID ? "A-bid" : "B-ask"
    } liquidity for ${trackedMatch.marketState.toBase58()} orderId=${
      trackedOrder.orderId
    } price=${trackedOrder.price} reason=${reason}`,
  );
}

async function cancelManagedClobQuotes(
  trackedMatch: ActiveClobMatch,
  reason: string,
): Promise<void> {
  for (const side of ["yesBidOrder", "noAskOrder"] as const) {
    const activeOrder = await getManagedOrderState(trackedMatch, trackedMatch[side]);
    if (!activeOrder) {
      trackedMatch[side] = null;
      continue;
    }
    await cancelManagedClobOrder(trackedMatch, activeOrder, reason);
    trackedMatch[side] = null;
  }
}

async function placeManagedClobOrder(
  trackedMatch: ActiveClobMatch,
  side: number,
  price: number,
  amountLamports: number,
): Promise<ManagedClobOrder> {
  const marketState = await getClobMarketState(trackedMatch.marketState);
  if (!marketState || !enumIs(marketState.status, "open")) {
    throw new Error(
      `Cannot seed closed market ${trackedMatch.marketState.toBase58()}`,
    );
  }

  const orderId = asNum(marketState.nextOrderId);
  const userBalance = findUserBalancePda(
    marketProgram.programId,
    trackedMatch.marketState,
    botKeypair.publicKey,
  );
  const newOrder = findOrderPda(
    marketProgram.programId,
    trackedMatch.marketState,
    BigInt(orderId),
  );
  const restingLevel = findPriceLevelPda(
    marketProgram.programId,
    trackedMatch.marketState,
    side,
    price,
  );

  await runWithRecovery(
    () =>
      marketProgram.methods
        .placeOrder(
          new BN(orderId),
          side,
          price,
          new BN(amountLamports),
        )
        .accountsPartial({
          marketState: trackedMatch.marketState,
          duelState: trackedMatch.duelState,
          userBalance,
          newOrder,
          restingLevel,
          config: marketConfigPda,
          treasury: configuredTradeTreasuryWallet,
          marketMaker: configuredTradeMarketMakerWallet,
          vault: trackedMatch.vault,
          user: botKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    connection,
  );

  console.log(
    `[bot] Seeded ${side === SIDE_BID ? "A-bid" : "B-ask"} liquidity for ${trackedMatch.marketState.toBase58()} orderId=${orderId} price=${price} amountLamports=${amountLamports}`,
  );

  return {
    orderId,
    side,
    price,
    amountLamports,
    placedAtMs: Date.now(),
  };
}

async function ensureManagedClobOrder(
  trackedMatch: ActiveClobMatch,
  side: "yesBidOrder" | "noAskOrder",
): Promise<void> {
  const marketState = await getClobMarketState(trackedMatch.marketState);
  if (!marketState || !enumIs(marketState.status, "open")) {
    trackedMatch[side] = null;
    return;
  }

  const now = Date.now();
  const { quoteContext, plan } = await refreshManagedClobHealth(
    trackedMatch,
    marketState,
    now,
  );
  trackedMatch.yesBidOrder = quoteContext.yesBidOrder
    ? toManagedClobOrder(quoteContext.yesBidOrder)
    : null;
  trackedMatch.noAskOrder = quoteContext.noAskOrder
    ? toManagedClobOrder(quoteContext.noAskOrder)
    : null;
  const activeOrder =
    side === "yesBidOrder" ? quoteContext.yesBidOrder : quoteContext.noAskOrder;
  const decision = evaluateQuoteDecision(
    side === "yesBidOrder" ? "BID" : "ASK",
    plan,
    activeOrder
      ? {
          price: activeOrder.price,
          units: activeOrder.remainingLamports,
          placedAtMs: activeOrder.placedAtMs,
        }
      : null,
    managedClobQuoteConfig,
    now,
  );

  if (activeOrder && decision.shouldCancel) {
    await cancelManagedClobOrder(
      trackedMatch,
      activeOrder,
      decision.reason ?? "quote-refresh",
    );
    trackedMatch[side] = null;
  } else if (activeOrder && decision.shouldKeep) {
    trackedMatch[side] = toManagedClobOrder(activeOrder);
    return;
  }

  if (
    !decision.shouldPlace ||
    decision.targetPrice == null ||
    decision.targetUnits <= 0
  ) {
    trackedMatch[side] = null;
    return;
  }

  trackedMatch[side] = await placeManagedClobOrder(
    trackedMatch,
    side === "yesBidOrder" ? SIDE_BID : SIDE_ASK,
    decision.targetPrice,
    decision.targetUnits,
  );
}

async function createOrSyncRound(
  data: DuelLifecycleEvent,
): Promise<ActiveClobMatch> {
  const duelState = await upsertDuelLifecycle(data, "bettingOpen");
  const marketState = findMarketPda(
    marketProgram.programId,
    duelState,
    DUEL_WINNER_MARKET_KIND,
  );
  const vault = findClobVaultPda(marketProgram.programId, marketState);
  const duelKey = duelKeyHexToBytes(data.duelKeyHex);

  try {
    await runWithRecovery(
      () =>
        marketProgram.methods
          .initializeMarket(Array.from(duelKey), DUEL_WINNER_MARKET_KIND)
          .accountsPartial({
            operator: botKeypair.publicKey,
            config: marketConfigPda,
            duelState,
            marketState,
            vault,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      connection,
    );
  } catch (error) {
    if (!isIgnorableRaceError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already in use|account .* already in use/i.test(message)) {
        throw error;
      }
    }
  }

  const trackedMatch: ActiveClobMatch = {
    duelId: data.duelId,
    duelKeyHex: data.duelKeyHex,
    duelState,
    marketState,
    vault,
    createdAt: Date.now(),
    lastStreamAtMs: Date.now(),
    lastOracleAtMs: null,
    lastRpcAtMs: null,
    lastSyncedAtMs: null,
    lastResolvedAtMs: null,
    lastClaimAtMs: null,
    lastQuoteSnapshot: null,
    lastQuotePlan: null,
    yesBidOrder: null,
    noAskOrder: null,
  };
  await syncTrackedMarketFromOracle(trackedMatch);

  console.log(
    `[bot] Duel market ready duel=${data.duelId} duelState=${duelState.toBase58()} market=${marketState.toBase58()}`,
  );
  return trackedMatch;
}

async function lockRound(data: DuelLifecycleEvent): Promise<void> {
  const trackedMatch = activeClobMatches.get(data.duelId);
  if (!trackedMatch) {
    return;
  }

  await upsertDuelLifecycle(data, "locked");
  await syncTrackedMarketFromOracle(trackedMatch);
}

async function maybeWarnUnresolvedDuel(trackedMatch: ActiveClobMatch): Promise<void> {
  const duelState = await getDuelState(trackedMatch.duelState);
  if (!duelState || !enumIs(duelState.status, "locked")) {
    unresolvedOracleWarningMatches.delete(trackedMatch.duelId);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < asNum(duelState.betCloseTs)) {
    return;
  }
  if (unresolvedOracleWarningMatches.has(trackedMatch.duelId)) {
    return;
  }

  unresolvedOracleWarningMatches.add(trackedMatch.duelId);
  console.warn(
    `[Keeper] Duel ${trackedMatch.duelId} is locked and past bet close but unresolved. Waiting for authoritative game result.`,
  );
}

async function maybeSeedMarket(trackedMatch: ActiveClobMatch): Promise<void> {
  if (Date.now() - trackedMatch.createdAt < autoSeedDelayMs) {
    return;
  }

  const marketState = await getClobMarketState(trackedMatch.marketState);
  if (!marketState || !enumIs(marketState.status, "open")) {
    return;
  }

  await ensureClobVaultReady(trackedMatch.vault);
  await ensureManagedClobOrder(trackedMatch, "noAskOrder");
  await ensureManagedClobOrder(trackedMatch, "yesBidOrder");
}

const activeClobMatches = new Map<string, ActiveClobMatch>();
const unresolvedOracleWarningMatches = new Set<string>();
const settledClobHealth = new Map<string, KeeperMarketHealthRecord>();

function loadPreviousBotHealthSnapshot(): KeeperBotHealthSnapshot | null {
  if (!BOT_HEALTH_FILE || !fs_node.existsSync(BOT_HEALTH_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs_node.readFileSync(BOT_HEALTH_FILE, "utf8"));
  } catch (error) {
    console.warn("[bot] Failed to read previous bot health snapshot:", error);
    return null;
  }
}

const previousBotHealthSnapshot = loadPreviousBotHealthSnapshot();
if (previousBotHealthSnapshot?.markets.some((market) => market.openOrderCount > 0)) {
  restartRecoveryObservedAtMs = Date.now();
  restartRecoveryDetails = `previous snapshot recorded open orders in ${previousBotHealthSnapshot.markets
    .filter((market) => market.openOrderCount > 0)
    .map((market) => market.marketRef ?? market.duelKey ?? market.duelId ?? "unknown")
    .join(", ")}`;
}

function trimSettledClobHealth(now = Date.now()): void {
  for (const [duelId, record] of settledClobHealth.entries()) {
    const referenceTime =
      record.lastClaimAtMs ?? record.lastResolvedAtMs ?? record.lastOracleAtMs ?? 0;
    if (referenceTime > 0 && now - referenceTime > MARKET_HEALTH_RETENTION_MS) {
      settledClobHealth.delete(duelId);
    }
  }
}

function buildTrackedMatchRecovery(
  trackedMatch: ActiveClobMatch,
  snapshot: MarketSnapshot | null,
  grossExposure: number,
): string[] {
  const recovery: string[] = [];
  if (unresolvedOracleWarningMatches.has(trackedMatch.duelId)) {
    recovery.push("awaiting-authoritative-result");
  }
  if (
    trackedMatch.lastResolvedAtMs != null &&
    trackedMatch.lastClaimAtMs == null &&
    grossExposure > 0
  ) {
    recovery.push("partial-claim");
  }
  if (
    restartRecoveryObservedAtMs != null &&
    (trackedMatch.yesBidOrder != null || trackedMatch.noAskOrder != null)
  ) {
    recovery.push("restart-open-orders");
  }
  if (snapshot?.lifecycleStatus === "LOCKED" && grossExposure > 0) {
    recovery.push("position-reconcile-pending");
  }
  return recovery;
}

function buildManagedClobHealthRecord(
  trackedMatch: ActiveClobMatch,
  lifecycleStatusOverride?: MarketSnapshot["lifecycleStatus"],
): KeeperMarketHealthRecord {
  const snapshot = trackedMatch.lastQuoteSnapshot;
  const plan = trackedMatch.lastQuotePlan;
  const inventoryYes = snapshot?.exposure.yes ?? 0;
  const inventoryNo = snapshot?.exposure.no ?? 0;
  const openYes = snapshot?.exposure.openYes ?? 0;
  const openNo = snapshot?.exposure.openNo ?? 0;
  const grossExposure = inventoryYes + inventoryNo + openYes + openNo;
  return {
    chainKey: "solana",
    duelId: trackedMatch.duelId,
    duelKey: trackedMatch.duelKeyHex,
    marketRef: trackedMatch.marketState.toBase58(),
    lifecycleStatus: lifecycleStatusOverride ?? snapshot?.lifecycleStatus ?? "UNKNOWN",
    fairValue: plan?.fairValue ?? null,
    bidPrice: plan?.bidPrice ?? null,
    askPrice: plan?.askPrice ?? null,
    bidUnits: plan?.bidUnits ?? 0,
    askUnits: plan?.askUnits ?? 0,
    openOrderCount:
      Number(trackedMatch.yesBidOrder != null) + Number(trackedMatch.noAskOrder != null),
    inventoryYes,
    inventoryNo,
    openYes,
    openNo,
    netExposure: (inventoryYes + openYes) - (inventoryNo + openNo),
    grossExposure,
    drawdownBps: plan?.risk.drawdownBps ?? snapshot?.exposure.drawdownBps ?? 0,
    quoteAgeMs: snapshot?.quoteAgeMs ?? null,
    lastStreamAtMs: trackedMatch.lastStreamAtMs ?? lastStreamEventAtMs ?? null,
    lastOracleAtMs: trackedMatch.lastOracleAtMs,
    lastRpcAtMs: trackedMatch.lastRpcAtMs ?? lastSuccessfulRpcAtMs,
    circuitBreakerReason: plan?.risk.circuitBreaker.reason ?? null,
    lastResolvedAtMs: trackedMatch.lastResolvedAtMs,
    lastClaimAtMs: trackedMatch.lastClaimAtMs,
    recovery: buildTrackedMatchRecovery(trackedMatch, snapshot, grossExposure),
  };
}

async function captureSettledClobHealth(
  trackedMatch: ActiveClobMatch,
  lifecycleStatus: MarketSnapshot["lifecycleStatus"],
): Promise<void> {
  const marketState = await getClobMarketState(trackedMatch.marketState);
  const now = Date.now();
  await refreshManagedClobHealth(trackedMatch, marketState, now);
  trackedMatch.lastResolvedAtMs = now;
  trackedMatch.yesBidOrder = null;
  trackedMatch.noAskOrder = null;
  settledClobHealth.set(
    trackedMatch.duelId,
    buildManagedClobHealthRecord(trackedMatch, lifecycleStatus),
  );
  trimSettledClobHealth(now);
}

function buildBotRecoveryStates(now = Date.now()): KeeperRecoveryState[] {
  return [
    {
      code: "rpc-backoff",
      active: rpcBlockedUntil > now,
      sinceMs: rpcBlockedUntil > now ? now : null,
      untilMs: rpcBlockedUntil > now ? rpcBlockedUntil : null,
      details: rpcBlockedUntil > now ? "waiting for RPC backoff window" : null,
    },
    {
      code: "funding-backoff",
      active: fundingBlockedUntil > now,
      sinceMs: fundingBlockedUntil > now ? now : null,
      untilMs: fundingBlockedUntil > now ? fundingBlockedUntil : null,
      details:
        fundingBlockedUntil > now ? "bot signer funding below threshold" : null,
    },
    {
      code: "chain-backoff",
      active: chainCheckBlockedUntil > now,
      sinceMs: chainCheckBlockedUntil > now ? now : null,
      untilMs: chainCheckBlockedUntil > now ? chainCheckBlockedUntil : null,
      details:
        chainCheckBlockedUntil > now
          ? "keeper chain readiness check cooling down"
          : null,
    },
    {
      code: "restart-reconcile",
      active: restartRecoveryObservedAtMs != null,
      sinceMs: restartRecoveryObservedAtMs,
      untilMs: null,
      details: restartRecoveryDetails,
    },
    {
      code: "awaiting-result",
      active: unresolvedOracleWarningMatches.size > 0,
      sinceMs: unresolvedOracleWarningMatches.size > 0 ? now : null,
      untilMs: null,
      details:
        unresolvedOracleWarningMatches.size > 0
          ? `${unresolvedOracleWarningMatches.size} locked duel(s) waiting on authoritative result`
          : null,
    },
  ];
}

function writeBotHealthSnapshot(): void {
  if (!BOT_HEALTH_FILE) return;
  try {
    trimSettledClobHealth();
    const activeRecords = Array.from(activeClobMatches.values()).map((trackedMatch) =>
      buildManagedClobHealthRecord(trackedMatch),
    );
    const recentSettledRecords = Array.from(settledClobHealth.entries())
      .filter(([duelId]) => !activeClobMatches.has(duelId))
      .map(([, record]) => record);
    const snapshot: KeeperBotHealthSnapshot = {
      chainKey: "solana",
      updatedAtMs: Date.now(),
      bootedAtMs: botBootedAtMs,
      running: true,
      processId: typeof process.pid === "number" ? process.pid : null,
      lastSuccessfulRpcAtMs,
      recovery: buildBotRecoveryStates(),
      markets: [...activeRecords, ...recentSettledRecords],
    };
    fs_node.mkdirSync(path.dirname(BOT_HEALTH_FILE), { recursive: true });
    fs_node.writeFileSync(BOT_HEALTH_FILE, JSON.stringify(snapshot, null, 2));
  } catch (error) {
    console.warn("[bot] Failed to write bot health snapshot:", error);
  }
}

async function reportRoundResult(data: DuelLifecycleEvent): Promise<void> {
  const trackedMatch = activeClobMatches.get(data.duelId);
  if (!trackedMatch) {
    return;
  }

  if (!data.seed || !data.replayHash) {
    console.warn(
      `[Keeper] duel:completed for ${data.duelId} is missing seed or replayHash; refusing to post an unverifiable oracle result.`,
    );
    return;
  }

  const winnerId = data.winnerId;
  const winnerSide =
    winnerId && winnerId === data.agent1?.id
      ? "A"
      : winnerId && winnerId === data.agent2?.id
        ? "B"
        : null;
  if (!winnerSide) {
    console.warn(
      `[Keeper] duel:completed for ${data.duelId} supplied an unknown winner id; refusing to post oracle result.`,
    );
    return;
  }

  const replayHashHex = data.replayHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(replayHashHex)) {
    console.warn(
      `[Keeper] duel:completed for ${data.duelId} supplied an invalid replayHash; refusing to post oracle result.`,
    );
    return;
  }

  const resolvedSeed = data.seed;

  const duelState = await getDuelState(trackedMatch.duelState);
  if (duelState && enumIs(duelState.status, "resolved")) {
    await syncTrackedMarketFromOracle(trackedMatch);
    trackedMatch.lastResolvedAtMs = Date.now();
    await captureSettledClobHealth(trackedMatch, "RESOLVED");
    activeClobMatches.delete(data.duelId);
    unresolvedOracleWarningMatches.delete(data.duelId);
    writeBotHealthSnapshot();
    return;
  }

  const duelKey = duelKeyHexToBytes(data.duelKeyHex);
  const duelEndTs = Math.max(
    Math.floor((data.duelEndTime ?? Date.now()) / 1000),
    duelState ? asNum(duelState.betCloseTs) : 0,
  );

  console.log(
    `[Keeper] Waiting 15s before posting result for duel ${data.duelId} to sync with stream...`,
  );
  await sleep(15_000);

  await runWithRecovery(
    () =>
      fightProgram.methods
        .reportResult(
          Array.from(duelKey),
          winnerSideEnum(winnerSide),
          new BN(resolvedSeed),
          Array.from(Buffer.from(replayHashHex, "hex")),
          buildResultHash(
            data.duelKeyHex,
            winnerSide,
            resolvedSeed,
            replayHashHex,
          ),
          new BN(duelEndTs),
          buildDuelMetadata(data),
        )
        .accountsPartial({
          reporter: botKeypair.publicKey,
          oracleConfig: oracleConfigPda,
          duelState: trackedMatch.duelState,
        })
        .rpc(),
    connection,
  );
  const resolutionRecordedAt = markRpcSuccess(trackedMatch);
  trackedMatch.lastOracleAtMs = resolutionRecordedAt;
  trackedMatch.lastResolvedAtMs = resolutionRecordedAt;

  unresolvedOracleWarningMatches.delete(data.duelId);
  await syncTrackedMarketFromOracle(trackedMatch);
  await captureSettledClobHealth(trackedMatch, "RESOLVED");
  activeClobMatches.delete(data.duelId);

  console.log(
    JSON.stringify(
      {
        action: "clob_resolved",
        duelId: data.duelId,
        duelState: trackedMatch.duelState.toBase58(),
        marketState: trackedMatch.marketState.toBase58(),
        winner: winnerSide,
      },
      null,
      2,
    ),
  );
  writeBotHealthSnapshot();
}

// Event-driven Logic
const gameClient = new GameClient(args["game-url"]);

gameClient.onDuelStart(async (data) => {
  markStreamEvent();
  if (!keeperProgramApiReady) {
    warnMissingKeeperMethodsOnce();
    return;
  }

  if (!(await ensureKeeperChainReady())) {
    console.warn(
      "[bot] Skipping duel-start market creation because keeper chain is not ready.",
    );
    return;
  }

  if (!(await ensureBotSignerFunding())) {
    console.warn(
      "[bot] Skipping duel-start market creation because bot signer funding is below threshold.",
    );
    return;
  }

  console.log("Duel Started:", data);
  try {
    await ensureMarketConfigReady();
    const trackedMatch = await createOrSyncRound(data);
    activeClobMatches.set(data.duelId, trackedMatch);
    await maybeSeedMarket(trackedMatch);
    console.log(`Created canonical CLOB market for duel ${data.duelId}`);
  } catch (err) {
    console.error("Failed to create market for duel:", err);
  }
  writeBotHealthSnapshot();
});

gameClient.onBettingLocked(async (data) => {
  markStreamEvent(activeClobMatches.get(data.duelId) ?? null);
  if (!keeperProgramApiReady) {
    warnMissingKeeperMethodsOnce();
    return;
  }

  if (!(await ensureKeeperChainReady()) || !(await ensureBotSignerFunding())) {
    return;
  }

  try {
    await lockRound(data);
    console.log(`Locked duel market for ${data.duelId}`);
  } catch (error) {
    console.error("Failed to lock market for duel:", error);
  }
  writeBotHealthSnapshot();
});

gameClient.onDuelEnd(async (data) => {
  markStreamEvent(activeClobMatches.get(data.duelId) ?? null);
  if (!keeperProgramApiReady) {
    warnMissingKeeperMethodsOnce();
    return;
  }

  if (!(await ensureKeeperChainReady())) {
    console.warn(
      "[bot] Skipping duel-end resolution because keeper chain is not ready.",
    );
    return;
  }

  if (!(await ensureBotSignerFunding())) {
    console.warn(
      "[bot] Skipping duel-end resolution because bot signer funding is below threshold.",
    );
    return;
  }

  console.log("Duel Ended:", data);
  try {
    const winnerId = data.winnerId;
    const isAgent1 = winnerId === data.agent1?.id;

    // Update TrueSkill Ratings
    if (data.agent1?.id && data.agent2?.id) {
      const uA1 = getRating(data.agent1.id.toString());
      const uA2 = getRating(data.agent2.id.toString());

      const { winner, loser } = updateRatings(
        isAgent1 ? uA1 : uA2,
        isAgent1 ? uA2 : uA1,
      );

      agentRatings[data.agent1.id.toString()] = isAgent1 ? winner : loser;
      agentRatings[data.agent2.id.toString()] = isAgent1 ? loser : winner;
      saveRatings();

      const trackedModels = await fetchTrackedModels();
      const fallbackModels: TrackedModelEntry[] = [
        {
          rank: null,
          characterId: data.agent1.id.toString(),
          name: data.agent1?.name || data.agent1.id.toString(),
          provider: "",
          model: "",
          wins: 0,
          losses: 0,
          winRate: 0,
          combatLevel: 0,
          currentStreak: 0,
        },
        {
          rank: null,
          characterId: data.agent2.id.toString(),
          name: data.agent2?.name || data.agent2.id.toString(),
          provider: "",
          model: "",
          wins: 0,
          losses: 0,
          winRate: 0,
          combatLevel: 0,
          currentStreak: 0,
        },
      ];
      await syncPerpsOracles(
        trackedModels.length > 0 ? trackedModels : fallbackModels,
      );
    }
    await reportRoundResult(data);
    console.log(`Resolved market for duel ${data.duelId}`);
  } catch (err) {
    console.error("Failed to resolve market:", err);
  }
  writeBotHealthSnapshot();
});

writeBotHealthSnapshot();
gameClient.connect();

// Maintenance Loop (Seeding & Cleanup)
async function runMaintenance(): Promise<void> {
  if (!keeperProgramApiReady) {
    warnMissingKeeperMethodsOnce();
    return;
  }

  if (!(await ensureKeeperChainReady())) {
    return;
  }

  if (!(await ensureBotSignerFunding())) {
    return;
  }
  await ensureOracleReady();
  await ensurePerpsConfigReady();
  // ... (simplified loop for seeing liquidity and resolving old markets)
  await syncPerpsOraclesFromLeaderboard();
  if (PERPS_MARKET_MAKER_RECYCLE_ENABLED) {
    const perpsMarkets = loadPerpsMarkets().filter(
      (record) => record.status !== PERPS_MARKET_STATUS_ARCHIVED,
    );
    for (const record of perpsMarkets) {
      await maybeRecyclePerpsMarketMakerFees(record.marketId);
    }
  }
  await maybeArchiveSettledPerpsMarkets();

  // Poll only the actively tracked CLOB markets we created.
  for (const [duelId, trackedMatch] of activeClobMatches.entries()) {
    const duelState = await getDuelState(trackedMatch.duelState);
    if (!duelState) {
      continue;
    }

    await syncTrackedMarketFromOracle(trackedMatch);

    if (enumIs(duelState.status, "bettingOpen")) {
      await maybeSeedMarket(trackedMatch);
      continue;
    }

    if (enumIs(duelState.status, "locked")) {
      await cancelManagedClobQuotes(trackedMatch, "market-locked");
      await maybeWarnUnresolvedDuel(trackedMatch);
      continue;
    }

    if (enumIs(duelState.status, "resolved") || enumIs(duelState.status, "cancelled")) {
      trackedMatch.lastResolvedAtMs = trackedMatch.lastResolvedAtMs ?? Date.now();
      await captureSettledClobHealth(
        trackedMatch,
        enumIs(duelState.status, "cancelled") ? "CANCELLED" : "RESOLVED",
      );
      unresolvedOracleWarningMatches.delete(duelId);
      activeClobMatches.delete(duelId);
    }
  }

  // NOTE: We do NOT create new rounds here anymore.

  if (PERPS_LIQUIDATOR_ENABLED) {
    await runLiquidatorLoop();
  }
}

async function runLiquidatorLoop(): Promise<void> {
  if (!keeperProgramApiReady || !PERPS_LIQUIDATOR_ENABLED) return;
  try {
    const allPositions = await perpsProgram.account.positionState.all();
    const configPda = derivePerpsConfigPda();
    const configAcc =
      await perpsProgram.account.configState.fetchNullable(configPda);
    if (!configAcc) {
      return;
    }
    const maxOracleAgeSeconds = resolveOracleMaxAgeSeconds(
      asNum(configAcc.maxOracleStalenessSeconds),
      PERPS_MAX_ORACLE_STALENESS_SECONDS,
    );

    for (const pos of allPositions) {
      if (!pos.account.initialized || pos.account.size.eq(new BN(0))) continue;

      const marketId = asNum(pos.account.marketId);
      const marketPda = derivePerpsMarketPda(marketId);
      const marketAcc =
        await perpsProgram.account.marketState.fetchNullable(marketPda);
      if (!marketAcc?.initialized) continue;

      const oracleAgeSeconds =
        Math.floor(Date.now() / 1000) - asNum(marketAcc.oracleLastUpdated);
      if (oracleAgeSeconds > maxOracleAgeSeconds) {
        continue;
      }

      const sizeLamports = asBigInt(pos.account.size);
      if (sizeLamports === 0n) {
        continue;
      }
      const skewScaleLamports = asBigInt(marketAcc.skewScale);
      if (skewScaleLamports <= 0n) {
        console.error(
          `[Keeper] Skipping liquidation precheck for ${pos.publicKey.toBase58()}: invalid market skew scale`,
        );
        continue;
      }

      let equityLamports = 0n;
      const maintenanceLamports = calculateMaintenanceMarginLamports(
        sizeLamports,
        asNum(configAcc.maintenanceMarginBps),
      );
      try {
        equityLamports = estimatePositionEquityLamports(
          {
            entryPriceLamports: asBigInt(pos.account.entryPrice),
            lastFundingRate: asBigInt(pos.account.lastFundingRate),
            marginLamports: asBigInt(pos.account.margin),
            sizeLamports,
          },
          {
            currentFundingRate: asBigInt(marketAcc.currentFundingRate),
            oracleLastUpdatedSeconds: asNum(marketAcc.oracleLastUpdated),
            spotIndexLamports: asBigInt(marketAcc.spotIndex),
            totalLongOiLamports: asBigInt(marketAcc.totalLongOi),
            totalShortOiLamports: asBigInt(marketAcc.totalShortOi),
          },
          skewScaleLamports,
        );
      } catch (error) {
        console.error(
          `[Keeper] Skipping liquidation precheck for ${pos.publicKey.toBase58()}:`,
          error,
        );
        continue;
      }

      if (equityLamports < maintenanceLamports) {
        const sizeAbs = sizeLamports < 0n ? -sizeLamports : sizeLamports;
        const equityRatio = Number(equityLamports) / Number(sizeAbs || 1n);
        console.log(
          `[Keeper] Liquidating position ${pos.publicKey.toBase58()} (Equity ratio: ${(equityRatio * 100).toFixed(2)}%)`,
        );
        try {
          const marketIdBn = new BN(String(marketId));
          await runWithRecovery(
            () =>
              perpsProgram.methods
                .liquidatePosition(marketIdBn)
                .accountsPartial({
                  config: configPda,
                  market: marketPda,
                  position: pos.publicKey,
                  owner: pos.account.owner,
                  liquidator: botKeypair.publicKey,
                })
                .rpc(),
            connection,
          );
          console.log(
            `[Keeper] Liquidated position ${pos.publicKey.toBase58()}`,
          );
        } catch (e) {
          console.error(
            `[Keeper] Failed to liquidate ${pos.publicKey.toBase58()}:`,
            e,
          );
        }
      }
    }
  } catch (e) {
    console.error("[Keeper] Error in liquidator loop:", e);
  }
}

for (;;) {
  try {
    await runMaintenance();
  } catch (error) {
    if (isFundingError(error)) {
      fundingBlockedUntil = Date.now() + fundingBackoffMs;
    }
    console.error(`[bot] cycle failed: ${(error as Error).message}`);
  } finally {
    writeBotHealthSnapshot();
  }

  if (args.once) break;
  await sleep(args["poll-seconds"] * 1_000);
}
