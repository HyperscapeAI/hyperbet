import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BETTING_DEPLOYMENTS,
  type BettingEvmNetwork,
} from "../deployments";

type Target = "testnet" | "mainnet";

// Public RPC fallbacks used when no private RPC env var is configured.
const HARDHAT_RPC_FALLBACKS: Record<BettingEvmNetwork, string> = {
  bscTestnet: "https://data-seed-prebsc-1-s1.binance.org:8545",
  bsc: "https://bsc-dataseed.binance.org",
  baseSepolia: "https://sepolia.base.org",
  base: "https://mainnet.base.org",
  avaxFuji: "https://api.avax-test.network/ext/bc/C/rpc",
  avax: "https://api.avax.network/ext/bc/C/rpc",
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
  return target === "mainnet"
    ? ["base", "bsc", "avax"]
    : ["baseSepolia", "bscTestnet", "avaxFuji"];
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv.slice(2));
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const bettingDir = path.resolve(__dirname, "..");
  const evmDir = path.resolve(bettingDir, "..", "evm-contracts");

  const failures: string[] = [];
  const warnings: string[] = [];

  console.log(`[preflight] target=${target} (hyperbet-evm canonical EVM package)`);

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
