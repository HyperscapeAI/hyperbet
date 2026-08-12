import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  SCENARIO_PRESETS,
  type ScenarioPreset,
} from "../packages/simulation-dashboard/src/scenario-catalog.ts";
import {
  findAvailablePort,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  spawnBackground,
  waitForJsonEndpoint,
  writeJsonArtifact,
} from "./ci-lib";

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

function validateArgs(): void {
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith("--scenario=")) continue;
    if (argument !== "--target=solana") {
      throw new Error(`unsupported SOL-only scenario argument ${argument}`);
    }
  }
}

function parseScenarioFilter(): string | null {
  const scenarioArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--scenario="))
      ?.slice("--scenario=".length)
      .trim() ?? "";
  return scenarioArg.length > 0 ? scenarioArg : null;
}

validateArgs();
const scenarioFilter = parseScenarioFilter();
const artifactRoot = resolveArtifactRoot("solana-exploit-gate");
const bootstrapKeypairPath = path.join(
  artifactRoot,
  "solana-bootstrap-keypair.json",
);
const solanaAnchorRoot = path.join(rootDir, "packages/hyperbet-solana/anchor");
const solanaDeployRoot = path.join(solanaAnchorRoot, "target", "deploy");
const requiredSolanaDeployArtifacts = [
  "fight_oracle.so",
  "duel_market.so",
] as const;
const reservedPorts = new Set<number>();
const MAX_SCENARIO_SERVER_STARTUP_RETRIES = 3;
const preferredPorts = { http: 3501, ws: 3500 };
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
  return {
    ANCHOR_WALLET: bootstrapKeypairPath,
    E2E_SOLANA_BOOTSTRAP_KEYPAIR: bootstrapKeypairPath,
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
  const chainKey = "solana";
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
}

function getMissingSolanaDeployArtifacts(): string[] {
  return requiredSolanaDeployArtifacts.filter(
    (artifact) => !existsSync(path.join(solanaDeployRoot, artifact)),
  );
}

async function ensureSolanaDeployArtifacts(): Promise<void> {
  // Always rebuild before a Solana scenario run. Existence alone can select a
  // stale .so from an older source revision and produce false launch evidence.
  const buildLogPath = path.join(artifactRoot, "solana-anchor-build.log");
  await runCommand("bun", ["run", "--cwd", solanaAnchorRoot, "build"], {
    stdoutFile: buildLogPath,
    stderrFile: buildLogPath,
  });

  const remainingMissingArtifacts = getMissingSolanaDeployArtifacts();
  if (remainingMissingArtifacts.length > 0) {
    throw new Error(
      `Solana deploy artifacts still missing after build: ${remainingMissingArtifacts.join(", ")}`,
    );
  }
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

  const completedRun = await pollScenarioRun(
    context.apiBaseUrl,
    queuedRun.runId,
  );
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
    const wsPort = String(
      await allocateDistinctPort(preferredPorts.ws, reservedPorts),
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

    writeJsonArtifact(
      scenarioArtifactRoot,
      `server${attempt > 1 ? `-retry-${attempt}` : ""}.json`,
      {
        apiBaseUrl,
        httpPort,
        wsPort,
        attempt,
      },
    );

    const server = await spawnBackground("bun", ["src/server.ts"], {
      cwd: path.join(rootDir, "packages/simulation-dashboard"),
      env: {
        SIM_HTTP_PORT: httpPort,
        SIM_WS_PORT: wsPort,
        SIM_RUNTIME_TARGET: "solana",
        SIM_SCENARIO_HISTORY_PATH: historyPath,
        ...scenarioEnv(),
      },
      logFile: serverLog,
    });
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
  await ensureSolanaDeployArtifacts();

  const selectedCanonical = scenarioFilter
    ? solanaCanonical.filter((scenarioId) => scenarioId === scenarioFilter)
    : solanaCanonical;
  const selectedMatrix = scenarioFilter
    ? solanaMatrix.filter((scenarioId) => scenarioId === scenarioFilter)
    : solanaMatrix;
  if (
    scenarioFilter &&
    selectedCanonical.length === 0 &&
    selectedMatrix.length === 0
  ) {
    throw new Error(`unknown Solana scenario filter ${scenarioFilter}`);
  }
  const executions = [
    ...buildScenarioExecutions(selectedCanonical, "canonical"),
    ...buildScenarioExecutions(selectedMatrix, "matrix"),
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
