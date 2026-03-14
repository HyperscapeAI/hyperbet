import { ethers } from "hardhat";

import { deployDuelOutcomeOracle, deployLvrRouter } from "../typed-contracts";

const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const SIDE_A = 1;
const BUY_SIDE = 1;
const SELL_SIDE = 2;

function duelKey(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function participantHash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  return (amount * component) / 1000n;
}

async function main() {
  const [admin, operator, reporter, treasury, marketMaker, traderA, traderB] =
    await ethers.getSigners();

  console.log("[simulate-localnet] deploying duel oracle and CLOB...");
  const oracle = await deployDuelOutcomeOracle(admin.address, reporter.address, admin);
  await oracle.waitForDeployment();

  const clob = await deployLvrRouter(
    admin.address,
    operator.address,
    await oracle.getAddress(),
    treasury.address,
    marketMaker.address,
    admin,
  );
  await clob.waitForDeployment();

  console.log("[simulate-localnet] duel oracle:", await oracle.getAddress());
  console.log("[simulate-localnet] gold clob:", await clob.getAddress());

  const duel = duelKey("localnet-duel-1");
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  console.log("[simulate-localnet] opening duel lifecycle...");
  await oracle.connect(reporter).upsertDuel(
    duel,
    participantHash("agent-alpha"),
    participantHash("agent-beta"),
    now,
    now + 60n,
    now + 120n,
    "localnet-simulation",
    DUEL_STATUS_BETTING_OPEN,
  );

  await clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

  const makerAmount = 1_000n;
  await clob.connect(traderA).placeOrder(
    duel,
    MARKET_KIND_DUEL_WINNER,
    SELL_SIDE,
    600,
    makerAmount,
    {
      value: quoteCost(SELL_SIDE, 600, makerAmount) + 20n,
    },
  );

  await clob.connect(traderB).placeOrder(
    duel,
    MARKET_KIND_DUEL_WINNER,
    BUY_SIDE,
    600,
    makerAmount,
    {
      value: quoteCost(BUY_SIDE, 600, makerAmount) + 20n,
    },
  );

  const marketBefore = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
  console.log("[simulate-localnet] matched market totals:", {
    totalAShares: marketBefore.totalAShares.toString(),
    totalBShares: marketBefore.totalBShares.toString(),
    bestBid: marketBefore.bestBid.toString(),
    bestAsk: marketBefore.bestAsk.toString(),
  });

  console.log("[simulate-localnet] resolving duel...");
  await oracle.connect(reporter).reportResult(
    duel,
    SIDE_A,
    42,
    ethers.keccak256(ethers.toUtf8Bytes("replay")),
    ethers.keccak256(ethers.toUtf8Bytes("result")),
    now + 180n,
    "resolved",
  );
  await clob.connect(operator).syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);

  console.log("[simulate-localnet] claiming winner...");
  await clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER);

  const marketAfter = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
  console.log("[simulate-localnet] final market status:", {
    status: marketAfter.status.toString(),
    winner: marketAfter.winner.toString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
