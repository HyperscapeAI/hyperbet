import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

import {
  BETTING_DEPLOYMENTS,
  type BettingEvmNetwork,
  type BettingSolanaCluster,
} from "../deployments";

type Target = "testnet" | "mainnet";
type ProgramKey = "fightOracle" | "goldClobMarket" | "goldPerpsMarket";

interface SolanaProgramCheck {
  key: ProgramKey;
  binaryName: "fight_oracle" | "gold_clob_market" | "gold_perps_market";
  manifestField:
    | "fightOracleProgramId"
    | "goldClobMarketProgramId"
    | "goldPerpsMarketProgramId";
}

const PROGRAMS: SolanaProgramCheck[] = [
  {
    key: "fightOracle",
    binaryName: "fight_oracle",
    manifestField: "fightOracleProgramId",
  },
  {
    key: "goldClobMarket",
    binaryName: "gold_clob_market",
    manifestField: "goldClobMarketProgramId",
  },
  {
    key: "goldPerpsMarket",
    binaryName: "gold_perps_market",
    manifestField: "goldPerpsMarketProgramId",
  },
] as const;

const HARDHAT_RPC_FALLBACKS: Record<BettingEvmNetwork, string> = {
  bscTestnet: "https://data-seed-prebsc-1-s1.binance.org:8545",
  baseSepolia: "https://sepolia.base.org",
  bsc: "https://bsc-dataseed.binance.org",
  base: "https://mainnet.base.org",
};

function parseTarget(argv: string[]): Target {
  const index = argv.findIndex((arg) => arg === "--target");
  const value = index >= 0 ? argv[index + 1] : "testnet";
  if (value === "testnet" || value === "mainnet") {
    return value;
  }
  throw new Error(`Unsupported --target value '${value}'`);
}

function parseDotEnv(filepath: string): Record<string, string> {
  if (!fs.existsSync(filepath)) return {};
  const body = fs.readFileSync(filepath, "utf8");
  const env: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    env[key] = value;
  }
  return env;
}

function readJson(filepath: string): unknown {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function readIdlAddress(filepath: string): string | null {
  if (!fs.existsSync(filepath)) return null;
  const parsed = readJson(filepath) as {
    address?: unknown;
    metadata?: { address?: unknown };
  };
  const direct =
    typeof parsed.address === "string" ? parsed.address.trim() : "";
  if (direct.length > 0) return direct;
  const metadata =
    typeof parsed.metadata?.address === "string"
      ? parsed.metadata.address.trim()
      : "";
  return metadata.length > 0 ? metadata : null;
}

function readKeypairPubkey(filepath: string): string | null {
  if (!fs.existsSync(filepath)) return null;
  const secret = readJson(filepath);
  if (!Array.isArray(secret)) return null;
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret as number[]));
  return keypair.publicKey.toBase58();
}

function appendStatus(
  ok: boolean,
  message: string,
  failures: string[],
  warnings: string[],
  warning = false,
): void {
  const prefix = ok ? "[ok]" : warning ? "[warn]" : "[fail]";
  console.log(`${prefix} ${message}`);
  if (!ok) {
    if (warning) warnings.push(message);
    else failures.push(message);
  }
}

