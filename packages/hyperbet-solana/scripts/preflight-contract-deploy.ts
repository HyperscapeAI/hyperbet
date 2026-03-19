import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

import {
  BETTING_DEPLOYMENTS,
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

function parseTarget(argv: string[]): Target {
  const index = argv.findIndex((arg) => arg === "--target");
  const value = index >= 0 ? argv[index + 1] : "testnet";
  if (value === "testnet" || value === "mainnet") {
    return value;
  }
  throw new Error(`Unsupported --target value '${value}'`);
}

function parseOptionalCluster(argv: string[]): BettingSolanaCluster | null {
  const index = argv.findIndex((arg) => arg === "--cluster");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value) {
    throw new Error("Missing value for --cluster");
  }
  if (
    value === "localnet" ||
    value === "devnet" ||
    value === "testnet" ||
    value === "mainnet-beta"
  ) {
    return value;
  }
  throw new Error(`Unsupported --cluster value '${value}'`);
}

function parsePmOnly(argv: string[]): boolean {
  return argv.includes("--pm-only");
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

function getTargetCluster(target: Target): BettingSolanaCluster {
  return target === "mainnet" ? "mainnet-beta" : "testnet";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = parseTarget(argv);
  const explicitCluster = parseOptionalCluster(argv);
  const pmOnly = parsePmOnly(argv);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const bettingDir = path.resolve(__dirname, "..");
  const anchorDir = path.join(bettingDir, "anchor");
  const appDir = path.join(bettingDir, "app");
  const keeperDir = path.join(bettingDir, "keeper");

  const failures: string[] = [];
  const warnings: string[] = [];
  const cluster = explicitCluster ?? getTargetCluster(target);
  const solanaDeployment = BETTING_DEPLOYMENTS.solana[cluster];
  const programs = pmOnly
    ? PROGRAMS.filter((program) => program.key !== "goldPerpsMarket")
    : PROGRAMS;

  console.log(`[preflight] target=${target}`);
  console.log(`[preflight] solana cluster=${cluster}`);
  console.log(`[preflight] scope=${pmOnly ? "pm-only" : "all"}`);

  for (const program of programs) {
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

  if (warnings.length > 0) {
    console.log(`[preflight] warnings=${warnings.length}`);
  }
  if (failures.length > 0) {
    console.log(`[preflight] failures=${failures.length}`);
    process.exitCode = 1;
    return;
  }

  console.log("[preflight] all required Solana checks passed");
}

void main().catch((error) => {
  console.error("[preflight] failed:", error);
  process.exitCode = 1;
});
