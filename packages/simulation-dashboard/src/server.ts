import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { ContractFactory, JsonRpcProvider, ethers, type Contract } from "ethers";
import { WebSocketServer, WebSocket } from "ws";
import {
    computeToxicityBps,
    type AgentActionTrace,
    type MitigationGate,
    type ScenarioResult,
} from "@hyperbet/mm-core";

import {
    loadArtifact,
    duelKey,
    hashParticipant,
    sleep,
    random,
    setRandomSeed,
    resetRandomSource,
    MARKET_KIND_DUEL_WINNER,
    DUEL_STATUS_BETTING_OPEN,
    SIDE_A,
    SIDE_B,
    BUY_SIDE,
    SELL_SIDE,
    MAX_PRICE,
    shortAddr,
    formatEth,
    withTimeout,
} from "./helpers.js";

import {
    BaseAgent,
    RetailAgent,
    MarketMakerAgent,
    WhaleAgent,
    MevFrontrunnerAgent,
    SandwichAgent,
    WashTraderAgent,
    OracleAttackAgent,
    CabalAgent,
    ArbitrageurAgent,
    StressTestAgent,
    CancelReplaceAgent,
    type SimContext,
} from "./agents.js";
import {
    GATE_SCENARIOS,
    SCENARIO_PRESETS,
    getScenarioPresetByIdOrName,
    type ScenarioPreset,
    type ScenarioSettlementMode,
    type ScenarioSettlementStatus,
} from "./scenario-catalog.js";
import { evaluateScenarioPolicyGates } from "./scenario-evaluator.js";

// ─── Config ──────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ANVIL_PORT = 18546;
const WS_PORT = 3400;
const HTTP_PORT = 3401;
const PUBLIC_DIR = join(__dirname, "..", "public");
const CONTRACTS_DIR = join(__dirname, "..", "..", "evm-contracts");
const SCENARIO_HISTORY_LIMIT = 50;
const SCENARIO_HISTORY_PATH =
    process.env.SIM_SCENARIO_HISTORY_PATH?.trim() ||
    join(tmpdir(), "hyperbet", "simulation-dashboard-history.json");
const RESOLVE_CLAIM_BUDGET_MS = Number(
    process.env.SIM_RESOLVE_CLAIM_BUDGET_MS ?? "45000",
);
const SCENARIO_RESOLVE_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_RESOLVE_TIMEOUT_MS ?? "120000",
);
const SCENARIO_SETTLEMENT_TX_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_SETTLEMENT_TX_TIMEOUT_MS ?? "20000",
);
const SCENARIO_SETTLEMENT_RECEIPT_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_SETTLEMENT_RECEIPT_TIMEOUT_MS ?? "30000",
);
const SCENARIO_BASELINE_REVERT_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_BASELINE_REVERT_TIMEOUT_MS ?? "12000",
);
const SCENARIO_BASELINE_SNAPSHOT_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_BASELINE_SNAPSHOT_TIMEOUT_MS ?? "12000",
);
const SCENARIO_BASELINE_REBUILD_TIMEOUT_MS = Number(
    process.env.SIM_SCENARIO_BASELINE_REBUILD_TIMEOUT_MS ?? "90000",
);

type ScenarioRunStatus = "queued" | "running" | "succeeded" | "failed";

type ScenarioRunRecord = {
    runId: string;
    scenarioId: string;
    scenarioName: string;
    seed: string;
    ticks: number;
    winner: "A" | "B";
    freshBaseline: boolean;
    status: ScenarioRunStatus;
    stage: string | null;
    requestedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    result: ScenarioResult | null;
};

type PersistedScenarioState = {
    history: ScenarioResult[];
    runs: ScenarioRunRecord[];
};

type CachedPosition = {
    aShares: bigint;
    bShares: bigint;
    aStake: bigint;
    bStake: bigint;
};

type ClaimCandidate = {
    agent: BaseAgent;
    address: string;
    position: CachedPosition;
};

// ─── State ───────────────────────────────────────────────────────────────────
let anvilProcess: ChildProcess | null = null;
let provider: JsonRpcProvider;
let readProvider: JsonRpcProvider;
let oracle: Contract;
let oracleRead: Contract;
let clob: Contract;
let clobRead: Contract;
let agents: BaseAgent[] = [];
let simRunning = false;
let simSpeed = 500; // ms between ticks
let simTick = 0;
let currentDuelKey = "";
let currentMarketKey = "";
let currentDuelLabel = "";
let duelCounter = 0;
let currentScenarioId = "manual";
let treasuryAddr = "";
let mmAddr = "";
let oracleAddr = "";
let clobAddr = "";
let feeConfig = {
    treasuryBps: 0n,
    mmBps: 0n,
    winningsMmBps: 0n,
};
const eventLog: any[] = [];
const initialBalances: Map<string, string> = new Map();
const wsClients = new Set<WebSocket>();
const ATTACKER_STRATEGIES = new Set([
    "mev_frontrunner",
    "sandwich",
    "wash_trader",
    "oracle_attack",
    "cabal",
    "arbitrageur",
    "stress_test",
    "cancel_replace",
]);
const MARKET_STATUS_RESOLVED = 3;
const MARKET_STATUS_CANCELLED = 4;
let peakInventorySeen = 0;
let worstMarketMakerPnl = 0;
let bestAttackerPnlSeen = 0;
let scenarioObservedTicks = 0;
let scenarioQuotedTicks = 0;
let scenarioSpreadBpsTotal = 0;
let scenarioSpreadSamples = 0;
let lastResolveLatencyMs: number | null = null;
let staleStreamGuardTripsSeen = 0;
let staleOracleGuardTripsSeen = 0;
let closeGuardTripsSeen = 0;
let circuitBreakerTripsSeen = 0;
let lastComputedState: Record<string, any> | null = null;
let scenarioRunInFlight = false;
let scenarioHistory: ScenarioResult[] = [];
let scenarioRuns: ScenarioRunRecord[] = [];
let activeScenarioRunId: string | null = null;
let scenarioRunSequence = 0;
let baselineSnapshotId: string | null = null;
let baselineRuntimeState:
    | {
          duelCounter: number;
          currentDuelLabel: string;
          currentDuelKey: string;
          currentMarketKey: string;
      }
    | null = null;
const agentAddressCache = new Map<BaseAgent, string>();
const agentPositionCache = new Map<string, CachedPosition>();
const ZERO_POSITION: CachedPosition = {
    aShares: 0n,
    bShares: 0n,
    aStake: 0n,
    bStake: 0n,
};

