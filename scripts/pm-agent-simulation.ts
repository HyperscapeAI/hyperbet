/**
 * pm-agent-simulation.ts — Multi-agent prediction market + perps simulation.
 *
 * Deploys CLOB + Oracle + Perps to local Anvil, then runs multiple agent
 * archetypes (InformedTrader, NoiseTrader, MarketMaker, Arbitrageur, Liquidator)
 * through repeated duel cycles. Tracks per-agent PnL, spread quality,
 * liquidation events, and insurance fund health.
 *
 * Usage:
 *   anvil --host 127.0.0.1 --port 18545 --chain-id 97 --accounts 20 --balance 10000
 *   bun run scripts/pm-agent-simulation.ts --cycles=10 --rpc=http://localhost:18545
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
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

import duelOracleArtifact from "../packages/evm-contracts/out/DuelOutcomeOracle.sol/DuelOutcomeOracle.json";
import goldClobArtifact from "../packages/evm-contracts/out/GoldClob.sol/GoldClob.json";
import mockErc20Artifact from "../packages/evm-contracts/out/MockERC20.sol/MockERC20.json";
import skillOracleArtifact from "../packages/evm-contracts/out/SkillOracle.sol/SkillOracle.json";
import agentPerpEngineArtifact from "../packages/evm-contracts/out/AgentPerpEngine.sol/AgentPerpEngine.json";

// ─── Deterministic RNG (matches adversarial suite pattern) ──────────────────

class Prng {
  private state: number;
  constructor(seed: number) { this.state = seed | 0 || 1; }
  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  nextBool(p = 0.5): boolean { return this.next() < p; }
}

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentType = "informed" | "noise" | "marketMaker" | "arbitrageur" | "liquidator";

interface AgentState {
  type: AgentType;
  label: string;
  address: Address;
  wallet: WalletClient;
  clobPnl: bigint;
  perpsPnl: bigint;
  ordersPlaced: number;
  fills: number;
  liquidationsExecuted: number;
}

interface ChainState {
  duelKey: string;
  trueWinner: "A" | "B"; // known to informed trader
  currentPhase: "BETTING" | "LOCKED" | "RESOLVED";
  ticksInPhase: number;
  perpMarkPrice: bigint;
  clobBestBid: number;
  clobBestAsk: number;
}

interface CycleMetrics {
  cycle: number;
  agentPnl: Record<string, { clob: string; perps: string; total: string }>;
  totalOrders: number;
  totalFills: number;
  liquidations: number;
  insuranceDelta: string;
  badDebt: string;
  spreadQuality: number; // avg spread in bps
  winner: string;
}

type SimConfig = {
  cycles: number;
  ticksPerPhase: number;
  rpcUrl: string;
  seed: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const GTC_FLAG = 0x01;
const UNIT = parseUnits("1", 18);

function hashLabel(label: string): `0x${string}` {
  return `0x${createHash("sha256").update(label).digest("hex")}`;
}

function resolveBytecode(artifact: any): `0x${string}` {
  const raw = typeof artifact.bytecode === "string"
    ? artifact.bytecode : artifact.bytecode?.object || "";
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function parseArgs(): SimConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    // Support both --flag value and --flag=value
    for (const arg of args) {
      if (arg.startsWith(flag + "=")) return arg.slice(flag.length + 1);
    }
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    cycles: parseInt(get("--cycles", "10"), 10),
    ticksPerPhase: parseInt(get("--ticks-per-phase", "5"), 10),
    rpcUrl: get("--rpc", "http://localhost:18545"),
    seed: parseInt(get("--seed", "42"), 10),
  };
}

// ─── Nonce tracker (reused from soak harness) ───────────────────────────────

function createNonceTracker(pub: PublicClient) {
  const cache = new Map<string, number>();
  const tracker = async (address: Address): Promise<number> => {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached != null) { cache.set(key, cached + 1); return cached; }
    const fresh = await pub.getTransactionCount({ address, blockTag: "pending" });
    cache.set(key, fresh + 1);
    return fresh;
  };
  tracker.invalidateAll = () => cache.clear();
  return tracker;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const rng = new Prng(config.seed);

  const outDir = path.resolve(process.cwd(), "output/simulation",
    new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });

  const localChain = {
    id: 97, name: "sim-bsc",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const;

  const pub = createPublicClient({ chain: localChain, transport: http(config.rpcUrl) });
  const nonce = createNonceTracker(pub);

  // Create 12 accounts: admin, reporter, operator, pauser + 8 agents
  const wallets = Array.from({ length: 12 }, (_, i) => {
    const account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i });
    return {
      account, address: account.address,
      wallet: createWalletClient({ account, chain: localChain, transport: http(config.rpcUrl) }),
    };
  });

  const [admin, reporter, operator, pauser] = wallets;

  async function waitReceipt(hash: `0x${string}`) {
    return pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
  }

  async function deploy(artifact: any, args: any[]): Promise<Address> {
    const hash = await admin.wallet.deployContract({
      abi: artifact.abi, bytecode: resolveBytecode(artifact),
      args, nonce: await nonce(admin.address),
    });
    const r = await waitReceipt(hash);
    return r.contractAddress!;
  }

  // ── Deploy ──────────────────────────────────────────────────────────────

  console.log("=== Deploying contracts ===");

  const tokenAddress = await deploy(mockErc20Artifact, ["GOLD", "GOLD"]);
  const oracleAddress = await deploy(duelOracleArtifact, [
    admin.address, reporter.address, reporter.address, reporter.address, pauser.address, 60n,
  ]);
  const clobAddress = await deploy(goldClobArtifact, [
    admin.address, operator.address, oracleAddress, admin.address, admin.address, pauser.address,
  ]);
  const skillOracleAddress = await deploy(skillOracleArtifact, [
    parseUnits("100", 18), 7200n, admin.address, admin.address, pauser.address,
  ]);
  const marginTokenAddress = await deploy(mockErc20Artifact, ["USDC", "USDC"]);
  const perpEngineAddress = await deploy(agentPerpEngineArtifact, [
    skillOracleAddress, marginTokenAddress, parseUnits("1000000", 18),
    admin.address, admin.address, pauser.address,
  ]);

  const perpAgentId = hashLabel("sim-agent");

  // Setup: skill oracle, perps market, fund everyone
  await waitReceipt(await admin.wallet.writeContract({
    address: skillOracleAddress, abi: skillOracleArtifact.abi,
    functionName: "updateAgentSkill", args: [perpAgentId, 1500, 0],
    nonce: await nonce(admin.address),
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
    functionName: "createMarket", args: [perpAgentId],
    nonce: await nonce(admin.address),
  }));

  // Fund all accounts with margin tokens and ETH
  for (const w of wallets.slice(4)) {
    await waitReceipt(await admin.wallet.writeContract({
      address: marginTokenAddress, abi: mockErc20Artifact.abi,
      functionName: "mint", args: [w.address, parseUnits("1000000", 18)],
      nonce: await nonce(admin.address),
    }));
    await waitReceipt(await w.wallet.writeContract({
      address: marginTokenAddress, abi: mockErc20Artifact.abi,
      functionName: "approve", args: [perpEngineAddress, parseUnits("999999999", 18)],
      nonce: await nonce(w.address),
    }));
  }

  // Seed insurance fund
  await waitReceipt(await admin.wallet.writeContract({
    address: marginTokenAddress, abi: mockErc20Artifact.abi,
    functionName: "mint", args: [admin.address, parseUnits("1000000", 18)],
    nonce: await nonce(admin.address),
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: marginTokenAddress, abi: mockErc20Artifact.abi,
    functionName: "approve", args: [perpEngineAddress, parseUnits("999999999", 18)],
    nonce: await nonce(admin.address),
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
    functionName: "depositInsuranceFund", args: [perpAgentId, parseUnits("100000", 18)],
    nonce: await nonce(admin.address),
  }));

  console.log("  Contracts deployed + funded");

  // ── Define agents ───────────────────────────────────────────────────────

  const agentDefs: { type: AgentType; label: string; walletIdx: number }[] = [
    { type: "informed", label: "informed-1", walletIdx: 4 },
    { type: "informed", label: "informed-2", walletIdx: 5 },
    { type: "noise", label: "noise-1", walletIdx: 6 },
    { type: "noise", label: "noise-2", walletIdx: 7 },
    { type: "marketMaker", label: "mm-1", walletIdx: 8 },
    { type: "marketMaker", label: "mm-2", walletIdx: 9 },
    { type: "arbitrageur", label: "arb-1", walletIdx: 10 },
    { type: "liquidator", label: "liq-1", walletIdx: 11 },
  ];

  const agents: AgentState[] = agentDefs.map(d => ({
    type: d.type, label: d.label,
    address: wallets[d.walletIdx].address,
    wallet: wallets[d.walletIdx].wallet,
    clobPnl: 0n, perpsPnl: 0n, ordersPlaced: 0, fills: 0, liquidationsExecuted: 0,
  }));

  // ── Agent tick functions ────────────────────────────────────────────────

  async function tickInformed(agent: AgentState, state: ChainState) {
    if (state.currentPhase !== "BETTING") return;
    // Informed trader knows the winner — bets heavily on correct side
    const side = state.trueWinner === "A" ? BUY_SIDE : SELL_SIDE;
    const price = side === BUY_SIDE ? rng.nextInt(550, 750) : rng.nextInt(250, 450);
    const amount = parseUnits(String(rng.nextInt(2, 5)), 18);
    const cost = (amount * BigInt(side === BUY_SIDE ? price : 1000 - price)) / 1000n;
    try {
      await waitReceipt(await agent.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
        args: [state.duelKey as `0x${string}`, 0, side, price, amount, GTC_FLAG],
        value: cost, nonce: await nonce(agent.address),
      }));
      agent.ordersPlaced++;
    } catch {}
  }

  async function tickNoise(agent: AgentState, state: ChainState) {
    if (state.currentPhase !== "BETTING") return;
    if (!rng.nextBool(0.4)) return; // 40% chance to trade per tick
    const side = rng.nextBool() ? BUY_SIDE : SELL_SIDE;
    const price = rng.nextInt(300, 700);
    const amount = parseUnits(String(rng.nextInt(1, 3)), 18);
    const cost = (amount * BigInt(side === BUY_SIDE ? price : 1000 - price)) / 1000n;
    try {
      await waitReceipt(await agent.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
        args: [state.duelKey as `0x${string}`, 0, side, price, amount, GTC_FLAG],
        value: cost, nonce: await nonce(agent.address),
      }));
      agent.ordersPlaced++;
    } catch {}
  }

  async function tickMarketMaker(agent: AgentState, state: ChainState) {
    if (state.currentPhase !== "BETTING") return;
    // Two-sided quotes with inventory-aware spread
    const spread = rng.nextInt(50, 150); // 5-15% spread
    const mid = 500;
    const bid = mid - spread / 2;
    const ask = mid + spread / 2;
    const amount = parseUnits(String(rng.nextInt(3, 8)), 18);

    // Place bid
    try {
      const bidCost = (amount * BigInt(bid)) / 1000n;
      await waitReceipt(await agent.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
        args: [state.duelKey as `0x${string}`, 0, BUY_SIDE, bid, amount, GTC_FLAG],
        value: bidCost, nonce: await nonce(agent.address),
      }));
      agent.ordersPlaced++;
    } catch {}

    // Place ask
    try {
      const askCost = (amount * BigInt(1000 - ask)) / 1000n;
      await waitReceipt(await agent.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
        args: [state.duelKey as `0x${string}`, 0, SELL_SIDE, ask, amount, GTC_FLAG],
        value: askCost, nonce: await nonce(agent.address),
      }));
      agent.ordersPlaced++;
    } catch {}

    // Also maintain a perps position (hedging)
    if (rng.nextBool(0.3)) {
      const perpSide = rng.nextBool() ? 1n : -1n;
      try {
        await waitReceipt(await agent.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "modifyPosition",
          args: [perpAgentId, parseUnits("100", 18), parseUnits("2", 18) * perpSide],
          nonce: await nonce(agent.address),
        }));
      } catch {}
    }
  }

  async function tickArbitrageur(agent: AgentState, state: ChainState) {
    if (state.currentPhase !== "BETTING") return;
    if (!rng.nextBool(0.2)) return; // 20% chance to act

    // Arbitrageur: if CLOB implied probability diverges from perps implied,
    // trade in both to capture the spread
    try {
      const health = await pub.readContract({
        address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
        functionName: "getMarkPrice", args: [perpAgentId],
      }) as bigint;
      const markPrice = Number(formatUnits(health, 18));
      const clobMid = 500; // Assume 50/50 market

      // If perps price > expected, short perps + buy CLOB
      if (markPrice > 110) { // perps overpriced
        try {
          await waitReceipt(await agent.wallet.writeContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "modifyPosition",
            args: [perpAgentId, parseUnits("50", 18), parseUnits("-1", 18)],
            nonce: await nonce(agent.address),
          }));
        } catch {}
        try {
          const cost = (parseUnits("1", 18) * BigInt(clobMid)) / 1000n;
          await waitReceipt(await agent.wallet.writeContract({
            address: clobAddress, abi: goldClobArtifact.abi, functionName: "placeOrder",
            args: [state.duelKey as `0x${string}`, 0, BUY_SIDE, clobMid, parseUnits("1", 18), GTC_FLAG],
            value: cost, nonce: await nonce(agent.address),
          }));
          agent.ordersPlaced++;
        } catch {}
      }
    } catch {}
  }

  async function tickLiquidator(agent: AgentState, state: ChainState) {
    // Liquidator scans all agents for liquidatable perps positions
    for (const target of agents) {
      if (target.type === "liquidator") continue;
      try {
        const health = await pub.readContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "getPositionHealth", args: [perpAgentId, target.address],
        }) as any;
        if (health[5]) { // liquidatable
          await waitReceipt(await agent.wallet.writeContract({
            address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
            functionName: "liquidate", args: [perpAgentId, target.address],
            nonce: await nonce(agent.address),
          }));
          agent.liquidationsExecuted++;
          console.log(`    [liq] Liquidated ${target.label}`);
        }
      } catch {}
    }
  }

  const tickFns: Record<AgentType, (a: AgentState, s: ChainState) => Promise<void>> = {
    informed: tickInformed,
    noise: tickNoise,
    marketMaker: tickMarketMaker,
    arbitrageur: tickArbitrageur,
    liquidator: tickLiquidator,
  };

  // ── Simulation loop ─────────────────────────────────────────────────────

  console.log(`\n=== Starting simulation — ${config.cycles} cycles, seed=${config.seed} ===\n`);

  const allMetrics: CycleMetrics[] = [];

  for (let cycle = 1; cycle <= config.cycles; cycle++) {
    const duelKey = hashLabel(`sim-duel-${cycle}`);
    const trueWinner: "A" | "B" = rng.nextBool() ? "A" : "B";

    console.log(`\n━━━ Cycle ${cycle}/${config.cycles} ━━━ winner=${trueWinner}`);

    // Create duel + CLOB market
    // Save timestamps for reuse in LOCKED transition (oracle enforces immutability)
    let betOpen: bigint, betClose: bigint, duelStartTs: bigint;
    try {
      const blk = await pub.getBlock({ blockTag: "latest" });
      const ts = BigInt(blk.timestamp);
      betOpen = ts;
      betClose = ts + 3600n;
      duelStartTs = ts + 7200n;

      await waitReceipt(await reporter.wallet.writeContract({
        address: oracleAddress, abi: duelOracleArtifact.abi, functionName: "upsertDuel",
        args: [duelKey, keccak256(stringToHex("A")), keccak256(stringToHex("B")),
          betOpen, betClose, duelStartTs, "", 2], // BETTING_OPEN
        nonce: await nonce(reporter.address),
      }));
      await waitReceipt(await operator.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "createMarketForDuel",
        args: [duelKey, 0], nonce: await nonce(operator.address),
      }));
    } catch (err: any) {
      console.log(`  Cycle setup failed: ${err.message?.slice(0, 80)}`);
      continue;
    }

    // Betting phase — run ticks
    const chainState: ChainState = {
      duelKey, trueWinner, currentPhase: "BETTING",
      ticksInPhase: 0, perpMarkPrice: 0n, clobBestBid: 0, clobBestAsk: 0,
    };

    let totalOrders = 0;
    const spreads: number[] = [];

    for (let tick = 0; tick < config.ticksPerPhase; tick++) {
      chainState.ticksInPhase = tick;
      // Run all agents in parallel per tick
      await Promise.allSettled(
        agents.map(a => tickFns[a.type](a, chainState))
      );
      totalOrders = agents.reduce((s, a) => s + a.ordersPlaced, 0);
    }

    // Resolve duel
    chainState.currentPhase = "LOCKED";
    try {
      // Warp to after betClose so we can lock and propose
      // betClose = betOpen + 3600, so warp 3700s from setup
      await fetch(config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_setNextBlockTimestamp", params: [Number(betClose) + 100], id: 1 }),
      });
      await fetch(config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 2 }),
      });

      // Lock — reuse SAME timestamps (oracle enforces immutability after BETTING_OPEN)
      await waitReceipt(await reporter.wallet.writeContract({
        address: oracleAddress, abi: duelOracleArtifact.abi, functionName: "upsertDuel",
        args: [duelKey, keccak256(stringToHex("A")), keccak256(stringToHex("B")),
          betOpen, betClose, duelStartTs, "", 3], // LOCKED
        nonce: await nonce(reporter.address),
      }));

      // Propose
      const winnerSide = trueWinner === "A" ? 1 : 2;
      const postLockBlk = await pub.getBlock({ blockTag: "latest" });
      await waitReceipt(await reporter.wallet.writeContract({
        address: oracleAddress, abi: duelOracleArtifact.abi, functionName: "proposeResult",
        args: [duelKey, winnerSide, 42n, keccak256(stringToHex(`replay-${cycle}`)),
          keccak256(stringToHex(`result-${cycle}`)), BigInt(postLockBlk.timestamp), `sim-${cycle}`],
        nonce: await nonce(reporter.address),
      }));

      // Warp past dispute window (60s configured)
      await fetch(config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_setNextBlockTimestamp", params: [Number(betClose) + 300], id: 3 }),
      });
      await fetch(config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 4 }),
      });

      // Finalize
      await waitReceipt(await reporter.wallet.writeContract({
        address: oracleAddress, abi: duelOracleArtifact.abi, functionName: "finalizeResult",
        args: [duelKey, `sim-finalized-${cycle}`],
        nonce: await nonce(reporter.address),
      }));

      // Sync CLOB
      await waitReceipt(await admin.wallet.writeContract({
        address: clobAddress, abi: goldClobArtifact.abi, functionName: "syncMarketFromOracle",
        args: [duelKey, 0], nonce: await nonce(admin.address),
      }));
    } catch (err: any) {
      console.log(`  Resolution failed: ${err.message?.slice(0, 100)}`);
    }

    chainState.currentPhase = "RESOLVED";

    // Update perps oracle (winner skill goes up)
    const winnerMu = trueWinner === "A" ? 1800 : 1200;
    try {
      await waitReceipt(await admin.wallet.writeContract({
        address: skillOracleAddress, abi: skillOracleArtifact.abi,
        functionName: "updateAgentSkill", args: [perpAgentId, winnerMu, 0],
        nonce: await nonce(admin.address),
      }));
    } catch {}

    // Liquidator tick post-resolution
    for (const a of agents.filter(a => a.type === "liquidator")) {
      await tickLiquidator(a, chainState);
    }

    // Claims — each agent claims CLOB payout
    let totalClaims = 0;
    for (const agent of agents) {
      const balBefore = await pub.getBalance({ address: agent.address });
      try {
        await waitReceipt(await agent.wallet.writeContract({
          address: clobAddress, abi: goldClobArtifact.abi, functionName: "claim",
          args: [duelKey, 0], nonce: await nonce(agent.address),
        }));
        const balAfter = await pub.getBalance({ address: agent.address });
        const payout = balAfter - balBefore;
        agent.clobPnl += payout;
        totalClaims++;
      } catch {}
    }

    // Close remaining perps positions
    for (const agent of agents) {
      try {
        const pos = await pub.readContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "positions", args: [perpAgentId, agent.address],
        }) as any;
        const size = BigInt(pos[0] ?? 0);
        if (size === 0n) continue;

        const healthPre = await pub.readContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "getPositionHealth", args: [perpAgentId, agent.address],
        }) as any;
        const equityPre = BigInt(healthPre[3] ?? 0);
        const marginPre = BigInt(pos[1] ?? 0);

        await waitReceipt(await agent.wallet.writeContract({
          address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
          functionName: "modifyPosition", args: [perpAgentId, 0n, -size],
          nonce: await nonce(agent.address),
        }));
        agent.perpsPnl += equityPre - marginPre;
      } catch {}
    }

    // Read insurance fund state
    let insuranceDelta = "0";
    let badDebt = "0";
    try {
      const mkt = await pub.readContract({
        address: perpEngineAddress, abi: agentPerpEngineArtifact.abi,
        functionName: "markets", args: [perpAgentId],
      }) as any;
      insuranceDelta = formatUnits(BigInt(mkt[9] ?? 0) - parseUnits("100000", 18), 18);
      badDebt = formatUnits(BigInt(mkt[10] ?? 0), 18);
    } catch {}

    // Reset oracle for next cycle
    try {
      await waitReceipt(await admin.wallet.writeContract({
        address: skillOracleAddress, abi: skillOracleArtifact.abi,
        functionName: "updateAgentSkill", args: [perpAgentId, 1500, 0],
        nonce: await nonce(admin.address),
      }));
    } catch {}

    // Collect metrics
    const agentPnl: Record<string, { clob: string; perps: string; total: string }> = {};
    const totalLiqs = agents.reduce((s, a) => s + a.liquidationsExecuted, 0);
    for (const a of agents) {
      agentPnl[a.label] = {
        clob: formatUnits(a.clobPnl, 18),
        perps: formatUnits(a.perpsPnl, 18),
        total: formatUnits(a.clobPnl + a.perpsPnl, 18),
      };
    }

    allMetrics.push({
      cycle, agentPnl, totalOrders,
      totalFills: agents.reduce((s, a) => s + a.fills, 0),
      liquidations: totalLiqs, insuranceDelta, badDebt,
      spreadQuality: spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0,
      winner: trueWinner,
    });

    console.log(`  ✓ Cycle ${cycle}: ${totalOrders} orders, ${totalClaims} claims, ${totalLiqs} liqs, winner=${trueWinner}`);
    for (const a of agents) {
      const total = formatUnits(a.clobPnl + a.perpsPnl, 18);
      if (a.clobPnl !== 0n || a.perpsPnl !== 0n) {
        console.log(`    ${a.label}: clob=${formatUnits(a.clobPnl, 18)} perps=${formatUnits(a.perpsPnl, 18)} total=${total}`);
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  const summary = {
    config,
    cycles: allMetrics.length,
    agentFinalPnl: Object.fromEntries(agents.map(a => [a.label, {
      type: a.type,
      clob: formatUnits(a.clobPnl, 18),
      perps: formatUnits(a.perpsPnl, 18),
      total: formatUnits(a.clobPnl + a.perpsPnl, 18),
      orders: a.ordersPlaced,
      liquidations: a.liquidationsExecuted,
    }])),
    cycleMetrics: allMetrics,
  };

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  console.log("\n" + "═".repeat(60));
  console.log("  SIMULATION RESULTS");
  console.log("═".repeat(60));
  console.log(`  Cycles:        ${allMetrics.length}`);
  console.log(`  Seed:          ${config.seed}`);
  console.log("─".repeat(60));
  console.log("  Agent PnL:");
  for (const a of agents) {
    const total = formatUnits(a.clobPnl + a.perpsPnl, 18);
    console.log(`    ${a.label.padEnd(14)} ${a.type.padEnd(12)} total=${total}  orders=${a.ordersPlaced}  liqs=${a.liquidationsExecuted}`);
  }
  console.log("─".repeat(60));
  console.log(`  Output: ${outDir}`);
  console.log("═".repeat(60));
}

main().catch(err => { console.error("Simulation fatal:", err); process.exit(2); });
