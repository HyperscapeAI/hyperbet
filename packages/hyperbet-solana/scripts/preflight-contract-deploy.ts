import fs from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PublicKey, clusterApiUrl } from "@solana/web3.js";

import {
  BETTING_DEPLOYMENTS,
  type BettingSolanaCluster,
} from "../deployments";
import {
  readKeypairPubkey,
  resolveStageAProgramKeypairPath,
  resolveStageAWalletPath,
  syncStageAProgramKeypairs,
} from "./stage-a-identity";

type Target = "testnet" | "mainnet";
type ProgramKey =
  | "fightOracle"
  | "goldClobMarket"
  | "goldAmmMarket"
  | "goldPerpsMarket";

interface SolanaProgramCheck {
  key: ProgramKey;
  binaryName:
    | "fight_oracle"
    | "gold_clob_market"
    | "lvr_amm"
    | "gold_perps_market";
  manifestField:
    | "fightOracleProgramId"
    | "goldClobMarketProgramId"
    | "goldAmmMarketProgramId"
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
    key: "goldAmmMarket",
    binaryName: "lvr_amm",
    manifestField: "goldAmmMarketProgramId",
  },
  {
    key: "goldPerpsMarket",
    binaryName: "gold_perps_market",
    manifestField: "goldPerpsMarketProgramId",
  },
] as const;

const execFile = promisify(execFileCb);

function usage(): never {
  console.log(
    "usage: bun run packages/hyperbet-solana/scripts/preflight-contract-deploy.ts [--target testnet|mainnet] [--cluster localnet|devnet|testnet|mainnet-beta] [--pm-only]",
  );
  process.exit(0);
}

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

function resolveRpcUrl(cluster: BettingSolanaCluster): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(cluster === "mainnet-beta" ? "mainnet-beta" : cluster);
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

function resolveExpectedUpgradeAuthority(walletPath: string): string | null {
  const explicit = process.env.SOLANA_EXPECTED_UPGRADE_AUTHORITY?.trim() || null;
  if (explicit) {
    return new PublicKey(explicit).toBase58();
  }
  return readKeypairPubkey(walletPath);
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

async function readProgramInfo(
  rpcUrl: string,
  programId: string,
): Promise<{ exists: boolean; executable: boolean }> {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [
      programId,
      {
        encoding: "base64",
        commitment: "confirmed",
      },
    ],
  });
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }
  const json = (await response.json()) as {
    result?: { value?: { executable?: boolean } | null };
  };
  const value = json.result?.value ?? null;
  return {
    exists: value !== null,
    executable: value?.executable === true,
  };
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
  if (argv.includes("--help")) usage();
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
  const rpcUrl = resolveRpcUrl(cluster);
  const walletPath = resolveStageAWalletPath();
  if (cluster !== "mainnet-beta") {
    syncStageAProgramKeypairs(anchorDir);
  }
  const expectedUpgradeAuthority = resolveExpectedUpgradeAuthority(walletPath);
  const programs = pmOnly
    ? PROGRAMS.filter(
        (program) =>
          program.key !== "goldAmmMarket" && program.key !== "goldPerpsMarket",
      )
    : PROGRAMS;

  console.log(`[preflight] target=${target}`);
  console.log(`[preflight] solana cluster=${cluster}`);
  console.log(`[preflight] scope=${pmOnly ? "pm-only" : "all"}`);
  console.log(`[preflight] rpc=${rpcUrl}`);
  if (walletPath) {
    console.log(`[preflight] wallet=${walletPath}`);
  }

  for (const program of programs) {
    const expected = solanaDeployment[program.manifestField];
    const keypairPath =
      cluster === "mainnet-beta"
        ? path.join(
            anchorDir,
            "target",
            "deploy",
            `${program.binaryName}-keypair.json`,
          )
        : resolveStageAProgramKeypairPath(program.binaryName);
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
    const programInfo = await readProgramInfo(rpcUrl, expected);
    const deploymentMode = programInfo.exists ? "upgrade" : "fresh-deploy";
    const upgradeAuthority = programInfo.exists
      ? await readUpgradeAuthority(expected, cluster, walletPath)
      : null;

    appendStatus(
      programInfo.exists ? programInfo.executable : true,
      `${program.binaryName} ${deploymentMode} mode selected for ${expected}`,
      failures,
      warnings,
    );

    const keypairPubkey = fs.existsSync(keypairPath)
      ? readKeypairPubkey(keypairPath)
      : null;
    if (deploymentMode === "fresh-deploy") {
      appendStatus(
        keypairPubkey === expected,
        `${program.binaryName} fresh-deploy keypair pubkey matches manifest (${expected})`,
        failures,
        warnings,
      );
    } else {
      appendStatus(
        keypairPubkey === expected,
        `${program.binaryName} local keypair pubkey matches manifest (${expected})`,
        failures,
        warnings,
        true,
      );
      if (expectedUpgradeAuthority) {
        appendStatus(
          upgradeAuthority === expectedUpgradeAuthority,
          `${program.binaryName} upgrade authority matches expected ${expectedUpgradeAuthority}`,
          failures,
          warnings,
        );
      } else {
        appendStatus(
          Boolean(upgradeAuthority),
          `${program.binaryName} upgrade authority is ${upgradeAuthority ?? "unavailable"}`,
          failures,
          warnings,
          true,
        );
      }
    }

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
