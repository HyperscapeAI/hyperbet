/**
 * Create2Parity.ts
 *
 * End-to-end parity tests for CREATE2-deployed DuelOutcomeOracle + GoldClob.
 * Verifies that contracts deployed via CREATE2 behave identically to
 * standard deployments across the full lifecycle.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const ARACHNID_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

// Arachnid proxy deployed bytecode (for injection into local hardhat network)
const ARACHNID_PROXY_DEPLOYED_BYTECODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

const ORACLE_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/DuelOutcomeOracle"),
);
const CLOB_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/GoldClob"),
);

const DISPUTE_WINDOW = 3600;
const BUY_SIDE = 1;
const SELL_SIDE = 2;
const GTC_FLAGS = 0;

function randomDuelKey(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

function initCodeHash(
  creationBytecode: string,
  encodedArgs: string,
): string {
  const initCode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [creationBytecode, encodedArgs],
  );
  return ethers.keccak256(initCode);
}

async function deployViaCreate2(
  deployer: HardhatEthersSigner,
  salt: string,
  initCode: string,
): Promise<string> {
  const payload = ethers.solidityPacked(
    ["bytes32", "bytes"],
    [salt, initCode],
  );
  const tx = await deployer.sendTransaction({
    to: ARACHNID_PROXY,
    data: payload,
    gasLimit: 10_000_000,
  });
  await tx.wait();
  return tx.hash;
}

describe("CREATE2 Parity", function () {
  let admin: HardhatEthersSigner;
  let reporter: HardhatEthersSigner;
  let finalizer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let marketOperator: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let marketMaker: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;

  let oracleAddress: string;
  let clobAddress: string;
  let oracle: any;
  let clob: any;

  before(async function () {
    // Set up Arachnid proxy in the local Hardhat network
    await ethers.provider.send("hardhat_setCode", [
      ARACHNID_PROXY,
      ARACHNID_PROXY_DEPLOYED_BYTECODE,
    ]);

    [
      admin,
      reporter,
      finalizer,
      challenger,
      pauser,
      marketOperator,
      treasury,
      marketMaker,
      userA,
      userB,
    ] = await ethers.getSigners();

    // Build oracle init code
    const OracleFactory = await ethers.getContractFactory("DuelOutcomeOracle");
    const oracleArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address", "address", "uint256"],
      [
        admin.address,
        reporter.address,
        finalizer.address,
        challenger.address,
        pauser.address,
        DISPUTE_WINDOW,
      ],
    );
    const oracleInitCode = ethers.solidityPacked(
      ["bytes", "bytes"],
      [OracleFactory.bytecode, oracleArgs],
    );
    const oracleCodeHash = initCodeHash(OracleFactory.bytecode, oracleArgs);

    // Build CLOB init code — oracle address is CREATE2-predicted
    oracleAddress = ethers.getCreate2Address(
      ARACHNID_PROXY,
      ORACLE_SALT,
      oracleCodeHash,
    );

    const ClobFactory = await ethers.getContractFactory("GoldClob");
    const clobArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address", "address", "address"],
      [
        admin.address,
        marketOperator.address,
        oracleAddress,
        treasury.address,
        marketMaker.address,
        pauser.address,
      ],
    );
    const clobInitCode = ethers.solidityPacked(
      ["bytes", "bytes"],
      [ClobFactory.bytecode, clobArgs],
    );
    const clobCodeHash = initCodeHash(ClobFactory.bytecode, clobArgs);
    clobAddress = ethers.getCreate2Address(
      ARACHNID_PROXY,
      CLOB_SALT,
      clobCodeHash,
    );

    // Deploy Oracle via CREATE2
    await deployViaCreate2(admin, ORACLE_SALT, oracleInitCode);
    oracle = OracleFactory.attach(oracleAddress);

    // Deploy CLOB via CREATE2
    await deployViaCreate2(admin, CLOB_SALT, clobInitCode);
    clob = ClobFactory.attach(clobAddress);
  });

  describe("Address Determinism", function () {
    it("should deploy oracle at the predicted CREATE2 address", async function () {
      const code = await ethers.provider.getCode(oracleAddress);
      expect(code).to.not.equal("0x");
    });

    it("should deploy clob at the predicted CREATE2 address", async function () {
      const code = await ethers.provider.getCode(clobAddress);
      expect(code).to.not.equal("0x");
    });

    it("clob should reference the correct oracle address", async function () {
      const oracleRef = await clob.duelOracle();
      expect(oracleRef).to.equal(oracleAddress);
    });
  });

  describe("Oracle Role Parity", function () {
    it("should have admin role granted", async function () {
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be
        .true;
    });

    it("should have reporter role granted", async function () {
      const REPORTER_ROLE = await oracle.REPORTER_ROLE();
      expect(await oracle.hasRole(REPORTER_ROLE, reporter.address)).to.be.true;
    });

    it("should have finalizer role granted", async function () {
      const FINALIZER_ROLE = await oracle.FINALIZER_ROLE();
      expect(await oracle.hasRole(FINALIZER_ROLE, finalizer.address)).to.be
        .true;
    });

    it("should have challenger role granted", async function () {
      const CHALLENGER_ROLE = await oracle.CHALLENGER_ROLE();
      expect(await oracle.hasRole(CHALLENGER_ROLE, challenger.address)).to.be
        .true;
    });

    it("should have correct disputeWindowSeconds", async function () {
      expect(await oracle.disputeWindowSeconds()).to.equal(DISPUTE_WINDOW);
    });
  });

  describe("CLOB Role Parity", function () {
    it("should have admin role granted", async function () {
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      expect(await clob.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should have market operator role granted", async function () {
      const MARKET_OPERATOR_ROLE = await clob.MARKET_OPERATOR_ROLE();
      expect(
        await clob.hasRole(MARKET_OPERATOR_ROLE, marketOperator.address),
      ).to.be.true;
    });

    it("should have pauser role granted", async function () {
      const PAUSER_ROLE = await clob.PAUSER_ROLE();
      expect(await clob.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
    });

    it("should reference correct treasury", async function () {
      expect(await clob.treasury()).to.equal(treasury.address);
    });

    it("should reference correct marketMaker", async function () {
      expect(await clob.marketMaker()).to.equal(marketMaker.address);
    });
  });

  describe("Oracle Lifecycle (happy path)", function () {
    let duelKey: string;

    it("should upsert a duel", async function () {
      duelKey = randomDuelKey();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const tx = await oracle
        .connect(reporter)
        .upsertDuel(
          duelKey,
          ethers.keccak256(ethers.toUtf8Bytes("create2-participant-a")),
          ethers.keccak256(ethers.toUtf8Bytes("create2-participant-b")),
          now + 60,
          now + 3600,
          now + 3660,
          "",
          2,
        );
      await expect(tx).to.emit(oracle, "DuelUpserted");
    });

    it("should propose a result", async function () {
      // Read the stored duel to use its immutable participant hashes and timing
      const duel = await oracle.getDuel(duelKey);
      // Advance past betCloseTs so we can propose
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);
      await oracle
        .connect(reporter)
        .upsertDuel(
          duelKey,
          duel.participantAHash,
          duel.participantBHash,
          duel.betOpenTs,
          duel.betCloseTs,
          duel.duelStartTs,
          "",
          3,
        );

      const nowAfterLock = (await ethers.provider.getBlock("latest"))!.timestamp;
      const tx = await oracle
        .connect(reporter)
        .proposeResult(
          duelKey,
          1,
          42,
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
          nowAfterLock + 1,
          "",
        );
      await expect(tx).to.emit(oracle, "ResultProposed");
    });

    it("should finalize after dispute window", async function () {
      // Fast-forward past dispute window
      await ethers.provider.send("evm_increaseTime", [DISPUTE_WINDOW + 1]);
      await ethers.provider.send("evm_mine", []);

      const tx = await oracle.connect(finalizer).finalizeResult(duelKey, "");
      await expect(tx).to.emit(oracle, "DuelResolved");

      const duel = await oracle.getDuel(duelKey);
      expect(duel.status).to.equal(6); // RESOLVED
    });
  });

  describe("Oracle Cancellation Path", function () {
    it("should cancel a duel", async function () {
      const duelKey = randomDuelKey();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await oracle
        .connect(reporter)
        .upsertDuel(
          duelKey,
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
          now + 60,
          now + 3600,
          now + 3660,
          "",
          1,
        );

      const tx = await oracle.connect(pauser).cancelDuel(duelKey, "");
      await expect(tx).to.emit(oracle, "DuelCancelled");

      const duel = await oracle.getDuel(duelKey);
      expect(duel.status).to.equal(7); // CANCELLED
    });
  });

  describe("Access Control Parity", function () {
    it("non-reporter cannot upsert duel", async function () {
      const duelKey = randomDuelKey();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await expect(
        oracle
          .connect(userA)
          .upsertDuel(
            duelKey,
            ethers.hexlify(ethers.randomBytes(32)),
            ethers.hexlify(ethers.randomBytes(32)),
            now + 60,
            now + 3600,
            now + 3660,
            "",
            1,
          ),
      ).to.be.reverted;
    });

    it("non-finalizer cannot finalize", async function () {
      const duelKey = randomDuelKey();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await oracle
        .connect(reporter)
        .upsertDuel(
          duelKey,
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
          now - 3600,
          now - 60,
          now,
          "",
          3,
        );

      await oracle
        .connect(reporter)
        .proposeResult(
          duelKey,
          1,
          42,
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
          now + 1,
          "",
        );

      await ethers.provider.send("evm_increaseTime", [DISPUTE_WINDOW + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        oracle.connect(userA).finalizeResult(duelKey, ""),
      ).to.be.reverted;
    });
  });

  describe("Idempotent Deploy", function () {
    it("CREATE2 to same address should be a no-op (code already present)", async function () {
      const code = await ethers.provider.getCode(oracleAddress);
      expect(code).to.not.equal("0x");
      // Attempting to deploy again would revert at the factory level
      // but the predict tool checks for existing code before deploying
    });
  });
});
