import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type ChainKey = "solana" | "bsc" | "avax";

type ControlFile = {
  services?: Record<
    string,
    {
      logPath?: string;
      pidFile?: string;
    }
  >;
};

function parseArgs(): ChainKey {
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--chain="))
      ?.slice("--chain=".length) ?? "solana";
  if (targetArg !== "solana" && targetArg !== "bsc" && targetArg !== "avax") {
    throw new Error(`unsupported e2e chain ${targetArg}`);
  }
  return targetArg;
}

const chain = parseArgs();
const artifactRoot = resolveArtifactRoot(`e2e-${chain}`);
const appRoot = path.join(rootDir, `packages/hyperbet-${chain}/app`);
const anchorRoot = path.join(rootDir, "packages/hyperbet-solana/anchor");
const evmRoot =
  chain === "solana"
    ? null
    : path.join(rootDir, "packages/evm-contracts");
const statePath = path.join(appRoot, "tests/e2e/state.json");
const controlPath = path.join(appRoot, "tests/e2e/control.json");
const bootstrapKeypairPath = path.join(artifactRoot, "solana-bootstrap-keypair.json");
const buildLogPath = path.join("/tmp", `hyperbet-${chain}-e2e-build.log`);
const evmBuildLogPath = path.join("/tmp", `hyperbet-${chain}-e2e-evm-build.log`);
const marketFlowGrepByChain: Record<ChainKey, string> = {
  solana:
    "solana predictions place YES and NO orders, resolve, and claim|solana prediction markets recover after keeper and proxy restarts|solana cancelled duel refunds and clears claim state",
  bsc:
    "evm predictions place YES and NO orders, resolve, and claim|bsc prediction markets recover after keeper and anvil restarts|bsc cancelled prediction markets refund and clear positions",
  avax:
    "evm predictions place YES and NO orders, resolve, and claim|avax prediction markets recover after keeper and anvil restarts|avax cancelled prediction markets refund and clear positions",
};

async function ensureBootstrapWallet(): Promise<void> {
  if (!existsSync(bootstrapKeypairPath)) {
    mkdirSync(path.dirname(bootstrapKeypairPath), { recursive: true });
    await runCommand(
      "solana-keygen",
      ["new", "--no-bip39-passphrase", "--silent", "--force", "-o", bootstrapKeypairPath],
      {
        stdoutFile: path.join(artifactRoot, "solana-keygen.out.log"),
        stderrFile: path.join(artifactRoot, "solana-keygen.err.log"),
      },
    );
  }
}

async function prebuild(harnessEnv: NodeJS.ProcessEnv): Promise<void> {
  await runCommand("bun", ["run", "--cwd", anchorRoot, "build"], {
    env: harnessEnv,
    stdoutFile: buildLogPath,
    stderrFile: buildLogPath,
  });

  if (!evmRoot) return;

  await runCommand("bun", ["run", "--cwd", "packages/evm-contracts", "build:foundry:e2e"], {
    env: harnessEnv,
    stdoutFile: evmBuildLogPath,
    stderrFile: evmBuildLogPath,
  });
}

async function runGate(): Promise<void> {
  await ensureBootstrapWallet();
  const harnessEnv = {
    E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    ANCHOR_WALLET: bootstrapKeypairPath,
    E2E_SKIP_PREBUILD: "true",
  };

  await prebuild(harnessEnv);

  await runCommand(
    "bash",
    [
      "scripts/run-e2e-local.sh",
      "tests/e2e/market-flows.spec.ts",
      "--grep",
      marketFlowGrepByChain[chain],
    ],
    {
      cwd: appRoot,
      env: harnessEnv,
      stdoutFile: path.join(artifactRoot, "market-flows.out.log"),
      stderrFile: path.join(artifactRoot, "market-flows.err.log"),
    },
  );

  await runCommand(
    "bash",
    [
      "scripts/run-e2e-local.sh",
      "tests/e2e/app-tabs-and-apis.spec.ts",
      "--grep",
      "keeper backend exposes all app-facing data endpoints",
    ],
    {
      cwd: appRoot,
      env: harnessEnv,
      stdoutFile: path.join(artifactRoot, "api-smoke.out.log"),
      stderrFile: path.join(artifactRoot, "api-smoke.err.log"),
    },
  );
}

function collectArtifacts(): void {
  copyIntoArtifacts(artifactRoot, statePath, "state.json");
  copyIntoArtifacts(artifactRoot, controlPath, "control.json");
  copyIntoArtifacts(artifactRoot, buildLogPath, "prebuild/anchor-build.log");
  copyIntoArtifacts(artifactRoot, evmBuildLogPath, "prebuild/evm-build.log");
  if (!existsSync(controlPath)) return;
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as ControlFile;
  writeJsonArtifact(artifactRoot, "control-summary.json", control);
  for (const [service, spec] of Object.entries(control.services ?? {})) {
    if (spec.logPath) {
      copyIntoArtifacts(artifactRoot, spec.logPath, path.join("logs", `${service}.log`));
    }
  }
}

try {
  await runGate();
} finally {
  collectArtifacts();
}
