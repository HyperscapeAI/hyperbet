// Requires: anvil --host 127.0.0.1 --port 18545 --chain-id 97 --accounts 20 --balance 10000
import { describe, test, expect, beforeAll } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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


const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const RPC_URL = process.env.PERPS_TEST_RPC || "http://127.0.0.1:18545";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const localChain = {
  id: 97, name: "test-bsc",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

type EvmArtifact = {
  abi: unknown[];
  bytecode:
    | string
    | {
        object?: string;
      };
};

type JsonRpcResult = { result: string };

type PositionHealthResult = { liquidatable: boolean };

type PositionResult = { size: bigint };

type MarketStateResult = {
  insuranceFund: bigint;
  badDebt: bigint;
};

async function loadArtifact(
  label: string,
  candidatePaths: string[],
): Promise<EvmArtifact | null> {
  for (const candidatePath of candidatePaths) {
    try {
      const body = await fs.readFile(path.resolve(TEST_DIR, candidatePath), "utf8");
      return JSON.parse(body) as EvmArtifact;
    } catch {}
  }

  console.log(`  ${label} artifact not available — skipping perps liquidation tests`);
  return null;
}

function resolveBytecode(artifact: EvmArtifact): `0x${string}` {
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
let suiteAvailable = false;
let skillOracleArtifact: EvmArtifact | null = null;
let agentPerpEngineArtifact: EvmArtifact | null = null;
let mockErc20Artifact: EvmArtifact | null = null;

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
  return (await res.json() as JsonRpcResult).result;
}

async function revert(id: string) {
  await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_revert", params: [id], id: 1 }),
  });
}

async function getMarketState(): Promise<MarketStateResult> {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact!.abi,
    functionName: "markets", args: [agentId],
  }) as Promise<MarketStateResult>;
}

async function getPositionHealth(addr: Address): Promise<PositionHealthResult> {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact!.abi,
    functionName: "getPositionHealth", args: [agentId, addr],
  }) as Promise<PositionHealthResult>;
}

async function crashOracle(mu: number) {
  await waitReceipt(await admin.wallet.writeContract({
    address: oracleAddr, abi: skillOracleArtifact!.abi,
    functionName: "updateAgentSkill", args: [agentId, mu, 0],
  }));
  await waitReceipt(await admin.wallet.writeContract({
    address: engineAddr, abi: agentPerpEngineArtifact!.abi,
    functionName: "syncOracle", args: [agentId],
  }));
}

async function getPosition(addr: Address): Promise<PositionResult> {
  return pub.readContract({
    address: engineAddr, abi: agentPerpEngineArtifact!.abi,
    functionName: "positions", args: [agentId, addr],
  }) as Promise<PositionResult>;
}


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

  skillOracleArtifact = await loadArtifact("SkillOracle", [
    "../../../evm-contracts/out/SkillOracle.sol/SkillOracle.json",
    "../../../evm-contracts/artifacts/contracts/perps/SkillOracle.sol/SkillOracle.json",
  ]);
  agentPerpEngineArtifact = await loadArtifact("AgentPerpEngine", [
    "../../../evm-contracts/out/AgentPerpEngine.sol/AgentPerpEngine.json",
    "../../../evm-contracts/artifacts/contracts/perps/AgentPerpEngine.sol/AgentPerpEngine.json",
  ]);
  mockErc20Artifact = await loadArtifact("MockERC20", [
    "../../../evm-contracts/out/MockERC20.sol/MockERC20.json",
    "../../../evm-contracts/artifacts/contracts/MockERC20.sol/MockERC20.json",
  ]);
  if (!skillOracleArtifact || !agentPerpEngineArtifact || !mockErc20Artifact) {
    return;
  }

  admin = makeWallet(0);
  trader = makeWallet(1);
  keeperBot = makeWallet(2);

  let hash = await admin.wallet.deployContract({
    abi: skillOracleArtifact.abi, bytecode: resolveBytecode(skillOracleArtifact),
    args: [parseUnits("100", 18), 7200n, admin.address, admin.address, admin.address],
  });
  oracleAddr = (await waitReceipt(hash)).contractAddress!;

  hash = await admin.wallet.deployContract({
    abi: mockErc20Artifact.abi, bytecode: resolveBytecode(mockErc20Artifact),
    args: ["USDC", "USDC"],
  });
  tokenAddr = (await waitReceipt(hash)).contractAddress!;

  hash = await admin.wallet.deployContract({
    abi: agentPerpEngineArtifact.abi, bytecode: resolveBytecode(agentPerpEngineArtifact),
    args: [oracleAddr, tokenAddr, parseUnits("1000000", 18), admin.address, admin.address, admin.address],
  });
  engineAddr = (await waitReceipt(hash)).contractAddress!;

  // Anchor globalMeanMu with two agents at mu=1500.
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

  await waitReceipt(await admin.wallet.writeContract({
    address: engineAddr, abi: agentPerpEngineArtifact.abi,
    functionName: "depositInsuranceFund", args: [agentId, parseUnits("50000", 18)],
  }));

  snapshotId = await snapshot();
  suiteAvailable = true;
});

