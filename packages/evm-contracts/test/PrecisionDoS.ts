import { expect } from "chai";
import type { EventLog, LogDescription } from "ethers";
import { ethers } from "hardhat";

import { deployDuelOutcomeOracle, deployLvrRouter } from "../typed-contracts";

describe("LvrRouter Precision DoS", () => {
  it("should process perfectly valid mixed-quantity matching without precision revert", async () => {
    const [admin, maker, taker] = await ethers.getSigners();

    const oracle = await deployDuelOutcomeOracle(admin.address, admin.address, admin);
    await oracle.waitForDeployment();

    const clob = await deployLvrRouter(
      admin.address,
      admin.address,
      await oracle.getAddress(),
      admin.address,
      admin.address,
      admin,
    );
    await clob.waitForDeployment();
    await clob.setFeeConfig(0, 0, 0);

    const duelKey = ethers.id("duel-123");
    await oracle.upsertDuel(
      duelKey,
      ethers.id("p1"),
      ethers.id("p2"),
      1,
      2000000000,
      2000000001,
      "m",
      2,
    );

    await clob.createMarketForDuel(duelKey, 0);

    await clob.connect(maker).placeOrder(duelKey, 0, 2, 250, 4000, { value: 3000 });

    const expectedMarketKey = await clob.marketKey(duelKey, 0);

    const tx = await clob
      .connect(taker)
      .placeOrder(duelKey, 0, 1, 500, 2000, { value: 1000 });
    const receipt = await tx.wait();

    expect(receipt).to.not.equal(null);

    const matchedEvent = receipt!.logs
      .map((log) => {
        try {
          return clob.interface.parseLog(log as EventLog);
        } catch {
          return null;
        }
      })
      .find((parsed): parsed is LogDescription => parsed?.name === "OrderMatched");

    expect(matchedEvent).to.not.equal(undefined);
    if (!matchedEvent) {
      throw new Error("OrderMatched event not found");
    }
    expect(matchedEvent.args[0]).to.equal(expectedMarketKey);
    expect(matchedEvent.args[1]).to.equal(1n);
    expect(matchedEvent.args[2]).to.equal(2n);
    expect(matchedEvent.args[3]).to.equal(2000n);
    expect(matchedEvent.args[4]).to.equal(250n);
  });
});