function loadScenarioState(): void {
    if (!existsSync(SCENARIO_HISTORY_PATH)) {
        return;
    }
    try {
        const parsed = JSON.parse(
            readFileSync(SCENARIO_HISTORY_PATH, "utf8"),
        ) as Partial<PersistedScenarioState>;
        scenarioHistory = Array.isArray(parsed.history)
            ? parsed.history.slice(0, SCENARIO_HISTORY_LIMIT)
            : [];
        scenarioRuns = Array.isArray(parsed.runs)
            ? parsed.runs.slice(0, SCENARIO_HISTORY_LIMIT)
            : [];
    } catch (error) {
        console.warn(
            `[history] Failed to load ${SCENARIO_HISTORY_PATH}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

function persistScenarioState(): void {
    try {
        mkdirSync(dirname(SCENARIO_HISTORY_PATH), { recursive: true });
        writeFileSync(
            SCENARIO_HISTORY_PATH,
            JSON.stringify(
                {
                    history: scenarioHistory.slice(0, SCENARIO_HISTORY_LIMIT),
                    runs: scenarioRuns.slice(0, SCENARIO_HISTORY_LIMIT),
                } satisfies PersistedScenarioState,
                null,
                2,
            ),
            "utf8",
        );
    } catch (error) {
        console.warn(
            `[history] Failed to persist ${SCENARIO_HISTORY_PATH}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

function getActiveScenarioRun(): ScenarioRunRecord | null {
    if (!activeScenarioRunId) {
        return null;
    }
    return scenarioRuns.find((run) => run.runId === activeScenarioRunId) ?? null;
}

function updateScenarioRun(
    runId: string,
    mutator: (run: ScenarioRunRecord) => void,
): ScenarioRunRecord | null {
    const run = scenarioRuns.find((entry) => entry.runId === runId) ?? null;
    if (!run) {
        return null;
    }
    mutator(run);
    persistScenarioState();
    return run;
}

function countEnabledAgents(): number {
    return agents.reduce(
        (count, agent) => count + (agent.config.enabled ? 1 : 0),
        0,
    );
}

async function getAgentAddress(agent: BaseAgent): Promise<string> {
    const cached = agentAddressCache.get(agent);
    if (cached) {
        return cached;
    }
    const address = await agent.signer.getAddress();
    agentAddressCache.set(agent, address);
    return address;
}

function getCachedPosition(address: string): CachedPosition {
    return agentPositionCache.get(address) ?? ZERO_POSITION;
}

function hasPosition(position: CachedPosition): boolean {
    return (
        position.aShares > 0n ||
        position.bShares > 0n ||
        position.aStake > 0n ||
        position.bStake > 0n
    );
}

function parsePosition(positionRaw: {
    aShares: bigint;
    bShares: bigint;
    aStake: bigint;
    bStake: bigint;
}): CachedPosition {
    return {
        aShares: BigInt(positionRaw.aShares),
        bShares: BigInt(positionRaw.bShares),
        aStake: BigInt(positionRaw.aStake),
        bStake: BigInt(positionRaw.bStake),
    };
}

function updateActiveRunStage(stage: string): void {
    const activeRun = getActiveScenarioRun();
    if (!activeRun) {
        return;
    }
    updateScenarioRun(activeRun.runId, (entry) => {
        entry.stage = stage;
    });
}

function refreshReadClients(): void {
    readProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);
    if (oracle) {
        oracleRead = oracle.connect(readProvider) as unknown as Contract;
    }
    if (clob) {
        clobRead = clob.connect(readProvider) as unknown as Contract;
    }
}

async function withReadRetry<T>(
    label: string,
    load: () => Promise<T>,
    options: {
        attempts?: number;
        timeoutMs?: number;
        backoffMs?: number;
    } = {},
): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? 2);
    const timeoutMs = Math.max(2_000, options.timeoutMs ?? 12_000);
    const backoffMs = Math.max(10, options.backoffMs ?? 100);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await withTimeout(
                load(),
                timeoutMs,
                `${label} attempt ${attempt}`,
            );
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                refreshReadClients();
                await sleep(backoffMs * attempt);
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error(`${label} failed after ${attempts} attempts`);
}

async function loadClaimPosition(
    agent: BaseAgent,
    address: string,
): Promise<CachedPosition | null> {
    const cachedPosition = getCachedPosition(address);
    if (hasPosition(cachedPosition)) {
        return cachedPosition;
    }

    const loadWithContract = async (
        contract: Contract,
        label: string,
    ): Promise<CachedPosition> => {
        const positionRaw = await withTimeout(
            contract.positions(currentMarketKey, address),
            6_000,
            `${agent.config.name} ${label} claim lookup`,
        );
        return parsePosition(positionRaw);
    };

    try {
        const position = await loadWithContract(clobRead, "read");
        agentPositionCache.set(address, position);
        return position;
    } catch (error) {
        refreshReadClients();
        try {
            const position = await loadWithContract(clob, "write");
            agentPositionCache.set(address, position);
            return position;
        } catch (fallbackError) {
            broadcast({
                type: "log",
                data: {
                    message: `[${agent.config.name}] Claim lookup skipped: ${
                        fallbackError instanceof Error
                            ? fallbackError.message.slice(0, 100)
                            : String(fallbackError).slice(0, 100)
                    }`,
                    tick: simTick,
                },
            });
            if (error instanceof Error) {
                console.warn(
                    `[claims] ${agent.config.name} read lookup failed: ${error.message}`,
                );
            }
            return null;
        }
    }
}

function getResidualClaimCandidates(): ClaimCandidate[] {
    const candidates: ClaimCandidate[] = [];
    for (const agent of agents) {
        const address = agentAddressCache.get(agent);
        if (!address) {
            continue;
        }
        const position = getCachedPosition(address);
        if (!hasPosition(position)) {
            continue;
        }
        candidates.push({
            agent,
            address,
            position,
        });
    }
    return candidates;
}

async function processClaimCandidates(
    candidates: ClaimCandidate[],
    stagePrefix: string,
    budgetMs: number,
): Promise<void> {
    if (candidates.length === 0) {
        return;
    }

    updateActiveRunStage(`${stagePrefix}-${candidates.length}`);
    const claimDeadline = Date.now() + budgetMs;
    for (const [index, candidate] of candidates.entries()) {
        if (Date.now() >= claimDeadline) {
            updateActiveRunStage(`${stagePrefix}-budget-exhausted`);
            broadcast({
                type: "log",
                data: {
                    message: `⏭️ Claim budget exhausted after ${index}/${candidates.length} claims during ${stagePrefix}`,
                    tick: simTick,
                },
            });
            break;
        }
        try {
            updateActiveRunStage(
                `${stagePrefix}-${index + 1}-of-${candidates.length}`,
            );
            const txClaim: any = await withTimeout(
                (clob.connect(candidate.agent.signer) as any).claim(
                    currentDuelKey,
                    MARKET_KIND_DUEL_WINNER,
                ),
                20_000,
                `${candidate.agent.config.name} claim`,
            );
            await withTimeout(
                txClaim.wait(),
                20_000,
                `${candidate.agent.config.name} claim receipt`,
            );
            agentPositionCache.set(candidate.address, { ...ZERO_POSITION });
            broadcast({
                type: "log",
                data: {
                    message: `[${candidate.agent.config.name}] Claimed winnings`,
                    tick: simTick,
                },
            });
        } catch (err: any) {
            broadcast({
                type: "log",
                data: {
                    message: `[${candidate.agent.config.name}] Claim: ${err.message?.slice(0, 80)}`,
                    tick: simTick,
                },
            });
        }
    }
}

function createScenarioRunRecord(
    preset: ScenarioPreset,
    options: {
        seed?: string;
        ticks?: number;
        winner?: "A" | "B";
        freshBaseline?: boolean;
    },
): ScenarioRunRecord {
    scenarioRunSequence += 1;
    return {
        runId: `${preset.id}-${Date.now()}-${scenarioRunSequence}`,
        scenarioId: preset.id,
        scenarioName: preset.name,
        seed: options.seed?.trim() || preset.canonicalSeed,
        ticks: Math.max(1, Math.min(200, options.ticks ?? preset.defaultTicks)),
        winner: options.winner ?? preset.defaultWinner,
        freshBaseline: options.freshBaseline ?? false,
        status: "queued",
        stage: "queued",
        requestedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        error: null,
        result: null,
    };
}

function resetScenarioMetrics(): void {
    peakInventorySeen = 0;
    worstMarketMakerPnl = 0;
    bestAttackerPnlSeen = 0;
    scenarioObservedTicks = 0;
    scenarioQuotedTicks = 0;
    scenarioSpreadBpsTotal = 0;
    scenarioSpreadSamples = 0;
    lastResolveLatencyMs = null;
    staleStreamGuardTripsSeen = 0;
    staleOracleGuardTripsSeen = 0;
    closeGuardTripsSeen = 0;
    circuitBreakerTripsSeen = 0;
    lastComputedState = null;
    simTick = 0;
}

function applyScenarioPresetByName(name: string): ScenarioPreset {
    const preset = getScenarioPresetByIdOrName(name);
    if (!preset) {
        throw new Error(`Unknown scenario preset: ${name}`);
    }

    currentScenarioId = preset.id;
    for (const agent of agents) {
        agent.config.enabled = preset.enabledStrategies.includes(agent.config.strategy);
    }
    return preset;
}

function marketStatusLabel(status: number): ScenarioSettlementStatus {
    switch (status) {
        case 1:
            return "OPEN";
        case 2:
            return "LOCKED";
        case 3:
            return "RESOLVED";
        case 4:
            return "CANCELLED";
        default:
            return "NULL";
    }
}

