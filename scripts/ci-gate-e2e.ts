import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib.js";

type ChainKey = "solana" | "bsc" | "avax";
type GateSurface = "unified";

type LocalPortConfig = {
  appPort: string;
  gameApiPort: string;
  solanaRpcPort: string;
  solanaProxyPort: string;
  evmPort?: string;
};

type ControlFile = {
  services?: Record<
    string,
    {
      logPath?: string;
      pidFile?: string;
    }
  >;
};

function parseArgs(): { chain: ChainKey; surface: GateSurface } {
  const surfaceArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--surface="))
      ?.slice("--surface=".length) ?? "unified";
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--chain="))
      ?.slice("--chain=".length) ?? "solana";
  if (targetArg !== "solana" && targetArg !== "bsc" && targetArg !== "avax") {
    throw new Error(`unsupported e2e chain ${targetArg}`);
  }
  if (surfaceArg !== "unified") {
    throw new Error(`unsupported e2e surface ${surfaceArg}`);
  }
  return { chain: targetArg, surface: surfaceArg as GateSurface };
}

const { chain, surface } = parseArgs();
const artifactRoot = resolveArtifactRoot(`e2e-${surface}-${chain}`);
const appRoot =
  surface === "unified"
    ? path.join(rootDir, "packages/hyperbet-evm/app")
    : path.join(rootDir, `packages/hyperbet-${chain}/app`);
const anchorRoot = path.join(rootDir, "packages/hyperbet-solana/anchor");
const evmRoot =
  chain === "solana"
    ? null
    : path.join(rootDir, "packages/evm-contracts");
const statePath = path.join(appRoot, "tests/e2e/state.json");
const controlPath = path.join(appRoot, "tests/e2e/control.json");
const bootstrapKeypairPath = path.join(
  "/tmp",
  `hyperbet-${chain}-solana-bootstrap-keypair.json`,
);
const buildLogPath = path.join("/tmp", `hyperbet-${chain}-e2e-build.log`);
const evmBuildLogPath = path.join("/tmp", `hyperbet-${chain}-e2e-evm-build.log`);
const localPortConfigByChain: Record<ChainKey, LocalPortConfig> = {
  solana: {
    appPort: "4281",
    gameApiPort: "5655",
    solanaRpcPort: "19899",
    solanaProxyPort: "21899",
  },
  bsc: {
    appPort: "4381",
    gameApiPort: "5755",
    solanaRpcPort: "19999",
    solanaProxyPort: "21999",
    evmPort: "19545",
  },
  avax: {
    appPort: "4481",
    gameApiPort: "5855",
    solanaRpcPort: "20999",
    solanaProxyPort: "22999",
    evmPort: "20545",
  },
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
  const harnessEnv: Record<string, string> = {
    E2E_GATED_CHAIN: chain,
    E2E_GATED_SURFACE: surface,
    E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    ANCHOR_WALLET: bootstrapKeypairPath,
    E2E_SKIP_PREBUILD: "true",
    PW_HEADLESS: process.env.PW_HEADLESS ?? "1",
    PW_WEBGPU_ARGS: process.env.PW_WEBGPU_ARGS ?? "--enable-unsafe-webgpu",
    E2E_APP_PORT: localPortConfigByChain[chain].appPort,
    E2E_GAME_API_PORT: localPortConfigByChain[chain].gameApiPort,
    E2E_SOLANA_RPC_PORT: localPortConfigByChain[chain].solanaRpcPort,
    E2E_SOLANA_PROXY_PORT: localPortConfigByChain[chain].solanaProxyPort,
  };
  if (process.platform === "darwin") {
    harnessEnv.PW_BROWSER_CHANNEL = process.env.PW_BROWSER_CHANNEL ?? "chrome";
  }
  if (localPortConfigByChain[chain].evmPort) {
    harnessEnv.E2E_EVM_PORT = localPortConfigByChain[chain].evmPort;
  }

  await prebuild(harnessEnv);

  await runCommand(
    "bash",
    ["scripts/run-e2e-local.sh", "tests/e2e/unified-app.e2e.ts"],
    {
      cwd: appRoot,
      env: harnessEnv,
      stdoutFile: path.join(artifactRoot, "unified-app.out.log"),
      stderrFile: path.join(artifactRoot, "unified-app.err.log"),
    },
  );

  await runCommand(
    "bash",
    ["scripts/run-e2e-local.sh", "tests/e2e/debug-page.e2e.ts"],
    {
      cwd: appRoot,
      env: harnessEnv,
      stdoutFile: path.join(artifactRoot, "debug-page.out.log"),
      stderrFile: path.join(artifactRoot, "debug-page.err.log"),
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
