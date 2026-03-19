import { expect } from "chai";
import { ethers } from "hardhat";

import {
  deployDuelOutcomeOracle,
  type DuelOutcomeOracleContract,
} from "../typed-contracts";

describe("DuelOutcomeOracle", () => {
  async function deployFixture() {
    const [admin, reporter, finalizer, challenger, pauser, other] =
      await ethers.getSigners();
    const oracle: DuelOutcomeOracleContract = await deployDuelOutcomeOracle(
      admin.address,
      reporter.address,
      finalizer.address,
      challenger.address,
      pauser.address,
      3600,
      admin,
    );
    await oracle.waitForDeployment();
    return { oracle, admin, reporter, finalizer, challenger, pauser, other };
  }

  async function seedDuel(
    oracle: DuelOutcomeOracleContract,
    reporter: Awaited<ReturnType<typeof deployFixture>>["reporter"],
    duelKey: string,
  ) {
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    if (now < 2_001n) {
      await advanceToTimestamp(2_001n);
    }
    await oracle.connect(reporter).upsertDuel(
      duelKey,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      1_000,
      2_000,
      3_000,
      "https://example.com/duels/1",
      3,
    );
  }

  async function advanceToTimestamp(target: bigint) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(target)]);
    await ethers.provider.send("evm_mine", []);
  }

  it("rejects zero dispute windows", async () => {
    const [admin, reporter, finalizer, challenger, pauser] =
      await ethers.getSigners();

    await expect(
      deployDuelOutcomeOracle(
        admin.address,
        reporter.address,
        finalizer.address,
        challenger.address,
        pauser.address,
        0,
        admin,
      ),
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory("DuelOutcomeOracle"),
      "InvalidDisputeWindow",
    );
  });

  it("requires proposal then finalization after dispute window", async () => {
    const { oracle, reporter, finalizer } = await deployFixture();
    const duelKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    await seedDuel(oracle, reporter, duelKey);

    const resultHash =
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const replayHash =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const expectedProposalId = await oracle.proposalId(
      duelKey,
      resultHash,
      replayHash,
    );

    await expect(
      oracle
        .connect(reporter)
        .proposeResult(
          duelKey,
          1,
          42,
          replayHash,
          resultHash,
          4_000,
          "https://example.com/duels/1/proposal",
        ),
    )
      .to.emit(oracle, "ResultProposed")
      .withArgs(
        duelKey,
        expectedProposalId,
        1,
        42,
        4_000,
        resultHash,
        replayHash,
        "https://example.com/duels/1/proposal",
      );

    await expect(
      oracle
        .connect(finalizer)
        .finalizeResult(duelKey, "https://example.com/duels/1/final"),
    ).to.be.revertedWithCustomError(oracle, "DisputeWindowActive");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle
        .connect(finalizer)
        .finalizeResult(duelKey, "https://example.com/duels/1/final"),
    ).to.emit(oracle, "DuelResolved");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(6n);
    expect(duel.activeProposalId).to.equal(expectedProposalId);
    expect(duel.winner).to.equal(1n);
  });

  it("blocks finalization for challenged proposals", async () => {
    const { oracle, reporter, finalizer, challenger } = await deployFixture();
    const duelKey =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    await seedDuel(oracle, reporter, duelKey);

    await oracle
      .connect(reporter)
      .proposeResult(
        duelKey,
        2,
        7,
        ethers.keccak256(ethers.toUtf8Bytes("r")),
        ethers.keccak256(ethers.toUtf8Bytes("s")),
        4_000,
        "proposal",
      );

    await expect(oracle.connect(challenger).challengeResult(duelKey, "challenged"))
      .to.emit(oracle, "ResultChallenged");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle.connect(finalizer).finalizeResult(duelKey, "final"),
    ).to.be.revertedWithCustomError(oracle, "NotProposed");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(5n);
  });

  it("prevents unauthorized finalization", async () => {
    const { oracle, reporter, other } = await deployFixture();
    const duelKey =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    await seedDuel(oracle, reporter, duelKey);

    await oracle
      .connect(reporter)
      .proposeResult(
        duelKey,
        1,
        1,
        ethers.keccak256(ethers.toUtf8Bytes("replay")),
        ethers.keccak256(ethers.toUtf8Bytes("result")),
        5_000,
        "proposal",
      );

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle.connect(other).finalizeResult(duelKey, "final"),
    ).to.be.reverted;
  });

  it("rejects proposals before the duel is locked", async () => {
    const { oracle, reporter } = await deployFixture();
    const duelKey =
      "0x5555555555555555555555555555555555555555555555555555555555555555";
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

    await oracle.connect(reporter).upsertDuel(
      duelKey,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      now,
      now + 60n,
      now + 120n,
      "https://example.com/duels/5",
      2,
    );

    await expect(
      oracle.connect(reporter).proposeResult(
        duelKey,
        1,
        99,
        ethers.keccak256(ethers.toUtf8Bytes("replay-5")),
        ethers.keccak256(ethers.toUtf8Bytes("result-5")),
        Number(now + 180n),
        "proposal",
      ),
    ).to.be.revertedWithCustomError(oracle, "DuelNotLocked");
  });

  it("rejects proposals while betting is still open", async () => {
    const { oracle, reporter } = await deployFixture();
    const duelKey =
      "0x6666666666666666666666666666666666666666666666666666666666666666";
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

    await oracle.connect(reporter).upsertDuel(
      duelKey,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      now,
      now + 600n,
      now + 660n,
      "https://example.com/duels/6",
      2,
    );

    await expect(
      oracle.connect(reporter).proposeResult(
        duelKey,
        1,
        99,
        ethers.keccak256(ethers.toUtf8Bytes("replay-6")),
        ethers.keccak256(ethers.toUtf8Bytes("result-6")),
        Number(now + 720n),
        "proposal",
      ),
    ).to.be.revertedWithCustomError(oracle, "DuelNotLocked");
  });

  it("rejects locking before betting closes and allows it at close", async () => {
    const { oracle, reporter } = await deployFixture();
    const duelKey =
      "0x6666666666666666666666666666666666666666666666666666666666666667";
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

    await expect(
      oracle.connect(reporter).upsertDuel(
        duelKey,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        now,
        now + 60n,
        now + 120n,
        "https://example.com/duels/7",
        3,
      ),
    ).to.be.revertedWithCustomError(oracle, "BettingWindowActive");

    await advanceToTimestamp(now + 60n);

    await expect(
      oracle.connect(reporter).upsertDuel(
        duelKey,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        now,
        now + 60n,
        now + 120n,
        "https://example.com/duels/7",
        3,
      ),
    )
      .to.emit(oracle, "DuelUpserted")
      .withArgs(
        duelKey,
        3,
        now,
        now + 60n,
        now + 120n,
        "https://example.com/duels/7",
      );
  });

  it("rejects late challenges after the dispute window expires", async () => {
    const { oracle, reporter, challenger } = await deployFixture();
    const duelKey =
      "0x7777777777777777777777777777777777777777777777777777777777777777";
    await seedDuel(oracle, reporter, duelKey);

    await oracle.connect(reporter).proposeResult(
      duelKey,
      1,
      22,
      ethers.keccak256(ethers.toUtf8Bytes("replay-7")),
      ethers.keccak256(ethers.toUtf8Bytes("result-7")),
      4_000,
      "proposal",
    );

    await advanceToTimestamp(BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3600n);

    await expect(
      oracle.connect(challenger).challengeResult(duelKey, "late-challenge"),
    ).to.be.revertedWithCustomError(oracle, "ChallengeWindowExpired");
  });

  it("allows the emergency pauser to halt oracle transitions without blocking reads", async () => {
    const { oracle, reporter, pauser } = await deployFixture();
    const duelKey =
      "0x4444444444444444444444444444444444444444444444444444444444444444";

    await oracle.connect(pauser).setOraclePaused(true);
    await expect(
      oracle.connect(reporter).upsertDuel(
        duelKey,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        1_000,
        2_000,
        3_000,
        "paused",
        3,
      ),
    ).to.be.revertedWithCustomError(oracle, "OraclePaused");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(0n);
  });

  it("lets admin rotate pausers but rejects unauthorized pause actions", async () => {
    const { oracle, admin, pauser, other } = await deployFixture();

    await expect(
      oracle.connect(other).setOraclePaused(true),
    ).to.be.reverted;

    await expect(oracle.connect(admin).setPauser(other.address, true))
      .to.emit(oracle, "PauserUpdated")
      .withArgs(other.address, true);

    await expect(oracle.connect(other).setOraclePaused(true))
      .to.emit(oracle, "OraclePauseUpdated")
      .withArgs(true, other.address);

    await expect(oracle.connect(admin).setPauser(pauser.address, false))
      .to.emit(oracle, "PauserUpdated")
      .withArgs(pauser.address, false);

    await expect(
      oracle.connect(pauser).setOraclePaused(false),
    ).to.be.reverted;
  });

  it("restricts cancellation to emergency pausers", async () => {
    const { oracle, reporter, pauser, other } = await deployFixture();
    const duelKey =
      "0x8888888888888888888888888888888888888888888888888888888888888888";

    await seedDuel(oracle, reporter, duelKey);

    await expect(
      oracle.connect(other).cancelDuel(duelKey, "unauthorized-cancel"),
    ).to.be.reverted;
    await expect(
      oracle.connect(reporter).cancelDuel(duelKey, "unauthorized-cancel"),
    ).to.be.reverted;

    await expect(
      oracle.connect(pauser).cancelDuel(duelKey, "emergency-cancel"),
    )
      .to.emit(oracle, "DuelCancelled")
      .withArgs(duelKey, "emergency-cancel");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(7n); // CANCELLED
  });
});
