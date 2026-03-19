import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  SCENARIO_PRESETS,
  type ScenarioPreset,
} from "../packages/simulation-dashboard/src/scenario-catalog.ts";
import {
  findAvailablePort,
  materializeCiSolanaWallet,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  spawnBackground,
  waitForJsonEndpoint,
  writeJsonArtifact,
} from "./ci-lib";

type ScenarioTarget = "evm" | "solana";

type ScenarioRunRecord = {
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: {
    passed?: boolean;
  } | null;
};

type ScenarioExecution = {
  mode: "canonical" | "matrix";
  scenarioId: string;
  seed: string;
  artifactName: string;
};

type ScenarioServerContext = {
  apiBaseUrl: string;
  scenarioArtifactRoot: string;
};

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
const bootstrapKeypairPath = path.join(
  artifactRoot,
  "solana-bootstrap-keypair.json",
);
const ciHome = path.join(artifactRoot, "home");
const reservedPorts = new Set<number>();
const MAX_SCENARIO_SERVER_STARTUP_RETRIES = 3;
const preferredPorts =
  target === "evm"
    ? { http: 3401, ws: 3400, anvil: 18546 }
    : { http: 3501, ws: 3500, anvil: 18547 };

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeArtifactName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function getScenarioPreset(scenarioId: string): ScenarioPreset {
  const chainKey = target === "evm" ? "bsc" : "solana";
  const preset =
    SCENARIO_PRESETS.find(
      (entry) => entry.id === scenarioId && entry.chainKey === chainKey,
    ) ?? null;
  if (!preset) {
    throw new Error(`unknown scenario preset ${scenarioId} for ${chainKey}`);
  }
  return preset;
}

function buildScenarioExecutions(
  scenarioIds: string[],
  mode: "canonical" | "matrix",
): ScenarioExecution[] {
  return scenarioIds.flatMap((scenarioId) => {
    const preset = getScenarioPreset(scenarioId);
    const seeds =
      mode === "canonical"
        ? [preset.canonicalSeed]
        : [preset.canonicalSeed, ...preset.matrixSeeds];
    return seeds.map((seed, index) => ({
      mode,
      scenarioId: preset.id,
      seed,
      artifactName:
        mode === "canonical"
          ? `${preset.id}-canonical`
          : `${preset.id}-matrix-${index + 1}`,
    }));
  });
}

