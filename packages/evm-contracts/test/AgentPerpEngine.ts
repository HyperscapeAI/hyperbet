import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAgentPerpEngine,
  deployMockErc20,
  deploySkillOracle,
} from "../typed-contracts";

describe("AgentPerpEngine", function () {
  async function deployFixture() {
    const [owner, trader, liquidator, reporter] = await ethers.getSigners();
    const agentId = ethers.encodeBytes32String("MODEL_A");
    const otherAgentId = ethers.encodeBytes32String("MODEL_B");

    const oracle = await deploySkillOracle(ethers.parseEther("100"), owner);
    await oracle.waitForDeployment();

    await oracle.connect(owner).updateAgentSkill(agentId, 1_500, 0);
    await oracle.connect(owner).updateAgentSkill(otherAgentId, 1_500, 0);

    const marginToken = await deployMockErc20("USDC", "USDC", owner);
    await marginToken.waitForDeployment();

    const engine = await deployAgentPerpEngine(
      await oracle.getAddress(),
      await marginToken.getAddress(),
      ethers.parseEther("1000000"),
      owner,
    );
    await engine.waitForDeployment();

    await marginToken.connect(owner).mint(owner.address, ethers.parseEther("1000000"));
    await marginToken.connect(owner).mint(trader.address, ethers.parseEther("1000"));
    await marginToken.connect(owner).approve(await engine.getAddress(), ethers.MaxUint256);
    await marginToken.connect(trader).approve(await engine.getAddress(), ethers.MaxUint256);

    return { owner, trader, liquidator, reporter, agentId, oracle, marginToken, engine };
  }

  it("creates explicit markets and records oracle snapshots", async function () {
    const { owner, engine, agentId } = await deployFixture();

    await expect(engine.connect(owner).createMarket(agentId))
      .to.emit(engine, "MarketCreated")
      .withArgs(
        agentId,
        ethers.parseEther("1000000"),
        ethers.parseEther("5"),
        1_000,
        500,
        120,
      );

    const config = await engine.marketConfigs(agentId);
    const market = await engine.markets(agentId);

    expect(config.exists).to.equal(true);
    expect(config.skewScale).to.equal(ethers.parseEther("1000000"));
    expect(market.status).to.equal(1n);
    expect(market.lastOraclePrice).to.equal(ethers.parseEther("100"));
    expect(await engine.marketCount()).to.equal(1n);
  });

  it("blocks non-reporter from updating skills", async function () {
    const { reporter, agentId, oracle } = await deployFixture();

    await expect(
      oracle.connect(reporter).updateAgentSkill(agentId, 1_700, 25),
    ).to.be.reverted;
  });

  it("opens, reduces, and closes positions with ERC20 collateral", async function () {
    const { owner, trader, agentId, oracle, engine } = await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine.connect(owner).depositInsuranceFund(agentId, ethers.parseEther("100"));

    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));

    const opened = await engine.positions(agentId, trader.address);
    expect(opened.size).to.equal(ethers.parseEther("1"));
    expect(opened.margin).to.equal(ethers.parseEther("30"));
    expect(opened.entryPrice).to.be.closeTo(
      ethers.parseEther("100"),
      ethers.parseEther("0.0001"),
    );

    await oracle.connect(owner).updateAgentSkill(agentId, 1_750, 0);

    await engine
      .connect(trader)
      .modifyPosition(agentId, 0, -ethers.parseEther("0.2"));

    const reduced = await engine.positions(agentId, trader.address);
    const marketAfterReduce = await engine.markets(agentId);
    expect(reduced.size).to.equal(ethers.parseEther("0.8"));
    expect(reduced.entryPrice).to.equal(opened.entryPrice);
    expect(reduced.margin).to.be.closeTo(
      ethers.parseEther("35"),
      ethers.parseEther("0.001"),
    );
    expect(marketAfterReduce.insuranceFund).to.be.closeTo(
      ethers.parseEther("95"),
      ethers.parseEther("0.001"),
    );

    await expect(
      engine.connect(trader).modifyPosition(agentId, 0, -ethers.parseEther("0.8")),
    ).to.emit(engine, "PositionClosed");

    const closed = await engine.positions(agentId, trader.address);
    expect(closed.size).to.equal(0n);
    expect(closed.margin).to.equal(0n);
    expect(closed.entryPrice).to.equal(0n);
  });

  it("requires funded market liquidity to realize trader profits", async function () {
    const { owner, trader, agentId, oracle, engine } = await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));

    await oracle.connect(owner).updateAgentSkill(agentId, 1_750, 0);

    await expect(
      engine.connect(trader).modifyPosition(agentId, 0, -ethers.parseEther("1")),
    ).to.be.revertedWithCustomError(engine, "InsufficientMarketLiquidity");
  });

  it("enforces close-only status for existing positions", async function () {
    const { owner, trader, agentId, engine } = await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine.connect(owner).depositInsuranceFund(agentId, ethers.parseEther("10"));
    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));

    await engine.connect(owner).setMarketStatus(agentId, 2);

    await expect(
      engine
        .connect(trader)
        .modifyPosition(agentId, 0, ethers.parseEther("0.5")),
    ).to.be.revertedWithCustomError(engine, "CloseOnlyMode");

    await expect(
      engine
        .connect(trader)
        .modifyPosition(agentId, 0, -ethers.parseEther("1.1")),
    ).to.be.revertedWithCustomError(engine, "CloseOnlyMode");

    await engine
      .connect(trader)
      .modifyPosition(agentId, 0, -ethers.parseEther("0.4"));
    const position = await engine.positions(agentId, trader.address);
    expect(position.size).to.equal(ethers.parseEther("0.6"));
  });

  it("blocks withdrawals that would violate equity-based leverage", async function () {
    const { owner, trader, agentId, engine } = await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("101"), ethers.parseEther("5"));

    await expect(
      engine.connect(trader).withdrawMargin(agentId, ethers.parseEther("80")),
    ).to.be.revertedWithCustomError(engine, "MaxLeverageExceeded");
  });

  it("liquidates unhealthy positions and routes losses into the market vault", async function () {
    const { owner, trader, liquidator, agentId, oracle, marginToken, engine } =
      await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));
    await engine.connect(owner).depositInsuranceFund(agentId, ethers.parseEther("100"));

    await oracle.connect(owner).updateAgentSkill(agentId, 1_000, 0);

    const liquidatorBalanceBefore = await marginToken.balanceOf(liquidator.address);
    await engine.connect(liquidator).liquidate(agentId, trader.address);
    const liquidatorBalanceAfter = await marginToken.balanceOf(liquidator.address);

    const position = await engine.positions(agentId, trader.address);
    const market = await engine.markets(agentId);

    expect(position.size).to.equal(0n);
    expect(position.margin).to.equal(0n);
    expect(market.vaultBalance).to.be.closeTo(
      ethers.parseEther("50"),
      ethers.parseEther("0.001"),
    );
    expect(market.insuranceFund).to.be.closeTo(
      ethers.parseEther("78.5"),
      ethers.parseEther("0.0001"),
    );
    expect(market.badDebt).to.equal(0n);
    expect(liquidatorBalanceAfter - liquidatorBalanceBefore).to.be.closeTo(
      ethers.parseEther("1.5"),
      ethers.parseEther("0.0001"),
    );
  });

  it("records bad debt when liquidation losses exceed available reserves", async function () {
    const { owner, trader, agentId, oracle, engine } = await deployFixture();

    await engine.connect(owner).createMarket(agentId);
    await engine.connect(owner).depositInsuranceFund(agentId, ethers.parseEther("10"));

    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));

    await oracle.connect(owner).updateAgentSkill(agentId, 800, 0);

    await expect(
      engine.connect(trader).modifyPosition(agentId, 0, -ethers.parseEther("1")),
    ).to.be.revertedWithCustomError(engine, "Underwater");

    await engine.connect(owner).updateMarketConfig(
      agentId,
      ethers.parseEther("1000000"),
      ethers.parseEther("5"),
      4_000,
      500,
      120,
    );

    await expect(engine.connect(trader).liquidate(agentId, trader.address)).to.emit(
      engine,
      "PositionLiquidated",
    );

    const position = await engine.positions(agentId, trader.address);
    const market = await engine.markets(agentId);

    expect(position.size).to.equal(0n);
    expect(position.margin).to.equal(0n);
    expect(market.vaultBalance).to.be.closeTo(
      ethers.parseEther("40"),
      ethers.parseEther("0.001"),
    );
    expect(market.insuranceFund).to.equal(0n);
    expect(market.badDebt).to.be.closeTo(
      ethers.parseEther("30"),
      ethers.parseEther("0.001"),
    );

    await engine.connect(owner).depositInsuranceFund(agentId, ethers.parseEther("40"));
    const recapitalizedMarket = await engine.markets(agentId);
    expect(recapitalizedMarket.badDebt).to.equal(0n);
    expect(recapitalizedMarket.vaultBalance).to.be.closeTo(
      ethers.parseEther("70"),
      ethers.parseEther("0.001"),
    );
    expect(recapitalizedMarket.insuranceFund).to.be.closeTo(
      ethers.parseEther("10"),
      ethers.parseEther("0.001"),
    );
  });
});
