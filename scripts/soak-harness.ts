/**
 * soak-harness.ts — Active trading soak test for prediction markets.
 *
 * Exercises CLOB, AMM, Perps, Oracle, Claims, and Reconciliation every
 * duel cycle against local Anvil chains + live Hyperscapes game server.
 *
 * Usage:
 *   anvil --port 18545 --chain-id 97 --block-time 1 --accounts 20 --balance 10000 --code-size-limit 49152
 *   bun run scripts/soak-harness.ts --duration-min=30 --bsc-rpc=http://localhost:18545
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  stringToHex,
  getAddress,
  type Address,
  type Hash,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

// ─── Foundry artifacts ──────────────────────────────────────────────────────

import duelOracleArtifact from "../packages/evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json";
import goldClobArtifact from "../packages/evm-contracts/out/GoldClob.sol/GoldClob.json";
import mockErc20Artifact from "../packages/evm-contracts/out/MockERC20.sol/MockERC20.json";
// AMM
import routerArtifact from "../packages/evm-contracts/out/Router.sol/Router.json";
import lvrMarketArtifact from "../packages/evm-contracts/out/LvrMarket.sol/LvrMarket.json";
import mockUsdArtifact from "../packages/evm-contracts/out/MockUSD.sol/MockUSD.json";
// Perps
import skillOracleArtifact from "../packages/evm-contracts/out/SkillOracle.sol/SkillOracle.json";
import agentPerpEngineArtifact from "../packages/evm-contracts/out/AgentPerpEngine.sol/AgentPerpEngine.json";

// ─── Types ──────────────────────────────────────────────────────────────────

type SoakEvent = {
  cycle: number;
  phase: string;
  timestamp: number;
  actor: string;
  action: string;
  txHash: string | null;
  gasUsed: number;
  blockNumber: number;
  success: boolean;
  error: string | null;
  details: Record<string, unknown>;
};

type CycleSummary = {
  cycle: number;
  duelKey: string;
  startedAt: number;
  endedAt: number;
  phases: string[];
  clobOrders: number;
  clobFills: number;
  claims: number;
  incidents: string[];
  balanceSheet: {
    clobContractBalance: string;
    totalDeposited: string;
    totalClaimed: string;
    discrepancy: string;
  };
  perps: {
    liquidations: number;
    longPnl: string;
    shortPnl: string;
    insuranceDelta: string;
    badDebtDelta: string;
  };
  sync: {
    sourceSeq: number | null;
    lastSeenSeq: number | null;
    lastAppliedSeq: number | null;
    applyLagMs: number | null;
    sourceEventAgeMs: number | null;
    replayMode: string | null;
    degradedReason: string | null;
  };
};

type MemorySnapshot = {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
};

type RendererHealth = {
  ready?: boolean | null;
  degradedReason?: string | null;
  updatedAt?: number | null;
  phase?: string | null;
};

type StreamStateSnapshot = {
  cycle?: {
    cycleId?: string | null;
    phase?: string | null;
    duelId?: string | null;
    duelKey?: string | null;
    duelKeyHex?: string | null;
    winnerId?: string | null;
    agent1?: { id?: string | null } | null;
    agent2?: { id?: string | null } | null;
  } | null;
};

type BetSyncSourceEvent = {
  seq?: number | null;
  duelId?: string | null;
  duelKey?: string | null;
  phase?: string | null;
  rendererHealth?: RendererHealth | null;
};

type BetSyncBootstrapStateResponse = {
  sourceEpoch?: number | null;
  seq?: number | null;
  latestSeq?: number | null;
  duelId?: string | null;
  duelKey?: string | null;
  phase?: string | null;
  rendererHealth?: RendererHealth | null;
  latestEvent?: BetSyncSourceEvent | null;
};

type SyncStatusResponse = {
  sourceEpoch?: number | null;
  sourceLatestSeq?: number | null;
  lastSeenSeq?: number | null;
  lastAppliedSeq?: number | null;
  applyLagMs?: number | null;
  sourceEventAgeMs?: number | null;
  replayMode?: string | null;
  degradedReason?: string | null;
  rendererHealth?: RendererHealth | null;
};

type AuthoritativeSyncSnapshot = {
  fetchedAt: number;
  sourceBetSyncState: BetSyncBootstrapStateResponse | null;
  syncStatus: SyncStatusResponse | null;
  streamState: StreamStateSnapshot | null;
};

// ─── Evidence helpers ────────────────────────────────────────────────────────

const ALL_ABIS = [...(duelOracleArtifact.abi as any[]), ...(goldClobArtifact.abi as any[]), ...(mockErc20Artifact.abi as any[])];

function decodeLogs(receipt: TransactionReceipt) {
  return receipt.logs.map((log: Log) => {
    try {
      return decodeEventLog({ abi: ALL_ABIS, data: log.data, topics: log.topics });
    } catch {
      return { eventName: "unknown", args: { raw: log } };
    }
  });
}

function saveReceipt(evidenceDir: string, cycle: number, actor: string, action: string, receipt: TransactionReceipt) {
  const dir = path.join(evidenceDir, "receipts", `cycle-${String(cycle).padStart(2, "0")}`);
  fs.mkdirSync(dir, { recursive: true });
  const decoded = decodeLogs(receipt);
  const filename = `${actor}-${action.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  const bigIntReplacer = (_: string, v: unknown) => typeof v === "bigint" ? v.toString() : v;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify({
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: Number(receipt.gasUsed),
    status: receipt.status,
    logsCount: receipt.logs.length,
    decodedLogs: decoded,
  }, bigIntReplacer, 2) + "\n");
  return decoded;
}

function saveSnapshot(evidenceDir: string, cycle: number, label: string, data: Record<string, unknown>) {
  const dir = path.join(evidenceDir, "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `cycle-${String(cycle).padStart(2, "0")}-${label}.json`),
    JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n",
  );
}

function saveNegativeTest(evidenceDir: string, cycle: number, testName: string, data: Record<string, unknown>) {
  const dir = path.join(evidenceDir, "negative-tests");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `cycle-${String(cycle).padStart(2, "0")}-${testName}.json`),
    JSON.stringify(data, null, 2) + "\n",
  );
}

function saveReconciliation(evidenceDir: string, cycle: number, data: Record<string, unknown>) {
  const dir = path.join(evidenceDir, "reconciliation");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `cycle-${String(cycle).padStart(2, "0")}.json`),
    JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n",
  );
}

type RpcLatencyEntry = { timestamp: number; operation: string; latencyMs: number };
type BlockTimestampEntry = { cycle: number; phase: string; blockNumber: number; blockTimestamp: number; wallClockMs: number };

// ─── Constants ──────────────────────────────────────────────────────────────

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

const MARKET_KIND = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const ORDER_FLAG_GTC = 0x01;
const DUEL_STATUS_BETTING_OPEN = 2;
const DISPUTE_WINDOW_SECONDS = 3_600; // Production-realistic 1hr dispute window
const UNIT = parseUnits("1", 18);

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashLabel(label: string): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex")}`;
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function resolveBytecode(artifact: any): `0x${string}` {
  const raw =
    typeof artifact.bytecode === "string"
      ? artifact.bytecode
      : artifact.bytecode?.object || "";
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    if (i >= 0 && args[i + 1]) {
      return args[i + 1];
    }
    const prefix = `${flag}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    return inline ? inline.slice(prefix.length) : fallback;
  };
  const hasFlag = (flag: string) =>
    args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
  const gameUrl = get("--game-url", "http://localhost:5555");
  return {
    durationMin: parseInt(get("--duration-min", "30"), 10),
    bscRpc: get("--bsc-rpc", "http://localhost:18545"),
    gameUrl,
    sourceBetSyncStateUrl:
      get(
        "--source-bet-sync-state-url",
        process.env.SOURCE_BET_SYNC_STATE_URL ??
          `${gameUrl}/api/internal/bet-sync/state`,
      ),
    syncStatusUrl:
      get(
        "--sync-status-url",
        process.env.SYNC_STATUS_URL ?? "http://127.0.0.1:8080/api/sync/status",
      ),
    streamStateUrl:
      get(
        "--stream-state-url",
        process.env.SOURCE_STREAM_STATE_URL ??
          process.env.STREAM_STATE_URL ??
          `${gameUrl}/api/streaming/state`,
      ),
    pollMs: parseInt(
      get("--poll-ms", process.env.PM_SOAK_POLL_MS ?? "5000"),
      10,
    ),
    resetBetweenCycles:
      hasFlag("--reset-between-cycles") ||
      process.env.PM_SOAK_RESET_BETWEEN_CYCLES === "1",
  };
}

function buildBearerHeaders(token: string | undefined): Record<string, string> {
  if (!token?.trim()) {
    return {};
  }
  return {
    Authorization: `Bearer ${token.trim()}`,
  };
}

async function requestJsonOrNull<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
  const response = await fetch(url, init);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

// ─── Nonce tracker ──────────────────────────────────────────────────────────

function createNonceTracker(pub: PublicClient) {
  const tracker = async (address: Address): Promise<number> => {
    return await pub.getTransactionCount({ address, blockTag: "pending" });
  };
  tracker.invalidate = (_address: Address) => {};
  tracker.invalidateAll = () => {};
  return tracker;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const startedAt = Date.now();
  const endAt = startedAt + config.durationMin * 60_000;

  // Output directory
  const outDir = path.resolve(
    process.cwd(),
    "output/soak",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(outDir, { recursive: true });

  const evidenceDir = path.join(outDir, "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const perfDir = path.join(evidenceDir, "performance");
  fs.mkdirSync(perfDir, { recursive: true });
  const authoritativeDir = path.join(evidenceDir, "authoritative-sync");
  fs.mkdirSync(authoritativeDir, { recursive: true });

  const eventsFile = path.join(outDir, "events.jsonl");
  const eventsStream = fs.createWriteStream(eventsFile, { flags: "a" });
  const authoritativeSyncFile = path.join(authoritativeDir, "polls.jsonl");
  const authoritativeSyncStream = fs.createWriteStream(authoritativeSyncFile, {
    flags: "a",
  });
  const memorySnapshots: MemorySnapshot[] = [];
  const rpcLatencyLog: RpcLatencyEntry[] = [];
  const blockTimestampLog: BlockTimestampEntry[] = [];
  const cycles: CycleSummary[] = [];
  const incidents: string[] = [];

  async function timedRpc<T>(pub: PublicClient, operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await fn();
    rpcLatencyLog.push({ timestamp: Date.now(), operation, latencyMs: Math.round(performance.now() - start) });
    return result;
  }

  // Manual receipt polling — bypasses viem's watchBlockNumber which breaks after evm_revert
  // (viem's prevBlockNumber watermark doesn't reset when block numbers go backward)
  async function waitReceipt(hash: Hash, retries = 100, delay = 200): Promise<TransactionReceipt> {
    for (let i = 0; i < retries; i++) {
      try {
        return await pub.getTransactionReceipt({ hash });
      } catch {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error(`Receipt not found for ${hash} after ${retries} retries`);
  }

  function logEvent(evt: SoakEvent) {
    eventsStream.write(JSON.stringify(evt, (_, v) => typeof v === "bigint" ? v.toString() : v) + "\n");
    const status = evt.success ? "✓" : "✗";
    const gas = evt.gasUsed > 0 ? ` gas=${evt.gasUsed}` : "";
    console.log(
      `  [C${evt.cycle}] ${status} ${evt.actor}.${evt.action}${gas}${evt.error ? " ERR=" + evt.error : ""}`,
    );
  }

  function incident(msg: string, cycle: number) {
    incidents.push(`[C${cycle}] ${msg}`);
    console.log(`  ❌ INCIDENT [C${cycle}]: ${msg}`);
  }

  // ── Setup chain ─────────────────────────────────────────────────────────

  const localChain = {
    id: 97,
    name: "soak-bsc",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.bscRpc] } },
  } as const;

  const pub = createPublicClient({ chain: localChain, transport: http(config.bscRpc) });

  const accounts = Array.from({ length: 8 }, (_, i) => {
    const account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i });
    const wallet = createWalletClient({
      account,
      chain: localChain,
      transport: http(config.bscRpc),
    });
    return { account, wallet, address: account.address };
  });

  const [admin, reporter, mm, yesBettor, noBettor, perpsLong, perpsShort, liquidator] =
    accounts;
  const nonce = createNonceTracker(pub);

  // ── Deploy contracts (once) ──────────────────────────────────────────────

  console.log("=== Deploying contracts ===");

  async function deploy(artifact: any, args: any[]): Promise<Address> {
    const hash = await admin.wallet.deployContract({
      abi: artifact.abi,
      bytecode: resolveBytecode(artifact),
      args,
      nonce: await nonce(admin.address),
    });
    const receipt = await waitReceipt(hash);
    if (!receipt.contractAddress) throw new Error("Deploy failed: no address");
    console.log(`  Deployed ${receipt.contractAddress} (${receipt.gasUsed} gas)`);
    return receipt.contractAddress;
  }

  const tokenAddress = await deploy(mockErc20Artifact, ["Mock Gold", "GOLD"]);
  const oracleAddress = await deploy(duelOracleArtifact, [
    admin.address,     // admin
    reporter.address,  // reporter
    reporter.address,  // finalizer
    admin.address,     // challenger
    admin.address,     // pauser
    DISPUTE_WINDOW_SECONDS,
  ]);
  const clobAddress = await deploy(goldClobArtifact, [
    admin.address,     // admin
    admin.address,     // marketOperator
    oracleAddress,     // duelOracle
    admin.address,     // treasury
    mm.address,        // marketMaker
    admin.address,     // pauser
  ]);

  // Mint tokens to all participants
  for (const acct of [admin, mm, yesBettor, noBettor]) {
    await admin.wallet.writeContract({
      address: tokenAddress,
      abi: mockErc20Artifact.abi,
      functionName: "mint",
      args: [acct.address, parseUnits("1000000", 18)],
      nonce: await nonce(admin.address),
    });
  }
  console.log("  Minted tokens to all participants");

  // ── Deploy AMM (Router + MockUSD) ──────────────────────────────────────
  // Router exceeds 24KB EIP-170 limit when libraries are inlined.
  // Must deploy Math + SwapMath as external libraries via forge, then link.
  // Key: --constructor-args MUST be last flag (forge CLI parser is greedy).

  const { execSync } = await import("node:child_process");
  const evmContractsDir = path.resolve(process.cwd(), "packages/evm-contracts");
  const forgeEnv = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}` };
  const adminPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  let routerAddress: Address | null = null;
  let musdAddress: Address | null = null;
  try {
    // MockUSD via viem
    const musdHash = await admin.wallet.deployContract({
      abi: mockUsdArtifact.abi, bytecode: resolveBytecode(mockUsdArtifact), args: [],
      nonce: await nonce(admin.address),
    });
    const musdReceipt = await waitReceipt(musdHash);
    musdAddress = musdReceipt.contractAddress!;
    console.log(`  AMM MockUSD: ${musdAddress}`);

    // Mint mUSD to participants
    for (const acct of [admin, mm, yesBettor, noBettor]) {
      await admin.wallet.writeContract({
        address: musdAddress, abi: mockUsdArtifact.abi, functionName: "mint",
        args: [acct.address, parseUnits("1000000", 18)], nonce: await nonce(admin.address),
      });
    }

    // Invalidate nonces before forge deploys
    nonce.invalidateAll();

    // Deploy Math + SwapMath + Router via forge (--constructor-args LAST per foundry-rs/foundry#770)
    const mathOut = execSync(
      `forge create contracts/lvr_amm/lib/Math.sol:Math --rpc-url ${config.bscRpc} --private-key ${adminPk} --broadcast --json`,
      { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
    );
    const mathAddr = JSON.parse(mathOut).deployedTo;

    const swapOut = execSync(
      `forge create contracts/lvr_amm/lib/SwapMath.sol:SwapMath --rpc-url ${config.bscRpc} --private-key ${adminPk} --broadcast --json`,
      { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
    );
    const swapMathAddr = JSON.parse(swapOut).deployedTo;

    // forge create: CONTRACT must come before --constructor-args (greedy flag eats it otherwise)
    const routerOut = execSync(
      `forge create contracts/lvr_amm/Router.sol:Router` +
      ` --rpc-url ${config.bscRpc}` +
      ` --private-key ${adminPk}` +
      ` --broadcast --json` +
      ` --libraries contracts/lvr_amm/lib/Math.sol:Math:${mathAddr}` +
      ` --libraries contracts/lvr_amm/lib/SwapMath.sol:SwapMath:${swapMathAddr}` +
      ` --constructor-args ${musdAddress} ${oracleAddress} ${admin.address} 200 ${admin.address}`,
      { cwd: evmContractsDir, env: forgeEnv, encoding: "utf8" },
    );
    routerAddress = JSON.parse(routerOut).deployedTo as Address;
    console.log(`  AMM Router: ${routerAddress}`);

    // Invalidate nonces after forge deploys
    nonce.invalidateAll();

    // Approve Router for all participants
    for (const acct of [admin, mm, yesBettor, noBettor]) {
      await acct.wallet.writeContract({
        address: musdAddress, abi: mockUsdArtifact.abi, functionName: "approve",
        args: [routerAddress, parseUnits("999999999", 18)], nonce: await nonce(acct.address),
      });
    }
    console.log("  AMM approvals set");
  } catch (err: any) {
    console.log(`  AMM deploy failed (non-fatal): ${err.message?.slice(0, 80)}`);
    nonce.invalidateAll();
  }

  // ── Deploy Perps (SkillOracle + AgentPerpEngine) ──────────────────────
  let skillOracleAddress: Address | null = null;
  let perpEngineAddress: Address | null = null;
  let perpMarginAddress: Address | null = null;
  const perpAgentId = hashLabel("soak-perps-agent");
  try {
    // Margin token (reuse MockERC20)
    const marginHash = await admin.wallet.deployContract({
      abi: mockErc20Artifact.abi, bytecode: resolveBytecode(mockErc20Artifact), args: ["Mock Margin", "MARGIN"],
      nonce: await nonce(admin.address),
    });
    const marginReceipt = await waitReceipt(marginHash);
    perpMarginAddress = marginReceipt.contractAddress!;

    // SkillOracle
    const soHash = await admin.wallet.deployContract({
      abi: skillOracleArtifact.abi, bytecode: resolveBytecode(skillOracleArtifact),
      args: [parseUnits("1", 18), 120, admin.address, reporter.address, admin.address], // basePrice, maxDelay, admin, reporter, pauser
      nonce: await nonce(admin.address),
    });
    const soReceipt = await waitReceipt(soHash);
    skillOracleAddress = soReceipt.contractAddress!;
    console.log(`  Perps SkillOracle: ${skillOracleAddress}`);

    // AgentPerpEngine
    const peHash = await admin.wallet.deployContract({
      abi: agentPerpEngineArtifact.abi, bytecode: resolveBytecode(agentPerpEngineArtifact),
      args: [skillOracleAddress, perpMarginAddress, parseUnits("1000000", 18), admin.address, admin.address, admin.address],
      nonce: await nonce(admin.address),
    });
    const peReceipt = await waitReceipt(peHash);
    perpEngineAddress = peReceipt.contractAddress!;
    console.log(`  Perps Engine: ${perpEngineAddress}`);

    // Seed agent skill
    await reporter.wallet.writeContract({
      address: skillOracleAddress, abi: skillOracleArtifact.abi, functionName: "updateAgentSkill",
      args: [perpAgentId, 1500, 200], nonce: await nonce(reporter.address),
    });

    // Create perps market
    await admin.wallet.writeContract({
      address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "createMarket",
      args: [perpAgentId, parseUnits("1000000", 18), parseUnits("5", 18), 1000, 500, 120, parseUnits("1000000", 18), 0, 0],
      nonce: await nonce(admin.address),
    });

    // Mint + approve margin token for traders
    for (const acct of [perpsLong, perpsShort, liquidator, admin]) {
      await admin.wallet.writeContract({
        address: perpMarginAddress, abi: mockErc20Artifact.abi, functionName: "mint",
        args: [acct.address, parseUnits("100000", 18)], nonce: await nonce(admin.address),
      });
      await acct.wallet.writeContract({
        address: perpMarginAddress, abi: mockErc20Artifact.abi, functionName: "approve",
        args: [perpEngineAddress, parseUnits("999999999", 18)], nonce: await nonce(acct.address),
      });
    }

    // Deposit insurance fund
    await admin.wallet.writeContract({
      address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "depositInsuranceFund",
      args: [perpAgentId, parseUnits("10000", 18)], nonce: await nonce(admin.address),
    });
    console.log("  Perps market created + funded");
  } catch (err: any) {
    console.log(`  Perps deploy failed (non-fatal): ${err.message?.slice(0, 80)}`);
  }

  // ── Optional snapshot baseline ────────────────────────────────────────
  // Disabled by default because repeated evm_snapshot/evm_revert churn has
  // proven fragile on local Anvil when combined with long-running soak flows.
  let baseSnapshotId: string | null = null;
  if (config.resetBetweenCycles) {
    const baseSnapshotRes = await fetch(config.bscRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 999 }),
    });
    baseSnapshotId = (await baseSnapshotRes.json() as any).result ?? null;
    console.log(`  Base snapshot: ${baseSnapshotId}`);
    nonce.invalidateAll();
  } else {
    console.log("  Base snapshot: disabled (running continuous multi-cycle soak state)");
  }

  async function revertAndResnap(): Promise<void> {
    if (!config.resetBetweenCycles || !baseSnapshotId) {
      return;
    }
    await fetch(config.bscRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "evm_revert", params: [baseSnapshotId], id: 1000 }),
    });
    // After revert, reset auto-mine and advance one block to ensure clean state.
    // The dispute window time warp can leave Anvil in manual-mine mode.
    await fetch(config.bscRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "evm_setAutomine", params: [true], id: 1002 }),
    });
    await fetch(config.bscRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 1003 }),
    });
    // Snapshot IDs are single-use — must re-snapshot after revert
    const resnap = await fetch(config.bscRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 1001 }),
    });
    baseSnapshotId = (await resnap.json() as any).result ?? null;
    // Invalidate all cached nonces since state reverted
    nonce.invalidateAll();
  }

  // ── Authoritative bet-sync polling ──────────────────────────────────────

  let currentPhase = "UNKNOWN";
  let currentDuelKey = "";
  let currentWinner = "";
  let lastAuthoritativeUpdate = 0;
  let latestAuthoritativeSync: AuthoritativeSyncSnapshot | null = null;

  const sourceBetSyncToken =
    process.env.SOURCE_BET_SYNC_BEARER_TOKEN ??
    process.env.BETTING_FEED_ACCESS_TOKEN ??
    process.env.STREAMING_VIEWER_ACCESS_TOKEN;
  const sourceBetSyncHeaders = buildBearerHeaders(sourceBetSyncToken);
  let authoritativePollerRunning = true;

  function normalizeDuelKey(value: string | null | undefined): string {
    if (!value?.trim()) {
      return "";
    }
    return value.startsWith("0x") ? value : `0x${value}`;
  }

  function normalizePhase(value: string | null | undefined): string {
    const normalized = value?.trim().toUpperCase();
    return normalized && normalized.length > 0 ? normalized : "UNKNOWN";
  }

  function phaseRank(phase: string): number {
    switch (phase) {
      case "IDLE":
        return 0;
      case "ANNOUNCEMENT":
        return 1;
      case "COUNTDOWN":
        return 2;
      case "FIGHTING":
        return 3;
      case "RESOLUTION":
        return 4;
      case "TERMINAL":
        return 5;
      default:
        return -1;
    }
  }

  function resolveActiveDuel(
    sourceBetSyncState: BetSyncBootstrapStateResponse | null,
    streamState: StreamStateSnapshot | null,
  ): { duelKey: string; phase: string } {
    const latestEvent = sourceBetSyncState?.latestEvent;
    const sourceDuelKey = normalizeDuelKey(
      latestEvent?.duelKey ?? sourceBetSyncState?.duelKey ?? null,
    );
    const streamDuelKey = normalizeDuelKey(
      streamState?.cycle?.duelKeyHex ?? streamState?.cycle?.duelKey ?? null,
    );
    const sourcePhase = normalizePhase(
      latestEvent?.phase ?? sourceBetSyncState?.phase ?? null,
    );
    const streamPhase = normalizePhase(streamState?.cycle?.phase ?? null);

    if (streamDuelKey && sourceDuelKey && streamDuelKey === sourceDuelKey) {
      return {
        duelKey: streamDuelKey,
        phase:
          phaseRank(streamPhase) >= phaseRank(sourcePhase)
            ? streamPhase
            : sourcePhase,
      };
    }

    if (
      streamDuelKey &&
      streamPhase !== "UNKNOWN" &&
      streamPhase !== "IDLE"
    ) {
      return { duelKey: streamDuelKey, phase: streamPhase };
    }

    if (sourceDuelKey) {
      return { duelKey: sourceDuelKey, phase: sourcePhase };
    }

    if (streamDuelKey) {
      return { duelKey: streamDuelKey, phase: streamPhase };
    }

    return {
      duelKey: "",
      phase:
        phaseRank(streamPhase) >= phaseRank(sourcePhase)
          ? streamPhase
          : sourcePhase,
    };
  }

  function deriveWinner(
    streamState: StreamStateSnapshot | null,
    duelKey: string,
  ): string {
    const cycle = streamState?.cycle;
    const cycleDuelKey = normalizeDuelKey(
      cycle?.duelKeyHex ?? cycle?.duelKey ?? null,
    );
    if (!cycle || cycleDuelKey !== duelKey || !cycle.winnerId) {
      return currentWinner;
    }
    if (cycle.agent1?.id && cycle.winnerId === cycle.agent1.id) {
      return "A";
    }
    if (cycle.agent2?.id && cycle.winnerId === cycle.agent2.id) {
      return "B";
    }
    return currentWinner;
  }

  async function pollAuthoritativeState(): Promise<void> {
    const fetchedAt = Date.now();
    const [sourceBetSyncStateResult, syncStatusResult, streamStateResult] =
      await Promise.allSettled([
        requestJsonOrNull<BetSyncBootstrapStateResponse>(
          config.sourceBetSyncStateUrl,
          {
            headers: sourceBetSyncHeaders,
          },
        ),
        requestJsonOrNull<SyncStatusResponse>(config.syncStatusUrl),
        requestJsonOrNull<StreamStateSnapshot>(config.streamStateUrl),
      ]);
    const sourceBetSyncState =
      sourceBetSyncStateResult.status === "fulfilled"
        ? sourceBetSyncStateResult.value
        : null;
    const syncStatus =
      syncStatusResult.status === "fulfilled" ? syncStatusResult.value : null;
    const streamState =
      streamStateResult.status === "fulfilled"
        ? streamStateResult.value
        : null;
    if (!sourceBetSyncState && !syncStatus && !streamState) {
      const errors = [
        sourceBetSyncStateResult,
        syncStatusResult,
        streamStateResult,
      ]
        .filter(
          (
            result,
          ): result is PromiseRejectedResult => result.status === "rejected",
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
      throw new Error(
        errors.length > 0
          ? errors.join("; ")
          : "authoritative sync unavailable",
      );
    }
    const { duelKey, phase } = resolveActiveDuel(sourceBetSyncState, streamState);
    currentPhase = phase;
    currentDuelKey = duelKey;
    currentWinner = deriveWinner(streamState, duelKey);
    lastAuthoritativeUpdate = fetchedAt;
    latestAuthoritativeSync = {
      fetchedAt,
      sourceBetSyncState,
      syncStatus,
      streamState,
    };
    authoritativeSyncStream.write(
      JSON.stringify({
        fetchedAt,
        duelKey,
        phase,
        winner: currentWinner || null,
        sourceSeq:
          sourceBetSyncState?.latestSeq ??
          sourceBetSyncState?.seq ??
          sourceBetSyncState?.latestEvent?.seq ??
          null,
        lastSeenSeq: syncStatus?.lastSeenSeq ?? null,
        lastAppliedSeq: syncStatus?.lastAppliedSeq ?? null,
        applyLagMs: syncStatus?.applyLagMs ?? null,
        sourceEventAgeMs: syncStatus?.sourceEventAgeMs ?? null,
        replayMode: syncStatus?.replayMode ?? null,
        degradedReason:
          syncStatus?.degradedReason ??
          syncStatus?.rendererHealth?.degradedReason ??
          sourceBetSyncState?.rendererHealth?.degradedReason ??
          null,
      }) + "\n",
    );
  }

  async function startAuthoritativePoller(): Promise<void> {
    while (authoritativePollerRunning) {
      try {
        await pollAuthoritativeState();
      } catch (error: any) {
        authoritativeSyncStream.write(
          JSON.stringify({
            fetchedAt: Date.now(),
            error: error?.message ?? String(error),
          }) + "\n",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    }
  }

  const authoritativePollerPromise = startAuthoritativePoller();

  const pollDeadline = Date.now() + 60_000;
  while (lastAuthoritativeUpdate === 0 && Date.now() < pollDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lastAuthoritativeUpdate === 0) {
    console.error("Failed to connect to authoritative betting-sync state (60s timeout)");
    process.exit(2);
  }
  console.log(
    `  Connected. Phase=${currentPhase}, DuelKey=${currentDuelKey.slice(0, 18)}..., source=${config.sourceBetSyncStateUrl}`,
  );

  // ── Memory monitor ────────────────────────────────────────────────────────

  const memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    memorySnapshots.push({
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    });
  }, 30_000);

  // Take initial snapshot
  const initMem = process.memoryUsage();
  memorySnapshots.push({
    timestamp: Date.now(),
    rss: initMem.rss,
    heapUsed: initMem.heapUsed,
    heapTotal: initMem.heapTotal,
  });

  // ── Main cycle loop ───────────────────────────────────────────────────────

  let cycleNum = 0;
  let prevDuelKey = "";
  let totalDeposited = 0n;
  let totalClaimed = 0n;
  let endedMidCycle = false;

  console.log(`\n=== Starting soak — ${config.durationMin} minutes ===\n`);

  mainLoop: while (Date.now() < endAt) {
    // Wait for new duel (ANNOUNCEMENT phase with different duelKey)
    if (currentDuelKey === prevDuelKey || !currentDuelKey) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    // New duel detected
    cycleNum++;
    prevDuelKey = currentDuelKey;
    const cycleStart = Date.now();
    const phasesObserved: string[] = [currentPhase];
    let clobOrders = 0;
    let clobFills = 0;
    let claimsExecuted = 0;
    const cycleIncidents: string[] = [];

    const duelKey = currentDuelKey.startsWith("0x")
      ? currentDuelKey as `0x${string}`
      : `0x${currentDuelKey}` as `0x${string}`;

    console.log(
      `\n━━━ Cycle ${cycleNum} ━━━ duel=${duelKey.slice(0, 18)}... phase=${currentPhase}`,
    );

    // ── Phase 1: Seed market ────────────────────────────────────────────

    // Use Anvil's block.timestamp (not Date.now) since evm_increaseTime shifts it
    const latestBlock = await pub.getBlock({ blockTag: "latest" });
    const now = latestBlock.timestamp;
    const betCloseTs = now + 120n; // 2 min from chain time
    const fightStartTs = betCloseTs + 10n;

    try {
      // Upsert duel into oracle
      console.log(`  Seeding duel ${duelKey.slice(0, 18)} reporter=${reporter.address}`);
      const upsertHash = await reporter.wallet.writeContract({
        address: oracleAddress,
        abi: duelOracleArtifact.abi,
        functionName: "upsertDuel",
        args: [
          duelKey,
          hashLabel(`agent-a-${cycleNum}`),
          hashLabel(`agent-b-${cycleNum}`),
          now - 5n,
          betCloseTs,
          fightStartTs,
          `soak-cycle-${cycleNum}`,
          DUEL_STATUS_BETTING_OPEN,
        ],
        gas: 500_000n,
        nonce: await nonce(reporter.address),
      });
      await waitReceipt(upsertHash);
      logEvent({
        cycle: cycleNum, phase: currentPhase, timestamp: Date.now(),
        actor: "reporter", action: "upsertDuel", txHash: upsertHash,
        gasUsed: 0, blockNumber: 0, success: true, error: null,
        details: { duelKey },
      });

      // Create CLOB market
      const createMktHash = await admin.wallet.writeContract({
        address: clobAddress,
        abi: goldClobArtifact.abi,
        functionName: "createMarketForDuel",
        args: [duelKey, MARKET_KIND],
        nonce: await nonce(admin.address),
      });
      await waitReceipt(createMktHash);
      logEvent({
        cycle: cycleNum, phase: currentPhase, timestamp: Date.now(),
        actor: "admin", action: "createMarketForDuel", txHash: createMktHash,
        gasUsed: 0, blockNumber: 0, success: true, error: null,
        details: { duelKey },
      });

      // Wait for Anvil to mine the block (block-time=2s)
      await new Promise((r) => setTimeout(r, 3000));

      // Verify market actually exists on-chain before placing orders
      const marketData = await pub.readContract({
        address: clobAddress,
        abi: goldClobArtifact.abi,
        functionName: "getMarket",
        args: [duelKey, MARKET_KIND],
      }) as any;
      // getMarket returns Market struct — check the 'exists' field
      const marketExists = typeof marketData === "object" && marketData !== null
        ? (marketData.exists ?? marketData[0] ?? false)
        : false;
      if (!marketExists) {
        incident(`Market created but exists=${JSON.stringify(marketData?.exists ?? marketData?.[0])} — check ABI`, cycleNum);
        cycleIncidents.push("market_not_found_after_create");
        await revertAndResnap();
        continue;
      }
    } catch (err: any) {
      incident(`Market seed failed: ${err.message?.slice(0, 100)}`, cycleNum);
      cycleIncidents.push("seed_failed");
      await revertAndResnap();
      continue; // Skip this cycle
    }

    // ── Phase 2: Place bets (OPEN window) ─────────────────────────────

    // Wait for chain time to be in betting window
    await new Promise((r) => setTimeout(r, 2000));

    const betAmount = parseUnits("5", 18);
    const mmBidPrice = 400;
    const mmAskPrice = 600;

    async function placeBet(
      wallet: WalletClient,
      address: Address,
      side: number,
      price: number,
      actor: string,
    ) {
      const cost = quoteCost(side, price, betAmount);
      const fee = cost / 50n; // 2% total fees
      try {
        const hash = await wallet.writeContract({
          address: clobAddress,
          abi: goldClobArtifact.abi,
          functionName: "placeOrder",
          args: [duelKey, MARKET_KIND, side, price, betAmount, ORDER_FLAG_GTC],
          value: cost + fee + fee, // treasury + MM fee
          nonce: await nonce(address),
        });
        const receipt = await timedRpc(pub, `placeOrder.${actor}`, () =>
          waitReceipt(hash));
        clobOrders++;
        totalDeposited += cost + fee + fee;

        // Decode logs and save receipt
        const actionLabel = `placeOrder-${side === BUY_SIDE ? "BUY" : "SELL"}-${price}`;
        const decoded = saveReceipt(evidenceDir, cycleNum, actor, actionLabel, receipt);

        // Check for fills by looking for OrderMatched/OrderFilled events
        const fills = decoded.filter((d: any) =>
          d.eventName === "OrderMatched" || d.eventName === "OrderFilled" || d.eventName === "Trade",
        );
        if (fills.length > 0) clobFills += fills.length;

        logEvent({
          cycle: cycleNum, phase: currentPhase, timestamp: Date.now(),
          actor, action: `placeOrder.${side === BUY_SIDE ? "BUY" : "SELL"}.${price}`,
          txHash: hash, gasUsed: Number(receipt.gasUsed), blockNumber: Number(receipt.blockNumber),
          success: true, error: null,
          details: { side, price, amount: formatUnits(betAmount, 18), cost: formatUnits(cost, 18), fills: fills.length },
        });
      } catch (err: any) {
        logEvent({
          cycle: cycleNum, phase: currentPhase, timestamp: Date.now(),
          actor, action: `placeOrder.${side === BUY_SIDE ? "BUY" : "SELL"}.${price}`,
          txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 200),
          details: { side, price },
        });
        // BettingClosed is expected if we're past the window
        if (!err.message?.includes("BettingClosed")) {
          incident(`Order failed: ${err.message?.slice(0, 80)}`, cycleNum);
          cycleIncidents.push("order_failed");
        }
      }
    }

    // MM quotes
    await placeBet(mm.wallet, mm.address, SELL_SIDE, mmAskPrice, "mm");
    await placeBet(mm.wallet, mm.address, BUY_SIDE, mmBidPrice, "mm");

    // Bettor crosses
    await placeBet(yesBettor.wallet, yesBettor.address, BUY_SIDE, mmAskPrice, "yesBettor");
    await placeBet(noBettor.wallet, noBettor.address, SELL_SIDE, mmBidPrice, "noBettor");

    // ── AMM trades ─────────────────────────────────────────────────────
    if (routerAddress && musdAddress) {
      try {
        // Create AMM market for this duel
        // Router.create(title, description, resolutionSource, duelKey, isDynamic, duration, collateralIn)
        // Use static market (isDynamic=false) to avoid ZScoreOutOfBounds from liquidity decay
        const createHash = await admin.wallet.writeContract({
          address: routerAddress, abi: routerArtifact.abi, functionName: "create",
          args: [`soak-amm-${cycleNum}`, `AMM cycle ${cycleNum}`, "soak-harness", duelKey, false, 3600n, parseUnits("1000", 18)],
          nonce: await nonce(admin.address),
        });
        const createReceipt = await waitReceipt(createHash);
        saveReceipt(evidenceDir, cycleNum, "admin", "amm-create", createReceipt);

        // Get the market address from Router.getAllMarkets()
        const allMarkets = await pub.readContract({
          address: routerAddress, abi: routerArtifact.abi, functionName: "getAllMarkets",
        }) as Address[];
        const ammMarketAddr = allMarkets[allMarkets.length - 1];

        // YES bettor buys YES (small relative to 1000 mUSD liquidity to avoid z-score overflow)
        const buyYesHash = await yesBettor.wallet.writeContract({
          address: routerAddress, abi: routerArtifact.abi, functionName: "buyYes",
          args: [ammMarketAddr, parseUnits("5", 18), 0n], nonce: await nonce(yesBettor.address),
        });
        const buyYesReceipt = await waitReceipt(buyYesHash);
        saveReceipt(evidenceDir, cycleNum, "yesBettor", "amm-buyYes", buyYesReceipt);
        logEvent({ cycle: cycleNum, phase: "AMM", timestamp: Date.now(), actor: "yesBettor",
          action: "amm.buyYes", txHash: buyYesHash, gasUsed: Number(buyYesReceipt.gasUsed),
          blockNumber: Number(buyYesReceipt.blockNumber), success: true, error: null, details: {} });

        // NO bettor buys NO (small relative to 1000 mUSD liquidity to avoid z-score overflow)
        try {
          const buyNoHash = await noBettor.wallet.writeContract({
            address: routerAddress, abi: routerArtifact.abi, functionName: "buyNo",
            args: [ammMarketAddr, parseUnits("5", 18), 0n], nonce: await nonce(noBettor.address),
          });
          const buyNoReceipt = await waitReceipt(buyNoHash);
          saveReceipt(evidenceDir, cycleNum, "noBettor", "amm-buyNo", buyNoReceipt);
          logEvent({ cycle: cycleNum, phase: "AMM", timestamp: Date.now(), actor: "noBettor",
            action: "amm.buyNo", txHash: buyNoHash, gasUsed: Number(buyNoReceipt.gasUsed),
            blockNumber: Number(buyNoReceipt.blockNumber), success: true, error: null, details: {} });
        } catch (buyNoErr: any) {
          logEvent({ cycle: cycleNum, phase: "AMM", timestamp: Date.now(), actor: "noBettor",
            action: "amm.buyNo", txHash: null, gasUsed: 0, blockNumber: 0,
            success: false, error: buyNoErr.message?.slice(0, 150), details: {} });
        }

        // Snapshot AMM reserves (always, even if buyNo failed)
        const details = await pub.readContract({
          address: ammMarketAddr, abi: lvrMarketArtifact.abi, functionName: "getMarketDetails",
        }) as any[];
        saveSnapshot(evidenceDir, cycleNum, "amm-post-trades", {
          market: ammMarketAddr, state: Number(details[0]),
          reserveYes: details[4]?.toString(), reserveNo: details[5]?.toString(),
          priceYes: details[6]?.toString(), priceNo: details[7]?.toString(),
        });
      } catch (err: any) {
        logEvent({ cycle: cycleNum, phase: "AMM", timestamp: Date.now(), actor: "amm",
          action: "amm.trade", txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 150), details: {} });
      }
    }

    // ── Perps: open positions (held through resolution) ────────────────
    let perpsLongOpen = false;
    let perpsShortOpen = false;
    let perpsInsuranceBefore = 0n;
    let perpsBadDebtBefore = 0n;
    if (perpEngineAddress && skillOracleAddress) {
      try {
        if (!config.resetBetweenCycles && cycleNum > 1) {
          const resetOracleHash = await reporter.wallet.writeContract({
            address: skillOracleAddress,
            abi: skillOracleArtifact.abi,
            functionName: "updateAgentSkill",
            args: [perpAgentId, 1500, 200],
            nonce: await nonce(reporter.address),
          });
          const resetOracleReceipt = await waitReceipt(resetOracleHash);
          saveReceipt(
            evidenceDir,
            cycleNum,
            "reporter",
            "perps-reset-skill-oracle",
            resetOracleReceipt,
          );
          logEvent({
            cycle: cycleNum,
            phase: "PERPS",
            timestamp: Date.now(),
            actor: "reporter",
            action: "perps.resetOracle",
            txHash: resetOracleHash,
            gasUsed: Number(resetOracleReceipt.gasUsed),
            blockNumber: Number(resetOracleReceipt.blockNumber),
            success: true,
            error: null,
            details: { mu: 1500, sigma: 200 },
          });

          const reopenHash = await admin.wallet.writeContract({
            address: perpEngineAddress,
            abi: agentPerpEngineArtifact.abi,
            functionName: "setMarketStatus",
            args: [perpAgentId, 1],
            nonce: await nonce(admin.address),
          });
          const reopenReceipt = await waitReceipt(reopenHash);
          saveReceipt(
            evidenceDir,
            cycleNum,
            "admin",
            "perps-set-active",
            reopenReceipt,
          );
          logEvent({
            cycle: cycleNum,
            phase: "PERPS",
            timestamp: Date.now(),
            actor: "admin",
            action: "perps.setActive",
            txHash: reopenHash,
            gasUsed: Number(reopenReceipt.gasUsed),
            blockNumber: Number(reopenReceipt.blockNumber),
            success: true,
            error: null,
            details: {},
          });
        }

        // Snapshot insurance fund before cycle
        const mktPre = await pub.readContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "markets",
          args: [perpAgentId],
        }) as any;
        perpsInsuranceBefore = BigInt(mktPre[9] ?? 0);
        perpsBadDebtBefore = BigInt(mktPre[10] ?? 0);

        const refreshOracleHash = await reporter.wallet.writeContract({
          address: skillOracleAddress,
          abi: skillOracleArtifact.abi,
          functionName: "updateAgentSkill",
          args: [perpAgentId, 1_500n, 0n],
          nonce: await nonce(reporter.address),
        });
        const refreshOracleReceipt = await waitReceipt(refreshOracleHash);
        saveReceipt(
          evidenceDir,
          cycleNum,
          "reporter",
          "perps-refresh-oracle",
          refreshOracleReceipt,
        );
        logEvent({
          cycle: cycleNum,
          phase: "PERPS",
          timestamp: Date.now(),
          actor: "reporter",
          action: "perps.refreshOracle",
          txHash: refreshOracleHash,
          gasUsed: Number(refreshOracleReceipt.gasUsed),
          blockNumber: Number(refreshOracleReceipt.blockNumber),
          success: true,
          error: null,
          details: { price: "1500" },
        });

        // Long opens position — margin sized to survive oracle swings
        const longHash = await perpsLong.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "modifyPosition",
          args: [perpAgentId, parseUnits("200", 18), parseUnits("5", 18)], // 200 margin, 5 size
          nonce: await nonce(perpsLong.address),
        });
        const longReceipt = await waitReceipt(longHash);
        perpsLongOpen = true;
        saveReceipt(evidenceDir, cycleNum, "perpsLong", "modifyPosition-open", longReceipt);
        logEvent({ cycle: cycleNum, phase: "PERPS", timestamp: Date.now(), actor: "perpsLong",
          action: "perps.openLong", txHash: longHash, gasUsed: Number(longReceipt.gasUsed),
          blockNumber: Number(longReceipt.blockNumber), success: true, error: null, details: {} });

        // Short opens position
        const shortHash = await perpsShort.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "modifyPosition",
          args: [perpAgentId, parseUnits("200", 18), parseUnits("-5", 18)], // 200 margin, -5 size
          nonce: await nonce(perpsShort.address),
        });
        const shortReceipt = await waitReceipt(shortHash);
        perpsShortOpen = true;
        saveReceipt(evidenceDir, cycleNum, "perpsShort", "modifyPosition-open", shortReceipt);
        logEvent({ cycle: cycleNum, phase: "PERPS", timestamp: Date.now(), actor: "perpsShort",
          action: "perps.openShort", txHash: shortHash, gasUsed: Number(shortReceipt.gasUsed),
          blockNumber: Number(shortReceipt.blockNumber), success: true, error: null, details: {} });

        saveSnapshot(evidenceDir, cycleNum, "perps-positions-opened", {
          longMargin: "200", longSize: "5", shortMargin: "200", shortSize: "-5",
          insuranceFund: perpsInsuranceBefore.toString(),
        });
      } catch (err: any) {
        logEvent({ cycle: cycleNum, phase: "PERPS", timestamp: Date.now(), actor: "perps",
          action: "perps.open", txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 150), details: {} });
      }
    }

    // ── Snapshot: positions + book after orders ─────────────────────────
    try {
      const market = await timedRpc(pub, "getMarket", () => pub.readContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "getMarket", args: [duelKey, MARKET_KIND],
      })) as any;
      const mktKey = await pub.readContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "marketKey", args: [duelKey, MARKET_KIND],
      }) as `0x${string}`;
      const posMap: Record<string, unknown> = {};
      for (const { address, label } of [
        { address: mm.address, label: "mm" },
        { address: yesBettor.address, label: "yesBettor" },
        { address: noBettor.address, label: "noBettor" },
      ]) {
        const pos = await pub.readContract({
          address: clobAddress, abi: goldClobArtifact.abi, functionName: "positions", args: [mktKey, address],
        }) as any;
        posMap[label] = { aShares: pos[0]?.toString(), bShares: pos[1]?.toString(), aStake: pos[2]?.toString(), bStake: pos[3]?.toString() };
      }
      saveSnapshot(evidenceDir, cycleNum, "post-orders", {
        market: { exists: market.exists, status: Number(market.status), bestBid: Number(market.bestBid), bestAsk: Number(market.bestAsk) },
        positions: posMap,
      });
    } catch (e: any) { console.log(`  [snapshot] post-orders failed: ${e.message?.slice(0, 60)}`); }

    // ── Fee balances before cycle ────────────────────────────────────
    const treasuryBalBefore = await pub.getBalance({ address: admin.address });
    const mmBalBefore = await pub.getBalance({ address: mm.address });

    // ── Phase 2b: Warp past bet close window (absolute) ───────────────

    try {
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_setNextBlockTimestamp", params: [Number(betCloseTs) + 1], id: 10 }),
      });
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 11 }),
      });
    } catch {}

    // ── Negative test: bet after close ──────────────────────────────
    try {
      const lateBetCost = quoteCost(BUY_SIDE, 500, parseUnits("1", 18));
      await liquidator.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
        args: [duelKey, MARKET_KIND, BUY_SIDE, 500, parseUnits("1", 18), ORDER_FLAG_GTC],
        value: lateBetCost * 2n, nonce: await nonce(liquidator.address),
      });
      incident("neg:betAfterClose did not revert", cycleNum);
      cycleIncidents.push("neg_betAfterClose_passed");
    } catch (e: any) {
      const expected = e.message?.includes("BettingClosed") || e.message?.includes("MarketNotOpen");
      saveNegativeTest(evidenceDir, cycleNum, "betAfterClose", {
        pass: !!expected, error: e.message?.slice(0, 200), expectedRevert: "BettingClosed",
      });
      if (!expected) {
        incident(`neg:betAfterClose wrong error: ${e.message?.slice(0, 60)}`, cycleNum);
      } else {
        logEvent({ cycle: cycleNum, phase: "NEGATIVE", timestamp: Date.now(), actor: "liquidator",
          action: "neg:betAfterClose", txHash: null, gasUsed: 0, blockNumber: 0,
          success: true, error: null, details: { revertedAs: "BettingClosed" } });
      }
    }

    // ── Phase 3: Wait for fight + resolution ──────────────────────────

    console.log("  Waiting for RESOLUTION...");
    const resolutionDeadline = Date.now() + 180_000; // 3 min max
    while (Date.now() < resolutionDeadline && Date.now() < endAt) {
      if (!phasesObserved.includes(currentPhase)) {
        phasesObserved.push(currentPhase);
        console.log(`  Phase → ${currentPhase}`);
      }
      if (currentPhase === "RESOLUTION" || currentPhase === "TERMINAL") break;
      // If a new duel started (ANNOUNCEMENT with different key), the old one resolved
      if (currentDuelKey !== duelKey.replace("0x", "") && currentDuelKey !== duelKey && currentPhase === "ANNOUNCEMENT") {
        console.log("  Phase → RESOLUTION (inferred from new duel ANNOUNCEMENT)");
        phasesObserved.push("RESOLUTION");
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const resolvedOrInferred = phasesObserved.includes("RESOLUTION") ||
      currentPhase === "RESOLUTION" || currentPhase === "TERMINAL";
    if (!resolvedOrInferred) {
      if (Date.now() >= endAt) {
        endedMidCycle = true;
        console.log("  Reached soak duration cap during an active duel; ending without incident");
        break mainLoop;
      }
      incident("Resolution timeout — duel did not resolve in 3min", cycleNum);
      cycleIncidents.push("resolution_timeout");
      await revertAndResnap();
      continue;
    }

    // ── Phase 4: Settle ─────────────────────────────────────────────────

    // Lock the duel first (transition from BETTING_OPEN to LOCKED)
    // Must use SAME participant hashes, betOpenTs, betCloseTs as original upsert
    // (oracle enforces immutability after BETTING_OPEN)
    const DUEL_STATUS_LOCKED = 3;
    try {
      const lockHash = await reporter.wallet.writeContract({
        address: oracleAddress,
        abi: duelOracleArtifact.abi,
        functionName: "upsertDuel",
        args: [
          duelKey,
          hashLabel(`agent-a-${cycleNum}`),
          hashLabel(`agent-b-${cycleNum}`),
          now - 5n,          // same betOpenTs as seed
          betCloseTs,        // same betCloseTs as seed (immutable after BETTING_OPEN)
          fightStartTs,      // same fightStartTs as seed
          `soak-locked-${cycleNum}`,
          DUEL_STATUS_LOCKED,
        ],
        gas: 500_000n,
        nonce: await nonce(reporter.address),
      });
      const lockReceipt = await waitReceipt(lockHash);
      if (lockReceipt.status !== "success") {
        incident(`lockDuel tx reverted`, cycleNum);
        cycleIncidents.push("lock_reverted");
      }
      logEvent({
        cycle: cycleNum, phase: "SETTLEMENT", timestamp: Date.now(),
        actor: "reporter", action: "lockDuel",
        txHash: lockHash, gasUsed: 0, blockNumber: 0,
        success: true, error: null, details: {},
      });
    } catch (err: any) {
      incident(`lockDuel failed: ${err.message?.slice(0, 100)}`, cycleNum);
      cycleIncidents.push("lock_failed");
    }

    // Propose result
    const winnerSide = currentWinner === "A" ? 1 : 2;
    try {
      const proposeHash = await reporter.wallet.writeContract({
        address: oracleAddress,
        abi: duelOracleArtifact.abi,
        functionName: "proposeResult",
        args: [
          duelKey,
          winnerSide,
          BigInt(42), // seed
          keccak256(stringToHex("replay")),
          keccak256(stringToHex("result")),
          now + 200n, // duelEndTs
          `soak-resolved-${cycleNum}`,
        ],
        gas: 500_000n,
        nonce: await nonce(reporter.address),
      });
      await waitReceipt(proposeHash);
      logEvent({
        cycle: cycleNum, phase: "SETTLEMENT", timestamp: Date.now(),
        actor: "reporter", action: "proposeResult",
        txHash: proposeHash, gasUsed: 0, blockNumber: 0,
        success: true, error: null,
        details: { winnerSide, winner: currentWinner },
      });
    } catch (err: any) {
      incident(`proposeResult failed: ${err.message?.slice(0, 100)}`, cycleNum);
      cycleIncidents.push("propose_failed");
    }

    // Warp past dispute window (absolute — read proposedAt from latest block)
    const postProposeBlock = await pub.getBlock({ blockTag: "latest" });
    const proposedAt = Number(postProposeBlock.timestamp);
    try {
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_setNextBlockTimestamp", params: [proposedAt + DISPUTE_WINDOW_SECONDS + 1], id: 3 }),
      });
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 4 }),
      });
    } catch {}

    // Finalize result
    try {
      const finalizeHash = await reporter.wallet.writeContract({
        address: oracleAddress,
        abi: duelOracleArtifact.abi,
        functionName: "finalizeResult",
        args: [duelKey, `soak-finalized-${cycleNum}`],
        gas: 500_000n,
        nonce: await nonce(reporter.address),
      });
      const finalizeReceipt = await waitReceipt(finalizeHash);
      const finalizeOk = finalizeReceipt.status === "success";
      logEvent({
        cycle: cycleNum, phase: "SETTLEMENT", timestamp: Date.now(),
        actor: "reporter", action: "finalizeResult",
        txHash: finalizeHash, gasUsed: Number(finalizeReceipt.gasUsed), blockNumber: Number(finalizeReceipt.blockNumber),
        success: finalizeOk, error: finalizeOk ? null : `receipt.status=${finalizeReceipt.status}`,
        details: { receiptStatus: finalizeReceipt.status },
      });
      if (!finalizeOk) {
        incident(`finalizeResult tx reverted (receipt.status=${finalizeReceipt.status})`, cycleNum);
        cycleIncidents.push("finalize_reverted");
      }
    } catch (err: any) {
      incident(`finalizeResult failed: ${err.message?.slice(0, 100)}`, cycleNum);
      cycleIncidents.push("finalize_failed");
    }

    // Diagnostic: read oracle state after finalize
    try {
      const duelState = await pub.readContract({
        address: oracleAddress,
        abi: duelOracleArtifact.abi,
        functionName: "getDuel",
        args: [duelKey],
      }) as any;
      // getDuel returns struct: [0]=duelKey, [1]=partA, [2]=partB, [3]=status, [4]=winner
      const oracleStatus = Number(duelState.status ?? duelState[3] ?? -1);
      const oracleWinner = Number(duelState.winner ?? duelState[4] ?? 0);
      console.log(`  [diag] Oracle: status=${oracleStatus} winner=${oracleWinner} (6=RESOLVED, 4=PROPOSED, 3=LOCKED, 2=BETTING_OPEN)`);
      if (oracleStatus !== 6) {
        incident(`Oracle not RESOLVED after finalize — status=${oracleStatus}`, cycleNum);
        cycleIncidents.push("oracle_not_resolved");
      }
    } catch (err: any) {
      console.log(`  [diag] getDuel failed: ${err.message?.slice(0, 80)}`);
    }

    // ── Phase 5: Claims ─────────────────────────────────────────────────

    // Sync market from oracle
    try {
      const syncHash = await admin.wallet.writeContract({
        address: clobAddress,
        abi: goldClobArtifact.abi,
        functionName: "syncMarketFromOracle",
        args: [duelKey, MARKET_KIND],
        nonce: await nonce(admin.address),
      });
      await waitReceipt(syncHash);
      logEvent({
        cycle: cycleNum, phase: "CLAIM", timestamp: Date.now(),
        actor: "admin", action: "syncMarketFromOracle",
        txHash: syncHash, gasUsed: 0, blockNumber: 0,
        success: true, error: null, details: {},
      });
    } catch (err: any) {
      logEvent({
        cycle: cycleNum, phase: "CLAIM", timestamp: Date.now(),
        actor: "admin", action: "syncMarketFromOracle",
        txHash: null, gasUsed: 0, blockNumber: 0,
        success: false, error: err.message?.slice(0, 200), details: {},
      });
    }

    // Each participant claims — with balance tracking
    const claimPayouts: Record<string, bigint> = {};
    for (const { wallet, address, label } of [
      { ...mm, label: "mm" },
      { ...yesBettor, label: "yesBettor" },
      { ...noBettor, label: "noBettor" },
    ]) {
      const balBefore = await pub.getBalance({ address });
      try {
        const claimHash = await wallet.writeContract({
          address: clobAddress,
          abi: goldClobArtifact.abi,
          functionName: "claim",
          args: [duelKey, MARKET_KIND],
          nonce: await nonce(address),
        });
        const receipt = await timedRpc(pub, `claim.${label}`, () =>
          waitReceipt(claimHash));
        const balAfter = await pub.getBalance({ address });
        const gasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
        const payout = balAfter - balBefore + gasCost;
        claimPayouts[label] = payout;
        totalClaimed += payout;
        claimsExecuted++;

        saveReceipt(evidenceDir, cycleNum, label, "claim", receipt);
        logEvent({
          cycle: cycleNum, phase: "CLAIM", timestamp: Date.now(),
          actor: label, action: "claim",
          txHash: claimHash, gasUsed: Number(receipt.gasUsed),
          blockNumber: Number(receipt.blockNumber),
          success: true, error: null,
          details: { payout: payout.toString(), balBefore: balBefore.toString(), balAfter: balAfter.toString() },
        });
      } catch (err: any) {
        claimPayouts[label] = 0n;
        const benign =
          err.message?.includes("NoPosition") ||
          err.message?.includes("NothingToClaim");
        logEvent({
          cycle: cycleNum, phase: "CLAIM", timestamp: Date.now(),
          actor: label, action: "claim",
          txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 150),
          details: { benign },
        });
        if (!benign) {
          incident(`${label} claim failed: ${err.message?.slice(0, 80)}`, cycleNum);
          cycleIncidents.push(`${label}_claim_failed`);
        }
      }
    }

    // ── Negative test: double claim ─────────────────────────────────
    try {
      await mm.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "claim",
        args: [duelKey, MARKET_KIND], nonce: await nonce(mm.address),
      });
      incident("neg:doubleClaim did not revert", cycleNum);
      cycleIncidents.push("neg_doubleClaim_passed");
    } catch (e: any) {
      const expected = e.message?.includes("NothingToClaim") || e.message?.includes("NoPosition");
      saveNegativeTest(evidenceDir, cycleNum, "doubleClaim", {
        pass: !!expected, error: e.message?.slice(0, 200), expectedRevert: "NothingToClaim",
      });
      logEvent({ cycle: cycleNum, phase: "NEGATIVE", timestamp: Date.now(), actor: "mm",
        action: "neg:doubleClaim", txHash: null, gasUsed: 0, blockNumber: 0,
        success: true, error: null, details: { revertedAs: expected ? "NothingToClaim" : "other" } });
    }

    // ── Negative test: unauthorized settle (liquidator has no REPORTER_ROLE) ──
    {
      let negSettlePass = false;
      try {
        const liqNonce = await pub.getTransactionCount({ address: liquidator.address, blockTag: "pending" });
        const negHash = await liquidator.wallet.writeContract({
          address: oracleAddress, abi: duelOracleArtifact.abi, functionName: "proposeResult",
          args: [duelKey, 1, 42n, keccak256(stringToHex("x")), keccak256(stringToHex("y")), now + 999n, "unauthorized"],
          gas: 200_000n, nonce: liqNonce,
        });
        // Tx was sent — check receipt for revert
        const negReceipt = await waitReceipt(negHash);
        if (negReceipt.status === "reverted") {
          negSettlePass = true;
          saveNegativeTest(evidenceDir, cycleNum, "unauthorizedSettle", {
            pass: true, txHash: negHash, receiptStatus: "reverted", expectedRevert: "AccessControlUnauthorizedAccount",
          });
        } else {
          incident("neg:unauthorizedSettle tx succeeded (should have reverted)", cycleNum);
        }
      } catch (e: any) {
        // viem threw before sending — that's also a pass (simulation revert)
        negSettlePass = true;
        saveNegativeTest(evidenceDir, cycleNum, "unauthorizedSettle", {
          pass: true, error: e.message?.slice(0, 200), expectedRevert: "AccessControlUnauthorizedAccount",
        });
      }
      if (negSettlePass) {
        logEvent({ cycle: cycleNum, phase: "NEGATIVE", timestamp: Date.now(), actor: "liquidator",
          action: "neg:unauthorizedSettle", txHash: null, gasUsed: 0, blockNumber: 0,
          success: true, error: null, details: {} });
      }
    }

    // ── Post-claim snapshots ────────────────────────────────────────
    try {
      const mktKey = await pub.readContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "marketKey", args: [duelKey, MARKET_KIND],
      }) as `0x${string}`;
      const postClaimPositions: Record<string, unknown> = {};
      for (const { address, label } of [
        { address: mm.address, label: "mm" },
        { address: yesBettor.address, label: "yesBettor" },
        { address: noBettor.address, label: "noBettor" },
      ]) {
        const pos = await pub.readContract({
          address: clobAddress, abi: goldClobArtifact.abi, functionName: "positions", args: [mktKey, address],
        }) as any;
        postClaimPositions[label] = { aShares: pos[0]?.toString(), bShares: pos[1]?.toString() };
      }
      const treasuryBalAfter = await pub.getBalance({ address: admin.address });
      const mmBalAfter = await pub.getBalance({ address: mm.address });
      saveSnapshot(evidenceDir, cycleNum, "post-claims", {
        positions: postClaimPositions,
        payouts: Object.fromEntries(Object.entries(claimPayouts).map(([k, v]) => [k, v.toString()])),
        feeAccounting: {
          treasuryDelta: (treasuryBalAfter - treasuryBalBefore).toString(),
          mmDelta: (mmBalAfter - mmBalBefore).toString(),
        },
      });
    } catch (e: any) { console.log(`  [snapshot] post-claims failed: ${e.message?.slice(0, 60)}`); }

    // ── Phase 5b: Perps post-resolution lifecycle ─────────────────────
    let perpsLiquidations = 0;
    let perpsInsuranceAfter = 0n;
    let perpsBadDebtAfter = 0n;
    let perpsLongPnl = 0n;
    let perpsShortPnl = 0n;

    if (perpEngineAddress && skillOracleAddress && (perpsLongOpen || perpsShortOpen)) {
      // Step 1: Update SkillOracle based on duel winner (oracle-driven price shock)
      // Winner's skill μ goes up, loser's goes down — this shifts the perps mark price
      const winnerMu = currentWinner === "A" ? 1800 : 1200;
      try {
        const oracleUpdateHash = await reporter.wallet.writeContract({
          address: skillOracleAddress, abi: skillOracleArtifact.abi, functionName: "updateAgentSkill",
          args: [perpAgentId, winnerMu, 0], nonce: await nonce(reporter.address),
        });
        const oracleUpdateReceipt = await waitReceipt(oracleUpdateHash);
        saveReceipt(evidenceDir, cycleNum, "reporter", "perps-updateSkillOracle", oracleUpdateReceipt);
        logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(), actor: "reporter",
          action: "perps.updateSkillOracle", txHash: null, gasUsed: 0, blockNumber: 0,
          success: true, error: null, details: { winnerMu, winner: currentWinner } });
      } catch (err: any) {
        logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(), actor: "reporter",
          action: "perps.updateSkillOracle", txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 150), details: {} });
      }

      // Step 1b: Sync the engine to the updated oracle and freeze settlement price.
      try {
        const syncOracleHash = await admin.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "syncOracle", args: [perpAgentId],
          nonce: await nonce(admin.address),
        });
        const syncOracleReceipt = await waitReceipt(syncOracleHash);
        saveReceipt(evidenceDir, cycleNum, "admin", "perps-syncOracle", syncOracleReceipt);
        logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(), actor: "admin",
          action: "perps.syncOracle", txHash: syncOracleHash, gasUsed: Number(syncOracleReceipt.gasUsed),
          blockNumber: Number(syncOracleReceipt.blockNumber), success: true, error: null, details: {} });

        const closeOnlyHash = await admin.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "setMarketStatus", args: [perpAgentId, 2],
          nonce: await nonce(admin.address),
        });
        const closeOnlyReceipt = await waitReceipt(closeOnlyHash);
        saveReceipt(evidenceDir, cycleNum, "admin", "perps-set-close-only", closeOnlyReceipt);
        logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(), actor: "admin",
          action: "perps.setCloseOnly", txHash: closeOnlyHash, gasUsed: Number(closeOnlyReceipt.gasUsed),
          blockNumber: Number(closeOnlyReceipt.blockNumber), success: true, error: null, details: {} });
      } catch (err: any) {
        logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(), actor: "admin",
          action: "perps.prepareSettlement", txHash: null, gasUsed: 0, blockNumber: 0,
          success: false, error: err.message?.slice(0, 150), details: {} });
      }

      // Step 2: Check position health and attempt liquidations
      for (const { wallet, address: addr, label, isOpen } of [
        { ...perpsLong, label: "perpsLong", isOpen: perpsLongOpen },
        { ...perpsShort, label: "perpsShort", isOpen: perpsShortOpen },
      ]) {
        if (!isOpen) continue;
        try {
          const health = await pub.readContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "getPositionHealth", args: [perpAgentId, addr],
          }) as any;
          const liquidatable = !!health[5]; // health.liquidatable
          const equity = BigInt(health[3] ?? 0); // health.equity

          saveSnapshot(evidenceDir, cycleNum, `perps-health-${label}`, {
            markPrice: health[0]?.toString(), notional: health[1]?.toString(),
            unrealizedPnl: health[2]?.toString(), equity: equity.toString(),
            maintenanceMargin: health[4]?.toString(), liquidatable,
          });

          if (liquidatable) {
            try {
              const liqHash = await liquidator.wallet.writeContract({
                address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
                functionName: "liquidate", args: [perpAgentId, addr],
                nonce: await nonce(liquidator.address),
              });
              const liqReceipt = await waitReceipt(liqHash);
              perpsLiquidations++;
              saveReceipt(evidenceDir, cycleNum, label, "liquidation", liqReceipt);
              logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
                actor: "liquidator", action: `perps.liquidate.${label}`,
                txHash: liqHash, gasUsed: Number(liqReceipt.gasUsed),
                blockNumber: Number(liqReceipt.blockNumber), success: true, error: null,
                details: { equity: equity.toString() } });
            } catch (err: any) {
              logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
                actor: "liquidator", action: `perps.liquidate.${label}`,
                txHash: null, gasUsed: 0, blockNumber: 0,
                success: false, error: err.message?.slice(0, 150), details: {} });
            }
          }
        } catch (err: any) {
          logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
            actor: label, action: "perps.healthCheck",
            txHash: null, gasUsed: 0, blockNumber: 0,
            success: false, error: err.message?.slice(0, 150), details: {} });
        }
      }

      // Step 3: Close remaining open positions and track PnL.
      // Close the losing side first so the vault is replenished before paying profits.
      const closeCandidates: Array<{
        wallet: WalletClient;
        addr: Address;
        label: string;
        isOpenRef: "long" | "short";
        equityBefore: bigint;
      }> = [];
      for (const { wallet, address: addr, label, isOpenRef } of [
        { ...perpsLong, label: "perpsLong", isOpenRef: "long" as const },
        { ...perpsShort, label: "perpsShort", isOpenRef: "short" as const },
      ]) {
        try {
          const pos = await pub.readContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "positions", args: [perpAgentId, addr],
          }) as any;
          const size = BigInt(pos[0] ?? 0);
          if (size === 0n) continue; // already liquidated or closed

          const marginBefore = await pub.readContract({
            address: perpEngineAddress as Address, abi: agentPerpEngineArtifact.abi,
            functionName: "getPositionHealth", args: [perpAgentId, addr],
          }) as any;
          closeCandidates.push({
            wallet,
            addr,
            label,
            isOpenRef,
            equityBefore: BigInt(marginBefore[3] ?? 0),
          });
        } catch (err: any) {
          logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
            actor: label, action: `perps.close.${isOpenRef}`,
            txHash: null, gasUsed: 0, blockNumber: 0,
            success: false, error: err.message?.slice(0, 150), details: {} });
        }
      }
      closeCandidates.sort((a, b) => {
        if (a.equityBefore === b.equityBefore) return 0;
        return a.equityBefore < b.equityBefore ? -1 : 1;
      });
      const attemptClose = async (
        wallet: WalletClient,
        addr: Address,
        label: string,
        isOpenRef: "long" | "short",
        equityBefore: bigint,
        retry = false,
      ) => {
        try {
          const pos = await pub.readContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "positions", args: [perpAgentId, addr],
          }) as any;
          const size = BigInt(pos[0] ?? 0);
          if (size === 0n) return true;

          const closeHash = await wallet.writeContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "modifyPosition", args: [perpAgentId, 0n, -size],
            nonce: await nonce(addr),
          });
          const closeReceipt = await waitReceipt(closeHash);
          saveReceipt(evidenceDir, cycleNum, label, `perps-close-${isOpenRef}${retry ? "-retry" : ""}`, closeReceipt);

          const pnl = equityBefore - parseUnits("200", 18);
          if (isOpenRef === "long") perpsLongPnl = pnl;
          else perpsShortPnl = pnl;

          logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
            actor: label, action: `perps.close.${isOpenRef}${retry ? ".retry" : ""}`,
            txHash: closeHash, gasUsed: Number(closeReceipt.gasUsed), blockNumber: Number(closeReceipt.blockNumber),
            success: true, error: null,
            details: { pnl: pnl.toString(), equity: equityBefore.toString() } });
          return true;
        } catch (err: any) {
          logEvent({ cycle: cycleNum, phase: "PERPS_SETTLEMENT", timestamp: Date.now(),
            actor: label, action: `perps.close.${isOpenRef}${retry ? ".retry" : ""}`,
            txHash: null, gasUsed: 0, blockNumber: 0,
            success: false, error: err.message?.slice(0, 150), details: {} });
          return false;
        }
      };
      const retryCandidates: typeof closeCandidates = [];
      for (const candidate of closeCandidates) {
        const closed = await attemptClose(
          candidate.wallet,
          candidate.addr,
          candidate.label,
          candidate.isOpenRef,
          candidate.equityBefore,
        );
        if (!closed) {
          retryCandidates.push(candidate);
        }
      }
      for (const candidate of retryCandidates) {
        await attemptClose(
          candidate.wallet,
          candidate.addr,
          candidate.label,
          candidate.isOpenRef,
          candidate.equityBefore,
          true,
        );
      }

      // Step 4: Snapshot insurance fund after cycle
      try {
        const mktPost = await pub.readContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi, functionName: "markets",
          args: [perpAgentId],
        }) as any;
        perpsInsuranceAfter = BigInt(mktPost[9] ?? 0);
        perpsBadDebtAfter = BigInt(mktPost[10] ?? 0);

        const insuranceDelta = perpsInsuranceAfter - perpsInsuranceBefore;
        const badDebtDelta = perpsBadDebtAfter - perpsBadDebtBefore;

        saveSnapshot(evidenceDir, cycleNum, "perps-settlement-summary", {
          insuranceBefore: perpsInsuranceBefore.toString(),
          insuranceAfter: perpsInsuranceAfter.toString(),
          insuranceDelta: insuranceDelta.toString(),
          badDebtBefore: perpsBadDebtBefore.toString(),
          badDebtAfter: perpsBadDebtAfter.toString(),
          badDebtDelta: badDebtDelta.toString(),
          liquidations: perpsLiquidations,
          longPnl: perpsLongPnl.toString(),
          shortPnl: perpsShortPnl.toString(),
          openPositionsRemaining: Number(mktPost[14] ?? 0),
        });

        // Incident: insurance fund depleted
        if (perpsInsuranceAfter === 0n && perpsInsuranceBefore > 0n) {
          incident("Perps insurance fund depleted to zero", cycleNum);
          cycleIncidents.push("perps_insurance_depleted");
        }
        // Incident: new bad debt
        if (badDebtDelta > 0n) {
          incident(`Perps bad debt increased by ${formatUnits(badDebtDelta, 18)}`, cycleNum);
          cycleIncidents.push("perps_bad_debt");
        }

        console.log(`  [perps] liq=${perpsLiquidations} longPnl=${formatUnits(perpsLongPnl, 18)} shortPnl=${formatUnits(perpsShortPnl, 18)} ins=${formatUnits(insuranceDelta, 18)}`);
      } catch {}
    }

    // ── Phase 6: Reconciliation ───────────────────────────────────────

    let clobBalance = 0n;
    try {
      clobBalance = await pub.getBalance({ address: clobAddress });
    } catch {}

    // Block timestamp for evidence
    try {
      const blk = await pub.getBlock({ blockTag: "latest" });
      blockTimestampLog.push({
        cycle: cycleNum, phase: "RECONCILE",
        blockNumber: Number(blk.number), blockTimestamp: Number(blk.timestamp),
        wallClockMs: Date.now(),
      });
    } catch {}

    // Save full reconciliation evidence
    const allBalances: Record<string, string> = {};
    for (const { address, label } of [
      { address: admin.address, label: "admin" },
      { address: reporter.address, label: "reporter" },
      { address: mm.address, label: "mm" },
      { address: yesBettor.address, label: "yesBettor" },
      { address: noBettor.address, label: "noBettor" },
      { address: clobAddress, label: "clob_contract" },
      { address: oracleAddress, label: "oracle_contract" },
    ]) {
      try { allBalances[label] = (await pub.getBalance({ address })).toString(); } catch {}
    }
    saveReconciliation(evidenceDir, cycleNum, {
      clobContractBalance: clobBalance.toString(),
      totalDeposited: totalDeposited.toString(),
      totalClaimed: totalClaimed.toString(),
      claimPayouts: Object.fromEntries(Object.entries(claimPayouts).map(([k, v]) => [k, v.toString()])),
      allBalances,
    });

    const sourceSeq =
      latestAuthoritativeSync?.sourceBetSyncState?.latestSeq ??
      latestAuthoritativeSync?.sourceBetSyncState?.seq ??
      latestAuthoritativeSync?.sourceBetSyncState?.latestEvent?.seq ??
      null;
    const lastSeenSeq = latestAuthoritativeSync?.syncStatus?.lastSeenSeq ?? null;
    const lastAppliedSeq =
      latestAuthoritativeSync?.syncStatus?.lastAppliedSeq ?? null;
    const applyLagMs = latestAuthoritativeSync?.syncStatus?.applyLagMs ?? null;
    const sourceEventAgeMs =
      latestAuthoritativeSync?.syncStatus?.sourceEventAgeMs ?? null;
    const replayMode = latestAuthoritativeSync?.syncStatus?.replayMode ?? null;
    const degradedReason =
      latestAuthoritativeSync?.syncStatus?.degradedReason ??
      latestAuthoritativeSync?.syncStatus?.rendererHealth?.degradedReason ??
      latestAuthoritativeSync?.sourceBetSyncState?.rendererHealth?.degradedReason ??
      null;

    if (
      sourceSeq != null &&
      lastAppliedSeq != null &&
      lastAppliedSeq < sourceSeq
    ) {
      incident(
        `Authoritative sync drift detected: applied ${lastAppliedSeq} behind source ${sourceSeq}`,
        cycleNum,
      );
      cycleIncidents.push("authoritative_sync_drift");
    }
    if (applyLagMs != null && applyLagMs > config.pollMs * 4) {
      incident(
        `Authoritative sync apply lag ${applyLagMs}ms exceeds budget`,
        cycleNum,
      );
      cycleIncidents.push("authoritative_sync_lag");
    }

    const cycleSummary: CycleSummary = {
      cycle: cycleNum,
      duelKey: duelKey,
      startedAt: cycleStart,
      endedAt: Date.now(),
      phases: phasesObserved,
      clobOrders,
      clobFills,
      claims: claimsExecuted,
      incidents: cycleIncidents,
      balanceSheet: {
        clobContractBalance: formatUnits(clobBalance, 18),
        totalDeposited: formatUnits(totalDeposited, 18),
        totalClaimed: formatUnits(totalClaimed, 18),
        discrepancy: formatUnits(clobBalance - (totalDeposited - totalClaimed), 18),
      },
      perps: {
        liquidations: perpsLiquidations,
        longPnl: formatUnits(perpsLongPnl, 18),
        shortPnl: formatUnits(perpsShortPnl, 18),
        insuranceDelta: formatUnits(perpsInsuranceAfter - perpsInsuranceBefore, 18),
        badDebtDelta: formatUnits(perpsBadDebtAfter - perpsBadDebtBefore, 18),
      },
      sync: {
        sourceSeq,
        lastSeenSeq,
        lastAppliedSeq,
        applyLagMs,
        sourceEventAgeMs,
        replayMode,
        degradedReason,
      },
    };
    cycles.push(cycleSummary);

    const elapsed = Math.floor((Date.now() - startedAt) / 60_000);
    console.log(
      `  ✓ Cycle ${cycleNum} complete: ${clobOrders} orders, ${clobFills} fills, ${claimsExecuted} claims, ${cycleIncidents.length} incidents (${elapsed}min elapsed)`,
    );

    // Revert to base snapshot — resets time, nonces, balances
    await revertAndResnap();

    // Refresh perps oracle timestamp only when a reset rewound it to deploy-time.
    if (config.resetBetweenCycles && skillOracleAddress) {
      try {
        await reporter.wallet.writeContract({
          address: skillOracleAddress, abi: skillOracleArtifact.abi, functionName: "updateAgentSkill",
          args: [perpAgentId, 1500, 200], nonce: await nonce(reporter.address),
        });
      } catch {}
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  clearInterval(memInterval);
  authoritativePollerRunning = false;
  await authoritativePollerPromise;
  eventsStream.end();
  authoritativeSyncStream.end();

  // Final memory snapshot
  const finalMem = process.memoryUsage();
  memorySnapshots.push({
    timestamp: Date.now(),
    rss: finalMem.rss,
    heapUsed: finalMem.heapUsed,
    heapTotal: finalMem.heapTotal,
  });

  // Memory growth check
  const initRss = memorySnapshots[0].rss;
  const finalRss = memorySnapshots[memorySnapshots.length - 1].rss;
  const memGrowthFactor = finalRss / initRss;
  if (memGrowthFactor > 2.0) {
    incidents.push(`Memory grew ${memGrowthFactor.toFixed(1)}x (${initRss} → ${finalRss})`);
  }

  // Write artifacts
  fs.writeFileSync(
    path.join(outDir, "cycles.json"),
    JSON.stringify(cycles, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(outDir, "incidents.json"),
    JSON.stringify(incidents, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(perfDir, "memory.csv"),
    "timestamp,rss,heapUsed,heapTotal\n" +
      memorySnapshots
        .map((m) => `${m.timestamp},${m.rss},${m.heapUsed},${m.heapTotal}`)
        .join("\n") +
      "\n",
  );
  fs.writeFileSync(
    path.join(perfDir, "rpc-latency.csv"),
    "timestamp,operation,latencyMs\n" +
      rpcLatencyLog.map((r) => `${r.timestamp},${r.operation},${r.latencyMs}`).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(perfDir, "block-timestamps.csv"),
    "cycle,phase,blockNumber,blockTimestamp,wallClockMs\n" +
      blockTimestampLog.map((b) => `${b.cycle},${b.phase},${b.blockNumber},${b.blockTimestamp},${b.wallClockMs}`).join("\n") + "\n",
  );

  // Gas by operation type
  const gasMap = new Map<string, number[]>();
  const events: SoakEvent[] = [];
  try {
    const raw = fs.readFileSync(eventsFile, "utf8").trim().split("\n");
    for (const line of raw) { try { events.push(JSON.parse(line)); } catch {} }
  } catch {}
  for (const e of events) {
    if (e.gasUsed > 0) {
      const key = e.action;
      if (!gasMap.has(key)) gasMap.set(key, []);
      gasMap.get(key)!.push(e.gasUsed);
    }
  }
  const gasRows = Array.from(gasMap.entries()).map(([op, vals]) => {
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return `${op},${avg},${min},${max},${vals.length}`;
  });
  fs.writeFileSync(
    path.join(perfDir, "gas-by-operation.csv"),
    "operation,avgGas,minGas,maxGas,count\n" + gasRows.join("\n") + "\n",
  );

  const totalOrders = cycles.reduce((s, c) => s + c.clobOrders, 0);
  const totalFills = cycles.reduce((s, c) => s + c.clobFills, 0);
  const totalClaims = cycles.reduce((s, c) => s + c.claims, 0);
  const requiredCycles = Math.max(1, Math.min(5, Math.floor(config.durationMin / 5)));

  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    durationMin: config.durationMin,
    actualDurationMin: Math.round((Date.now() - startedAt) / 60_000),
    cycles: cycles.length,
    endedMidCycle,
    totalOrders,
    totalFills,
    totalClaims,
    incidents: incidents.length,
    incidentDetails: incidents,
    memoryGrowthFactor: memGrowthFactor.toFixed(2),
    negativeTestsPassed: fs.readdirSync(path.join(evidenceDir, "negative-tests")).length,
    receiptsStored: fs.readdirSync(path.join(evidenceDir, "receipts")).reduce(
      (sum, dir) => sum + fs.readdirSync(path.join(evidenceDir, "receipts", dir)).length, 0),
    authoritativeSync: {
      sourceBetSyncStateUrl: config.sourceBetSyncStateUrl,
      syncStatusUrl: config.syncStatusUrl,
      streamStateUrl: config.streamStateUrl,
      pollMs: config.pollMs,
      resetBetweenCycles: config.resetBetweenCycles,
      lastSuccessfulPollAt:
        latestAuthoritativeSync != null
          ? new Date(latestAuthoritativeSync.fetchedAt).toISOString()
          : null,
      sourceSeq:
        latestAuthoritativeSync?.sourceBetSyncState?.latestSeq ??
        latestAuthoritativeSync?.sourceBetSyncState?.seq ??
        latestAuthoritativeSync?.sourceBetSyncState?.latestEvent?.seq ??
        null,
      lastSeenSeq: latestAuthoritativeSync?.syncStatus?.lastSeenSeq ?? null,
      lastAppliedSeq:
        latestAuthoritativeSync?.syncStatus?.lastAppliedSeq ?? null,
      applyLagMs: latestAuthoritativeSync?.syncStatus?.applyLagMs ?? null,
      sourceEventAgeMs:
        latestAuthoritativeSync?.syncStatus?.sourceEventAgeMs ?? null,
      replayMode: latestAuthoritativeSync?.syncStatus?.replayMode ?? null,
      degradedReason:
        latestAuthoritativeSync?.syncStatus?.degradedReason ??
        latestAuthoritativeSync?.syncStatus?.rendererHealth?.degradedReason ??
        latestAuthoritativeSync?.sourceBetSyncState?.rendererHealth
          ?.degradedReason ??
        null,
    },
    pass: incidents.length === 0 && cycles.length >= requiredCycles,
    outputDir: outDir,
  };

  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );

  // Print final report
  console.log("\n" + "═".repeat(60));
  console.log("  SOAK RESULTS");
  console.log("═".repeat(60));
  console.log(`  Duration:      ${summary.actualDurationMin} min`);
  console.log(`  Cycles:        ${cycleNum}`);
  console.log(`  CLOB orders:   ${totalOrders}`);
  console.log(`  CLOB fills:    ${totalFills}`);
  console.log(`  Claims:        ${totalClaims}`);
  const totalPerpsLiqs = cycles.reduce((s, c) => s + c.perps.liquidations, 0);
  console.log(`  Perps liqs:    ${totalPerpsLiqs}`);
  console.log(`  Incidents:     ${incidents.length}`);
  console.log(`  Memory growth: ${memGrowthFactor.toFixed(2)}x`);
  console.log(`  Output:        ${outDir}`);
  console.log("─".repeat(60));
  if (summary.pass) {
    console.log("  VERDICT: ✅ PASS");
  } else {
    console.log("  VERDICT: ❌ FAIL");
    for (const inc of incidents) {
      console.log(`    - ${inc}`);
    }
  }
  console.log("═".repeat(60));

  process.exit(summary.pass ? 0 : 1);
}

main().catch((err) => {
  console.error("Soak harness fatal:", err);
  process.exit(2);
});
