import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type EvmWalletFile = {
  role: string;
  address: string;
  privateKey: string;
};

type Options = {
  walletDir: string;
  format: "shell" | "env";
};

function parseArgs(): Options {
  const dirFlagIndex = process.argv.indexOf("--dir");
  const formatFlagIndex = process.argv.indexOf("--format");
  const walletDir =
    dirFlagIndex >= 0 && process.argv[dirFlagIndex + 1]
      ? path.resolve(process.cwd(), process.argv[dirFlagIndex + 1])
      : path.join(ROOT_DIR, "keys", "stage-a");
  const formatValue =
    formatFlagIndex >= 0 && process.argv[formatFlagIndex + 1]
      ? process.argv[formatFlagIndex + 1]
      : "shell";
  if (formatValue !== "shell" && formatValue !== "env") {
    throw new Error(`Unsupported format '${formatValue}'`);
  }
  return { walletDir, format: formatValue };
}

function readEvmWallet(walletDir: string, role: string): EvmWalletFile {
  return JSON.parse(
    readFileSync(path.join(walletDir, "evm", `${role}.json`), "utf8"),
  ) as EvmWalletFile;
}

function readSolanaAddress(walletDir: string, role: string): string {
  const bytes = JSON.parse(
    readFileSync(path.join(walletDir, "solana", `${role}.json`), "utf8"),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
}

function readSolanaProgramAddress(walletDir: string, program: string): string {
  const bytes = JSON.parse(
    readFileSync(
      path.join(walletDir, "solana-programs", `${program}-keypair.json`),
      "utf8",
    ),
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
}

function quote(value: string, format: "shell" | "env"): string {
  if (format === "env") return value;
  return JSON.stringify(value);
}

function emit(name: string, value: string, format: "shell" | "env"): string {
  return format === "env"
    ? `${name}=${value}`
    : `export ${name}=${quote(value, format)}`;
}

function maybeReadTokenAddresses(walletDir: string): Record<string, string> {
  const filepath = path.join(walletDir, "token-addresses.json");
  try {
    return JSON.parse(readFileSync(filepath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function main(): void {
  const options = parseArgs();
  const deployer = readEvmWallet(options.walletDir, "deployer");
  const admin = readEvmWallet(options.walletDir, "admin");
  const reporter = readEvmWallet(options.walletDir, "reporter");
  const finalizer = readEvmWallet(options.walletDir, "finalizer");
  const challenger = readEvmWallet(options.walletDir, "challenger");
  const pauser = readEvmWallet(options.walletDir, "pauser");
  const treasury = readEvmWallet(options.walletDir, "treasury");
  const marketOperator = readEvmWallet(options.walletDir, "market_operator");
  const marketMaker = readEvmWallet(options.walletDir, "market_maker");
  const keeper = readEvmWallet(options.walletDir, "keeper");
  const canary = readEvmWallet(options.walletDir, "canary");
  const matcher = readEvmWallet(options.walletDir, "matcher");

  const solanaDeployerPath = path.join(options.walletDir, "solana", "deployer.json");
  const solanaOracleAuthorityPath = path.join(
    options.walletDir,
    "solana",
    "oracle_authority.json",
  );
  const solanaKeeperPath = path.join(options.walletDir, "solana", "keeper.json");
  const solanaCanaryPath = path.join(options.walletDir, "solana", "canary.json");
  const solanaMarketMakerPath = path.join(
    options.walletDir,
    "solana",
    "market_maker.json",
  );
  const solanaProgramsDir = path.join(options.walletDir, "solana-programs");
  const solanaDeployerValue = readFileSync(solanaDeployerPath, "utf8").trim();
  const solanaDeployerAddress = readSolanaAddress(options.walletDir, "deployer");
  const tokenAddresses = maybeReadTokenAddresses(options.walletDir);

  const lines = [
    emit("PRIVATE_KEY", deployer.privateKey, options.format),
    emit("BSC_TESTNET_PRIVATE_KEY", deployer.privateKey, options.format),
    emit("AVAX_FUJI_PRIVATE_KEY", deployer.privateKey, options.format),
    emit("TESTNET_DEPLOYER_PRIVATE_KEY", deployer.privateKey, options.format),
    emit("TESTNET_ADMIN_PRIVATE_KEY", admin.privateKey, options.format),
    emit("ADMIN_ADDRESS", admin.address, options.format),
    emit("TESTNET_REPORTER_PRIVATE_KEY", reporter.privateKey, options.format),
    emit("REPORTER_ADDRESS", reporter.address, options.format),
    emit("TESTNET_FINALIZER_PRIVATE_KEY", finalizer.privateKey, options.format),
    emit("FINALIZER_ADDRESS", finalizer.address, options.format),
    emit("TESTNET_CHALLENGER_PRIVATE_KEY", challenger.privateKey, options.format),
    emit("CHALLENGER_ADDRESS", challenger.address, options.format),
    emit("TESTNET_PAUSER_PRIVATE_KEY", pauser.privateKey, options.format),
    emit("PAUSER_ADDRESS", pauser.address, options.format),
    emit("TESTNET_TREASURY_PRIVATE_KEY", treasury.privateKey, options.format),
    emit("TREASURY_ADDRESS", treasury.address, options.format),
    emit("TESTNET_MARKET_OPERATOR_PRIVATE_KEY", marketOperator.privateKey, options.format),
    emit("MARKET_OPERATOR_ADDRESS", marketOperator.address, options.format),
    emit("TESTNET_MARKET_MAKER_PRIVATE_KEY", marketMaker.privateKey, options.format),
    emit("MARKET_MAKER_ADDRESS", marketMaker.address, options.format),
    emit("EVM_KEEPER_PRIVATE_KEY", keeper.privateKey, options.format),
    emit("CANARY_PRIVATE_KEY", canary.privateKey, options.format),
    emit("MATCHER_PRIVATE_KEY", matcher.privateKey, options.format),
    emit("LOCAL_STAGE_A_EVM_KEEPER_ADDRESS", keeper.address, options.format),
    emit("LOCAL_STAGE_A_EVM_CANARY_ADDRESS", canary.address, options.format),
    emit("LOCAL_STAGE_A_EVM_MATCHER_ADDRESS", matcher.address, options.format),
    emit("TESTNET_SOLANA_DEPLOYER_KEYPAIR", solanaDeployerValue, options.format),
    emit("ANCHOR_WALLET", solanaDeployerPath, options.format),
    emit("SOLANA_STAGE_A_WALLET_PATH", solanaDeployerPath, options.format),
    emit("BOT_KEYPAIR", solanaKeeperPath, options.format),
    emit("ORACLE_AUTHORITY_KEYPAIR", solanaOracleAuthorityPath, options.format),
    emit("MARKET_MAKER_KEYPAIR", solanaMarketMakerPath, options.format),
    emit("SOLANA_CANARY_KEYPAIR", solanaCanaryPath, options.format),
    emit(
      "SOLANA_EXPECTED_AUTHORITY",
      solanaDeployerAddress,
      options.format,
    ),
    emit(
      "SOLANA_EXPECTED_UPGRADE_AUTHORITY",
      solanaDeployerAddress,
      options.format,
    ),
    emit(
      "STAGE_A_SOLANA_PROGRAM_KEYS_DIR",
      solanaProgramsDir,
      options.format,
    ),
    emit(
      "STAGE_A_FIGHT_ORACLE_PROGRAM_KEYPAIR",
      path.join(solanaProgramsDir, "fight_oracle-keypair.json"),
      options.format,
    ),
    emit(
      "STAGE_A_DUEL_MARKET_PROGRAM_KEYPAIR",
      path.join(solanaProgramsDir, "duel_market-keypair.json"),
      options.format,
    ),
    emit(
      "STAGE_A_GOLD_AMM_PROGRAM_KEYPAIR",
      path.join(solanaProgramsDir, "lvr_amm-keypair.json"),
      options.format,
    ),
    emit(
      "STAGE_A_GOLD_PERPS_PROGRAM_KEYPAIR",
      path.join(solanaProgramsDir, "gold_perps_market-keypair.json"),
      options.format,
    ),
    emit(
      "STAGE_A_FIGHT_ORACLE_PROGRAM_ID",
      readSolanaProgramAddress(options.walletDir, "fight_oracle"),
      options.format,
    ),
    emit(
      "STAGE_A_DUEL_MARKET_PROGRAM_ID",
      readSolanaProgramAddress(options.walletDir, "duel_market"),
      options.format,
    ),
    emit(
      "STAGE_A_GOLD_AMM_PROGRAM_ID",
      readSolanaProgramAddress(options.walletDir, "lvr_amm"),
      options.format,
    ),
    emit(
      "STAGE_A_GOLD_PERPS_PROGRAM_ID",
      readSolanaProgramAddress(options.walletDir, "gold_perps_market"),
      options.format,
    ),
    emit(
      "LOCAL_STAGE_A_SOLANA_DEPLOYER_ADDRESS",
      solanaDeployerAddress,
      options.format,
    ),
    emit(
      "LOCAL_STAGE_A_SOLANA_KEEPER_ADDRESS",
      readSolanaAddress(options.walletDir, "keeper"),
      options.format,
    ),
    emit(
      "LOCAL_STAGE_A_SOLANA_CANARY_ADDRESS",
      readSolanaAddress(options.walletDir, "canary"),
      options.format,
    ),
    emit(
      "LOCAL_STAGE_A_SOLANA_MARKET_MAKER_ADDRESS",
      readSolanaAddress(options.walletDir, "market_maker"),
      options.format,
    ),
  ];

  for (const [key, value] of Object.entries(tokenAddresses)) {
    lines.push(emit(key, value, options.format));
  }

  console.log(lines.join("\n"));
}

main();