function loadMergedEvmEnv(evmDir: string): Record<string, string> {
  return {
    ...parseDotEnv(path.join(evmDir, ".env")),
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
}

function getTargetNetworks(target: Target): BettingEvmNetwork[] {
  return target === "mainnet" ? ["bsc", "base"] : ["bscTestnet", "baseSepolia"];
}

function getTargetCluster(target: Target): BettingSolanaCluster {
  return target === "mainnet" ? "mainnet-beta" : "testnet";
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv.slice(2));
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const bettingDir = path.resolve(__dirname, "..");
  const anchorDir = path.resolve(bettingDir, "..", "hyperbet-solana", "anchor");
  const evmDir = path.resolve(bettingDir, "..", "evm-contracts");
  const appDir = path.join(bettingDir, "app");
  const keeperDir = path.join(bettingDir, "keeper");

  const failures: string[] = [];
  const warnings: string[] = [];
  const cluster = getTargetCluster(target);
  const solanaDeployment = BETTING_DEPLOYMENTS.solana[cluster];

  console.log(`[preflight] target=${target}`);
  console.log(`[preflight] solana cluster=${cluster}`);

  for (const program of PROGRAMS) {
    const expected = solanaDeployment[program.manifestField];
    const keypairPath = path.join(
      anchorDir,
      "target",
      "deploy",
      `${program.binaryName}-keypair.json`,
    );
    const anchorIdlPath = path.join(
      anchorDir,
      "target",
      "idl",
      `${program.binaryName}.json`,
    );
    const appIdlPath = path.join(
      appDir,
      "src",
      "idl",
      `${program.binaryName}.json`,
    );
    const keeperIdlPath = path.join(
      keeperDir,
      "src",
      "idl",
      `${program.binaryName}.json`,
    );

    const keypairPubkey = readKeypairPubkey(keypairPath);
    appendStatus(
      keypairPubkey === expected,
      `${program.binaryName} keypair pubkey matches manifest (${expected})`,
      failures,
      warnings,
    );

    const anchorIdlAddress = readIdlAddress(anchorIdlPath);
    appendStatus(
      anchorIdlAddress === expected,
      `${program.binaryName} anchor IDL matches manifest (${expected})`,
      failures,
      warnings,
      !anchorIdlAddress,
    );

    const appIdlAddress = readIdlAddress(appIdlPath);
    appendStatus(
      appIdlAddress === expected,
      `${program.binaryName} app IDL matches manifest (${expected})`,
      failures,
      warnings,
      !appIdlAddress,
    );

    const keeperIdlAddress = readIdlAddress(keeperIdlPath);
    appendStatus(
      keeperIdlAddress === expected,
      `${program.binaryName} keeper IDL matches manifest (${expected})`,
      failures,
      warnings,
      !keeperIdlAddress,
    );
  }

  const evmEnv = loadMergedEvmEnv(evmDir);
  const requiredSharedEnv = [
    "PRIVATE_KEY",
    "ADMIN_ADDRESS",
    "MARKET_OPERATOR_ADDRESS",
    "REPORTER_ADDRESS",
    "TREASURY_ADDRESS",
    "MARKET_MAKER_ADDRESS",
  ] as const;
  for (const envName of requiredSharedEnv) {
    appendStatus(
      typeof evmEnv[envName] === "string" && evmEnv[envName].trim().length > 0,
      `EVM deploy env provides ${envName}`,
      failures,
      warnings,
    );
  }

  for (const network of getTargetNetworks(target)) {
    const deployment = BETTING_DEPLOYMENTS.evm[network];
    const rpcConfigured =
      typeof evmEnv[deployment.rpcEnvVar] === "string" &&
      evmEnv[deployment.rpcEnvVar]!.trim().length > 0;
    const fallbackRpc = HARDHAT_RPC_FALLBACKS[network];
    const rpcAvailable = rpcConfigured || fallbackRpc.trim().length > 0;
    const rpcMessage = rpcConfigured
      ? `${deployment.label} deploy RPC env ${deployment.rpcEnvVar} is configured`
      : `${deployment.label} deploy RPC env ${deployment.rpcEnvVar} is missing; using Hardhat fallback ${fallbackRpc}`;
    appendStatus(rpcAvailable, rpcMessage, failures, warnings, !rpcConfigured);

    const hasClobAddress = deployment.goldClobAddress.trim().length > 0;
    const hasOracleAddress = deployment.duelOracleAddress.trim().length > 0;
    appendStatus(
      hasOracleAddress,
      `${deployment.label} DuelOutcomeOracle address is ${hasOracleAddress ? "present" : "pending"} in deployment manifest`,
      failures,
      warnings,
      true,
    );
    appendStatus(
      hasClobAddress,
      `${deployment.label} GoldClob address is ${hasClobAddress ? "present" : "pending"} in deployment manifest`,
      failures,
      warnings,
      true,
    );
    appendStatus(
      deployment.deploymentVersion === "v2",
      `${deployment.label} deployment manifest version is ${deployment.deploymentVersion}`,
      failures,
      warnings,
      true,
    );
  }

  if (warnings.length > 0) {
    console.log(`[preflight] warnings=${warnings.length}`);
  }
  if (failures.length > 0) {
    console.log(`[preflight] failures=${failures.length}`);
    process.exitCode = 1;
    return;
  }

  console.log("[preflight] all required checks passed");
}

void main().catch((error) => {
  console.error("[preflight] failed:", error);
  process.exitCode = 1;
});
