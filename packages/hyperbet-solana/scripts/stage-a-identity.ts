import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SOLANA_STAGE_A_PROGRAMS = [
  {
    binaryName: "fight_oracle",
    envKeypairVar: "STAGE_A_FIGHT_ORACLE_PROGRAM_KEYPAIR",
    envIdVar: "STAGE_A_FIGHT_ORACLE_PROGRAM_ID",
  },
  {
    binaryName: "gold_clob_market",
    envKeypairVar: "STAGE_A_GOLD_CLOB_MARKET_PROGRAM_KEYPAIR",
    envIdVar: "STAGE_A_GOLD_CLOB_MARKET_PROGRAM_ID",
  },
  {
    binaryName: "lvr_amm",
    envKeypairVar: "STAGE_A_GOLD_AMM_PROGRAM_KEYPAIR",
    envIdVar: "STAGE_A_GOLD_AMM_PROGRAM_ID",
  },
  {
    binaryName: "gold_perps_market",
    envKeypairVar: "STAGE_A_GOLD_PERPS_PROGRAM_KEYPAIR",
    envIdVar: "STAGE_A_GOLD_PERPS_PROGRAM_ID",
  },
] as const;

export type StageAProgramBinaryName =
  (typeof SOLANA_STAGE_A_PROGRAMS)[number]["binaryName"];

export type StageAProgramManifest = {
  createdAt: string;
  syncedAt: string;
  root: string;
  programs: Record<StageAProgramBinaryName, string>;
};

function writeSecureFile(filepath: string, contents: string): void {
  writeFileSync(filepath, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(filepath, 0o600);
}

export function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

export function defaultStageARoot(): string {
  return path.join(repoRoot(), "keys", "stage-a");
}

export function resolveStageARoot(): string {
  const configured = process.env.STAGE_A_ROOT?.trim();
  return configured ? path.resolve(configured) : defaultStageARoot();
}

export function resolveStageAWalletPath(): string {
  const candidates = [
    process.env.SOLANA_STAGE_A_WALLET_PATH?.trim(),
    process.env.ANCHOR_WALLET?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    throw new Error(
      "Stage-A Solana wallet path is required via SOLANA_STAGE_A_WALLET_PATH or ANCHOR_WALLET",
    );
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }

  throw new Error(
    `Stage-A Solana wallet path does not exist. Checked: ${candidates.join(", ")}`,
  );
}

export function readKeypairPubkey(filepath: string): string {
  const secret = JSON.parse(readFileSync(filepath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
}

export function resolveStageAProgramKeysDir(): string {
  const configured = process.env.STAGE_A_SOLANA_PROGRAM_KEYS_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(resolveStageARoot(), "solana-programs");
}

export function resolveStageAProgramKeypairPath(
  binaryName: StageAProgramBinaryName,
): string {
  const configured = SOLANA_STAGE_A_PROGRAMS.find(
    (program) => program.binaryName === binaryName,
  );
  if (!configured) {
    throw new Error(`Unknown Stage-A Solana program '${binaryName}'`);
  }
  const explicit = process.env[configured.envKeypairVar]?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(resolveStageAProgramKeysDir(), `${binaryName}-keypair.json`);
}

function writeManifest(
  keysDir: string,
  createdAt: string,
  programs: Record<StageAProgramBinaryName, string>,
): StageAProgramManifest {
  const manifest: StageAProgramManifest = {
    createdAt,
    syncedAt: new Date().toISOString(),
    root: keysDir,
    programs,
  };
  writeSecureFile(
    path.join(keysDir, "program-addresses.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

export function syncStageAProgramKeypairs(
  anchorRoot: string,
  options: { rotate?: boolean } = {},
): StageAProgramManifest {
  const keysDir = resolveStageAProgramKeysDir();
  const deployDir = path.join(anchorRoot, "target", "deploy");
  mkdirSync(keysDir, { recursive: true });
  mkdirSync(deployDir, { recursive: true });

  const createdAt = new Date().toISOString();
  const programs = {} as Record<StageAProgramBinaryName, string>;

  for (const program of SOLANA_STAGE_A_PROGRAMS) {
    const durablePath = resolveStageAProgramKeypairPath(program.binaryName);
    if (options.rotate || !existsSync(durablePath)) {
      const keypair = Keypair.generate();
      writeSecureFile(
        durablePath,
        JSON.stringify(Array.from(keypair.secretKey)) + "\n",
      );
    }

    const address = readKeypairPubkey(durablePath);
    programs[program.binaryName] = address;
    copyFileSync(
      durablePath,
      path.join(deployDir, `${program.binaryName}-keypair.json`),
    );
  }

  return writeManifest(keysDir, createdAt, programs);
}
