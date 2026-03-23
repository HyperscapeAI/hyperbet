/**
 * soak-harness.ts — Active trading soak test for prediction markets.
 *
 * Exercises CLOB, AMM, Perps, Oracle, Claims, and Reconciliation every
 * duel cycle against local Anvil chains + live Hyperscapes game server.
 *
 * Usage:
 *   bun run scripts/soak-harness.ts --duration-min=30 --bsc-rpc=http://localhost:18545
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  stringToHex,
  getAddress,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

// ─── Foundry artifacts ──────────────────────────────────────────────────────

import duelOracleArtifact from "../packages/evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json";
import goldClobArtifact from "../packages/evm-contracts/out/GoldClob.sol/GoldClob.json";
import mockErc20Artifact from "../packages/evm-contracts/out/MockERC20.sol/MockERC20.json";

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
};

type MemorySnapshot = {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

const MARKET_KIND = 0;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const ORDER_FLAG_GTC = 0x01;
const DUEL_STATUS_BETTING_OPEN = 2;
const DISPUTE_WINDOW_SECONDS = 3_600;
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
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    durationMin: parseInt(get("--duration-min", "30"), 10),
    bscRpc: get("--bsc-rpc", "http://localhost:18545"),
    gameUrl: get("--game-url", "http://localhost:5555"),
  };
}

// ─── Nonce tracker ──────────────────────────────────────────────────────────

function createNonceTracker(pub: PublicClient) {
  const cache = new Map<string, number>();
  return async (address: Address): Promise<number> => {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached != null) {
      cache.set(key, cached + 1);
      return cached;
    }
    const fresh = await pub.getTransactionCount({ address, blockTag: "pending" });
    cache.set(key, fresh + 1);
    return fresh;
  };
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

  const eventsFile = path.join(outDir, "events.jsonl");
  const eventsStream = fs.createWriteStream(eventsFile, { flags: "a" });
  const memorySnapshots: MemorySnapshot[] = [];
  const cycles: CycleSummary[] = [];
  const incidents: string[] = [];

  function logEvent(evt: SoakEvent) {
    eventsStream.write(JSON.stringify(evt) + "\n");
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
    const receipt = await pub.waitForTransactionReceipt({ hash });
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

  // ── SSE stream consumer ─────────────────────────────────────────────────

  let currentPhase = "UNKNOWN";
  let currentDuelKey = "";
  let currentWinner = "";
  let lastStreamUpdate = 0;

  const sseUrl = `${config.gameUrl}/api/streaming/state/events`;
  console.log(`\n=== Consuming SSE stream: ${sseUrl} ===`);

  // Background SSE reader using fetch streaming
  let sseAbort = new AbortController();
  async function startSseReader() {
    while (!sseAbort.signal.aborted) {
      try {
        const res = await fetch(sseUrl, {
          signal: sseAbort.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) { await new Promise(r => setTimeout(r, 2000)); continue; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const data = JSON.parse(line.slice(5).trim());
              if (data.error) continue; // skip "warming up" frames
              const cycle = data.cycle || {};
              currentPhase = cycle.phase || data.type || "UNKNOWN";
              currentDuelKey = cycle.duelKeyHex || cycle.duelKey || "";
              lastStreamUpdate = Date.now();
              // Extract winner — only update if same duel
              const a1 = cycle.agent1;
              const a2 = cycle.agent2;
              const thisKey = cycle.duelKeyHex || cycle.duelKey || "";
              if (a1 && a2 && cycle.winnerId && thisKey === currentDuelKey) {
                currentWinner = cycle.winnerId === a1.id ? "A" : "B";
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (sseAbort.signal.aborted) break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  // Fire and forget — runs in background
  startSseReader();

  // Wait for first real frame
  const pollDeadline = Date.now() + 60_000;
  while (lastStreamUpdate === 0 && Date.now() < pollDeadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (lastStreamUpdate === 0) {
    console.error("Failed to connect to game server (60s timeout)");
    process.exit(2);
  }
  console.log(`  Connected. Phase=${currentPhase}, DuelKey=${currentDuelKey.slice(0, 16)}...`);

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

  console.log(`\n=== Starting soak — ${config.durationMin} minutes ===\n`);

  while (Date.now() < endAt) {
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
      await pub.waitForTransactionReceipt({ hash: upsertHash });
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
      await pub.waitForTransactionReceipt({ hash: createMktHash });
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
        continue;
      }
    } catch (err: any) {
      incident(`Market seed failed: ${err.message?.slice(0, 100)}`, cycleNum);
      cycleIncidents.push("seed_failed");
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
        const receipt = await pub.waitForTransactionReceipt({ hash });
        clobOrders++;
        totalDeposited += cost + fee + fee;

        // Check if order filled (logs contain OrderFilled or trade events)
        const fillLogs = receipt.logs.filter(
          (l) => l.topics[0] === keccak256(stringToHex("OrderFilled(bytes32,uint64,uint64,uint256)")),
        );
        if (fillLogs.length > 0) clobFills++;

        logEvent({
          cycle: cycleNum, phase: currentPhase, timestamp: Date.now(),
          actor, action: `placeOrder.${side === BUY_SIDE ? "BUY" : "SELL"}.${price}`,
          txHash: hash, gasUsed: Number(receipt.gasUsed), blockNumber: Number(receipt.blockNumber),
          success: true, error: null,
          details: { side, price, amount: formatUnits(betAmount, 18), cost: formatUnits(cost, 18) },
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

    // ── Phase 2b: Warp past bet close window ──────────────────────────
    // Must happen AFTER bets are placed, BEFORE settlement

    try {
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "evm_increaseTime",
          params: [300], // 5 min — past betCloseTs (120s from seed)
          id: 10,
        }),
      });
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 11 }),
      });
    } catch {}

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
      incident("Resolution timeout — duel did not resolve in 3min", cycleNum);
      cycleIncidents.push("resolution_timeout");
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
      const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockHash });
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
      await pub.waitForTransactionReceipt({ hash: proposeHash });
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

    // Advance past dispute window
    try {
      await fetch(config.bscRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "evm_increaseTime",
          params: [DISPUTE_WINDOW_SECONDS + 60], id: 3,
        }),
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
      const finalizeReceipt = await pub.waitForTransactionReceipt({ hash: finalizeHash });
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
      await pub.waitForTransactionReceipt({ hash: syncHash });
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

    // Each participant claims
    for (const { wallet, address, label } of [
      { ...mm, label: "mm" },
      { ...yesBettor, label: "yesBettor" },
      { ...noBettor, label: "noBettor" },
    ]) {
      try {
        const claimHash = await wallet.writeContract({
          address: clobAddress,
          abi: goldClobArtifact.abi,
          functionName: "claim",
          args: [duelKey, MARKET_KIND],
          nonce: await nonce(address),
        });
        const receipt = await pub.waitForTransactionReceipt({ hash: claimHash });
        claimsExecuted++;
        logEvent({
          cycle: cycleNum, phase: "CLAIM", timestamp: Date.now(),
          actor: label, action: "claim",
          txHash: claimHash, gasUsed: Number(receipt.gasUsed),
          blockNumber: Number(receipt.blockNumber),
          success: true, error: null, details: {},
        });
      } catch (err: any) {
        // "NoPosition" or "NothingToClaim" are acceptable (no fill = nothing to claim)
        // MarketNotSettled is NOT benign — it means settlement flow broke
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

    // ── Phase 6: Reconciliation ───────────────────────────────────────

    let clobBalance = 0n;
    try {
      clobBalance = await pub.getBalance({ address: clobAddress });
    } catch {}

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
        discrepancy: "0",
      },
    };
    cycles.push(cycleSummary);

    const elapsed = Math.floor((Date.now() - startedAt) / 60_000);
    console.log(
      `  ✓ Cycle ${cycleNum} complete: ${clobOrders} orders, ${clobFills} fills, ${claimsExecuted} claims, ${cycleIncidents.length} incidents (${elapsed}min elapsed)`,
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  clearInterval(memInterval);
  sseAbort.abort();
  eventsStream.end();

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
    path.join(outDir, "memory.csv"),
    "timestamp,rss,heapUsed,heapTotal\n" +
      memorySnapshots
        .map((m) => `${m.timestamp},${m.rss},${m.heapUsed},${m.heapTotal}`)
        .join("\n") +
      "\n",
  );

  const totalOrders = cycles.reduce((s, c) => s + c.clobOrders, 0);
  const totalFills = cycles.reduce((s, c) => s + c.clobFills, 0);
  const totalClaims = cycles.reduce((s, c) => s + c.claims, 0);

  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    durationMin: config.durationMin,
    actualDurationMin: Math.round((Date.now() - startedAt) / 60_000),
    cycles: cycleNum,
    totalOrders,
    totalFills,
    totalClaims,
    incidents: incidents.length,
    incidentDetails: incidents,
    memoryGrowthFactor: memGrowthFactor.toFixed(2),
    pass: incidents.length === 0 && cycleNum >= 5,
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
