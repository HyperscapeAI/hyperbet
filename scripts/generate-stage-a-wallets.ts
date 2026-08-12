import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Keypair } from "@solana/web3.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EVM_ROLES = [
  "deployer",
  "admin",
  "reporter",
  "finalizer",
  "challenger",
  "pauser",
  "treasury",
  "market_operator",
  "market_maker",
  "keeper",
  "canary",
  "matcher",
  "multisig_signer_1",
  "multisig_signer_2",
  "multisig_signer_3",
] as const;

const SOLANA_ROLES = [
  "deployer",
  "oracle_authority",
  "keeper",
  "canary",
  "market_maker",
  "multisig_signer_1",
  "multisig_signer_2",
  "multisig_signer_3",
] as const;

const SOLANA_PROGRAMS = [
  "fight_oracle",
  "duel_market",
  "lvr_amm",
  "gold_perps_market",
] as const;

type EvmRole = (typeof EVM_ROLES)[number];
type SolanaRole = (typeof SOLANA_ROLES)[number];
type SolanaProgram = (typeof SOLANA_PROGRAMS)[number];

type Options = {
  outputDir: string;
  force: boolean;
};

type EvmWalletFile = {
  role: EvmRole;
  address: string;
  privateKey: string;
  createdAt: string;
};

type PublicManifest = {
  createdAt: string;
  root: string;
  evm: Record<EvmRole, string>;
  solana: Record<SolanaRole, string>;
  solanaPrograms: Record<SolanaProgram, string>;
};

function parseArgs(): Options {
  const dirFlagIndex = process.argv.indexOf("--dir");
  const outputDir =
    dirFlagIndex >= 0 && process.argv[dirFlagIndex + 1]
      ? path.resolve(process.cwd(), process.argv[dirFlagIndex + 1])
      : path.join(ROOT_DIR, "keys", "stage-a");

  return {
    outputDir,
    force: process.argv.includes("--force"),
  };
}

function ensureEmptyDir(targetDir: string, force: boolean): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    return;
  }

  const entries = readdirSync(targetDir);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Refusing to overwrite non-empty wallet directory: ${targetDir}. Re-run with --force if you want a new set.`,
    );
  }

  mkdirSync(targetDir, { recursive: true });
}

function randomPrivateKeyHex(): string {
  while (true) {
    const bytes = randomBytes(32);
    if (!bytes.every((value) => value === 0)) {
      return `0x${bytes.toString("hex")}`;
    }
  }
}

function deriveEvmAddress(privateKey: string): string {
  const output = execFileSync("cast", ["wallet", "address", "--private-key", privateKey], {
    encoding: "utf8",
  }).trim();
  if (!output.startsWith("0x") || output.length !== 42) {
    throw new Error(`Unexpected EVM address derived from cast: ${output}`);
  }
  return output;
}

function writeSecureFile(filepath: string, contents: string): void {
  writeFileSync(filepath, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(filepath, 0o600);
}

function main(): void {
  const options = parseArgs();
  const evmDir = path.join(options.outputDir, "evm");
  const solanaDir = path.join(options.outputDir, "solana");
  const solanaProgramsDir = path.join(options.outputDir, "solana-programs");

  ensureEmptyDir(options.outputDir, options.force);
  mkdirSync(evmDir, { recursive: true });
  mkdirSync(solanaDir, { recursive: true });
  mkdirSync(solanaProgramsDir, { recursive: true });

  const createdAt = new Date().toISOString();
  const manifest: PublicManifest = {
    createdAt,
    root: options.outputDir,
    evm: {} as Record<EvmRole, string>,
    solana: {} as Record<SolanaRole, string>,
    solanaPrograms: {} as Record<SolanaProgram, string>,
  };

  for (const role of EVM_ROLES) {
    const privateKey = randomPrivateKeyHex();
    const address = deriveEvmAddress(privateKey);
    const walletFile: EvmWalletFile = {
      role,
      address,
      privateKey,
      createdAt,
    };
    const filepath = path.join(evmDir, `${role}.json`);
    writeSecureFile(filepath, JSON.stringify(walletFile, null, 2) + "\n");
    manifest.evm[role] = address;
  }

  for (const role of SOLANA_ROLES) {
    const keypair = Keypair.generate();
    const filepath = path.join(solanaDir, `${role}.json`);
    writeSecureFile(filepath, JSON.stringify(Array.from(keypair.secretKey)) + "\n");
    manifest.solana[role] = keypair.publicKey.toBase58();
  }

  for (const program of SOLANA_PROGRAMS) {
    const keypair = Keypair.generate();
    const filepath = path.join(solanaProgramsDir, `${program}-keypair.json`);
    writeSecureFile(filepath, JSON.stringify(Array.from(keypair.secretKey)) + "\n");
    manifest.solanaPrograms[program] = keypair.publicKey.toBase58();
  }

  writeSecureFile(
    path.join(solanaProgramsDir, "program-addresses.json"),
    JSON.stringify(
      {
        createdAt,
        root: solanaProgramsDir,
        programs: manifest.solanaPrograms,
      },
      null,
      2,
    ) + "\n",
  );

  writeSecureFile(
    path.join(options.outputDir, "public-addresses.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`[stage-a-wallets] wrote wallet set to ${options.outputDir}`);
  console.log(
    JSON.stringify(
      {
        createdAt,
        evm: manifest.evm,
        solana: manifest.solana,
      },
      null,
      2,
    ),
  );
}

main();