async function restoreScenarioBaseline(): Promise<void> {
    if (!provider || !baselineSnapshotId || !baselineRuntimeState) {
        throw new Error("Scenario baseline is not initialized");
    }

    simRunning = false;
    try {
        updateActiveRunStage("restore-baseline-revert");
        const controlProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);
        await withTimeout(
            controlProvider.send("evm_revert", [baselineSnapshotId]),
            SCENARIO_BASELINE_REVERT_TIMEOUT_MS,
            "baseline evm_revert",
        );
        updateActiveRunStage("restore-baseline-snapshot");
        baselineSnapshotId = await withTimeout(
            controlProvider.send("evm_snapshot", []),
            SCENARIO_BASELINE_SNAPSHOT_TIMEOUT_MS,
            "baseline evm_snapshot",
        );
        refreshReadClients();
    } catch (error) {
        console.warn(
            `[baseline] Restore failed, rebuilding local sim backend: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        updateActiveRunStage("restore-baseline-rebuild");
        await withTimeout(
            rebuildSimulationEnvironment(),
            SCENARIO_BASELINE_REBUILD_TIMEOUT_MS,
            "baseline rebuild",
        );
    }

    duelCounter = baselineRuntimeState.duelCounter;
    currentDuelLabel = baselineRuntimeState.currentDuelLabel;
    currentDuelKey = baselineRuntimeState.currentDuelKey;
    currentMarketKey = baselineRuntimeState.currentMarketKey;
    currentScenarioId = "manual";
    eventLog.length = 0;
    for (const agent of agents) {
        agent.activeOrderIds = [];
        agent.tradeCount = 0;
        const address = agentAddressCache.get(agent);
        if (address) {
            agentPositionCache.set(address, { ...ZERO_POSITION });
        }
    }
    resetScenarioMetrics();
}

async function captureScenarioBaseline(): Promise<void> {
    baselineRuntimeState = {
        duelCounter,
        currentDuelLabel,
        currentDuelKey,
        currentMarketKey,
    };
    baselineSnapshotId = await provider.send("evm_snapshot", []);
    eventLog.length = 0;
    refreshReadClients();
}

async function rebuildSimulationEnvironment(): Promise<void> {
    await stopAnvil();
    eventLog.length = 0;
    initialBalances.clear();
    agentAddressCache.clear();
    agentPositionCache.clear();
    await startAnvil();
    await deployContracts();
    await captureScenarioBaseline();
}

// ─── Anvil Management ────────────────────────────────────────────────────────

async function startAnvil(): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`[anvil] Starting on port ${ANVIL_PORT}...`);
        anvilProcess = spawn("anvil", [
            "--host", "127.0.0.1",
            "--port", String(ANVIL_PORT),
            "--chain-id", "31337",
            "--accounts", "24",
            "--balance", "10000",
            "--silent",
        ]);

        anvilProcess.on("error", (err) => {
            console.error("[anvil] Failed to start:", err.message);
            reject(err);
        });

        anvilProcess.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes("error") || text.includes("Error")) {
                console.error("[anvil stderr]", text.trim());
            }
        });

        // Wait for Anvil to be ready
        const checkReady = async () => {
            for (let i = 0; i < 60; i++) {
                try {
                    const testProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`);
                    await testProvider.getBlockNumber();
                    console.log("[anvil] Ready ✓");
                    resolve();
                    return;
                } catch {
                    await sleep(500);
                }
            }
            reject(new Error("Anvil did not start within 30s"));
        };

        checkReady();
    });
}

async function stopAnvil(): Promise<void> {
    if (anvilProcess) {
        const processToStop = anvilProcess;
        anvilProcess = null;
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            };
            const timer = setTimeout(() => {
                processToStop.kill("SIGKILL");
                finish();
            }, 5_000);
            processToStop.once("exit", () => {
                clearTimeout(timer);
                finish();
            });
            processToStop.kill("SIGTERM");
        });
        await sleep(250);
        console.log("[anvil] Stopped");
    }
}

// ─── Deploy Contracts ────────────────────────────────────────────────────────

async function deployContracts(): Promise<void> {
    provider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);
    readProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);

    const signers = await Promise.all(
        Array.from({ length: 24 }, (_, i) => provider.getSigner(i)),
    );
    const admin = signers[0];
    const operator = signers[1];
    const reporter = signers[2];
    const treasury = signers[3];
    const marketMaker = signers[4];

    treasuryAddr = await treasury.getAddress();
    mmAddr = await marketMaker.getAddress();

    let oracleArtifact;
    let clobArtifact;
    try {
        oracleArtifact = loadArtifact(CONTRACTS_DIR, "DuelOutcomeOracle");
        clobArtifact = loadArtifact(CONTRACTS_DIR, "GoldClob");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
            `[deploy] Contract artifacts not found. Build packages/evm-contracts first. (${message})`,
        );
        process.exit(1);
    }

    console.log("[deploy] Deploying DuelOutcomeOracle...");
    const oracleFactory = new ContractFactory(oracleArtifact.abi as any, oracleArtifact.bytecode, admin);
    oracle = (await oracleFactory.deploy(
        await admin.getAddress(),
        await reporter.getAddress(),
    )) as unknown as Contract;
    await oracle.waitForDeployment();

    console.log("[deploy] Deploying GoldClob...");
    const clobFactory = new ContractFactory(clobArtifact.abi as any, clobArtifact.bytecode, admin);
    clob = (await clobFactory.deploy(
        await admin.getAddress(),
        await operator.getAddress(),
        await oracle.getAddress(),
        await treasury.getAddress(),
        await marketMaker.getAddress(),
    )) as unknown as Contract;
    await clob.waitForDeployment();

    oracleAddr = await oracle.getAddress();
    clobAddr = await clob.getAddress();
    oracleRead = oracle.connect(readProvider) as unknown as Contract;
    clobRead = clob.connect(readProvider) as unknown as Contract;
    feeConfig = {
        treasuryBps: BigInt(await clob.tradeTreasuryFeeBps()),
        mmBps: BigInt(await clob.tradeMarketMakerFeeBps()),
        winningsMmBps: BigInt(await clob.winningsMarketMakerFeeBps()),
    };
    console.log(`[deploy] Oracle: ${oracleAddr}`);
    console.log(`[deploy] CLOB:   ${clobAddr}`);

    // Set up event listeners on CLOB
    setupEventListeners();

    // Create initial agents
    await createAgents(signers);

    // Create initial duel
    await openNewDuel();
}

function setupEventListeners(): void {
    const iface = clob.interface;

    clob.on("*", (event: any) => {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                event: event.eventName || event.fragment?.name || "unknown",
                args: {} as Record<string, any>,
                blockNumber: event.log?.blockNumber,
                txHash: event.log?.transactionHash,
            };

            // Parse args
            if (event.args) {
                const fragment = event.fragment;
                if (fragment && (fragment as any).inputs) {
                    for (let i = 0; i < (fragment as any).inputs.length; i++) {
                        const name = (fragment as any).inputs[i].name;
                        const val = event.args[i];
                        entry.args[name] = typeof val === "bigint" ? val.toString() : val;
                    }
                }
            }

            eventLog.push(entry);
            if (eventLog.length > 1000) eventLog.shift();

            broadcast({ type: "event", data: entry });
        } catch {
            // Ignore parsing errors for catch-all listener
        }
    });
}

async function createAgents(signers: any[]): Promise<void> {
    // Define agents with their desired starting balances
    const agentDefs: { agent: BaseAgent; balance: string }[] = [
        { agent: new RetailAgent(signers[5], clob), balance: "5" },
        { agent: new RetailAgent(signers[6], clob), balance: "5" },
        { agent: new RetailAgent(signers[16], clob), balance: "3" },
        { agent: new MarketMakerAgent(signers[7], clob), balance: "1" },
        { agent: new WhaleAgent(signers[8], clob), balance: "10" },
        { agent: new MevFrontrunnerAgent(signers[9], clob, provider), balance: "2" },
        { agent: new MevFrontrunnerAgent(signers[17], clob, provider), balance: "2" },
        { agent: new SandwichAgent(signers[10], clob), balance: "3" },
        { agent: new SandwichAgent(signers[18], clob), balance: "2" },
        { agent: new WashTraderAgent(signers[11], clob), balance: "3" },
        { agent: new OracleAttackAgent(signers[12], clob, oracle), balance: "2" },
        { agent: new CabalAgent(signers[13], clob, true), balance: "3" },
        { agent: new CabalAgent(signers[19], clob, false), balance: "3" },
        { agent: new ArbitrageurAgent(signers[14], clob), balance: "2" },
        { agent: new StressTestAgent(signers[15], clob), balance: "2" },
        { agent: new CancelReplaceAgent(signers[20], clob), balance: "2" },
    ];

    agents = agentDefs.map(d => d.agent);

    // Name duplicated agent types
    agents[1].config.name = "Retail Trader 2";
    agents[1].config.color = "#29b6f6";
    agents[2].config.name = "Retail Trader 3";
    agents[2].config.color = "#4dd0e1";
    agents[6].config.name = "MEV Bot 2";
    agents[6].config.color = "#ff6e40";
    agents[8].config.name = "Sandwich Bot 2";
    agents[8].config.color = "#e040fb";
    agents[12].config.name = "Cabal (Counter)";
    agents[12].config.color = "#b388ff";

    // Set balances via anvil_setBalance
    for (let i = 0; i < agents.length; i++) {
        const addr = await agents[i].signer.getAddress();
        agentAddressCache.set(agents[i], addr);
        agentPositionCache.set(addr, { ...ZERO_POSITION });
        const balWei = ethers.parseEther(agentDefs[i].balance);
        await provider.send("anvil_setBalance", [addr, "0x" + balWei.toString(16)]);
        initialBalances.set(addr, agentDefs[i].balance);
        console.log(`[fund] ${agents[i].config.name}: ${agentDefs[i].balance} ETH`);
    }
}

