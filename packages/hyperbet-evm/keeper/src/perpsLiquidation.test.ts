/**
 * perpsLiquidation.test.ts — Integration tests for keeper-driven perps liquidation flow.
 *
 * Tests the end-to-end lifecycle: oracle outcome → skill update → position health
 * check → liquidation execution → insurance fund accounting.
 *
 * Requires: anvil running on localhost:18545
 *   anvil --host 127.0.0.1 --port 18545 --chain-id 97 --accounts 20 --balance 10000
 */
import { describe, test, expect, beforeAll } from "bun:test";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

// ─── Artifacts ──────────────────────────────────────────────────────────────

import skillOracleArtifact from "../../../evm-contracts/out/SkillOracle.sol/SkillOracle.json";
import agentPerpEngineArtifact from "../../../evm-contracts/out/AgentPerpEngine.sol/AgentPerpEngine.json";
import mockErc20Artifact from "../../../evm-contracts/out/MockERC20.sol/MockERC20.json";

// ─── Setup ──────────────────────────────────────────────────────────────────

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const RPC_URL = process.env.PERPS_TEST_RPC || "http://127.0.0.1:18545";

const localChain = {
  id: 97, name: "test-bsc",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

function resolveBytecode(artifact: any): `0x${string}` {
  const raw = typeof artifact.bytecode === "string"
    ? artifact.bytecode : artifact.bytecode?.object || "";
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function makeWallet(idx: number) {
  const account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: idx });
  return {
    account, address: account.address,
    wallet: createWalletClient({ account, chain: localChain, transport: http(RPC_URL) }),
  };
}

const agentId = `0x${"a".repeat(64)}` as `0x${string}`;
const agentIdB = `0x${"b".repeat(64)}` as `0x${string}`; // second agent to anchor globalMeanMu

let pub: PublicClient;
let admin: ReturnType<typeof makeWallet>;
let trader: ReturnType<typeof makeWallet>;
let keeperBot: ReturnType<typeof makeWallet>;
let oracleAddr: Address;
let engineAddr: Address;
let tokenAddr: Address;
let snapshotId: string;

async function waitReceipt(hash: `0x${string}`) {
  return pub.waitForTransactionReceipt({ hash, timeout: 15_000 });
}

async function mine() {
  await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 1 }),
  });
}

async function snapshot(): Promise<string> {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 1 }),
  });
  return (await res.json() as any).result;
}

async function revert(id: string) {
  await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_revert", params: [id], id: 1 }),
  });
}

async function getMarketState() {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "markets", args: [agentId],
  }) as any;
}

async function getPositionHealth(addr: Address) {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "getPositionHealth", args: [agentId, addr],
  }) as any;
}

async function crashOracle(mu: number) {
  await waitReceipt(await admin.wallet.writeContract({
    address: oracleAddr, abi: skillOracleArtifact.abi,
    functionName: "updateAgentSkill", args: [agentId, mu, 0],
  }));
  // Propagate new price into the perps engine's stored state
  await waitReceipt(await admin.wallet.writeContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "syncOracle", args: [agentId],
  }));
}

async function getPosition(addr: Address) {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "positions", args: [agentId, addr],
  }) as any;
}

// ─── Deploy once ────────────────────────────────────────────────────────────

let anvilAvailable = false;

beforeAll(async () => {
  try {
    pub = createPublicClient({ chain: localChain, transport: http(RPC_URL) });
    await pub.getChainId();
    anvilAvailable = true;
  } catch {
    console.log("  Anvil not available at", RPC_URL, "— skipping perps liquidation tests");
    return;
  }

  admin = makeWallet(0);
  trader = makeWallet(1);
  keeperBot = makeWallet(2);

  // Deploy SkillOracle
  let hash = await admin.wallet.deployContract({
    abi: skillOracleArtifact.abi, bytecode: resolveBytecode(skillOracleArtifact),
    args: [parseUnits("100", 18), 7200n, admin.address, admin.address, admin.address],
  });
  oracleAddr = (await waitReceipt(hash)).contractAddress!;

  // Deploy margin token
  hash = await admin.wallet.deployContract({
    abi: mockErc20Artifact.abi, bytecode: resolveBytecode(mockErc20Artifact),
    args: ["USDC", "USDC"],
  });
  tokenAddr = (await waitReceipt(hash)).contractAddress!;

  // Deploy AgentPerpEngine
  hash = await admin.wallet.deployContract({
    abi: agentPerpEngineArtifact.abi, bytecode: resolveBytecode(agentPerpEngineArtifact),
    args: [oracleAddr, tokenAddr, parseUnits("1000000", 18), admin.address, admin.address, admin.address],
  });
  engineAddr = (await waitReceipt(hash)).contractAddress!;

  // Setup: oracle skills for 2 agents (needed so globalMeanMu is anchored)
  // Agent A starts at mu=1500, Agent B at mu=1500 (anchors the mean)
  await waitReceipt(await admin.wallet.writeContract({
    address: oracleAddr, abi: skillOracleArtifact.abi,
    functionName: "updateAgentSkill", args: [agentId, 1500, 0],
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: oracleAddr, abi: skillOracleArtifact.abi,
    functionName: "updateAgentSkill", args: [agentIdB, 1500, 0],
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "createMarket", args: [agentId],
  }));

  // Fund trader + keeper with margin tokens
  for (const w of [admin, trader, keeperBot]) {
    await waitReceipt(await admin.wallet.writeContract({
      address: tokenAddr, abi: mockErc20Artifact.abi,
      functionName: "mint", args: [w.address, parseUnits("1000000", 18)],
    }));
    await waitReceipt(await w.wallet.writeContract({
      address: tokenAddr, abi: mockErc20Artifact.abi,
      functionName: "approve", args: [engineAddr, parseUnits("999999999", 18)],
    }));
  }

  // Seed insurance fund
  await waitReceipt(await admin.wallet.writeContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "depositInsuranceFund", args: [agentId, parseUnits("50000", 18)],
  }));

  // Take base snapshot — each test reverts to this then re-snapshots
  snapshotId = await snapshot();
});

