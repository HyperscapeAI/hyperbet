import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";

import { resolveBettingSolanaDeployment, type BettingSolanaCluster } from "../deployments";

const { Program } = anchor;
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

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
  [--cluster devnet|testnet|mainnet-beta|localnet] [--freeze] [--out <path>]

env:
  DISPUTE_WINDOW_SECONDS   default 3600; must be >= 60 (on-chain minimum)
  ANCHOR_WALLET            path to authority keypair (upgrade authority)

optional role overrides (base58 Solana pubkeys; default = deployer):
  SOLANA_PM_REPORTER_PUBKEY   SOLANA_PM_FINALIZER_PUBKEY   SOLANA_PM_CHALLENGER_PUBKEY
  SOLANA_PM_MARKET_OPERATOR_PUBKEY   SOLANA_PM_TREASURY_PUBKEY   SOLANA_PM_MARKET_MAKER_PUBKEY
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
  const candidates = [
    process.env.ANCHOR_WALLET,
    path.join(process.env.HOME ?? "", ".config/solana/hyperscape-keys/deployer.json"),
    path.join(process.env.HOME ?? "", ".config/solana/id.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No Solana deploy wallet found. Checked: ${candidates.join(", ")}`);
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
  return PublicKey.findProgramAddressSync([Buffer.from("oracle_config")], programId)[0];
}

function deriveMarketConfigPda(programId: PublicKey): PublicKey {
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

/** Optional base58 pubkeys; default to deployer. EVM *ADDRESS* env vars are not valid here. */
function optionalSolanaPubkey(envName: string, fallback: PublicKey): PublicKey {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`${envName} must be a valid base58 Solana public key`);
  }
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
    marketOperator: optionalSolanaPubkey("SOLANA_PM_MARKET_OPERATOR_PUBKEY", authority),
    treasury: optionalSolanaPubkey("SOLANA_PM_TREASURY_PUBKEY", authority),
    marketMaker: optionalSolanaPubkey("SOLANA_PM_MARKET_MAKER_PUBKEY", authority),
  };
}

const DEFAULT_TRADE_TREASURY_FEE_BPS = 100;
const DEFAULT_TRADE_MM_FEE_BPS = 100;
const DEFAULT_WINNINGS_MM_FEE_BPS = 200;

function oracleStateMatches(
  existing: NonNullable<Awaited<ReturnType<Program["account"]["oracleConfig"]["fetchNullable"]>>>,
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
  existing: NonNullable<Awaited<ReturnType<Program["account"]["marketConfig"]["fetchNullable"]>>>,
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

async function ensureOracleConfig(
  program: Program,
  authority: Keypair,
  disputeWindowSecs: number,
): Promise<PublicKey> {
  const { reporter, finalizer, challenger } = resolveOracleRoleKeys(authority.publicKey);
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const existing = await program.account.oracleConfig.fetchNullable(oracleConfig);
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

async function ensureMarketConfig(program: Program, authority: Keypair): Promise<PublicKey> {
  const { marketOperator, treasury, marketMaker } = resolveMarketRoleKeys(authority.publicKey);
  const config = deriveMarketConfigPda(program.programId);
  const existing = await program.account.marketConfig.fetchNullable(config);
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

async function maybeFreezeOracle(program: Program, authority: Keypair, oracleConfig: PublicKey): Promise<string | null> {
  const account = await program.account.oracleConfig.fetch(oracleConfig);
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

async function maybeFreezeMarket(program: Program, authority: Keypair, config: PublicKey): Promise<string | null> {
  const account = await program.account.marketConfig.fetch(config);
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

async function main(): Promise<void> {
  if (hasFlag("--help")) usage();

  const cluster = parseCluster();
  const freeze = hasFlag("--freeze");
  const outPath = parseArg("--out");
  const disputeWindowSecs = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  if (!Number.isFinite(disputeWindowSecs) || disputeWindowSecs <= 0) {
    throw new Error(`Invalid DISPUTE_WINDOW_SECONDS '${process.env.DISPUTE_WINDOW_SECONDS ?? ""}'`);
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
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });

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

  const oracleConfig = await ensureOracleConfig(oracleProgram, authority, disputeWindowSecs);
  const marketConfig = await ensureMarketConfig(clobProgram, authority);
  const freezeOracleTx = freeze ? await maybeFreezeOracle(oracleProgram, authority, oracleConfig) : null;
  const freezeMarketTx = freeze ? await maybeFreezeMarket(clobProgram, authority, marketConfig) : null;

  const oracleAccount = await oracleProgram.account.oracleConfig.fetch(oracleConfig);
  const marketAccount = await clobProgram.account.marketConfig.fetch(marketConfig);

  const summary = {
    cluster,
    rpcUrl,
    authority: authority.publicKey.toBase58(),
    oracleProgramId: oracleProgramId.toBase58(),
    goldClobProgramId: clobProgramId.toBase58(),
    oracleConfig: oracleConfig.toBase58(),
    marketConfig: marketConfig.toBase58(),
    freezeRequested: freeze,
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
      treasury: marketAccount.treasury.toBase58(),
      marketMaker: marketAccount.marketMaker.toBase58(),
      tradeTreasuryFeeBps: marketAccount.tradeTreasuryFeeBps,
      tradeMarketMakerFeeBps: marketAccount.tradeMarketMakerFeeBps,
      winningsMarketMakerFeeBps: marketAccount.winningsMarketMakerFeeBps,
      orderPlacementPaused: marketAccount.orderPlacementPaused,
      marketCreationPaused: marketAccount.marketCreationPaused,
      configFrozen: marketAccount.configFrozen,
    },
  };

  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