async function openNewDuel(): Promise<void> {
    duelCounter++;
    currentDuelLabel = `sim-duel-${duelCounter}`;
    currentDuelKey = duelKey(currentDuelLabel);
    currentScenarioId = "manual";
    resetScenarioMetrics();

    const reporter = await provider.getSigner(2);
    const operator = await provider.getSigner(1);

    const block = await provider.getBlock("latest");
    const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));

    const tx1 = await (oracle.connect(reporter) as any).upsertDuel(
      currentDuelKey,
      hashParticipant(`${currentDuelLabel}:agent-alpha`),
      hashParticipant(`${currentDuelLabel}:agent-beta`),
      now,
      now + 604800n, // 1 week betting window (Anvil advances time per-tx)
      now + 1209600n, // 2 week duel start
      `sim://${currentDuelLabel}`,
      DUEL_STATUS_BETTING_OPEN,
  );
  await tx1.wait();

  const tx2 = await (clob.connect(operator) as any).createMarketForDuel(currentDuelKey, MARKET_KIND_DUEL_WINNER);
  await tx2.wait();

    currentMarketKey = await clob.marketKey(currentDuelKey, MARKET_KIND_DUEL_WINNER);

    console.log(`[sim] Opened duel: ${currentDuelLabel}`);
    broadcast({ type: "duel_opened", data: { label: currentDuelLabel, duelKey: currentDuelKey } });
}

// ─── Simulation Loop ─────────────────────────────────────────────────────────

async function simulationTick(): Promise<void> {
    simTick++;
    const scenarioMode = scenarioRunInFlight;
    const scenarioPreset = getScenarioPresetByIdOrName(currentScenarioId);
    const treasuryFeeBps = feeConfig.treasuryBps;
    const mmFeeBps = feeConfig.mmBps;
    let market = await withReadRetry(
        `tick ${simTick} initial getMarket`,
        () => clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER),
    );

    for (const agent of agents) {
        if (!agent.config.enabled) continue;

        if (scenarioMode) {
            updateActiveRunStage(`tick-${simTick}-agent-${agent.config.strategy}`);
        }
        try {
            await withTimeout(
                (async () => {
                    const address = await getAgentAddress(agent);
                    const position = getCachedPosition(address);
                    const ctx: SimContext = {
                        duelKey: currentDuelKey,
                        marketKey: currentMarketKey,
                        bestBid: Number(market.bestBid),
                        bestAsk: Number(market.bestAsk) >= MAX_PRICE ? 0 : Number(market.bestAsk),
                        mid: calculateMid(Number(market.bestBid), Number(market.bestAsk)),
                        totalAShares: market.totalAShares,
                        totalBShares: market.totalBShares,
                        tick: simTick,
                        nowMs: simTick * 500,
                        treasuryFeeBps,
                        mmFeeBps,
                        agentActiveOrderIds: agent.activeOrderIds,
                        scenarioProfile: scenarioPreset?.runtimeProfile ?? null,
                        agentPosition: {
                            aShares: position.aShares,
                            bShares: position.bShares,
                            aStake: position.aStake,
                            bStake: position.bStake,
                        },
                    };

                    // Special handling for oracle attack agent
                    if (agent instanceof OracleAttackAgent && agent.config.enabled) {
                        if (simTick % 10 === 0) {
                            const msg = await agent.executeOracleAttack(currentDuelKey);
                            broadcast({ type: "log", data: { message: msg, tick: simTick } });
                        }
                        return;
                    }

                    const actions = agent.decide(ctx);
                    if (actions.length > 0) {
                        const logs = await withTimeout(
                            agent.executeActions(actions, ctx),
                            scenarioMode
                                ? Math.max(8_000, actions.length * 6_000)
                                : Math.max(20_000, actions.length * 20_000),
                            `tick ${simTick} agent ${agent.config.name} executeActions`,
                        );
                        for (const msg of logs) {
                            broadcast({ type: "log", data: { message: msg, tick: simTick } });
                        }
                    }
                })(),
                scenarioMode ? 15_000 : 120_000,
                `tick ${simTick} agent ${agent.config.name}`,
            );
        } catch (err: any) {
            const message = err.message?.slice(0, 150) ?? "unknown simulation error";
            broadcast({
                type: "log",
                data: { message: `[${agent.config.name}] ERROR: ${message}`, tick: simTick },
            });
            if (message.includes("timed out after") && !scenarioMode) {
                throw err;
            }
        }

        await sleep(5);
    }

    if (scenarioRunInFlight) {
        return;
    }

    // Broadcast full state update for interactive/manual mode.
    await withTimeout(
        broadcastState(),
        30_000,
        `tick ${simTick} broadcastState`,
    );
}

function calculateMid(bestBid: number, bestAsk: number): number {
    const bid = bestBid > 0 ? bestBid : 0;
    const ask = bestAsk > 0 && bestAsk < MAX_PRICE ? bestAsk : 0;

    if (bid > 0 && ask > 0) return Math.floor((bid + ask) / 2);
    if (bid > 0) return bid;
    if (ask > 0) return ask;
    return 500; // default mid
}

