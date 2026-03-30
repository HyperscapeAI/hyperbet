import { expect } from "chai";
import { ethers } from "hardhat";

import { deploySkillOracle, type SkillOracleContract } from "../typed-contracts";

describe("SkillOracle", () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const oracle: SkillOracleContract = await deploySkillOracle(
      ethers.parseEther("100"),
      owner,
    );
    await oracle.waitForDeployment();
    return { owner, oracle };
  }

  it("updates the global mean incrementally for inserts and overwrites", async () => {
    const { owner, oracle } = await deployFixture();
    const agentA = ethers.encodeBytes32String("MODEL_A");
    const agentB = ethers.encodeBytes32String("MODEL_B");

    await oracle.connect(owner).updateAgentSkill(agentA, 1_000, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_000n);

    await oracle.connect(owner).updateAgentSkill(agentB, 1_400, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_200n);

    await oracle.connect(owner).updateAgentSkill(agentA, 1_500, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_450n);
  });

  it("keeps index prices positive for agents below the mean", async () => {
    const { owner, oracle } = await deployFixture();
    const agentA = ethers.encodeBytes32String("MODEL_A");
    const agentB = ethers.encodeBytes32String("MODEL_B");

    await oracle.connect(owner).updateAgentSkill(agentA, 1_000, 50);
    await oracle.connect(owner).updateAgentSkill(agentB, 1_500, 50);

    const lowerPrice = await oracle.getIndexPrice(agentA);
    const higherPrice = await oracle.getIndexPrice(agentB);

    expect(lowerPrice).to.be.greaterThan(0n);
    expect(higherPrice).to.be.greaterThan(lowerPrice);
  });

  it("only allows REPORTER_ROLE to update skills", async () => {
    const { owner, oracle } = await deployFixture();
    const [, nonReporter] = await ethers.getSigners();
    const agent = ethers.encodeBytes32String("MODEL_A");

    // Owner has REPORTER_ROLE from construction
    await oracle.connect(owner).updateAgentSkill(agent, 1_700, 25);
    const stored = await oracle.agentSkills(agent);
    expect(stored.mu).to.equal(1_700n);
    expect(stored.sigma).to.equal(25n);

    // Non-reporter should fail
    await expect(
      oracle.connect(nonReporter).updateAgentSkill(agent, 1_800, 30),
    ).to.be.reverted;
  });

  it("removes agents while preserving the active set and recomputing the mean", async () => {
    const { owner, oracle } = await deployFixture();
    const agentA = ethers.encodeBytes32String("MODEL_A");
    const agentB = ethers.encodeBytes32String("MODEL_B");
    const agentC = ethers.encodeBytes32String("MODEL_C");

    await oracle.connect(owner).updateAgentSkill(agentA, 1_000, 50);
    await oracle.connect(owner).updateAgentSkill(agentB, 1_400, 50);
    await oracle.connect(owner).updateAgentSkill(agentC, 1_600, 50);

    await oracle.connect(owner).removeAgent(agentB);

    expect(await oracle.activeAgentCount()).to.equal(2n);
    expect(await oracle.globalMeanMu()).to.equal(1_300n);

    const activeAgents = [
      await oracle.activeAgents(0),
      await oracle.activeAgents(1),
    ];
    expect(new Set(activeAgents)).to.deep.equal(new Set([agentA, agentC]));

    const removed = await oracle.agentSkills(agentB);
    expect(removed.lastUpdate).to.equal(0n);
  });
});
