import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, clusterApiUrl } from "@solana/web3.js";

import { resolveBettingSolanaDeployment, type BettingSolanaCluster } from "../deployments";

const execFile = promisify(execFileCb);

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
  const candidates = [
    process.env.SOLANA_STAGE_A_WALLET_PATH,
    process.env.ANCHOR_WALLET,
    path.join(process.env.HOME ?? "", ".config/solana/hyperscape-keys/deployer.json"),
    path.join(process.env.HOME ?? "", ".config/solana/id.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
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

function appendCheck(
  ok: boolean,
  message: string,
  failures: string[],
  warnings: string[],
  warning = false,
): void {
  const prefix = ok ? "[ok]" : warning ? "[warn]" : "[fail]";
  console.log(`${prefix} ${message}`);
  if (ok) return;
  if (warning) warnings.push(message);
  else failures.push(message);
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
  const expectedDisputeWindow = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  const expectedAuthority = process.env.SOLANA_EXPECTED_AUTHORITY?.trim() || null;
  const expectedUpgradeAuthority =
    process.env.SOLANA_EXPECTED_UPGRADE_AUTHORITY?.trim() || null;
  const walletPath = resolveWalletPath();

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

  const failures: string[] = [];
  const warnings: string[] = [];

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
  const oracleConfig = await oracleProgram.account.oracleConfig.fetchNullable(oracleConfigPda);
  const marketConfig = await clobProgram.account.marketConfig.fetchNullable(marketConfigPda);

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
      !pmOnly,
    );
    if (expectedAuthority) {
      appendCheck(
        oracleConfig.authority.toBase58() === expectedAuthority,
        `oracle authority matches expected ${expectedAuthority}`,
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
      !pmOnly,
    );
    if (expectedAuthority) {
      appendCheck(
        marketConfig.authority.toBase58() === expectedAuthority,
        `market config authority matches expected ${expectedAuthority}`,
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

  const summary = {
    cluster,
    pmOnly,
    rpcUrl,
    oracleProgramId: oracleProgramId.toBase58(),
    goldClobProgramId: clobProgramId.toBase58(),
    oracleConfigPda: oracleConfigPda.toBase58(),
    marketConfigPda: marketConfigPda.toBase58(),
    fightUpgradeAuthority,
    goldClobUpgradeAuthority: clobUpgradeAuthority,
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