async function broadcastState(): Promise<void> {
    try {
        const [
            market,
            agentSnapshots,
            book,
            treasuryBalance,
            mmBalance,
        ] = await Promise.all([
            withReadRetry(
                "broadcast getMarket",
                () => clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER),
            ),
            Promise.all(
                agents.map(async (agent) => {
                    const addr = await getAgentAddress(agent);
                    const [balance, position] = await Promise.all([
                        withReadRetry(
                            `broadcast ${agent.config.name} getBalance`,
                            () => readProvider.getBalance(addr),
                        ),
                        withReadRetry(
                            `broadcast ${agent.config.name} getPosition`,
                            () => clobRead.positions(currentMarketKey, addr),
                        ),
                    ]);
                    const balanceFormatted = formatEth(balance);
                    const initBal = initialBalances.get(addr) || "10000";
                    const pnlValue = Number(balanceFormatted) - Number(initBal);
                    const inventoryUnits = Number(position.aShares + position.bShares);
                    return {
                        name: agent.config.name,
                        strategy: agent.config.strategy,
                        description: agent.config.description,
                        enabled: agent.config.enabled,
                        color: agent.config.color,
                        address: addr,
                        balance: balanceFormatted,
                        pnl: pnlValue.toFixed(4),
                        pnlValue,
                        tradeCount: agent.tradeCount,
                        activeOrders: agent.activeOrderIds.length,
                        inventoryUnits,
                        positionRaw: {
                            aShares: position.aShares.toString(),
                            bShares: position.bShares.toString(),
                            aStake: position.aStake.toString(),
                            bStake: position.bStake.toString(),
                        },
                        position: {
                            aShares: position.aShares.toString(),
                            bShares: position.bShares.toString(),
                            aStake: formatEth(position.aStake),
                            bStake: formatEth(position.bStake),
                        },
                        };
                    }),
            ),
            buildOrderBook(),
            withReadRetry("broadcast treasury getBalance", () => readProvider.getBalance(treasuryAddr)),
            withReadRetry("broadcast mm getBalance", () => readProvider.getBalance(mmAddr)),
        ]);
        for (const snapshot of agentSnapshots) {
            agentPositionCache.set(snapshot.address, {
                aShares: BigInt(snapshot.positionRaw.aShares),
                bShares: BigInt(snapshot.positionRaw.bShares),
                aStake: BigInt(snapshot.positionRaw.aStake),
                bStake: BigInt(snapshot.positionRaw.bStake),
            });
        }
        const agentStates = agentSnapshots.map(
            ({ pnlValue, inventoryUnits, positionRaw, ...agentState }) => agentState,
        );
        const marketStatus = Number(market.status);
        const settlementStatus = marketStatusLabel(marketStatus);
        const bestBid = Number(market.bestBid);
        const bestAsk = Number(market.bestAsk);
        const boundedBestAsk = bestAsk > 0 && bestAsk < MAX_PRICE ? bestAsk : null;
        const spreadWidthBps = computeToxicityBps(
            bestBid > 0 ? bestBid : null,
            boundedBestAsk,
        );
        const orderChurn = eventLog.filter((entry) =>
            entry.event === "OrderPlaced" ||
            entry.event === "OrderCancelled" ||
            entry.event === "OrderMatched",
        ).length;
        const attackerPnl = agentSnapshots
            .filter((agent) => ATTACKER_STRATEGIES.has(agent.strategy))
            .reduce((max, agent) => Math.max(max, agent.pnlValue), 0);
        bestAttackerPnlSeen = Math.max(bestAttackerPnlSeen, attackerPnl);

        const marketMakerAgent = agentSnapshots.find(
            (agent) => agent.strategy === "market_maker",
        );
        const marketMakerRuntimeAgent =
            agents.find((agent) => agent instanceof MarketMakerAgent) ??
            null;
        const marketMakerPlan =
            marketMakerRuntimeAgent instanceof MarketMakerAgent
                ? marketMakerRuntimeAgent.lastPlan
                : null;
        if (marketMakerPlan?.risk.staleStream) {
            staleStreamGuardTripsSeen += 1;
        }
        if (marketMakerPlan?.risk.staleOracle) {
            staleOracleGuardTripsSeen += 1;
        }
        if (marketMakerPlan?.risk.closingSoon) {
            closeGuardTripsSeen += 1;
        }
        if (marketMakerPlan?.risk.circuitBreaker.active) {
            circuitBreakerTripsSeen += 1;
        }
        if (marketMakerAgent) {
            worstMarketMakerPnl = Math.min(
                worstMarketMakerPnl,
                marketMakerAgent.pnlValue,
            );
        }
        peakInventorySeen = Math.max(
            peakInventorySeen,
            ...agentSnapshots.map((agent) => agent.inventoryUnits),
        );

        const marketMakerDrawdownBps = marketMakerAgent
            ? Math.round(
                (Math.abs(Math.min(0, worstMarketMakerPnl)) /
                    Math.max(
                        0.0001,
                        Number(initialBalances.get(marketMakerAgent.address) || "1"),
                    )) *
                    10_000,
            )
            : 0;
        const claimsProcessed =
            marketStatus < MARKET_STATUS_RESOLVED ||
            agentSnapshots.every(
                (agent) =>
                    BigInt(agent.positionRaw.aShares) === 0n &&
                    BigInt(agent.positionRaw.bShares) === 0n &&
                    BigInt(agent.positionRaw.aStake) === 0n &&
                    BigInt(agent.positionRaw.bStake) === 0n,
            );
        const settlementConsistent =
            marketStatus === MARKET_STATUS_RESOLVED
                ? Number(market.winner) === SIDE_A || Number(market.winner) === SIDE_B
                : marketStatus === MARKET_STATUS_CANCELLED
                  ? Number(market.winner) === 0
                  : true;
        const bookNotCrossed = boundedBestAsk == null || bestBid <= 0 || bestBid < boundedBestAsk;
        const mmSolvent =
            (marketMakerAgent ? Number(marketMakerAgent.balance) > 0 : true) &&
            mmBalance > 0n;
        const mitigationGates: MitigationGate[] = [
            {
                name: "mmSolvent",
                passed: mmSolvent,
                reason: mmSolvent ? null : "market-maker wallet depleted",
            },
            {
                name: "bookNotCrossed",
                passed: bookNotCrossed,
                reason: bookNotCrossed ? null : "best bid crosses best ask",
            },
            {
                name: "noPositiveAttackerPnl",
                passed: bestAttackerPnlSeen <= 0,
                reason:
                    bestAttackerPnlSeen <= 0
                        ? null
                        : `attacker pnl peaked at ${bestAttackerPnlSeen.toFixed(4)} ETH`,
            },
            {
                name: "settlementConsistent",
                passed: settlementConsistent,
                reason: settlementConsistent ? null : "winner/status mismatch after settlement",
            },
            {
                name: "claimsProcessed",
                passed: claimsProcessed,
                reason: claimsProcessed ? null : "settled market still has residual positions",
            },
        ];
        const activeScenarioPreset = getScenarioPresetByIdOrName(currentScenarioId);
        const scenarioPolicyGates = activeScenarioPreset
            ? evaluateScenarioPolicyGates(activeScenarioPreset, {
                  attackerPnl: bestAttackerPnlSeen,
                  maxDrawdownBps: marketMakerDrawdownBps,
                  quoteUptimeRatio:
                      scenarioObservedTicks > 0
                          ? scenarioQuotedTicks / scenarioObservedTicks
                          : 0,
                  orderChurn,
                  degraded: false,
                  mmSolvent,
                  bookNotCrossed,
                  settlementConsistent,
                  claimsProcessed,
                  settlementStatus,
                  staleStreamGuardTrips: staleStreamGuardTripsSeen,
                  staleOracleGuardTrips: staleOracleGuardTripsSeen,
                  closeGuardTrips: closeGuardTripsSeen,
              })
            : [];
        const protocolMmPnl = Number(
            formatEth(
                mmBalance - ethers.parseEther(initialBalances.get(mmAddr) || "10000"),
            ),
        );
        if (marketStatus === 1) {
            scenarioObservedTicks += 1;
            if ((marketMakerAgent?.activeOrders ?? 0) > 0) {
                scenarioQuotedTicks += 1;
            }
            scenarioSpreadBpsTotal += spreadWidthBps;
            scenarioSpreadSamples += 1;
        }

        const state = {
            type: "state",
            data: {
                tick: simTick,
                running: simRunning,
                speed: simSpeed,
                scenario: {
                    id: currentScenarioId,
                },
                duel: {
                    label: currentDuelLabel,
                    key: currentDuelKey,
                    counter: duelCounter,
                },
                market: {
                    exists: market.exists,
                    status: marketStatus,
                    winner: Number(market.winner),
                    bestBid,
                    bestAsk,
                    totalAShares: market.totalAShares.toString(),
                    totalBShares: market.totalBShares.toString(),
                },
                contracts: {
                    oracle: oracleAddr,
                    clob: clobAddr,
                },
                fees: {
                    treasuryBps: feeConfig.treasuryBps.toString(),
                    mmBps: feeConfig.mmBps.toString(),
                    winningsMmBps: feeConfig.winningsMmBps.toString(),
                    treasuryAccruedWei: (treasuryBalance - ethers.parseEther(initialBalances.get(treasuryAddr) || "10000")).toString(),
                    mmAccruedWei: (mmBalance - ethers.parseEther(initialBalances.get(mmAddr) || "10000")).toString(),
                },
                activeRun: getActiveScenarioRun(),
                agents: agentStates,
                book,
                mitigation: {
                    gates: mitigationGates,
                    scenarioGates: scenarioPolicyGates,
                    metrics: {
                        attackerPnlCurrent: attackerPnl,
                        attackerPnlPeak: bestAttackerPnlSeen,
                        marketMakerPnl:
                            marketMakerAgent?.pnlValue ?? 0,
                        protocolMarketMakerPnl: protocolMmPnl,
                        marketMakerDrawdownBps,
                        peakInventory: peakInventorySeen,
                        spreadWidthBps,
                        orderChurn,
                        staleStreamGuardTrips: staleStreamGuardTripsSeen,
                        staleOracleGuardTrips: staleOracleGuardTripsSeen,
                        closeGuardTrips: closeGuardTripsSeen,
                        circuitBreakerTrips: circuitBreakerTripsSeen,
                        settlementConsistent,
                        claimsProcessed,
                        settlementStatus,
                    },
                },
                scenarios: SCENARIO_PRESETS,
                eventLogCount: eventLog.length,
            },
        };

        lastComputedState = state.data;
        broadcast(state);
    } catch (err: any) {
        console.error("[state] Error building state:", err.message);
    }
}

