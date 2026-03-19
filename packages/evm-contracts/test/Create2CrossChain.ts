/**
 * Create2CrossChain.ts
 *
 * Verifies that CREATE2 address predictions are consistent regardless
 * of chain configuration. This test runs offline (no live chain needed)
 * and validates that the init code hash and predicted addresses are
 * deterministic given the same constructor arguments.
 */

import { expect } from "chai";
import { ethers } from "hardhat";

const ARACHNID_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

const ORACLE_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/DuelOutcomeOracle"),
);
const CLOB_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/GoldClob"),
);

const DISPUTE_WINDOW = 3600;

/**
 * Canonical test governance addresses.
 * In production, these would be the same addresses used across all chains.
 */
const CANONICAL_ARGS = {
  admin: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
  reporter: "0x5De5F0Df60a1091247368849582Ee20CDDa210f9",
  finalizer: "0xF4f7d3b3203c8aF01f522d8906200D3DCe295425",
  challenger: "0x5a914F3DeD45B045F5548185ca4663585666C7e4",
  pauser: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
  disputeWindowSeconds: DISPUTE_WINDOW,
  marketOperator: "0x7908b93DF1A91A5e1B83a4538107Db3c9131eED8",
  treasury: "0x0262dC245f38d614d508D8BD680c69E3B6D26F4c",
  marketMaker: "0x1B6C8799998f0a55CA69E6b2886C489861045cFd",
};

function buildInitCode(
  creationBytecode: string,
  encodedArgs: string,
): string {
  return ethers.solidityPacked(
    ["bytes", "bytes"],
    [creationBytecode, encodedArgs],
  );
}

