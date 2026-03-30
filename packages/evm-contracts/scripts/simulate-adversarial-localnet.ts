import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ContractFactory,
  type InterfaceAbi,
  JsonRpcProvider,
  ethers,
  type JsonRpcSigner,
} from "ethers";

import type {
  DuelOutcomeOracleContract,
  GoldClobContract,
} from "../typed-contracts";

type Artifact = {
  abi: InterfaceAbi;
  bytecode: string | { object: string };
};

type ScenarioResult = {
  name: string;
  details: Record<string, string | number | boolean>;
};

type Fixture = {
  provider: JsonRpcProvider;
  admin: JsonRpcSigner;
  operator: JsonRpcSigner;
  reporter: JsonRpcSigner;
  finalizer: JsonRpcSigner;
  treasury: JsonRpcSigner;
  marketMaker: JsonRpcSigner;
  makerOne: JsonRpcSigner;
  makerTwo: JsonRpcSigner;
  taker: JsonRpcSigner;
  mevBot: JsonRpcSigner;
  retailBot: JsonRpcSigner;
  arbBot: JsonRpcSigner;
  attacker: JsonRpcSigner;
  oracle: DuelOutcomeOracleContract;
  clob: GoldClobContract;
};

const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const DUEL_STATUS_LOCKED = 3;
const SIDE_A = 1;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const ORDER_AMOUNT = 1_000n;
const ORDER_FLAG_GTC = 0x01;

function loadArtifact(projectDir: string, name: string): Artifact {
  return JSON.parse(
    readFileSync(
      join(projectDir, "out", `${name}.sol`, `${name}.json`),
      "utf8",
    ),
  ) as Artifact;
}

function duelKey(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function hashParticipant(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function normalizeBytecode(bytecode: Artifact["bytecode"]): string {
  const resolved = typeof bytecode === "string" ? bytecode : bytecode.object;
  return resolved.startsWith("0x") ? resolved : `0x${resolved}`;
}

async function deployFixture(
  provider: JsonRpcProvider,
  projectDir: string,
): Promise<Fixture> {
  const signers = await Promise.all(
    Array.from({ length: 13 }, (_, index) => provider.getSigner(index)),
  );
  const [
    admin,
    operator,
    reporter,
    finalizer,
    challenger,
    pauser,
    treasury,
    marketMaker,
    makerOne,
    makerTwo,
    taker,
    mevBot,
    retailBot,
  ] = signers;
  const arbBot = taker;
  const attacker = retailBot;

  const oracleArtifact = loadArtifact(projectDir, "DuelOutcomeOracle");
  const clobArtifact = loadArtifact(projectDir, "GoldClob");

  const oracleFactory = new ContractFactory(
    oracleArtifact.abi,
    normalizeBytecode(oracleArtifact.bytecode),
    admin,
  );
  const reporterAddress = await reporter.getAddress();
  const oracle = (await oracleFactory.deploy(
    await admin.getAddress(),
    reporterAddress,
    await finalizer.getAddress(),
    await challenger.getAddress(),
    await pauser.getAddress(),
    3_600,
  )) as DuelOutcomeOracleContract;
  await oracle.waitForDeployment();

  const clobFactory = new ContractFactory(
    clobArtifact.abi,
    normalizeBytecode(clobArtifact.bytecode),
    admin,
  );
  const clob = (await clobFactory.deploy(
    await admin.getAddress(),
    await operator.getAddress(),
    await oracle.getAddress(),
    await treasury.getAddress(),
    await marketMaker.getAddress(),
    await pauser.getAddress(),
  )) as GoldClobContract;
  await clob.waitForDeployment();

  return {
    provider,
    admin,
    operator,
    reporter,
    finalizer,
    treasury,
    marketMaker,
    makerOne,
    makerTwo,
    taker,
    mevBot,
    retailBot,
    arbBot,
    attacker,
    oracle,
    clob,
  };
}

async function openMarket(fixture: Fixture, label: string): Promise<string> {
  const duel = duelKey(label);
  const latestBlock = await fixture.provider.getBlock("latest");
  const now = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));

  await (
    await fixture.oracle.connect(fixture.reporter).upsertDuel(
      duel,
      hashParticipant(`${label}:a`),
      hashParticipant(`${label}:b`),
      now,
      now + 60n,
      now + 120n,
      `local://${label}`,
      DUEL_STATUS_BETTING_OPEN,
    )
  ).wait();
  await (
    await fixture.clob
      .connect(fixture.operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER)
  ).wait();

  return duel;
}