async function buildOrderBook(): Promise<{ bids: any[]; asks: any[] }> {
    const bids: { price: number; total: string }[] = [];
    const asks: { price: number; total: string }[] = [];

    // Sample price levels around the interesting range
    const market = await withReadRetry(
        "order-book getMarket",
        () => clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER),
    );
    const bestBid = Number(market.bestBid);
    const bestAsk = Number(market.bestAsk);

    // Scan bid side downward from bestBid
    if (bestBid > 0) {
        const prices: number[] = [];
        for (let p = bestBid; p >= Math.max(1, bestBid - 100); p -= 5) {
            prices.push(p);
        }
        const levels = await Promise.all(
            prices.map(async (price) => {
                try {
                    const level = await withReadRetry(
                        `order-book bid level ${price}`,
                        () => clobRead.getPriceLevel(
                            currentDuelKey,
                            MARKET_KIND_DUEL_WINNER,
                            BUY_SIDE,
                            price,
                        ),
                    );
                    return level[2] > 0n
                        ? { price, total: level[2].toString() }
                        : null;
                } catch {
                    return null;
                }
            }),
        );
        bids.push(
            ...levels.filter(
                (level): level is { price: number; total: string } => level != null,
            ),
        );
    }

    // Scan ask side upward from bestAsk
    if (bestAsk > 0 && bestAsk < MAX_PRICE) {
        const prices: number[] = [];
        for (let p = bestAsk; p <= Math.min(999, bestAsk + 100); p += 5) {
            prices.push(p);
        }
        const levels = await Promise.all(
            prices.map(async (price) => {
                try {
                    const level = await withReadRetry(
                        `order-book ask level ${price}`,
                        () => clobRead.getPriceLevel(
                            currentDuelKey,
                            MARKET_KIND_DUEL_WINNER,
                            SELL_SIDE,
                            price,
                        ),
                    );
                    return level[2] > 0n
                        ? { price, total: level[2].toString() }
                        : null;
                } catch {
                    return null;
                }
            }),
        );
        asks.push(
            ...levels.filter(
                (level): level is { price: number; total: string } => level != null,
            ),
        );
    }

    return { bids, asks };
}

async function runSimLoop(): Promise<void> {
    while (simRunning) {
        await simulationTick();
        await sleep(simSpeed);
    }
}

function buildScenarioTraces(limit = 80): AgentActionTrace[] {
    return eventLog.slice(-limit).map((entry) => ({
        actor: String(entry.args?.maker ?? "protocol"),
        action: String(entry.event ?? "unknown"),
        chainKey: "bsc",
        duelKey: currentDuelKey,
        marketRef: currentMarketKey,
        price:
            entry.args?.price == null
                ? null
                : Number(entry.args.price),
        units:
            entry.args?.amount != null
                ? Number(entry.args.amount)
                : entry.args?.matchedAmount != null
                  ? Number(entry.args.matchedAmount)
                  : null,
        txRef: entry.txHash ?? null,
        ok: true,
        message: entry.event,
    }));
}

function buildScenarioResult(
    preset: ScenarioPreset,
    seed: string,
    options: {
        degradedReasons?: Array<{
            name: string;
            reason: string;
        }>;
    } = {},
): ScenarioResult {
    const fallbackGates = [...(options.degradedReasons ?? [])].reverse().map(
        (degradedReason) =>
            ({
                name: degradedReason.name,
                passed: false,
                reason: degradedReason.reason,
            }) satisfies MitigationGate,
    );
    if (!lastComputedState) {
        fallbackGates.unshift({
            name: "stateCaptured",
            passed: false,
            reason: "Scenario finished without a computed state snapshot",
        });
        const marketMakerPnl = worstMarketMakerPnl;
        const gates = fallbackGates;
        return {
            scenarioId: preset.id,
            name: preset.name,
            family: preset.family,
            seed,
            chainKey: "bsc",
            attackerPnl: bestAttackerPnlSeen,
            marketMakerPnl,
            maxDrawdownBps: Math.round(
                (Math.abs(Math.min(0, marketMakerPnl)) / 1) * 10_000,
            ),
            peakInventory: peakInventorySeen,
            quoteUptimeRatio:
                scenarioObservedTicks > 0
                    ? scenarioQuotedTicks / scenarioObservedTicks
                    : 0,
            spreadWidthBps:
                scenarioSpreadSamples > 0
                    ? Math.round(scenarioSpreadBpsTotal / scenarioSpreadSamples)
                    : 0,
            orderChurn: eventLog.filter((entry) =>
                entry.event === "OrderPlaced" ||
                entry.event === "OrderCancelled" ||
                entry.event === "OrderMatched",
            ).length,
            lockTransitionLatencyMs: lastResolveLatencyMs,
            resolvedCorrectly: false,
            claimCorrectly: false,
            passed: gates.every((gate) => gate.passed),
            degraded: true,
            gates,
            traces: buildScenarioTraces(),
        };
    }

    const gates = [
        ...(lastComputedState.mitigation.gates as MitigationGate[]),
        ...((lastComputedState.mitigation.scenarioGates as MitigationGate[] | undefined) ?? []),
    ];
    gates.unshift(...fallbackGates);

    const marketMakerSnapshotPnl = Number(
        lastComputedState.mitigation.metrics.marketMakerPnl ?? 0,
    );
    const marketMakerPnl =
        marketMakerSnapshotPnl !== 0 ? marketMakerSnapshotPnl : worstMarketMakerPnl;
    const maxDrawdownBps = Math.round(
        (Math.abs(Math.min(0, marketMakerPnl)) / 1) * 10_000,
    );
    const degraded = (options.degradedReasons?.length ?? 0) > 0;
    const expectedSettledStatus =
        preset.runtimeProfile?.settlementMode === "cancel"
            ? MARKET_STATUS_CANCELLED
            : MARKET_STATUS_RESOLVED;

    return {
        scenarioId: preset.id,
        name: preset.name,
        family: preset.family,
        seed,
        chainKey: "bsc",
        attackerPnl: bestAttackerPnlSeen,
        marketMakerPnl,
        maxDrawdownBps,
        peakInventory: peakInventorySeen,
        quoteUptimeRatio:
            scenarioObservedTicks > 0 ? scenarioQuotedTicks / scenarioObservedTicks : 0,
        spreadWidthBps:
            scenarioSpreadSamples > 0
                ? Math.round(scenarioSpreadBpsTotal / scenarioSpreadSamples)
                : Number(lastComputedState.mitigation.metrics.spreadWidthBps ?? 0),
        orderChurn: eventLog.filter((entry) =>
            entry.event === "OrderPlaced" ||
            entry.event === "OrderCancelled" ||
            entry.event === "OrderMatched",
        ).length,
        lockTransitionLatencyMs: lastResolveLatencyMs,
        resolvedCorrectly: degraded
            ? false
            : Boolean(lastComputedState.mitigation.metrics.settlementConsistent) &&
              Number(lastComputedState.market.status) === expectedSettledStatus,
        claimCorrectly: degraded
            ? false
            : Boolean(lastComputedState.mitigation.metrics.claimsProcessed),
        passed: gates.every((gate) => gate.passed),
        degraded,
        gates,
        traces: buildScenarioTraces(),
    };
}