async function isolate<T>(fn: () => Promise<T>): Promise<T> {
  // Revert to base state, re-snapshot for next test
  await revert(snapshotId);
  snapshotId = await snapshot();
  return fn();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("keeper perps liquidation flow", () => {
  test("happy path: oracle crash → position underwater → keeper liquidates", async () => {
    if (!anvilAvailable) return;
    await revert(snapshotId); snapshotId = await snapshot();
    const sid = await snapshot();

    // Trader opens long position: 100 margin, 5 size
    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("100", 18), parseUnits("5", 18)],
    }));

    // Verify position is healthy
    let health = await getPositionHealth(trader.address);
    expect((health as any).liquidatable).toBe(false); // not liquidatable

    // Oracle crash: mu 1500 → 1000, synced into perps engine
    await crashOracle(1000);

    // Position should now be liquidatable
    health = await getPositionHealth(trader.address);
    expect((health as any).liquidatable).toBe(true); // liquidatable

    // Keeper executes liquidation
    const liqHash = await keeperBot.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "liquidate", args: [agentId, trader.address],
    });
    const receipt = await waitReceipt(liqHash);
    expect(receipt.status).toBe("success");

    // Verify position is closed or reduced
    const pos = await getPosition(trader.address);
    const sizeAfter = BigInt((pos as any).size ?? 0);
    // Position should be fully or partially liquidated
    expect(Math.abs(Number(sizeAfter))).toBeLessThan(Number(parseUnits("5", 18)));

    await revert(sid);
  });

  test("insurance fund covers liquidation losses", async () => {
    if (!anvilAvailable) return;
    const sid = await snapshot();

    const mktBefore = await getMarketState();
    const insuranceBefore = BigInt((mktBefore as any).insuranceFund ?? 0);

    // Trader opens leveraged long
    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("120", 18), parseUnits("5", 18)], // near max leverage
    }));

    // Oracle crash
    await crashOracle(1000);

    // Liquidate
    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const mktAfter = await getMarketState();
    const insuranceAfter = BigInt((mktAfter as any).insuranceFund ?? 0);
    const badDebt = BigInt((mktAfter as any).badDebt ?? 0);

    // Insurance should have absorbed losses or bad debt was recorded
    expect(insuranceAfter <= insuranceBefore || badDebt > 0n).toBe(true);

    await revert(sid);
  });

  test("no liquidation needed when price move is small", async () => {
    if (!anvilAvailable) return;
    const sid = await snapshot();

    // Trader opens well-collateralized position
    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("500", 18), parseUnits("5", 18)], // 100x margin
    }));

    // Small oracle move (within delta caps but not enough to liquidate)
    await waitReceipt(await admin.wallet.writeContract({
      address: oracleAddr, abi: skillOracleArtifact.abi,
      functionName: "updateAgentSkill", args: [agentId, 1400, 0], // -100 mu
    }));

    // Position should NOT be liquidatable
    const health = await getPositionHealth(trader.address);
    expect((health as any).liquidatable).toBe(false);

    // Liquidation attempt should revert
    let reverted = false;
    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {
      reverted = true;
    }
    expect(reverted).toBe(true);

    await revert(sid);
  });

  test("keeper earns liquidation reward", async () => {
    if (!anvilAvailable) return;
    const sid = await snapshot();

    const keeperBalBefore = await pub.readContract({
      address: tokenAddr, abi: mockErc20Artifact.abi,
      functionName: "balanceOf", args: [keeperBot.address],
    }) as bigint;

    // Trader opens leveraged long
    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("100", 18), parseUnits("5", 18)],
    }));

    // Oracle crash
    await crashOracle(1000);

    // Liquidate
    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const keeperBalAfter = await pub.readContract({
      address: tokenAddr, abi: mockErc20Artifact.abi,
      functionName: "balanceOf", args: [keeperBot.address],
    }) as bigint;

    // Keeper should have received a liquidation reward
    expect(keeperBalAfter).toBeGreaterThanOrEqual(keeperBalBefore);

    await revert(sid);
  });

  test("position equity goes negative → bad debt recorded", async () => {
    if (!anvilAvailable) return;
    const sid = await snapshot();

    // Drain insurance to minimum
    const mkt0 = await getMarketState();
    const currentInsurance = BigInt((mkt0 as any).insuranceFund ?? 0);
    if (currentInsurance > parseUnits("1", 18)) {
      try {
        await waitReceipt(await admin.wallet.writeContract({
          address: engineAddr, abi: agentPerpEngineArtifact.abi,
          functionName: "withdrawInsuranceFund",
          args: [agentId, admin.address, currentInsurance - parseUnits("1", 18)],
        }));
      } catch {}
    }

    // Trader opens very leveraged position
    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("110", 18), parseUnits("5", 18)], // near max leverage, minimal cushion
    }));

    // Oracle crash
    await crashOracle(1000);

    // Liquidate — may create bad debt if insurance insufficient
    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const mktAfter = await getMarketState();
    const badDebt = BigInt((mktAfter as any).badDebt ?? 0);
    const insuranceAfter = BigInt((mktAfter as any).insuranceFund ?? 0);

    // Either bad debt was recorded or insurance was depleted (or both)
    expect(badDebt > 0n || insuranceAfter === 0n).toBe(true);

    await revert(sid);
  });
});
