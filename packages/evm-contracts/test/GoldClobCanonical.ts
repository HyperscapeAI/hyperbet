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
const ORDER_FLAG_GTC = 0x01;
const ORDER_FLAG_IOC = 0x02;
const ORDER_FLAG_POST_ONLY = 0x04;
const ORDER_FLAGS_GTC_POST_ONLY = ORDER_FLAG_GTC | ORDER_FLAG_POST_ONLY;
const TOTAL_TRADE_FEE_BPS = 200n;

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

function quoteOrderValue(side: number, price: number, amount: bigint): bigint {
  const cost = quoteCost(side, price, amount);
  const fee = (cost * TOTAL_TRADE_FEE_BPS) / 10_000n;
  return cost + fee + 20n;
}

async function expectTxSuccess(
  txPromise: Promise<{ wait: () => Promise<{ status: number | null } | null> }>,
) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  expect(receipt?.status).to.equal(1);
}

async function deployFixture() {
  const [admin, operator, reporter, finalizer, challenger, pauser, treasury, marketMaker, traderA, traderB] =
    await ethers.getSigners();

  const oracle = await deployDuelOutcomeOracle(
    admin.address,
    reporter.address,
    finalizer.address,
    challenger.address,
    pauser.address,
    3600,
    admin,
  );
  await oracle.waitForDeployment();

  const clob = await deployGoldClob(
    admin.address,
    operator.address,
    await oracle.getAddress(),
    treasury.address,
    marketMaker.address,
    pauser.address,
    admin,
  );
  await clob.waitForDeployment();

  return {
    admin,
    operator,
    reporter,
    finalizer,
    challenger,
    pauser,
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
  betCloseOffset = 60n,
  duelStartOffset = 120n,
) {
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  await oracle
    .connect(reporter)
    .upsertDuel(
      duel,
      hashParticipant("agent-a"),
      hashParticipant("agent-b"),
      now,
      now + betCloseOffset,
      now + duelStartOffset,
      "duel-open",
      DUEL_STATUS_BETTING_OPEN,
    );
  return now;
}

async function advanceToTimestamp(target: bigint) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(target)]);
  await ethers.provider.send("evm_mine", []);
}