async function runScenarioPreset(
    run: ScenarioRunRecord,
): Promise<ScenarioResult> {
    if (scenarioRunInFlight) {
        throw new Error("A scenario run is already in progress");
    }

    const preset = SCENARIO_PRESETS.find((entry) => entry.id === run.scenarioId);
    if (!preset) {
        throw new Error(`Unknown scenario preset: ${run.scenarioId}`);
    }

    scenarioRunInFlight = true;
    activeScenarioRunId = run.runId;
    try {
        updateScenarioRun(run.runId, (entry) => {
            entry.status = "running";
            entry.stage = "restore-baseline";
            entry.startedAt = Date.now();
            entry.finishedAt = null;
            entry.error = null;
            entry.result = null;
        });
        if (run.freshBaseline) {
            updateActiveRunStage("restore-baseline-rebuild");
            await withTimeout(
                rebuildSimulationEnvironment(),
                SCENARIO_BASELINE_REBUILD_TIMEOUT_MS,
                `scenario ${preset.id} fresh baseline rebuild`,
            );
        } else {
            await restoreScenarioBaseline();
        }
        applyScenarioPresetByName(run.scenarioId);
        const seed = run.seed;
        const ticks = run.ticks;
        const winner = run.winner;
        const settlementMode =
            preset.runtimeProfile?.settlementMode ?? "resolve";

        setRandomSeed(seed);
        broadcast({
            type: "log",
            data: {
                message: `🧪 Scenario run starting: ${preset.name} seed=${seed} ticks=${ticks}`,
                tick: simTick,
            },
        });

        const degradedReasons: Array<{ name: string; reason: string }> = [];
        const tickTimeoutMs = Math.max(20_000, countEnabledAgents() * 4_000);
        for (let i = 0; i < ticks; i += 1) {
            updateScenarioRun(run.runId, (entry) => {
                entry.stage = `tick-${i + 1}-of-${ticks}`;
            });
            try {
                await withTimeout(
                    simulationTick(),
                    tickTimeoutMs,
                    `scenario ${preset.id} tick ${i + 1}`,
                );
            } catch (error) {
                const reason =
                    error instanceof Error ? error.message : String(error);
                degradedReasons.push({
                    name: "tickCompleted",
                    reason,
                });
                broadcast({
                    type: "log",
                    data: {
                        message: `⚠️ Scenario tick degraded: ${reason.slice(0, 140)}`,
                        tick: simTick,
                    },
                });
                break;
            }
        }

        if (degradedReasons.length === 0) {
            updateScenarioRun(run.runId, (entry) => {
                entry.stage = "resolve";
            });
            try {
                const resolveStartedAt = Date.now();
                await withTimeout(
                    settleDuel(settlementMode, winner === "B" ? SIDE_B : SIDE_A),
                    SCENARIO_RESOLVE_TIMEOUT_MS,
                    `scenario ${preset.id} settle`,
                );
                lastResolveLatencyMs = Date.now() - resolveStartedAt;
            } catch (error) {
                const reason =
                    error instanceof Error ? error.message : String(error);
                degradedReasons.push({
                    name: "resolveCompleted",
                    reason,
                });
                broadcast({
                    type: "log",
                    data: {
                        message: `⚠️ Scenario resolve degraded: ${reason.slice(0, 140)}`,
                        tick: simTick,
                    },
                });
            }
        }

        if (degradedReasons.length > 0) {
            try {
                await withTimeout(
                    broadcastState(),
                    45_000,
                    `scenario ${preset.id} final degraded broadcastState`,
                );
            } catch (refreshError) {
                broadcast({
                    type: "log",
                    data: {
                        message: `⚠️ Final degraded state refresh failed: ${
                            refreshError instanceof Error
                                ? refreshError.message.slice(0, 140)
                                : String(refreshError).slice(0, 140)
                        }`,
                        tick: simTick,
                    },
                });
            }
        }

        const result = buildScenarioResult(preset, seed, {
            degradedReasons,
        });
        scenarioHistory = [result, ...scenarioHistory].slice(0, SCENARIO_HISTORY_LIMIT);
        updateScenarioRun(run.runId, (entry) => {
            entry.status = "succeeded";
            entry.stage = degradedReasons.length > 0 ? "completed-degraded" : "completed";
            entry.finishedAt = Date.now();
            entry.error = degradedReasons.length > 0
                ? degradedReasons.map((reason) => `${reason.name}: ${reason.reason}`).join("; ")
                : null;
            entry.result = result;
        });
        broadcast({
            type: "scenario_result",
            data: result,
        });
        return result;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const activeStage = getActiveScenarioRun()?.stage ?? "scenario";
        const degradedGateName = activeStage === "restore-baseline"
            ? "baselineRestored"
            : activeStage.startsWith("resolve")
              ? "resolveCompleted"
              : activeStage.startsWith("tick-")
                ? "tickCompleted"
                : "scenarioCompleted";
        const result = buildScenarioResult(preset, run.seed, {
            degradedReasons: [
                {
                    name: degradedGateName,
                    reason,
                },
            ],
        });
        updateScenarioRun(run.runId, (entry) => {
            entry.status = "succeeded";
            entry.stage = "completed-degraded";
            entry.finishedAt = Date.now();
            entry.error = `${degradedGateName}: ${reason}`;
            entry.result = result;
        });
        broadcast({
            type: "scenario_result",
            data: result,
        });
        return result;
    } finally {
        resetRandomSource();
        scenarioRunInFlight = false;
        activeScenarioRunId = null;
        persistScenarioState();
    }
}

// ─── Resolve Duel ────────────────────────────────────────────────────────────

async function settleDuel(
    settlementMode: ScenarioSettlementMode,
    winnerSide: number,
): Promise<void> {
  try {
    const reporter = await provider.getSigner(2);
    const operator = await provider.getSigner(1);
    updateActiveRunStage("resolve-advance-time");

    // Advance Anvil's block time past the betting window (1 week forward)
    await provider.send("evm_increaseTime", [604800]);
    await provider.send("evm_mine", []);

    const block = await provider.getBlock("latest");
    const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));

    let tx1: any;
    if (settlementMode === "cancel") {
        updateActiveRunStage("resolve-cancel-duel");
        tx1 = await withTimeout(
            (oracle.connect(reporter) as any).cancelDuel(
                currentDuelKey,
                `cancelled-${currentDuelLabel}`,
            ),
            SCENARIO_SETTLEMENT_TX_TIMEOUT_MS,
            "resolve cancelDuel",
        );
        await withTimeout(
            tx1.wait(),
            SCENARIO_SETTLEMENT_RECEIPT_TIMEOUT_MS,
            "resolve cancelDuel receipt",
        );
    } else {
        updateActiveRunStage("resolve-report-result");
        tx1 = await withTimeout(
            (oracle.connect(reporter) as any).reportResult(
                currentDuelKey,
                winnerSide,
                BigInt(Math.floor(random() * 1000000)),
                ethers.keccak256(ethers.toUtf8Bytes(`replay-${currentDuelLabel}`)),
                ethers.keccak256(ethers.toUtf8Bytes(`result-${currentDuelLabel}`)),
                now,
                `resolved-${currentDuelLabel}`,
            ),
            SCENARIO_SETTLEMENT_TX_TIMEOUT_MS,
            "resolve reportResult",
        );
        await withTimeout(
            tx1.wait(),
            SCENARIO_SETTLEMENT_RECEIPT_TIMEOUT_MS,
            "resolve reportResult receipt",
        );
    }

    updateActiveRunStage("resolve-sync-market");
    const tx2: any = await withTimeout(
        (clob.connect(operator) as any).syncMarketFromOracle(currentDuelKey, MARKET_KIND_DUEL_WINNER),
        SCENARIO_SETTLEMENT_TX_TIMEOUT_MS,
        "resolve syncMarketFromOracle",
    );
    await withTimeout(
        tx2.wait(),
        SCENARIO_SETTLEMENT_RECEIPT_TIMEOUT_MS,
        "resolve syncMarketFromOracle receipt",
    );

    broadcast({
        type: "log",
        data: {
            message:
                settlementMode === "cancel"
                    ? "🧾 Duel cancelled and refunds unlocked"
                    : `🏆 Duel resolved! Winner: Side ${winnerSide === SIDE_A ? "A" : "B"}`,
            tick: simTick,
        },
    });

    // Auto-pause so agents don't spam "market not open" errors
    simRunning = false;
    broadcast({ type: "log", data: { message: "⏸️ Simulation auto-paused after resolution. Click 'New Duel' then 'Start' to continue.", tick: simTick } });

    updateActiveRunStage("resolve-scan-claims");
    refreshReadClients();
    const claimCandidates: ClaimCandidate[] = [];
    for (const [index, agent] of agents.entries()) {
        updateActiveRunStage(`resolve-position-${index + 1}-of-${agents.length}`);
        const address = await getAgentAddress(agent);
        const position = await loadClaimPosition(agent, address);
        if (position && hasPosition(position)) {
            claimCandidates.push({
                agent,
                address,
                position,
            });
        }
    }

    await processClaimCandidates(
        claimCandidates,
        "resolve-claims",
        RESOLVE_CLAIM_BUDGET_MS,
    );

    updateActiveRunStage("resolve-final-state");
    await withTimeout(
        broadcastState(),
        60_000,
        "resolve final broadcastState",
    );

    if (!lastComputedState?.mitigation.metrics.claimsProcessed) {
        const residualCandidates = getResidualClaimCandidates();
        if (residualCandidates.length > 0) {
            await processClaimCandidates(
                residualCandidates,
                "resolve-residual-claims",
                Math.max(10_000, Math.floor(RESOLVE_CLAIM_BUDGET_MS / 2)),
            );
            updateActiveRunStage("resolve-final-state-residual");
            await withTimeout(
                broadcastState(),
                60_000,
                "resolve residual broadcastState",
            );
        }
    }
  } catch (err: any) {
    broadcast({
        type: "log",
        data: { message: `⚠️ Resolution error: ${err.message?.slice(0, 120)}`, tick: simTick },
    });
    console.error("[resolve] Error:", err.shortMessage || err.message);
    throw err;
  }
}

