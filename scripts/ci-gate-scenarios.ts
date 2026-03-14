import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  copyIntoArtifacts,
  findAvailablePort,
  materializeCiSolanaWallet,
  resolveArtifactRoot,
  runCommand,
  spawnBackground,
  waitForJsonEndpoint,
} from "./ci-lib";

type ScenarioTarget = "evm" | "solana";

function parseArgs(): ScenarioTarget {
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "evm";
  if (targetArg !== "evm" && targetArg !== "solana") {
    throw new Error(`unsupported scenario target ${targetArg}`);
  }
  return targetArg;
}

const target = parseArgs();
const artifactRoot = resolveArtifactRoot(
  target === "evm" ? "evm-exploit-gate" : "solana-exploit-gate",
);
const simRoot = path.join(process.cwd(), "packages/simulation-dashboard");
const historyPath = path.join(artifactRoot, "scenario-history.json");
const serverLog = path.join(artifactRoot, "simulation-server.log");
const bootstrapKeypairPath = path.join(artifactRoot, "solana-bootstrap-keypair.json");
const ciHome = path.join(artifactRoot, "home");
let httpPort = target === "evm" ? "3401" : "3501";
let wsPort = target === "evm" ? "3400" : "3500";
let anvilPort = target === "evm" ? "18546" : "18547";

const evmCanonical = [
  "stale-signal-sniping",
  "stale-oracle-sniping",
  "close-window-race",
  "whale-impact",
  "mev-extraction",
  "sandwich-attack",
  "wash-trading",
  "arbitrage-hunt",
  "cancel-replace-griefing",
  "stress-test",
  "claim-refund-abuse",
];
const evmMatrix = [
  "sandwich-attack",
  "stale-oracle-sniping",
  "whale-impact",
  "stress-test",
];
const solanaCanonical = [
  "solana-stale-resolution-window",
  "solana-lock-race-attempt",
  "solana-cancel-replace-griefing",
  "solana-inventory-poisoning",
  "solana-claim-refund-abuse",
  "solana-cross-market-validation-abuse",
];
const solanaMatrix = [
  "solana-lock-race-attempt",
  "solana-inventory-poisoning",
  "solana-cross-market-validation-abuse",
];

function scenarioEnv(): NodeJS.ProcessEnv {
  if (target !== "solana") {
    return {};
  }

  return {
    ANCHOR_WALLET: bootstrapKeypairPath,
    E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
    HOME: ciHome,
    SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
  };
}

async function ensureBootstrapWallet(): Promise<void> {
  if (target !== "solana") {
    return;
  }

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

  materializeCiSolanaWallet(bootstrapKeypairPath, ciHome);
}

async function runCli(args: string[], name: string): Promise<void> {
  await runCommand("bun", ["run", "--cwd", "packages/simulation-dashboard", "scenario", ...args], {
    env: {
      SIM_API_URL: `http://127.0.0.1:${httpPort}`,
      ...scenarioEnv(),
    },
    stdoutFile: path.join(artifactRoot, `${name}.out.log`),
    stderrFile: path.join(artifactRoot, `${name}.err.log`),
  });
}

async function runSolanaLocalGate(): Promise<void> {
  await ensureBootstrapWallet();
  await runCommand(
    "bun",
    ["run", "--cwd", "packages/hyperbet-solana", "test:pm-amm:local"],
    {
      env: {
        ANCHOR_WALLET: bootstrapKeypairPath,
        E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
        SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
      },
      stdoutFile: path.join(artifactRoot, "solana-pm-amm-local.out.log"),
      stderrFile: path.join(artifactRoot, "solana-pm-amm-local.err.log"),
    },
  );
}

let stopServer: (() => void) | null = null;
let fatalError: unknown = null;

async function allocateDistinctPort(
  preferredPort: number,
  usedPorts: Set<number>,
): Promise<number> {
  while (true) {
    const candidate = await findAvailablePort(preferredPort);
    if (!usedPorts.has(candidate)) {
      usedPorts.add(candidate);
      return candidate;
    }
  }
}

try {
  if (target === "solana") {
    await runSolanaLocalGate();
    process.exit(0);
  }

  const preferredHttpPort = target === "evm" ? 3401 : 3501;
  const preferredWsPort = target === "evm" ? 3400 : 3500;
  const preferredAnvilPort = target === "evm" ? 18546 : 18547;
  const usedPorts = new Set<number>();
  httpPort = String(await allocateDistinctPort(preferredHttpPort, usedPorts));
  wsPort = String(await allocateDistinctPort(preferredWsPort, usedPorts));
  anvilPort = String(await allocateDistinctPort(preferredAnvilPort, usedPorts));

  await ensureBootstrapWallet();

  await runCommand(
    "bun",
    ["run", "--cwd", "packages/evm-contracts", "build:foundry"],
    {
      stdoutFile: path.join(artifactRoot, "foundry-build.out.log"),
      stderrFile: path.join(artifactRoot, "foundry-build.err.log"),
    },
  );

  const server = await spawnBackground(
    "bun",
    ["run", "--cwd", "packages/simulation-dashboard", "dev"],
    {
      cwd: process.cwd(),
      env: {
        SIM_HTTP_PORT: httpPort,
        SIM_WS_PORT: wsPort,
        SIM_ANVIL_PORT: anvilPort,
        SIM_SCENARIO_HISTORY_PATH: historyPath,
        ...scenarioEnv(),
      },
      logFile: serverLog,
    },
  );
  stopServer = server.stop;

  const apiBaseUrl = `http://127.0.0.1:${httpPort}`;
  await waitForJsonEndpoint(`${apiBaseUrl}/api/scenarios`, {
    validate: (payload) => Array.isArray(payload?.scenarios),
  });

  const canonical = target === "evm" ? evmCanonical : solanaCanonical;
  const matrix = target === "evm" ? evmMatrix : solanaMatrix;

  for (const scenarioId of canonical) {
    await runCli(["canonical", scenarioId, "--fresh"], `${scenarioId}-canonical`);
  }

  for (const scenarioId of matrix) {
    await runCli(["matrix", scenarioId, "--fresh"], `${scenarioId}-matrix`);
  }
} catch (error) {
  fatalError = error;
} finally {
  stopServer?.();
  copyIntoArtifacts(artifactRoot, historyPath, "scenario-history.json");
  copyIntoArtifacts(artifactRoot, serverLog, "simulation-server.log");
}

if (fatalError) {
  throw fatalError;
}

process.exit(0);
