import { expect } from "chai";
import { ethers } from "hardhat";

import {
  deployDuelOutcomeOracle,
  deployGoldClob,
  type DuelOutcomeOracleContract,
  type GoldClobContract,
} from "../typed-contracts";

const MARKET_KIND_DUEL_WINNER = 0;
const DUEL_STATUS_BETTING_OPEN = 2;
const DUEL_STATUS_LOCKED = 3;
const SIDE_A = 1;
const SIDE_B = 2;
const BUY_SIDE = 1;
const SELL_SIDE = 2;

function duelKey(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function hashParticipant(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function quoteCost(side: number, price: number, amount: bigint): bigint {
  const component = BigInt(side === BUY_SIDE ? price : 1000 - price);
  const total = amount * component;
  expect(total % 1000n).to.equal(0n);
  return total / 1000n;
}

async function expectTxSuccess(
  txPromise: Promise<{ wait: () => Promise<{ status: number | null } | null> }>,
) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  expect(receipt?.status).to.equal(1);
}

async function deployFixture() {
  const [admin, operator, reporter, treasury, marketMaker, traderA, traderB] =
    await ethers.getSigners();

  const oracle = await deployDuelOutcomeOracle(
    admin.address,
    reporter.address,
    admin,
  );
  await oracle.waitForDeployment();

  const clob = await deployGoldClob(
    admin.address,
    operator.address,
    await oracle.getAddress(),
    treasury.address,
    marketMaker.address,
    admin,
  );
  await clob.waitForDeployment();

  return {
    admin,
    operator,
    reporter,
    treasury,
    marketMaker,
    traderA,
    traderB,
    oracle,
    clob,
  };
}

async function upsertOpenDuel(
  oracle: DuelOutcomeOracleContract,
  reporter: Awaited<ReturnType<typeof deployFixture>>["reporter"],
  duel: string,
) {
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  await oracle
    .connect(reporter)
    .upsertDuel(
      duel,
      hashParticipant("agent-a"),
      hashParticipant("agent-b"),
      now,
      now + 60n,
      now + 120n,
      "duel-open",
      DUEL_STATUS_BETTING_OPEN,
    );
  return now;
}

describe("GoldClob", function () {
  it("creates one canonical market per duel and syncs from the duel oracle", async function () {
    const { clob, oracle, operator, reporter } = await deployFixture();
    const duel = duelKey("duel-1");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const market = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(market.exists).to.equal(true);
    expect(market.duelKey).to.equal(duel);
    expect(market.status).to.equal(1n);

    await expect(
      clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketExists");
  });

  it("matches FIFO orders and unlinks cancellations immediately", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-2");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const makerAmount = 1000n;
    const makerValue = quoteCost(BUY_SIDE, 500, makerAmount) + 20n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, makerAmount, {
        value: makerValue,
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    let queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      500,
    );
    expect(queue[0]).to.equal(1n);
    expect(queue[1]).to.equal(1n);
    expect(queue[2]).to.equal(makerAmount);

    await clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1);
    queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      500,
    );
    expect(queue[0]).to.equal(0n);
    expect(queue[1]).to.equal(0n);
    expect(queue[2]).to.equal(0n);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, makerAmount, {
        value: quoteCost(SELL_SIDE, 600, makerAmount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, makerAmount, {
        value: quoteCost(BUY_SIDE, 600, makerAmount) + 20n,
      });

    const market = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(market.totalAShares).to.equal(makerAmount);
    expect(market.totalBShares).to.equal(makerAmount);

    const makerPosition = await clob.positions(marketKey, traderA.address);
    const takerPosition = await clob.positions(marketKey, traderB.address);
    expect(makerPosition.bShares).to.equal(makerAmount);
    expect(takerPosition.aShares).to.equal(makerAmount);
  });

  it("allows unmatched resting orders to be cancelled after betting locks", async function () {
    const { clob, oracle, operator, reporter, traderA } = await deployFixture();
    const duel = duelKey("duel-locked-cancel");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const makerAmount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, makerAmount, {
        value: quoteCost(BUY_SIDE, 500, makerAmount) + 20n,
      });

    await oracle
      .connect(reporter)
      .upsertDuel(
        duel,
        hashParticipant("agent-a"),
        hashParticipant("agent-b"),
        openedAt,
        openedAt + 60n,
        openedAt + 120n,
        "duel-locked",
        DUEL_STATUS_LOCKED,
      );

    await expectTxSuccess(
      clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1),
    );

    const queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      500,
    );
    expect(queue[0]).to.equal(0n);
    expect(queue[1]).to.equal(0n);
    expect(queue[2]).to.equal(0n);
  });

  it("tracks sparse best bid and ask levels after cancellations", async function () {
    const { clob, oracle, operator, reporter, admin, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-sparse-book");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 300, 1000, {
        value: quoteCost(BUY_SIDE, 300, 1000n) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 450, 1000, {
        value: quoteCost(BUY_SIDE, 450, 1000n) + 20n,
      });
    await clob
      .connect(admin)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 650, 1000, {
        value: quoteCost(SELL_SIDE, 650, 1000n) + 20n,
      });
    await clob
      .connect(reporter)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 800, 1000, {
        value: quoteCost(SELL_SIDE, 800, 1000n) + 20n,
      });

    let market = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(market.bestBid).to.equal(450n);
    expect(market.bestAsk).to.equal(650n);

    await clob.connect(traderB).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 2);
    market = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(market.bestBid).to.equal(300n);
    expect(market.bestAsk).to.equal(650n);

    await clob.connect(admin).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 3);
    market = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(market.bestBid).to.equal(300n);
    expect(market.bestAsk).to.equal(800n);
  });

  it("settles from the duel oracle and routes winner claim fees to the market maker", async function () {
    const {
      clob,
      oracle,
      operator,
      reporter,
      treasury,
      marketMaker,
      traderA,
      traderB,
    } = await deployFixture();
    const duel = duelKey("duel-3");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, {
        value: quoteCost(BUY_SIDE, 600, amount) + 20n,
      });

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);

    await oracle
      .connect(reporter)
      .reportResult(
        duel,
        SIDE_A,
        42,
        ethers.keccak256(ethers.toUtf8Bytes("replay")),
        ethers.keccak256(ethers.toUtf8Bytes("result")),
        openedAt + 180n,
        "resolved",
      );
    await clob
      .connect(operator)
      .syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);

    const claimTx = await clob
      .connect(traderB)
      .claim(duel, MARKET_KIND_DUEL_WINNER);
    const claimReceipt = await claimTx.wait();
    const claimFee = (amount * 200n) / 10_000n;

    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(
      mmBefore + claimFee,
    );
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(
      treasuryBefore,
    );
    expect(claimReceipt?.status).to.equal(1);
  });

  it("clears losing trader state on first post-resolution claim and rejects repeated claims", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-loser-clear");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, {
        value: quoteCost(BUY_SIDE, 600, amount) + 20n,
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const loserBefore = await clob.positions(marketKey, traderA.address);
    expect(loserBefore.bShares).to.equal(amount);
    expect(loserBefore.bStake).to.equal(quoteCost(SELL_SIDE, 600, amount));

    await oracle
      .connect(reporter)
      .reportResult(
        duel,
        SIDE_A,
        99,
        ethers.keccak256(ethers.toUtf8Bytes("replay-loser")),
        ethers.keccak256(ethers.toUtf8Bytes("result-loser")),
        openedAt + 180n,
        "resolved-loser",
      );
    await clob
      .connect(operator)
      .syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);

    await expectTxSuccess(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    );

    const loserAfter = await clob.positions(marketKey, traderA.address);
    expect(loserAfter.aShares).to.equal(0n);
    expect(loserAfter.bShares).to.equal(0n);
    expect(loserAfter.aStake).to.equal(0n);
    expect(loserAfter.bStake).to.equal(0n);

    await expect(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWith("nothing to claim");
    await expectTxSuccess(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    );
    await expect(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWith("nothing to claim");
  });

  it("rejects claims before the market is settled", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-unresolved-claim");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, {
        value: quoteCost(BUY_SIDE, 600, amount) + 20n,
      });

    await expect(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketNotSettled");
  });

  it("refunds recorded stake on duel cancellation", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-4");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    const sellerStake = quoteCost(SELL_SIDE, 600, amount);
    const buyerStake = quoteCost(BUY_SIDE, 600, amount);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, {
        value: sellerStake + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, {
        value: buyerStake + 20n,
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const aBefore = await clob.positions(marketKey, traderA.address);
    const bBefore = await clob.positions(marketKey, traderB.address);
    expect(aBefore.bStake).to.equal(sellerStake);
    expect(bBefore.aStake).to.equal(buyerStake);

    await oracle.connect(reporter).cancelDuel(duel, "cancelled");
    await clob
      .connect(operator)
      .syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);

    await expectTxSuccess(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    );
    await expectTxSuccess(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    );

    const aAfter = await clob.positions(marketKey, traderA.address);
    const bAfter = await clob.positions(marketKey, traderB.address);
    expect(aAfter.bStake).to.equal(0n);
    expect(bAfter.aStake).to.equal(0n);
  });

  it("deducts and routes trade fees correctly on order placement", async function () {
    const { clob, oracle, operator, reporter, treasury, marketMaker, traderA } = await deployFixture();
    const duel = duelKey("duel-fee-test-1");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    // Initial balances
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);

    const amount = 2000n;
    const price = 600;
    const cost = quoteCost(BUY_SIDE, price, amount); // 2000 * 600 / 1000 = 1200n

    // Default fee config set in constructor: tradeTreasuryFeeBps = 100 (1%), tradeMarketMakerFeeBps = 100 (1%)
    const expectedTreasuryFee = cost * 100n / 10000n; // 12
    const expectedMmFee = cost * 100n / 10000n; // 12

    const requiredValue = cost + expectedTreasuryFee + expectedMmFee;

    await expectTxSuccess(
      clob.connect(traderA).placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, price, amount, {
        value: requiredValue
      })
    );

    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    const mmAfter = await ethers.provider.getBalance(marketMaker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasuryFee);
    expect(mmAfter - mmBefore).to.equal(expectedMmFee);
  });

  it("handles maximum fees, zero fees, and edge limit prices correctly", async function () {
    const { clob, oracle, operator, reporter, admin, treasury, marketMaker, traderA } = await deployFixture();
    const duel = duelKey("duel-fee-test-2");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    // Test zero fees
    await clob.connect(admin).setFeeConfig(0, 0, 0);

    let treasuryBefore = await ethers.provider.getBalance(treasury.address);
    let mmBefore = await ethers.provider.getBalance(marketMaker.address);
    let cost = quoteCost(SELL_SIDE, 999, 1000n); // extreme limit price 999. cost = 1000 * 1 / 1000 = 1
    
    await clob.connect(traderA).placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 999, 1000n, {
      value: cost
    });

    let treasuryAfter = await ethers.provider.getBalance(treasury.address);
    let mmAfter = await ethers.provider.getBalance(marketMaker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(0n);
    expect(mmAfter - mmBefore).to.equal(0n);

    // Test max fees: 9000 BPS treasury, 1000 BPS MM (Total 10000 = 100%)
    await clob.connect(admin).setFeeConfig(9000, 1000, 0);

    treasuryBefore = await ethers.provider.getBalance(treasury.address);
    mmBefore = await ethers.provider.getBalance(marketMaker.address);
    cost = quoteCost(BUY_SIDE, 1, 10000n); // extreme limit price 1. cost = 10000 * 1 / 1000 = 10
    
    const expectedTreasuryFee = cost * 9000n / 10000n; // 9
    const expectedMmFee = cost * 1000n / 10000n; // 1

    await clob.connect(traderA).placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 1, 10000n, {
      value: cost + expectedTreasuryFee + expectedMmFee
    });

    treasuryAfter = await ethers.provider.getBalance(treasury.address);
    mmAfter = await ethers.provider.getBalance(marketMaker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasuryFee);
    expect(mmAfter - mmBefore).to.equal(expectedMmFee);

    // Test fee config reversion
    await expect(clob.connect(admin).setFeeConfig(5000, 5001, 0)).to.be.revertedWithCustomError(clob, "TotalTradeFeeTooHigh");
  });
});
