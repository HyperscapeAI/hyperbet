import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type ControlFile = {
  services?: Record<
    string,
    {
      logPath?: string;
      pidFile?: string;
    }
  >;
};

for (const argument of process.argv.slice(2)) {
  if (argument !== "--chain=solana") {
    throw new Error(`unsupported SOL-only E2E argument ${argument}`);
  }
}

const artifactRoot = resolveArtifactRoot("e2e-solana");
const appRoot = path.join(rootDir, "packages/hyperbet-solana/app");
const anchorRoot = path.join(rootDir, "packages/hyperbet-solana/anchor");
const statePath = path.join(appRoot, "tests/e2e/state.json");
const controlPath = path.join(appRoot, "tests/e2e/control.json");
const bootstrapKeypairPath = path.join(
  "/tmp",
  "hyperbet-solana-bootstrap-keypair.json",
);
const buildLogPath = path.join("/tmp", "hyperbet-solana-e2e-build.log");
const marketFlowGrep =
  "solana predictions place YES and NO orders and stage a proposed winner claim|solana predictions finalize a matured proposal and claim winnings|solana resolved loser closes the stale balance and recovers exact rent|solana open prediction markets recover after keeper and proxy restarts|solana cancelled duel refunds and clears claim state";

async function ensureBootstrapWallet(): Promise<void> {
  if (existsSync(bootstrapKeypairPath)) return;
  mkdirSync(path.dirname(bootstrapKeypairPath), { recursive: true });
  await runCommand(
    "solana-keygen",
    [
      "new",
      "--no-bip39-passphrase",
      "--silent",
      "--force",
      "-o",
      bootstrapKeypairPath,
    ],
    {
      stdoutFile: path.join(artifactRoot, "solana-keygen.out.log"),
      stderrFile: path.join(artifactRoot, "solana-keygen.err.log"),
    },
  );
}

async function runGate(): Promise<void> {
  await ensureBootstrapWallet();
  const harnessEnv: NodeJS.ProcessEnv = {
    E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    ANCHOR_WALLET: bootstrapKeypairPath,
    E2E_REQUIRE_MATURED_SOLANA_WIN_CLAIM: "true",
    E2E_SOLANA_ORACLE_DISPUTE_WINDOW_SECS: "60",
    E2E_SKIP_PREBUILD: "true",
    PW_HEADLESS: process.env.PW_HEADLESS ?? "1",
    PW_WEBGPU_ARGS: process.env.PW_WEBGPU_ARGS ?? "--enable-unsafe-webgpu",
    E2E_APP_PORT: "4281",
    E2E_GAME_API_PORT: "5655",
    E2E_SOLANA_RPC_PORT: "19899",
    E2E_SOLANA_PROXY_PORT: "21899",
  };
  if (process.platform === "darwin") {
    harnessEnv.PW_BROWSER_CHANNEL = process.env.PW_BROWSER_CHANNEL ?? "chrome";
  }

  await runCommand("bun", ["run", "--cwd", anchorRoot, "build"], {
    env: harnessEnv,
    stdoutFile: buildLogPath,
    stderrFile: buildLogPath,
  });

  await runCommand(
    "bash",
    [
      "scripts/run-e2e-local.sh",
      "tests/e2e/market-flows.e2e.ts",
      "--grep",
      marketFlowGrep,
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
      "tests/e2e/app-tabs-and-apis.e2e.ts",
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
  if (!existsSync(controlPath)) return;
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as ControlFile;
  writeJsonArtifact(artifactRoot, "control-summary.json", control);
  for (const [service, spec] of Object.entries(control.services ?? {})) {
    if (spec.logPath) {
      copyIntoArtifacts(
        artifactRoot,
        spec.logPath,
        path.join("logs", `${service}.log`),
      );
    }
  }
}

try {
  await runGate();
} finally {
  collectArtifacts();
}