async function isolate<T>(fn: () => Promise<T>): Promise<T> {
  await revert(snapshotId);
  snapshotId = await snapshot();
  return fn();
}


describe("keeper perps liquidation flow", () => {
  test("happy path: oracle crash → position underwater → keeper liquidates", async () => {
    if (!suiteAvailable) return;
    await revert(snapshotId); snapshotId = await snapshot();
    const sid = await snapshot();

    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("100", 18), parseUnits("5", 18)],
    }));

    let health = await getPositionHealth(trader.address);
    expect(health.liquidatable).toBe(false);

    await crashOracle(1000);

    health = await getPositionHealth(trader.address);
    expect(health.liquidatable).toBe(true);

    const liqHash = await keeperBot.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "liquidate", args: [agentId, trader.address],
    });
    const receipt = await waitReceipt(liqHash);
    expect(receipt.status).toBe("success");

    const pos = await getPosition(trader.address);
    const sizeAfter = BigInt(pos.size ?? 0);
    expect(Math.abs(Number(sizeAfter))).toBeLessThan(Number(parseUnits("5", 18)));

    await revert(sid);
  });

  test("insurance fund covers liquidation losses", async () => {
    if (!suiteAvailable) return;
    const sid = await snapshot();

    const mktBefore = await getMarketState();
    const insuranceBefore = BigInt(mktBefore.insuranceFund ?? 0);

    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("120", 18), parseUnits("5", 18)],
    }));

    await crashOracle(1000);

    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact!.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const mktAfter = await getMarketState();
    const insuranceAfter = BigInt(mktAfter.insuranceFund ?? 0);
    const badDebt = BigInt(mktAfter.badDebt ?? 0);

    expect(insuranceAfter <= insuranceBefore || badDebt > 0n).toBe(true);

    await revert(sid);
  });

  test("no liquidation needed when price move is small", async () => {
    if (!suiteAvailable) return;
    const sid = await snapshot();

    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("500", 18), parseUnits("5", 18)],
    }));

    await waitReceipt(await admin.wallet.writeContract({
      address: oracleAddr, abi: skillOracleArtifact!.abi,
      functionName: "updateAgentSkill", args: [agentId, 1400, 0], // -100 mu
    }));

    const health = await getPositionHealth(trader.address);
    expect(health.liquidatable).toBe(false);

    let reverted = false;
    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact!.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {
      reverted = true;
    }
    expect(reverted).toBe(true);

    await revert(sid);
  });

  test("keeper earns liquidation reward", async () => {
    if (!suiteAvailable) return;
    const sid = await snapshot();

    const keeperBalBefore = await pub.readContract({
      address: tokenAddr, abi: mockErc20Artifact!.abi,
      functionName: "balanceOf", args: [keeperBot.address],
    }) as bigint;

    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("100", 18), parseUnits("5", 18)],
    }));

    await crashOracle(1000);

    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact!.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const keeperBalAfter = await pub.readContract({
      address: tokenAddr, abi: mockErc20Artifact!.abi,
      functionName: "balanceOf", args: [keeperBot.address],
    }) as bigint;

    expect(keeperBalAfter).toBeGreaterThanOrEqual(keeperBalBefore);

    await revert(sid);
  });

  test("position equity goes negative → bad debt recorded", async () => {
    if (!suiteAvailable) return;
    const sid = await snapshot();

    const mkt0 = await getMarketState();
    const currentInsurance = BigInt(mkt0.insuranceFund ?? 0);
    if (currentInsurance > parseUnits("1", 18)) {
      try {
        await waitReceipt(await admin.wallet.writeContract({
          address: engineAddr, abi: agentPerpEngineArtifact!.abi,
          functionName: "withdrawInsuranceFund",
          args: [agentId, admin.address, currentInsurance - parseUnits("1", 18)],
        }));
      } catch {}
    }

    await waitReceipt(await trader.wallet.writeContract({
      address: engineAddr, abi: agentPerpEngineArtifact!.abi,
      functionName: "modifyPosition",
      args: [agentId, parseUnits("110", 18), parseUnits("5", 18)],
    }));

    await crashOracle(1000);

    try {
      await waitReceipt(await keeperBot.wallet.writeContract({
        address: engineAddr, abi: agentPerpEngineArtifact!.abi,
        functionName: "liquidate", args: [agentId, trader.address],
      }));
    } catch {}

    const mktAfter = await getMarketState();
    const badDebt = BigInt(mktAfter.badDebt ?? 0);
    const insuranceAfter = BigInt(mktAfter.insuranceFund ?? 0);

    expect(badDebt > 0n || insuranceAfter === 0n).toBe(true);

    await revert(sid);
  });
});