async function lockMarket(
  fixture: Fixture,
  duel: string,
  label: string,
): Promise<void> {
  // Read stored duel to preserve immutable participant hashes and timing (FIX-4)
  const storedDuel = await fixture.oracle.getDuel(duel);

  // Advance past betCloseTs so the lock transition is valid
  const betClose = Number(storedDuel.betCloseTs);
  await fixture.provider.send("evm_setNextBlockTimestamp", [betClose + 1]);
  await fixture.provider.send("evm_mine", []);

  await (
    await fixture.oracle.connect(fixture.reporter).upsertDuel(
      duel,
      storedDuel.participantAHash,
      storedDuel.participantBHash,
      storedDuel.betOpenTs,
      storedDuel.betCloseTs,
      storedDuel.duelStartTs,
      `locked://${label}`,
      DUEL_STATUS_LOCKED,
    )
  ).wait();
}

async function runLowLiquidityScenario(
  fixture: Fixture,
): Promise<ScenarioResult> {
  const duel = await openMarket(fixture, "low-liquidity");

  await (
    await fixture.clob.connect(fixture.makerOne).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      650,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(SELL_SIDE, 650, ORDER_AMOUNT) + 20n },
    )
  ).wait();
  await (
    await fixture.clob.connect(fixture.makerTwo).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      650,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(SELL_SIDE, 650, ORDER_AMOUNT) + 20n },
    )
  ).wait();
  await (
    await fixture.clob.connect(fixture.taker).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      650,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(BUY_SIDE, 650, ORDER_AMOUNT) + 20n },
    )
  ).wait();

  const market = await fixture.clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
  const queue = await fixture.clob.getPriceLevel(
    duel,
    MARKET_KIND_DUEL_WINNER,
    SELL_SIDE,
    650,
  );
  const marketKey = await fixture.clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
  const takerPosition = await fixture.clob.positions(
    marketKey,
    await fixture.taker.getAddress(),
  );

  if (queue[0] !== 2n || queue[2] !== ORDER_AMOUNT) {
    throw new Error(`unexpected low-liquidity queue state: ${queue.join(",")}`);
  }

  return {
    name: "low_liquidity_fifo",
    details: {
      bestAsk: market.bestAsk.toString(),
      restingHeadOrderId: queue[0].toString(),
      restingAmount: queue[2].toString(),
      takerAShares: takerPosition.aShares.toString(),
    },
  };
}

async function runMevScenario(fixture: Fixture): Promise<ScenarioResult> {
  const duel = await openMarket(fixture, "mev-race");

  await (
    await fixture.clob.connect(fixture.makerOne).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      450,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(SELL_SIDE, 450, ORDER_AMOUNT) + 20n },
    )
  ).wait();

  await fixture.provider.send("anvil_setAutomine", [false]);
  try {
    const mevTx = await fixture.clob.connect(fixture.mevBot).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      450,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(BUY_SIDE, 450, ORDER_AMOUNT) + 20n },
    );
    const retailTx = await fixture.clob.connect(fixture.retailBot).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      450,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(BUY_SIDE, 450, ORDER_AMOUNT) + 20n },
    );
    await fixture.provider.send("evm_mine", []);
    await Promise.all([mevTx.wait(), retailTx.wait()]);
  } finally {
    await fixture.provider.send("anvil_setAutomine", [true]);
  }

  const market = await fixture.clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
  const queue = await fixture.clob.getPriceLevel(
    duel,
    MARKET_KIND_DUEL_WINNER,
    BUY_SIDE,
    450,
  );
  const marketKey = await fixture.clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
  const mevPosition = await fixture.clob.positions(
    marketKey,
    await fixture.mevBot.getAddress(),
  );
  const retailPosition = await fixture.clob.positions(
    marketKey,
    await fixture.retailBot.getAddress(),
  );

  if (mevPosition.aShares !== ORDER_AMOUNT || retailPosition.aShares !== 0n) {
    throw new Error("MEV ordering scenario did not prioritize the first taker");
  }

  return {
    name: "same_block_mev_priority",
    details: {
      mevAShares: mevPosition.aShares.toString(),
      retailAShares: retailPosition.aShares.toString(),
      restingBidHead: queue[0].toString(),
      restingBidAmount: queue[2].toString(),
      bestBid: market.bestBid.toString(),
    },
  };
}