describe("CREATE2 Cross-Chain Address Verification", function () {
  let oracleInitCodeHash: string;
  let clobInitCodeHash: string;
  let predictedOracleAddress: string;
  let predictedClobAddress: string;

  before(async function () {
    // Build oracle init code
    const OracleFactory = await ethers.getContractFactory("DuelOutcomeOracle");
    const oracleArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address", "address", "uint256"],
      [
        CANONICAL_ARGS.admin,
        CANONICAL_ARGS.reporter,
        CANONICAL_ARGS.finalizer,
        CANONICAL_ARGS.challenger,
        CANONICAL_ARGS.pauser,
        CANONICAL_ARGS.disputeWindowSeconds,
      ],
    );
    const oracleInitCode = buildInitCode(OracleFactory.bytecode, oracleArgs);
    oracleInitCodeHash = ethers.keccak256(oracleInitCode);
    predictedOracleAddress = ethers.getCreate2Address(
      ARACHNID_PROXY,
      ORACLE_SALT,
      oracleInitCodeHash,
    );

    // Build CLOB init code — uses predicted oracle address
    const ClobFactory = await ethers.getContractFactory("GoldClob");
    const clobArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address", "address", "address"],
      [
        CANONICAL_ARGS.admin,
        CANONICAL_ARGS.marketOperator,
        predictedOracleAddress,
        CANONICAL_ARGS.treasury,
        CANONICAL_ARGS.marketMaker,
        CANONICAL_ARGS.pauser,
      ],
    );
    const clobInitCode = buildInitCode(ClobFactory.bytecode, clobArgs);
    clobInitCodeHash = ethers.keccak256(clobInitCode);
    predictedClobAddress = ethers.getCreate2Address(
      ARACHNID_PROXY,
      CLOB_SALT,
      clobInitCodeHash,
    );
  });

  describe("Address Determinism", function () {
    it("oracle address should be deterministic from factory + salt + initCodeHash", function () {
      expect(predictedOracleAddress).to.be.properAddress;
      expect(predictedOracleAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("clob address should be deterministic from factory + salt + initCodeHash", function () {
      expect(predictedClobAddress).to.be.properAddress;
      expect(predictedClobAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("computing addresses twice with same args should yield same results", async function () {
      // Recompute from scratch
      const OracleFactory = await ethers.getContractFactory(
        "DuelOutcomeOracle",
      );
      const oracleArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "address", "uint256"],
        [
          CANONICAL_ARGS.admin,
          CANONICAL_ARGS.reporter,
          CANONICAL_ARGS.finalizer,
          CANONICAL_ARGS.challenger,
          CANONICAL_ARGS.pauser,
          CANONICAL_ARGS.disputeWindowSeconds,
        ],
      );
      const oracleInitCode2 = buildInitCode(
        OracleFactory.bytecode,
        oracleArgs,
      );
      const oracleHash2 = ethers.keccak256(oracleInitCode2);
      const oracleAddr2 = ethers.getCreate2Address(
        ARACHNID_PROXY,
        ORACLE_SALT,
        oracleHash2,
      );

      expect(oracleAddr2).to.equal(predictedOracleAddress);
      expect(oracleHash2).to.equal(oracleInitCodeHash);
    });
  });

  describe("Salt Policy", function () {
    it("oracle salt should be keccak256 of versioned name", function () {
      const expected = ethers.keccak256(
        ethers.toUtf8Bytes("hyperbet/v3/DuelOutcomeOracle"),
      );
      expect(ORACLE_SALT).to.equal(expected);
    });

    it("clob salt should be keccak256 of versioned name", function () {
      const expected = ethers.keccak256(
        ethers.toUtf8Bytes("hyperbet/v3/GoldClob"),
      );
      expect(CLOB_SALT).to.equal(expected);
    });

    it("bumping version changes the salt and thus the address", async function () {
      const v4Salt = ethers.keccak256(
        ethers.toUtf8Bytes("hyperbet/v4/DuelOutcomeOracle"),
      );
      expect(v4Salt).to.not.equal(ORACLE_SALT);

      const v4Address = ethers.getCreate2Address(
        ARACHNID_PROXY,
        v4Salt,
        oracleInitCodeHash,
      );
      expect(v4Address).to.not.equal(predictedOracleAddress);
    });
  });

  describe("Constructor Arg Sensitivity", function () {
    it("changing admin address changes the oracle address", async function () {
      const OracleFactory = await ethers.getContractFactory(
        "DuelOutcomeOracle",
      );
      const differentArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "address", "uint256"],
        [
          "0x0000000000000000000000000000000000000001", // different admin
          CANONICAL_ARGS.reporter,
          CANONICAL_ARGS.finalizer,
          CANONICAL_ARGS.challenger,
          CANONICAL_ARGS.pauser,
          CANONICAL_ARGS.disputeWindowSeconds,
        ],
      );
      const differentInitCode = buildInitCode(
        OracleFactory.bytecode,
        differentArgs,
      );
      const differentHash = ethers.keccak256(differentInitCode);
      const differentAddress = ethers.getCreate2Address(
        ARACHNID_PROXY,
        ORACLE_SALT,
        differentHash,
      );

      expect(differentAddress).to.not.equal(predictedOracleAddress);
    });

    it("oracle address propagates to CLOB — changing oracle changes CLOB address", async function () {
      // If oracle address is different, the CLOB constructor gets a different
      // oracle arg, so the CLOB init code hash changes, so the CLOB address changes
      const ClobFactory = await ethers.getContractFactory("GoldClob");
      const differentOracleAddr =
        "0x0000000000000000000000000000000000000042";
      const differentClobArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address", "address", "address"],
        [
          CANONICAL_ARGS.admin,
          CANONICAL_ARGS.marketOperator,
          differentOracleAddr,
          CANONICAL_ARGS.treasury,
          CANONICAL_ARGS.marketMaker,
          CANONICAL_ARGS.pauser,
        ],
      );
      const differentClobInitCode = buildInitCode(
        ClobFactory.bytecode,
        differentClobArgs,
      );
      const differentClobAddress = ethers.getCreate2Address(
        ARACHNID_PROXY,
        CLOB_SALT,
        ethers.keccak256(differentClobInitCode),
      );

      expect(differentClobAddress).to.not.equal(predictedClobAddress);
    });
  });

  describe("Cross-Chain Consistency", function () {
    it("addresses do not depend on chain ID (only on factory + salt + initCode)", function () {
      // CREATE2 address = keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]
      // ChainId is NOT part of the formula.
      // This test is a documentation assertion — if it passes, we confirm
      // that the address computation is chain-agnostic.

      // Compute the same address using raw keccak256 to verify
      const packed = ethers.solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", ARACHNID_PROXY, ORACLE_SALT, oracleInitCodeHash],
      );
      const hash = ethers.keccak256(packed);
      const manualAddress = ethers.getAddress(
        "0x" + hash.slice(26), // last 20 bytes
      );

      expect(manualAddress).to.equal(predictedOracleAddress);
    });
  });
});
