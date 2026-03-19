/**
 * predict-create2-addresses.ts
 *
 * Offline tool that computes deterministic CREATE2 addresses for
 * DuelOutcomeOracle and GoldClob using the Arachnid Deterministic
 * Deployment Proxy (0x4e59b44847b379578588920cA78FbF26c0B4956C).
 *
 * Usage:
 *   npx hardhat run scripts/predict-create2-addresses.ts
 *
 * Env vars (all required):
 *   ADMIN_ADDRESS, REPORTER_ADDRESS, FINALIZER_ADDRESS,
 *   CHALLENGER_ADDRESS, PAUSER_ADDRESS, DISPUTE_WINDOW_SECONDS,
 *   MARKET_OPERATOR_ADDRESS, TREASURY_ADDRESS, MARKET_MAKER_ADDRESS
 */

import { ethers } from "hardhat";

// ── Arachnid Deterministic Deployment Proxy ──────────────────────────
export const ARACHNID_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

// ── Salt Policy ──────────────────────────────────────────────────────
export const ORACLE_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/DuelOutcomeOracle"),
);
export const CLOB_SALT = ethers.keccak256(
  ethers.toUtf8Bytes("hyperbet/v3/GoldClob"),
);

// ── Helpers ──────────────────────────────────────────────────────────

export interface Create2Prediction {
  oracleAddress: string;
  clobAddress: string;
  oracleSalt: string;
  clobSalt: string;
  oracleInitCodeHash: string;
  clobInitCodeHash: string;
  constructorArgs: {
    admin: string;
    reporter: string;
    finalizer: string;
    challenger: string;
    pauser: string;
    disputeWindowSeconds: number;
    marketOperator: string;
    treasury: string;
    marketMaker: string;
  };
}

/**
 * Build the full init code (creation code + ABI-encoded constructor args)
 * for a contract and return its keccak256 hash.
 */
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

/**
 * Compute CREATE2 address: keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
 */
function computeCreate2Address(
  factory: string,
  salt: string,
  codeHash: string,
): string {
  return ethers.getCreate2Address(factory, salt, codeHash);
}

/**
 * Resolve governance addresses from environment variables with validation.
 */
function resolveGovernanceArgs(): Create2Prediction["constructorArgs"] {
  const admin = requireEnvAddress("ADMIN_ADDRESS");
  const reporter = requireEnvAddress("REPORTER_ADDRESS");
  const finalizer = requireEnvAddress("FINALIZER_ADDRESS");
  const challenger = requireEnvAddress("CHALLENGER_ADDRESS");
  const pauser =
    process.env.PAUSER_ADDRESS?.trim() || admin;
  const disputeWindowSeconds = parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  const marketOperator = requireEnvAddress("MARKET_OPERATOR_ADDRESS");
  const treasury = requireEnvAddress("TREASURY_ADDRESS");
  const marketMaker = requireEnvAddress("MARKET_MAKER_ADDRESS");

  if (!ethers.isAddress(pauser)) {
    throw new Error(`Invalid PAUSER_ADDRESS: ${pauser}`);
  }
  if (disputeWindowSeconds <= 0) {
    throw new Error(
      `DISPUTE_WINDOW_SECONDS must be > 0, got: ${disputeWindowSeconds}`,
    );
  }

  return {
    admin,
    reporter,
    finalizer,
    challenger,
    pauser,
    disputeWindowSeconds,
    marketOperator,
    treasury,
    marketMaker,
  };
}

function requireEnvAddress(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !ethers.isAddress(value)) {
    throw new Error(
      `Missing or invalid env var ${name}: "${value || ""}"`,
    );
  }
  return value;
}

/**
 * Predict CREATE2 addresses for both contracts.
 */
export async function predictAddresses(): Promise<Create2Prediction> {
  const args = resolveGovernanceArgs();

  // Oracle: constructor(admin, reporter, finalizer, challenger, pauser, disputeWindowSeconds)
  const OracleFactory = await ethers.getContractFactory("DuelOutcomeOracle");
  const oracleEncodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "address", "uint256"],
    [
      args.admin,
      args.reporter,
      args.finalizer,
      args.challenger,
      args.pauser,
      args.disputeWindowSeconds,
    ],
  );
  const oracleCodeHash = initCodeHash(
    OracleFactory.bytecode,
    oracleEncodedArgs,
  );
  const oracleAddress = computeCreate2Address(
    ARACHNID_PROXY,
    ORACLE_SALT,
    oracleCodeHash,
  );

  // CLOB: constructor(admin, marketOperator, oracle, treasury, marketMaker, pauser)
  const ClobFactory = await ethers.getContractFactory("GoldClob");
  const clobEncodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "address", "address"],
    [
      args.admin,
      args.marketOperator,
      oracleAddress, // deterministic oracle address as constructor arg
      args.treasury,
      args.marketMaker,
      args.pauser,
    ],
  );
  const clobCodeHash = initCodeHash(ClobFactory.bytecode, clobEncodedArgs);
  const clobAddress = computeCreate2Address(
    ARACHNID_PROXY,
    CLOB_SALT,
    clobCodeHash,
  );

  return {
    oracleAddress,
    clobAddress,
    oracleSalt: ORACLE_SALT,
    clobSalt: CLOB_SALT,
    oracleInitCodeHash: oracleCodeHash,
    clobInitCodeHash: clobCodeHash,
    constructorArgs: args,
  };
}

// ── CLI entry point ──────────────────────────────────────────────────
async function main() {
  console.log("═══ CREATE2 Address Prediction ═══\n");

  const prediction = await predictAddresses();

  console.log("Constructor Arguments:");
  console.log(JSON.stringify(prediction.constructorArgs, null, 2));
  console.log();
  console.log("Salt (oracle):", prediction.oracleSalt);
  console.log("Salt (clob):  ", prediction.clobSalt);
  console.log();
  console.log("Init Code Hash (oracle):", prediction.oracleInitCodeHash);
  console.log("Init Code Hash (clob):  ", prediction.clobInitCodeHash);
  console.log();
  console.log("═══ Predicted Addresses ═══");
  console.log("DuelOutcomeOracle:", prediction.oracleAddress);
  console.log("GoldClob:         ", prediction.clobAddress);
  console.log();
  console.log(
    "These addresses will be identical on ANY EVM chain using the",
  );
  console.log("same constructor arguments and deployer factory.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