async function ensureBootstrapWallet(): Promise<void> {
  if (target !== "solana") {
    return;
  }

  if (!existsSync(bootstrapKeypairPath)) {
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

  materializeCiSolanaWallet(bootstrapKeypairPath, ciHome);
}

async function fetchScenarioJson(
  apiBaseUrl: string,
  pathname: string,
  options: {
    retries?: number;
    backoffMs?: number;
  } = {},
): Promise<any> {
  const retries = Math.max(1, options.retries ?? 1);
  const backoffMs = Math.max(50, options.backoffMs ?? 250);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}${pathname}`);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(
          payload?.error || `${response.status} ${response.statusText}`,
        );
        if (response.status >= 500 && attempt < retries) {
          lastError = error;
          await sleep(backoffMs * attempt);
          continue;
        }
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(backoffMs * attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function pollScenarioRun(
  apiBaseUrl: string,
  runId: string,
): Promise<ScenarioRunRecord> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const payload = await fetchScenarioJson(
      apiBaseUrl,
      `/api/scenarios/results?runId=${encodeURIComponent(runId)}`,
      {
        retries: 3,
        backoffMs: 300,
      },
    );
    const run = payload.run as ScenarioRunRecord | null;
    if (!run) {
      throw new Error(`scenario run not found: ${runId}`);
    }
    if (run.status === "succeeded" || run.status === "failed") {
      return run;
    }
    await sleep(1_500);
  }
  throw new Error(`scenario run ${runId} timed out after 300000ms`);
}

async function runScenarioViaApi(
  context: ScenarioServerContext,
  execution: ScenarioExecution,
): Promise<void> {
  writeJsonArtifact(context.scenarioArtifactRoot, "request.json", execution);

  const params = new URLSearchParams({
    name: execution.scenarioId,
    seed: execution.seed,
    fresh: "1",
  });
  const payload = await fetchScenarioJson(
    context.apiBaseUrl,
    `/api/scenarios/run?${params.toString()}`,
    {
      retries: 5,
      backoffMs: 300,
    },
  );
  const queuedRun = payload.run as ScenarioRunRecord | null;
  if (!queuedRun) {
    throw new Error(
      `scenario ${execution.scenarioId} was accepted without a run record`,
    );
  }

  const completedRun = await pollScenarioRun(context.apiBaseUrl, queuedRun.runId);
  writeJsonArtifact(context.scenarioArtifactRoot, "result.json", completedRun);
  if (
    completedRun.status !== "succeeded" ||
    completedRun.result?.passed !== true
  ) {
    throw new Error(
      `scenario ${execution.scenarioId} (${execution.seed}) failed`,
    );
  }
}

let stopServer: (() => Promise<void>) | null = null;
let fatalError: unknown = null;

function isStartupFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  if (!message) {
    return false;
  }
  return (
    message.includes("fetch failed") ||
    message.includes("endpoint did not become ready") ||
    message.includes("EADDRINUSE") ||
    message.includes("failed to become ready") ||
    message.includes("connection closed") ||
    message.includes("ECONNRESET")
  );
}

async function withSimulationServer<T>(
  execution: ScenarioExecution,
  run: (context: ScenarioServerContext) => Promise<T>,
): Promise<T> {
  const scenarioArtifactRoot = path.join(
    artifactRoot,
    "scenarios",
    sanitizeArtifactName(execution.artifactName),
  );

  let attempt = 0;
  while (true) {
    attempt += 1;
    mkdirSync(scenarioArtifactRoot, { recursive: true });

    const httpPort = String(
      await allocateDistinctPort(preferredPorts.http, reservedPorts),
    );
    const wsPort = String(await allocateDistinctPort(preferredPorts.ws, reservedPorts));
    const anvilPort = String(
      await allocateDistinctPort(preferredPorts.anvil, reservedPorts),
    );
    const apiBaseUrl = `http://127.0.0.1:${httpPort}`;
    const serverLog = path.join(
      scenarioArtifactRoot,
      `simulation-server${attempt > 1 ? `-retry-${attempt}` : ""}.log`,
    );
    const historyPath = path.join(
      scenarioArtifactRoot,
      `scenario-history${attempt > 1 ? `-retry-${attempt}` : ""}.json`,
    );

    writeJsonArtifact(scenarioArtifactRoot, `server${attempt > 1 ? `-retry-${attempt}` : ""}.json`, {
      apiBaseUrl,
      anvilPort,
      httpPort,
      wsPort,
      attempt,
    });

    const server = await spawnBackground(
      "bun",
      ["run", "--cwd", "packages/simulation-dashboard", "dev"],
      {
        cwd: rootDir,
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
    stopServer = () => server.stop({ timeoutMs: 15_000 });

    try {
      await waitForJsonEndpoint(`${apiBaseUrl}/api/scenarios`, {
        timeoutMs: 20_000,
        validate: (payload) => Array.isArray(payload?.scenarios),
      });
      await fetchScenarioJson(apiBaseUrl, "/api/scenarios", {
        retries: 8,
        backoffMs: 300,
      });
      return await run({
        apiBaseUrl,
        scenarioArtifactRoot,
      });
    } catch (error) {
      const shouldRetry = isStartupFailure(error);
      if (!shouldRetry || attempt >= MAX_SCENARIO_SERVER_STARTUP_RETRIES) {
        throw error;
      }
      await sleep(Math.min(500 * attempt, 2_000));
      continue;
    } finally {
      await server.stop({ timeoutMs: 15_000 });
      stopServer = null;
    }
  }
}

async function allocateDistinctPort(
  preferredPort: number,
  usedPorts: Set<number>,
): Promise<number> {
  const preferredCandidate = await findAvailablePort(preferredPort);
  if (!usedPorts.has(preferredCandidate)) {
    usedPorts.add(preferredCandidate);
    return preferredCandidate;
  }

  while (true) {
    const candidate = await findAvailablePort(0);
    if (!usedPorts.has(candidate)) {
      usedPorts.add(candidate);
      return candidate;
    }
  }
}

try {
  await ensureBootstrapWallet();

  await runCommand(
    "bun",
    ["run", "--cwd", "packages/evm-contracts", "build:foundry:pm"],
    {
      stdoutFile: path.join(artifactRoot, "foundry-build.out.log"),
      stderrFile: path.join(artifactRoot, "foundry-build.err.log"),
    },
  );

  const canonical = target === "evm" ? evmCanonical : solanaCanonical;
  const matrix = target === "evm" ? evmMatrix : solanaMatrix;
  const executions = [
    ...buildScenarioExecutions(canonical, "canonical"),
    ...buildScenarioExecutions(matrix, "matrix"),
  ];
  writeJsonArtifact(artifactRoot, "executions.json", executions);

  for (const execution of executions) {
    await withSimulationServer(execution, (context) =>
      runScenarioViaApi(context, execution),
    );
  }
} catch (error) {
  fatalError = error;
} finally {
  await stopServer?.();
}

if (fatalError) {
  throw fatalError;
}

process.exit(0);