async function runArbitrageScenario(
  fixture: Fixture,
): Promise<ScenarioResult> {
  const duel = await openMarket(fixture, "arbitrage");
  const marketKey = await fixture.clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);

  await (
    await fixture.clob.connect(fixture.makerOne).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      700,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(BUY_SIDE, 700, ORDER_AMOUNT) + 20n },
    )
  ).wait();
  await (
    await fixture.clob.connect(fixture.arbBot).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      700,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(SELL_SIDE, 700, ORDER_AMOUNT) + 20n },
    )
  ).wait();
  await (
    await fixture.clob.connect(fixture.makerTwo).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      300,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(SELL_SIDE, 300, ORDER_AMOUNT) + 20n },
    )
  ).wait();
  await (
    await fixture.clob.connect(fixture.arbBot).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      300,
      ORDER_AMOUNT,
      ORDER_FLAG_GTC,
      { value: quoteCost(BUY_SIDE, 300, ORDER_AMOUNT) + 20n },
    )
  ).wait();

  const position = await fixture.clob.positions(
    marketKey,
    await fixture.arbBot.getAddress(),
  );
  const combinedStake = position.aStake + position.bStake;
  if (position.aShares !== ORDER_AMOUNT || position.bShares !== ORDER_AMOUNT) {
    throw new Error("arb bot did not acquire both sides");
  }
  if (combinedStake >= ORDER_AMOUNT) {
    throw new Error(`arb bot stake is not discounted: ${combinedStake.toString()}`);
  }

  const latestBlock = await fixture.provider.getBlock("latest");
  const now = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
  await lockMarket(fixture, duel, "arbitrage");
  await (
    await fixture.oracle.connect(fixture.reporter).proposeResult(
      duel,
      SIDE_A,
      77,
      ethers.keccak256(ethers.toUtf8Bytes("arb-replay")),
      ethers.keccak256(ethers.toUtf8Bytes("arb-result")),
      now + 180n,
      "arb-resolved",
    )
  ).wait();
  await fixture.provider.send("evm_increaseTime", [3_600]);
  await fixture.provider.send("evm_mine", []);
  await (await fixture.oracle.connect(fixture.finalizer).finalizeResult(duel, "finalized")).wait();
  await (
    await fixture.clob
      .connect(fixture.operator)
      .syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER)
  ).wait();
  await (
    await fixture.clob
      .connect(fixture.arbBot)
      .claim(duel, MARKET_KIND_DUEL_WINNER)
  ).wait();

  const settledPosition = await fixture.clob.positions(
    marketKey,
    await fixture.arbBot.getAddress(),
  );

  return {
    name: "crossed_book_arbitrage",
    details: {
      combinedStake: combinedStake.toString(),
      theoreticalGrossEdge: (ORDER_AMOUNT - combinedStake).toString(),
      clearedAShares: settledPosition.aShares.toString(),
      clearedBShares: settledPosition.bShares.toString(),
    },
  };
}

async function runAttackScenario(fixture: Fixture): Promise<ScenarioResult> {
  const duel = await openMarket(fixture, "attack");
  const latestBlock = await fixture.provider.getBlock("latest");
  const now = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));

  let rejected = false;
  try {
    await (
      await fixture.oracle.connect(fixture.attacker).proposeResult(
        duel,
        SIDE_A,
        13,
        ethers.keccak256(ethers.toUtf8Bytes("attack-replay")),
        ethers.keccak256(ethers.toUtf8Bytes("attack-result")),
        now + 90n,
        "attack",
      )
    ).wait();
  } catch {
    rejected = true;
  }

  if (!rejected) {
    throw new Error("unauthorized oracle reporter unexpectedly succeeded");
  }

  return {
    name: "unauthorized_oracle_attack",
    details: {
      rejected,
      duel,
    },
  };
}

async function main(): Promise<void> {
  const projectDir = process.cwd();
  const rpcUrl = process.env.ANVIL_RPC_URL || "http://127.0.0.1:18545";
  const chainId = Number(process.env.ANVIL_CHAIN_ID || 31337);
  const outputDir =
    process.env.HYPERBET_SIMULATION_OUTPUT_DIR ||
    join(projectDir, "simulations");
  const provider = new JsonRpcProvider(rpcUrl, chainId);
  const fixture = await deployFixture(provider, projectDir);

  const scenarios = [
    await runLowLiquidityScenario(fixture),
    await runMevScenario(fixture),
    await runArbitrageScenario(fixture),
    await runAttackScenario(fixture),
  ];

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "evm-localnet-adversarial-report.json");
  const network = await provider.getNetwork();
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        network: {
          chainId: network.chainId.toString(),
          name: network.name,
        },
        oracle: await fixture.oracle.getAddress(),
        clob: await fixture.clob.getAddress(),
        scenarios,
      },
      null,
      2,
    ),
  );

  console.log(
    `[simulate-adversarial] completed ${scenarios.length} scenarios -> ${outputPath}`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