// ─── WebSocket Server ────────────────────────────────────────────────────────

function broadcast(msg: any): void {
    const payload = JSON.stringify(msg);
    for (const ws of wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }
}

function handleWsMessage(data: string): void {
    try {
        const msg = JSON.parse(data);
        switch (msg.command) {
            case "start":
                if (!simRunning) {
                    simRunning = true;
                    runSimLoop();
                    broadcast({ type: "log", data: { message: "▶ Simulation started", tick: simTick } });
                }
                break;

            case "pause":
                simRunning = false;
                broadcast({ type: "log", data: { message: "⏸ Simulation paused", tick: simTick } });
                break;

            case "step":
                if (!simRunning) {
                    simulationTick();
                }
                break;

            case "speed":
                simSpeed = Math.max(100, Math.min(5000, Number(msg.value ?? 500)));
                broadcast({ type: "log", data: { message: `⚡ Speed set to ${simSpeed}ms`, tick: simTick } });
                break;

            case "scenario": {
                const preset = SCENARIO_PRESETS.find(
                    (p) => p.name === msg.value || p.id === msg.value,
                );
                if (preset) {
                    applyScenarioPresetByName(preset.id);
                    broadcast({
                        type: "log",
                        data: { message: `🎯 Scenario: ${preset.name}`, tick: simTick },
                    });
                    void broadcastState();
                }
                break;
            }

            case "toggle_agent": {
                const agent = agents.find((a) => a.config.strategy === msg.strategy);
                if (agent) {
                    agent.config.enabled = !agent.config.enabled;
                    broadcastState();
                }
                break;
            }

            case "resolve": {
                const side = msg.winner === "B" ? SIDE_B : SIDE_A;
                settleDuel("resolve", side);
                break;
            }

            case "new_duel":
                openNewDuel().then(() => broadcastState());
                break;

            case "get_state":
                broadcastState();
                break;

            case "get_events":
                broadcast({ type: "events_bulk", data: eventLog.slice(-200) });
                break;

            default:
                break;
        }
    } catch (err: any) {
        console.error("[ws] Message error:", err.message);
    }
}

// ─── HTTP Server (static files) ──────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
    const filePath = join(PUBLIC_DIR, url);

    if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
        const content = readFileSync(filePath);
        res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
        });
        res.end(content);
    } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
    }
}

function writeJson(
    res: ServerResponse,
    statusCode: number,
    payload: unknown,
): void {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(payload, null, 2));
}

async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `127.0.0.1:${HTTP_PORT}`}`,
    );

    if (requestUrl.pathname === "/api/state") {
        writeJson(res, 200, {
            ok: true,
            state: lastComputedState,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios") {
        writeJson(res, 200, {
            ok: true,
            scenarios: SCENARIO_PRESETS,
            gateScenarios: GATE_SCENARIOS,
            latest: scenarioHistory[0] ?? null,
            activeRun: getActiveScenarioRun(),
            runs: scenarioRuns.slice(0, SCENARIO_HISTORY_LIMIT),
            historyCount: scenarioHistory.length,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios/results") {
        const runId = requestUrl.searchParams.get("runId");
        if (runId) {
            const run = scenarioRuns.find((entry) => entry.runId === runId) ?? null;
            writeJson(res, run ? 200 : 404, {
                ok: run != null,
                run,
                error: run ? null : `Unknown runId: ${runId}`,
            });
            return;
        }
        writeJson(res, 200, {
            ok: true,
            activeRun: getActiveScenarioRun(),
            runs: scenarioRuns.slice(0, SCENARIO_HISTORY_LIMIT),
            results: scenarioHistory,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios/run") {
        if (scenarioRunInFlight) {
            writeJson(res, 409, {
                ok: false,
                error: "A scenario run is already in progress",
                run: getActiveScenarioRun(),
            });
            return;
        }
        const scenarioName =
            requestUrl.searchParams.get("name") ??
            requestUrl.searchParams.get("id");
        if (!scenarioName) {
            writeJson(res, 400, {
                ok: false,
                error: "Missing scenario name or id",
            });
            return;
        }

        try {
            const preset = SCENARIO_PRESETS.find(
                (entry) => entry.name === scenarioName || entry.id === scenarioName,
            );
            if (!preset) {
                writeJson(res, 404, {
                    ok: false,
                    error: `Unknown scenario: ${scenarioName}`,
                });
                return;
            }
            const ticksParam = requestUrl.searchParams.get("ticks");
            const winnerParam = requestUrl.searchParams.get("winner");
            const run = createScenarioRunRecord(preset, {
                seed: requestUrl.searchParams.get("seed") ?? undefined,
                ticks:
                    ticksParam == null || ticksParam === ""
                        ? undefined
                        : Number(ticksParam),
                winner:
                    winnerParam === "A" || winnerParam === "B"
                        ? winnerParam
                        : undefined,
                freshBaseline:
                    requestUrl.searchParams.get("fresh") === "1" ||
                    requestUrl.searchParams.get("fresh") === "true",
            });
            scenarioRuns = [run, ...scenarioRuns].slice(0, SCENARIO_HISTORY_LIMIT);
            persistScenarioState();
            void runScenarioPreset(run).catch((error) => {
                console.error(
                    `[scenario] ${run.runId} failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            });
            writeJson(res, 202, {
                ok: true,
                run,
            });
        } catch (error) {
            writeJson(res, 500, {
                ok: false,
                error: (error as Error).message,
            });
        }
        return;
    }

    serveStatic(req, res);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║   Hyperbet Simulation Dashboard                        ║");
    console.log("╚══════════════════════════════════════════════════════════╝");
    loadScenarioState();

    // 1. Start Anvil
    await startAnvil();

    // 2. Deploy contracts
    await deployContracts();
    await captureScenarioBaseline();
    await broadcastState();

    // 3. Start HTTP server
    const httpServer = createServer((req, res) => {
        void handleHttpRequest(req, res);
    });
    httpServer.listen(HTTP_PORT, () => {
        console.log(`[http] Dashboard at http://localhost:${HTTP_PORT}`);
    });

    // 4. Start WebSocket server
    const wss = new WebSocketServer({ port: WS_PORT });
    wss.on("connection", (ws) => {
        wsClients.add(ws);
        console.log(`[ws] Client connected (total: ${wsClients.size})`);

        // Send initial state
        broadcastState();
        broadcast({ type: "events_bulk", data: eventLog.slice(-200) });

        ws.on("message", (data) => handleWsMessage(data.toString()));
        ws.on("close", () => {
            wsClients.delete(ws);
            console.log(`[ws] Client disconnected (total: ${wsClients.size})`);
        });
    });
    console.log(`[ws] WebSocket server on ws://localhost:${WS_PORT}`);

    // Cleanup on exit
    const cleanup = () => {
        simRunning = false;
        wss.close();
        httpServer.close();
        void stopAnvil().finally(() => {
            process.exit(0);
        });
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    console.log("\n🎮 Ready! Open http://localhost:3401 in your browser.\n");
}

main().catch((err) => {
    console.error("Fatal:", err);
    void stopAnvil().finally(() => {
        process.exit(1);
    });
});