async function lockDuel(
  oracle: DuelOutcomeOracleContract,
  reporter: Awaited<ReturnType<typeof deployFixture>>["reporter"],
  duel: string,
  openedAt: bigint,
  metadataUri = "duel-locked",
) {
  await advanceToTimestamp(openedAt + 61n);
  await oracle
    .connect(reporter)
    .upsertDuel(
      duel,
      hashParticipant("agent-a"),
      hashParticipant("agent-b"),
      openedAt,
      openedAt + 60n,
      openedAt + 120n,
      metadataUri,
      DUEL_STATUS_LOCKED,
    );
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

  it("lets the emergency pauser halt new market creation", async function () {
    const { clob, oracle, operator, reporter, pauser } = await deployFixture();
    const duel = duelKey("duel-market-pause");

    await upsertOpenDuel(oracle, reporter, duel);
    await expect(clob.connect(pauser).setMarketCreationPaused(true))
      .to.emit(clob, "MarketCreationPauseUpdated")
      .withArgs(true, pauser.address);

    await expect(
      clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketCreationIsPaused");
  });

  it("lets the emergency pauser halt new order placement without blocking cancels", async function () {
    const { clob, oracle, operator, reporter, pauser, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-order-pause");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(BUY_SIDE, 500, 1000n) + 20n,
      });

    await expect(clob.connect(pauser).setOrderPlacementPaused(true))
      .to.emit(clob, "OrderPlacementPauseUpdated")
      .withArgs(true, pauser.address);

    await expect(
      clob
        .connect(traderB)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 500, 1000, ORDER_FLAG_GTC, {
          value: quoteCost(SELL_SIDE, 500, 1000n) + 20n,
        }),
    ).to.be.revertedWithCustomError(clob, "OrderPlacementIsPaused");

    await expect(clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1))
      .to.emit(clob, "OrderCancelled")
      .withArgs(await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER), 1n);
  });

  it("matches FIFO orders and unlinks cancellations immediately", async function () {
    const { clob, oracle, operator, reporter, finalizer, traderA, traderB } =
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
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, makerAmount, ORDER_FLAG_GTC, {
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
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, makerAmount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, makerAmount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, makerAmount, ORDER_FLAG_GTC, {
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

  it("cancels direct self-cross takers and emits cancel-taker telemetry", async function () {
    const { clob, oracle, operator, reporter, treasury, marketMaker, traderA } =
      await deployFixture();
    const duel = duelKey("duel-self-cross-direct");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);
    const clobAddress = await clob.getAddress();
    const contractBefore = await ethers.provider.getBalance(clobAddress);

    await expect(
      clob
        .connect(traderA)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, 1000, ORDER_FLAG_GTC, {
          value: quoteOrderValue(BUY_SIDE, 600, 1000n),
        }),
    )
      .to.emit(clob, "SelfTradePolicyTriggered")
      .withArgs(
        await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER),
        traderA.address,
        traderA.address,
        1n,
        2n,
        "cancel-taker",
        true,
      );

    const queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      600,
    );
    expect(queue[0]).to.equal(1n);
    expect(queue[2]).to.equal(1000n);

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const takerOrder = await clob.orders(marketKey, 2);
    expect(takerOrder.amount).to.equal(1000n);
    expect(takerOrder.filled).to.equal(0n);
    expect(takerOrder.active).to.equal(false);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(mmBefore);
    expect(await ethers.provider.getBalance(clobAddress)).to.equal(contractBefore);
  });

  it("keeps prior fills but cancels the taker remainder on a later self-cross candidate", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-self-cross-partial");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    const tx = await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, 2000, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, 2000n),
      });
    const receipt = await tx.wait();
    const selfTradeEvents = (receipt?.logs ?? [])
      .map((log) => {
        try {
          return clob.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((log) => log?.name === "SelfTradePolicyTriggered");

    expect(selfTradeEvents.length).to.equal(1);

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const takerOrder = await clob.orders(marketKey, 3);
    const traderAPosition = await clob.positions(marketKey, traderA.address);
    const traderBPosition = await clob.positions(marketKey, traderB.address);
    const queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      600,
    );
    expect(traderAPosition.aShares).to.equal(1000n);
    expect(traderAPosition.bShares).to.equal(0n);
    expect(traderBPosition.bShares).to.equal(1000n);
    expect(traderBPosition.aShares).to.equal(0n);
    expect(takerOrder.amount).to.equal(2000n);
    expect(takerOrder.filled).to.equal(1000n);
    expect(takerOrder.active).to.equal(false);
    expect(queue[0]).to.equal(2n);
    expect(queue[2]).to.equal(1000n);
  });

  it("does not emit self-cross detection for mixed-user matches", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-self-cross-mixed-users");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    const tx = await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, 1000n),
      });
    const receipt = await tx.wait();
    const selfTradeEvents = (receipt?.logs ?? [])
      .map((log) => {
        try {
          return clob.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((log) => log?.name === "SelfTradePolicyTriggered");

    expect(selfTradeEvents.length).to.equal(0);
  });

  it("rejects unsupported order flags", async function () {
    const { clob, oracle, operator, reporter, traderA } = await deployFixture();
    const duel = duelKey("duel-invalid-flags");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await expect(
      clob
        .connect(traderA)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, 1000, 0, {
          value: quoteCost(BUY_SIDE, 500, 1000n) + 20n,
        }),
    ).to.be.revertedWithCustomError(clob, "InvalidOrderFlags");
  });

  it("rejects crossing post-only orders and rests non-crossing post-only orders", async function () {
    const { clob, oracle, operator, reporter, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-post-only");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    await expect(
      clob
        .connect(traderB)
        .placeOrder(
          duel,
          MARKET_KIND_DUEL_WINNER,
          BUY_SIDE,
          600,
          1000,
          ORDER_FLAGS_GTC_POST_ONLY,
          {
            value: quoteCost(BUY_SIDE, 600, 1000n) + 20n,
          },
        ),
    ).to.be.revertedWithCustomError(clob, "PostOnlyWouldCross");

    await expectTxSuccess(
      clob
        .connect(traderB)
        .placeOrder(
          duel,
          MARKET_KIND_DUEL_WINNER,
          BUY_SIDE,
          550,
          1000,
          ORDER_FLAGS_GTC_POST_ONLY,
          {
            value: quoteCost(BUY_SIDE, 550, 1000n) + 20n,
          },
        ),
    );

    const queue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      550,
    );
    expect(queue[0]).to.equal(2n);
    expect(queue[2]).to.equal(1000n);
  });

  it("cancels IOC remainders instead of resting them", async function () {
    const { clob, oracle, operator, reporter, treasury, marketMaker, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-ioc");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    const clobAddress = await clob.getAddress();
    const contractBefore = await ethers.provider.getBalance(clobAddress);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);

    await expectTxSuccess(
      clob
        .connect(traderB)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, 2000, ORDER_FLAG_IOC, {
          value: quoteOrderValue(BUY_SIDE, 600, 2000n),
        }),
    );

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const takerOrder = await clob.orders(marketKey, 2);
    const buyQueue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      600,
    );
    const takerPosition = await clob.positions(marketKey, traderB.address);

    expect(takerOrder.amount).to.equal(2000n);
    expect(takerOrder.filled).to.equal(1000n);
    expect(takerOrder.active).to.equal(false);
    expect(buyQueue[2]).to.equal(0n);
    expect(takerPosition.aShares).to.equal(1000n);
    expect(await ethers.provider.getBalance(clobAddress)).to.equal(contractBefore + 600n);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + 6n);
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(mmBefore + 6n);
  });

  it("rests GTC remainders once matching hits the bounded continuation cap", async function () {
    const { clob, oracle, operator, reporter, traderB } = await deployFixture();
    const duel = duelKey("duel-match-cap");
    const signers = await ethers.getSigners();
    const makers = signers
      .filter((signer) => signer.address !== traderB.address)
      .slice(0, 10);

    await upsertOpenDuel(oracle, reporter, duel, 1_000n, 1_060n);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    for (let index = 0; index < 101; index += 1) {
      const maker = makers[index % makers.length]!;
      await clob
        .connect(maker)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
          value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
        });
    }

    await expectTxSuccess(
      clob
        .connect(traderB)
        .placeOrder(
          duel,
          MARKET_KIND_DUEL_WINNER,
          BUY_SIDE,
          600,
          101_000,
          ORDER_FLAG_GTC,
          {
            value: quoteOrderValue(BUY_SIDE, 600, 101_000n),
          },
        ),
    );

    const sellQueue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      600,
    );
    const buyQueue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      600,
    );
    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const takerOrder = await clob.orders(marketKey, 102);

    expect(sellQueue[0]).to.equal(51n);
    expect(sellQueue[2]).to.equal(51_000n);
    expect(buyQueue[0]).to.equal(102n);
    expect(buyQueue[2]).to.equal(51_000n);
    expect(takerOrder.amount).to.equal(101_000n);
    expect(takerOrder.filled).to.equal(50_000n);
    expect(takerOrder.active).to.equal(true);
  });

  it("rejects order cancellation after betting locks (PM21 guardrail)", async function () {
    const { clob, oracle, operator, reporter, traderA } = await deployFixture();
    const duel = duelKey("duel-locked-cancel");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const makerAmount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, makerAmount, ORDER_FLAG_GTC, {
        value: quoteCost(BUY_SIDE, 500, makerAmount) + 20n,
      });

    await advanceToTimestamp(openedAt + 60n);

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

    await expect(
      clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1),
    ).to.be.revertedWithCustomError(clob, "MarketNotOpen");
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
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 300, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(BUY_SIDE, 300, 1000n) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 450, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(BUY_SIDE, 450, 1000n) + 20n,
      });
    await clob
      .connect(admin)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 650, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 650, 1000n) + 20n,
      });
    await clob
      .connect(reporter)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 800, 1000, ORDER_FLAG_GTC, {
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
      finalizer,
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
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, amount),
      });

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);

    await lockDuel(oracle, reporter, duel, openedAt);
    await oracle
      .connect(reporter)
      .proposeResult(
        duel,
        SIDE_A,
        42,
        ethers.keccak256(ethers.toUtf8Bytes("replay")),
        ethers.keccak256(ethers.toUtf8Bytes("result")),
        openedAt + 180n,
        "resolved",
      );
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await oracle.connect(finalizer).finalizeResult(duel, "finalized");
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

  it("uses fee snapshots from market creation for claims and blocks post-deploy fee updates", async function () {
    const { clob, oracle, operator, reporter, finalizer, admin, marketMaker, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-claim-fee-snapshot");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob.connect(operator).syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);
    const marketBeforeFeeChange = await clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
    expect(marketBeforeFeeChange.winningsMarketMakerFeeBpsSnapshot).to.equal(200n);

    await expect(
      clob.connect(admin).setFeeConfig(0, 0, 5000),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, amount),
      });

    await lockDuel(oracle, reporter, duel, openedAt, "duel-locked-snapshot");
    await oracle
      .connect(reporter)
      .proposeResult(
        duel,
        SIDE_A,
        99,
        ethers.keccak256(ethers.toUtf8Bytes("replay-snapshot")),
        ethers.keccak256(ethers.toUtf8Bytes("result-snapshot")),
        openedAt + 180n,
        "resolved-snapshot",
      );
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await oracle.connect(finalizer).finalizeResult(duel, "resolved-snapshot-final");
    await clob
      .connect(operator)
      .syncMarketFromOracle(duel, MARKET_KIND_DUEL_WINNER);

    const mmBefore = await ethers.provider.getBalance(marketMaker.address);
    await expectTxSuccess(clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER));
    const mmAfter = await ethers.provider.getBalance(marketMaker.address);
    const expectedClaimFee = (amount * 200n) / 10_000n;
    expect(mmAfter - mmBefore).to.equal(expectedClaimFee);
  });

  it("clears losing trader state on first post-resolution claim and rejects repeated claims", async function () {
    const { clob, oracle, operator, reporter, finalizer, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-loser-clear");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, amount),
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const loserBefore = await clob.positions(marketKey, traderA.address);
    expect(loserBefore.bShares).to.equal(amount);
    expect(loserBefore.bStake).to.equal(quoteCost(SELL_SIDE, 600, amount));

    await lockDuel(oracle, reporter, duel, openedAt, "duel-locked-loser");
    await oracle
      .connect(reporter)
      .proposeResult(
        duel,
        SIDE_A,
        99,
        ethers.keccak256(ethers.toUtf8Bytes("replay-loser")),
        ethers.keccak256(ethers.toUtf8Bytes("result-loser")),
        openedAt + 180n,
        "resolved-loser",
      );
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await oracle.connect(finalizer).finalizeResult(duel, "finalized");
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
    ).to.be.revertedWithCustomError(clob, "NothingToClaim");
    await expectTxSuccess(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    );
    await expect(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "NothingToClaim");
  });

  it("rejects claims before the market is settled", async function () {
    const { clob, oracle, operator, reporter, finalizer, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-unresolved-claim");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, amount),
      });

    await expect(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketNotSettled");
  });

  it("keeps claims fail-closed during proposed and challenged resolution states", async function () {
    const { clob, oracle, operator, reporter, challenger, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-fail-closed-claim");

    const openedAt = await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const amount = 1000n;
    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, amount) + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(BUY_SIDE, 600, amount),
      });

    await lockDuel(oracle, reporter, duel, openedAt, "duel-locked-fail-closed");
    await oracle
      .connect(reporter)
      .proposeResult(
        duel,
        SIDE_A,
        55,
        ethers.keccak256(ethers.toUtf8Bytes("replay-fail-closed")),
        ethers.keccak256(ethers.toUtf8Bytes("result-fail-closed")),
        openedAt + 180n,
        "result-proposed",
      );

    await expect(
      clob.connect(traderA).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketNotSettled");

    await oracle.connect(challenger).challengeResult(duel, "result-challenged");

    await expect(
      clob.connect(traderB).claim(duel, MARKET_KIND_DUEL_WINNER),
    ).to.be.revertedWithCustomError(clob, "MarketNotSettled");
  });

  it("refunds recorded stake on duel cancellation", async function () {
    const { clob, oracle, operator, reporter, finalizer, pauser, traderA, traderB } =
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
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: sellerStake + 20n,
      });
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, amount, ORDER_FLAG_GTC, {
        value: buyerStake + 20n,
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const aBefore = await clob.positions(marketKey, traderA.address);
    const bBefore = await clob.positions(marketKey, traderB.address);
    expect(bBefore.aStake).to.equal(buyerStake);

    await oracle.connect(pauser).cancelDuel(duel, "cancelled");
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

  it("charges trade fees only on executed taker volume and does not bill cancels", async function () {
    const { clob, oracle, operator, reporter, treasury, marketMaker, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-fee-test-1");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const clobAddress = await clob.getAddress();
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);
    const contractBefore = await ethers.provider.getBalance(clobAddress);

    const restingAmount = 2000n;
    const price = 600;
    const restingCost = quoteCost(BUY_SIDE, price, restingAmount);

    await expectTxSuccess(
      clob.connect(traderA).placeOrder(
        duel,
        MARKET_KIND_DUEL_WINNER,
        BUY_SIDE,
        price,
        restingAmount,
        ORDER_FLAG_GTC,
        { value: quoteOrderValue(BUY_SIDE, price, restingAmount) },
      ),
    );

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(mmBefore);
    expect(await ethers.provider.getBalance(clobAddress)).to.equal(contractBefore + restingCost);

    const takerAmount = 1000n;
    const takerCost = quoteCost(SELL_SIDE, price, takerAmount);
    const expectedTreasuryFee = (takerCost * 100n) / 10_000n;
    const expectedMmFee = (takerCost * 100n) / 10_000n;

    await expectTxSuccess(
      clob.connect(traderB).placeOrder(
        duel,
        MARKET_KIND_DUEL_WINNER,
        SELL_SIDE,
        price,
        takerAmount,
        ORDER_FLAG_GTC,
        { value: quoteOrderValue(SELL_SIDE, price, takerAmount) },
      ),
    );

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(
      treasuryBefore + expectedTreasuryFee,
    );
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(
      mmBefore + expectedMmFee,
    );
    expect(await ethers.provider.getBalance(clobAddress)).to.equal(
      contractBefore + restingCost + takerCost,
    );

    await expectTxSuccess(
      clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1),
    );

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(
      treasuryBefore + expectedTreasuryFee,
    );
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(
      mmBefore + expectedMmFee,
    );
    expect(await ethers.provider.getBalance(clobAddress)).to.equal(contractBefore + takerAmount);
  });

  it("blocks fee config updates after deploy (PM20)", async function () {
    const { clob, oracle, operator, reporter, admin, treasury, marketMaker, traderA, traderB } =
      await deployFixture();
    await upsertOpenDuel(oracle, reporter, duelKey("duel-fee-freeze"));
    await clob.connect(operator).createMarketForDuel(
      duelKey("duel-fee-freeze"),
      MARKET_KIND_DUEL_WINNER,
    );

    await expect(
      clob.connect(admin).setFeeConfig(0, 0, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");
    await expect(
      clob.connect(admin).setFeeConfig(9000, 1000, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");
    await expect(
      clob.connect(admin).setFeeConfig(5000, 5001, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");
  });

  it("handles edge limit prices correctly with frozen fee settings", async function () {
    const {
      clob,
      oracle,
      operator,
      reporter,
      admin,
      treasury,
      marketMaker,
      traderA,
      traderB,
    } = await deployFixture();
    const duel = duelKey("duel-fee-test-2");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob.connect(operator).createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await expect(
      clob.connect(admin).setFeeConfig(0, 0, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");
    await expect(
      clob.connect(admin).setFeeConfig(9000, 1000, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");
    await expect(
      clob.connect(admin).setFeeConfig(5000, 5001, 0),
    ).to.be.revertedWithCustomError(clob, "GovernanceSurfaceFrozen");

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const marketMakerBefore = await ethers.provider.getBalance(marketMaker.address);
    const makerCost = quoteCost(SELL_SIDE, 999, 1000n); // extreme limit price 999. cost = 1000 * 1 / 1000 = 1

    await clob.connect(traderA).placeOrder(
      duel,
      MARKET_KIND_DUEL_WINNER,
      SELL_SIDE,
      999,
      1000n,
      ORDER_FLAG_GTC,
      { value: makerCost },
    );

    await expectTxSuccess(
      clob.connect(traderB).placeOrder(
        duel,
        MARKET_KIND_DUEL_WINNER,
        BUY_SIDE,
        999,
        1000n,
        ORDER_FLAG_GTC,
        { value: quoteOrderValue(BUY_SIDE, 999, 1000n) },
      ),
    );

    const executedCost = quoteCost(BUY_SIDE, 999, 1000n);
    const expectedTreasuryFee = (executedCost * 100n) / 10_000n;
    const expectedMmFee = (executedCost * 100n) / 10_000n;

    expect(await ethers.provider.getBalance(treasury.address)).to.equal(
      treasuryBefore + expectedTreasuryFee,
    );
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(
      marketMakerBefore + expectedMmFee,
    );
  });

  it("rejects all invalid order flag combinations in the 3-bit space", async function () {
    const { clob, oracle, operator, reporter, traderA } = await deployFixture();
    const duel = duelKey("duel-flag-matrix");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const validFlags = [ORDER_FLAG_GTC, ORDER_FLAG_IOC, ORDER_FLAGS_GTC_POST_ONLY];
    for (let flags = 0; flags <= 0x07; flags++) {
      const value = quoteCost(BUY_SIDE, 500, 1000n) + 20n;
      if (validFlags.includes(flags)) {
        await expectTxSuccess(
          clob
            .connect(traderA)
            .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, 1000, flags, { value }),
        );
      } else {
        await expect(
          clob
            .connect(traderA)
            .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, 1000, flags, { value }),
        ).to.be.revertedWithCustomError(clob, "InvalidOrderFlags");
      }
    }
  });

  it("cancels IOC taker on self-cross without resting any remainder", async function () {
    const { clob, oracle, operator, reporter, traderA } = await deployFixture();
    const duel = duelKey("duel-ioc-self-cross");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 600, 1000, ORDER_FLAG_GTC, {
        value: quoteCost(SELL_SIDE, 600, 1000n) + 20n,
      });

    const clobAddress = await clob.getAddress();
    const contractBefore = await ethers.provider.getBalance(clobAddress);

    await expect(
      clob
        .connect(traderA)
        .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 600, 2000, ORDER_FLAG_IOC, {
          value: quoteOrderValue(BUY_SIDE, 600, 2000n),
        }),
    )
      .to.emit(clob, "SelfTradePolicyTriggered");

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const takerOrder = await clob.orders(marketKey, 2);
    expect(takerOrder.amount).to.equal(2000n);
    expect(takerOrder.filled).to.equal(0n);
    expect(takerOrder.active).to.equal(false);

    const buyQueue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      600,
    );
    expect(buyQueue[2]).to.equal(0n);

    expect(await ethers.provider.getBalance(clobAddress)).to.equal(contractBefore);
  });

  it("refunds only the unfilled portion when cancelling a partially-filled GTC order", async function () {
    const { clob, oracle, operator, reporter, treasury, marketMaker, traderA, traderB } =
      await deployFixture();
    const duel = duelKey("duel-partial-cancel-refund");

    await upsertOpenDuel(oracle, reporter, duel);
    await clob
      .connect(operator)
      .createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);

    const makerAmount = 3000n;
    const price = 600;
    const makerCost = quoteCost(BUY_SIDE, price, makerAmount);

    await clob
      .connect(traderA)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, BUY_SIDE, price, makerAmount, ORDER_FLAG_GTC, {
        value: makerCost + 20n,
      });

    const takerAmount = 1000n;
    await clob
      .connect(traderB)
      .placeOrder(duel, MARKET_KIND_DUEL_WINNER, SELL_SIDE, price, takerAmount, ORDER_FLAG_GTC, {
        value: quoteOrderValue(SELL_SIDE, price, takerAmount),
      });

    const marketKey = await clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
    const orderAfterFill = await clob.orders(marketKey, 1);
    expect(orderAfterFill.filled).to.equal(takerAmount);
    expect(orderAfterFill.active).to.equal(true);

    const clobAddress = await clob.getAddress();
    const contractBefore = await ethers.provider.getBalance(clobAddress);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    const mmBefore = await ethers.provider.getBalance(marketMaker.address);

    await expectTxSuccess(
      clob.connect(traderA).cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1),
    );

    const contractAfter = await ethers.provider.getBalance(clobAddress);
    const contractDelta = contractBefore - contractAfter;
    const unfilledAmount = makerAmount - takerAmount;
    // _quoteCost(BUY_SIDE, 600, 2000) = 2000 * 600 / 1000 = 1200
    expect(contractDelta).to.equal(1200n);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore);
    expect(await ethers.provider.getBalance(marketMaker.address)).to.equal(mmBefore);

    const orderAfterCancel = await clob.orders(marketKey, 1);
    expect(orderAfterCancel.active).to.equal(false);
    // cancel sets filled = amount to prevent re-cancellation
    expect(orderAfterCancel.filled).to.equal(makerAmount);

    const buyQueue = await clob.getPriceLevel(
      duel,
      MARKET_KIND_DUEL_WINNER,
      BUY_SIDE,
      price,
    );
    expect(buyQueue[2]).to.equal(0n);
  });
});
