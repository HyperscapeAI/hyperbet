type ScenarioRunRecord = {
    runId: string;
    scenarioId: string;
    scenarioName: string;
    seed: string;
    ticks: number;
    winner: "A" | "B";
    freshBaseline: boolean;
    status: "queued" | "running" | "succeeded" | "failed";
    stage: string | null;
    requestedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    result:
        | {
              passed?: boolean;
              degraded?: boolean;
          }
        | null;
};

type ScenarioPreset = {
    id: string;
    name: string;
    family: string;
    canonicalSeed: string;
    matrixSeeds: string[];
    tier: "gate" | "diagnostic";
};

const API_BASE_URL = (
    process.env.SIM_API_URL?.trim() || "http://127.0.0.1:3401"
).replace(/\/$/, "");
const POLL_INTERVAL_MS = Number(process.env.SIM_SCENARIO_POLL_MS ?? "1500");
const RUN_TIMEOUT_MS = Number(process.env.SIM_SCENARIO_TIMEOUT_MS ?? "300000");

function usage(): never {
    console.error(
        [
            "Usage:",
            "  bun run --cwd packages/simulation-dashboard scenario list",
            "  bun run --cwd packages/simulation-dashboard scenario gates",
            "  bun run --cwd packages/simulation-dashboard scenario latest",
            "  bun run --cwd packages/simulation-dashboard scenario history",
            "  bun run --cwd packages/simulation-dashboard scenario run <scenario-id-or-name> [--seed=...] [--ticks=...] [--winner=A|B] [--fresh]",
            "  bun run --cwd packages/simulation-dashboard scenario canonical <scenario-id-or-name> [--fresh]",
            "  bun run --cwd packages/simulation-dashboard scenario matrix <scenario-id-or-name> [--fresh]",
            "  bun run --cwd packages/simulation-dashboard scenario suite",
        ].join("\n"),
    );
    process.exit(1);
}

async function fetchJson(path: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(payload?.error || `${response.status} ${response.statusText}`);
    }
    return payload;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function getFlagValue(args: string[], flag: string): string | undefined {
    return args
        .find((arg) => arg.startsWith(`${flag}=`))
        ?.slice(flag.length + 1)
        .trim();
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

async function fetchScenarioCatalog(): Promise<{
    scenarios: ScenarioPreset[];
    gateScenarios: ScenarioPreset[];
}> {
    const payload = await fetchJson("/api/scenarios");
    return {
        scenarios: payload.scenarios as ScenarioPreset[],
        gateScenarios: payload.gateScenarios as ScenarioPreset[],
    };
}

function findScenarioPreset(
    scenarios: readonly ScenarioPreset[],
    nameOrId: string,
): ScenarioPreset {
    const scenario = scenarios.find(
        (entry) => entry.id === nameOrId || entry.name === nameOrId,
    );
    if (!scenario) {
        throw new Error(`Unknown scenario: ${nameOrId}`);
    }
    return scenario;
}

async function runScenario(
    scenario: string,
    options: {
        seed?: string;
        ticks?: string;
        winner?: string;
        fresh?: boolean;
    } = {},
): Promise<ScenarioRunRecord> {
    const params = new URLSearchParams({
        name: scenario,
    });
    if (options.seed) params.set("seed", options.seed);
    if (options.ticks) params.set("ticks", options.ticks);
    if (options.winner) params.set("winner", options.winner);
    if (options.fresh) params.set("fresh", "1");

    const payload = await fetchJson(
        `/api/scenarios/run?${params.toString()}`,
    );
    const run = payload.run as ScenarioRunRecord | null;
    if (!run) {
        throw new Error("Scenario run was accepted without a run record");
    }
    return pollRun(run.runId);
}

function scenarioRunPassed(run: ScenarioRunRecord): boolean {
    return run.status === "succeeded" && run.result?.passed === true;
}

async function pollRun(runId: string): Promise<ScenarioRunRecord> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const payload = await fetchJson(
            `/api/scenarios/results?runId=${encodeURIComponent(runId)}`,
        );
        const run = payload.run as ScenarioRunRecord | null;
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        if (run.status === "succeeded" || run.status === "failed") {
            return run;
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Scenario run ${runId} timed out after ${RUN_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv;

    switch (command) {
        case "list": {
            const payload = await fetchJson("/api/scenarios");
            printJson({
                scenarios: payload.scenarios,
                gateScenarios: payload.gateScenarios,
                activeRun: payload.activeRun,
                latest: payload.latest,
            });
            return;
        }
        case "gates": {
            const payload = await fetchScenarioCatalog();
            printJson(payload.gateScenarios);
            return;
        }
        case "latest": {
            const payload = await fetchJson("/api/scenarios/results");
            printJson(payload.results?.[0] ?? null);
            return;
        }
        case "history": {
            const payload = await fetchJson("/api/scenarios/results");
            printJson({
                activeRun: payload.activeRun,
                runs: payload.runs,
                results: payload.results,
            });
            return;
        }
        case "run": {
            const scenario = rest.find((arg) => !arg.startsWith("--"));
            if (!scenario) {
                usage();
            }
            const seed = getFlagValue(rest, "--seed");
            const ticks = getFlagValue(rest, "--ticks");
            const winner = getFlagValue(rest, "--winner");
            const fresh = hasFlag(rest, "--fresh");
            const completed = await runScenario(scenario, {
                seed,
                ticks,
                winner,
                fresh,
            });
            printJson(completed);
            if (!scenarioRunPassed(completed)) {
                process.exit(1);
            }
            return;
        }
        case "canonical": {
            const scenario = rest.find((arg) => !arg.startsWith("--"));
            if (!scenario) {
                usage();
            }
            const fresh = hasFlag(rest, "--fresh");
            const { scenarios } = await fetchScenarioCatalog();
            const preset = findScenarioPreset(scenarios, scenario);
            const completed = await runScenario(preset.id, {
                seed: preset.canonicalSeed,
                fresh,
            });
            printJson(completed);
            if (!scenarioRunPassed(completed)) {
                process.exit(1);
            }
            return;
        }
        case "matrix": {
            const scenario = rest.find((arg) => !arg.startsWith("--"));
            if (!scenario) {
                usage();
            }
            const fresh = hasFlag(rest, "--fresh");
            const { scenarios } = await fetchScenarioCatalog();
            const preset = findScenarioPreset(scenarios, scenario);
            const seeds = [preset.canonicalSeed, ...preset.matrixSeeds];
            const results: ScenarioRunRecord[] = [];
            for (const seed of seeds) {
                results.push(
                    await runScenario(preset.id, {
                        seed,
                        fresh,
                    }),
                );
            }
            printJson(results);
            if (results.some((result) => !scenarioRunPassed(result))) {
                process.exit(1);
            }
            return;
        }
        case "suite": {
            const { gateScenarios } = await fetchScenarioCatalog();
            const results: ScenarioRunRecord[] = [];
            for (const preset of gateScenarios) {
                results.push(
                    await runScenario(preset.id, {
                        seed: preset.canonicalSeed,
                        fresh: true,
                    }),
                );
            }
            printJson(results);
            if (results.some((result) => !scenarioRunPassed(result))) {
                process.exit(1);
            }
            return;
        }
        default:
            usage();
    }
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
