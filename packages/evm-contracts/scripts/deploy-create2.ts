/**
 * deploy-create2.ts
 *
 * Deploys DuelOutcomeOracle and GoldClob via CREATE2 using the
 * Arachnid Deterministic Deployment Proxy to ensure identical
 * addresses across all EVM chains.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-create2.ts --network avaxFuji
 *
 * Env vars (all required for production):
 *   ADMIN_ADDRESS, REPORTER_ADDRESS, FINALIZER_ADDRESS,
 *   CHALLENGER_ADDRESS, PAUSER_ADDRESS, DISPUTE_WINDOW_SECONDS,
 *   MARKET_OPERATOR_ADDRESS, TREASURY_ADDRESS, MARKET_MAKER_ADDRESS
 *
 * The script:
 * 1. Pre-computes deterministic addresses and displays them
 * 2. Verifies the Arachnid proxy exists on-chain
 * 3. Deploys DuelOutcomeOracle via CREATE2
 * 4. Deploys GoldClob via CREATE2 (using oracle's predicted address)
 * 5. Verifies deployed addresses match predictions
 * 6. Writes deployment receipt to deployments/{networkName}.json
 */

import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import {
  ARACHNID_PROXY,
  ORACLE_SALT,
  CLOB_SALT,
  predictAddresses,
} from "./predict-create2-addresses";

// ── Deployment Receipt ───────────────────────────────────────────────

function resolveDeploymentOutputPath(networkName: string): string {
  return path.resolve(__dirname, "..", "deployments", `${networkName}.json`);
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

interface DeploymentReceipt {
  networkName: string;
  chainId: number;
  deployer: string;
  deploymentVersion: string;
  deploymentMethod: "CREATE2";
  factoryAddress: string;
  oracleSalt: string;
  clobSalt: string;
  oracleInitCodeHash: string;
  clobInitCodeHash: string;
  duelOracleAddress: string;
  goldClobAddress: string;
  oracleTxHash: string | null;
  clobTxHash: string | null;
  constructorArgs: Record<string, string | number>;
  timestamp: string;
}

function writeDeploymentReceipt(receipt: DeploymentReceipt): void {
  const outputPath = resolveDeploymentOutputPath(receipt.networkName);
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(receipt, null, 2));
  console.log("\n📝 Deployment receipt written to:", outputPath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCode(
  address: string,
  attempts = 15,
  delayMs = 1000,
): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = await ethers.provider.getCode(address);
    if (code !== "0x") {
      return code;
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return "0x";
}

// ── CREATE2 Deploy Helper ────────────────────────────────────────────

/**
 * Deploy a contract via the Arachnid Deterministic Deployment Proxy.
 *
 * The proxy expects: send(salt32 ++ initCode) to the proxy address.
 * It will deploy the contract at CREATE2(proxy, salt, keccak256(initCode))
 * and return the deployed address.
 */
async function deployViaCreate2(
  salt: string,
  initCode: string,
  expectedAddress: string,
  label: string,
): Promise<string | null> {
  // Check if already deployed at the expected address
  const existingCode = await ethers.provider.getCode(expectedAddress);
  if (existingCode !== "0x") {
    console.log(`  ✅ ${label} already deployed at ${expectedAddress}`);
    return null; // No tx — already deployed
  }

  // Build the payload: salt (32 bytes) + initCode
  const payload = ethers.solidityPacked(["bytes32", "bytes"], [salt, initCode]);

  const [deployer] = await ethers.getSigners();
  console.log(`  🚀 Deploying ${label} via CREATE2...`);

  // Estimate gas dynamically with 20% buffer
  const estimatedGas = await deployer.estimateGas({
    to: ARACHNID_PROXY,
    data: payload,
  });
  const gasLimit = (estimatedGas * 120n) / 100n;

  const tx = await deployer.sendTransaction({
    to: ARACHNID_PROXY,
    data: payload,
    gasLimit,
  });

  console.log(`  ⏳ Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} deployment transaction failed: ${tx.hash}`);
  }

  // Some RPC backends lag briefly between the mined receipt and code availability.
  // Poll for code before treating this as a genuine CREATE2 mismatch.
  const deployedCode = await waitForCode(expectedAddress);
  if (deployedCode === "0x") {
    throw new Error(
      `${label} deployment tx succeeded but no code at ${expectedAddress}. ` +
        `This indicates a CREATE2 address mismatch.`,
    );
  }

  console.log(`  ✅ ${label} deployed at ${expectedAddress}`);
  return tx.hash;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("═══ CREATE2 Deterministic Deployment ═══\n");
  console.log("Network:  ", network.name, `(chainId=${chainId})`);
  console.log("Deployer: ", deployer.address);
  console.log();

  // 1. Verify Arachnid proxy exists
  const proxyCode = await ethers.provider.getCode(ARACHNID_PROXY);
  if (proxyCode === "0x") {
    throw new Error(
      `Arachnid Deterministic Deployment Proxy not found at ${ARACHNID_PROXY} ` +
        `on ${network.name}. This chain may not support it.`,
    );
  }
  console.log("✅ Arachnid proxy verified at", ARACHNID_PROXY);
  console.log();

  // 2. Predict addresses
  const prediction = await predictAddresses();

  console.log("Predicted Addresses:");
  console.log("  DuelOutcomeOracle:", prediction.oracleAddress);
  console.log("  GoldClob:         ", prediction.clobAddress);
  console.log();
  console.log("Constructor Args:");
  console.log(JSON.stringify(prediction.constructorArgs, null, 2));
  console.log();

  // 3. Build init codes
  const OracleFactory = await ethers.getContractFactory("DuelOutcomeOracle");
  const oracleEncodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "address", "uint256"],
    [
      prediction.constructorArgs.admin,
      prediction.constructorArgs.reporter,
      prediction.constructorArgs.finalizer,
      prediction.constructorArgs.challenger,
      prediction.constructorArgs.pauser,
      prediction.constructorArgs.disputeWindowSeconds,
    ],
  );
  const oracleInitCode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [OracleFactory.bytecode, oracleEncodedArgs],
  );

  const ClobFactory = await ethers.getContractFactory("GoldClob");
  const clobEncodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "address", "address"],
    [
      prediction.constructorArgs.admin,
      prediction.constructorArgs.marketOperator,
      prediction.oracleAddress,
      prediction.constructorArgs.treasury,
      prediction.constructorArgs.marketMaker,
      prediction.constructorArgs.pauser,
    ],
  );
  const clobInitCode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [ClobFactory.bytecode, clobEncodedArgs],
  );

  // 4. Deploy Oracle via CREATE2
  console.log("─── Deploying DuelOutcomeOracle ───");
  const oracleTxHash = await deployViaCreate2(
    ORACLE_SALT,
    oracleInitCode,
    prediction.oracleAddress,
    "DuelOutcomeOracle",
  );

  // 5. Deploy CLOB via CREATE2
  console.log("\n─── Deploying GoldClob ───");
  const clobTxHash = await deployViaCreate2(
    CLOB_SALT,
    clobInitCode,
    prediction.clobAddress,
    "GoldClob",
  );

  // 6. Write receipt
  const receipt: DeploymentReceipt = {
    networkName: network.name,
    chainId,
    deployer: deployer.address,
    deploymentVersion: "v3",
    deploymentMethod: "CREATE2",
    factoryAddress: ARACHNID_PROXY,
    oracleSalt: prediction.oracleSalt,
    clobSalt: prediction.clobSalt,
    oracleInitCodeHash: prediction.oracleInitCodeHash,
    clobInitCodeHash: prediction.clobInitCodeHash,
    duelOracleAddress: prediction.oracleAddress,
    goldClobAddress: prediction.clobAddress,
    oracleTxHash,
    clobTxHash,
    constructorArgs: {
      admin: prediction.constructorArgs.admin,
      reporter: prediction.constructorArgs.reporter,
      finalizer: prediction.constructorArgs.finalizer,
      challenger: prediction.constructorArgs.challenger,
      pauser: prediction.constructorArgs.pauser,
      disputeWindowSeconds: prediction.constructorArgs.disputeWindowSeconds,
      marketOperator: prediction.constructorArgs.marketOperator,
      treasury: prediction.constructorArgs.treasury,
      marketMaker: prediction.constructorArgs.marketMaker,
    },
    timestamp: new Date().toISOString(),
  };

  writeDeploymentReceipt(receipt);

  console.log("\n═══ Deployment Complete ═══");
  console.log("DuelOutcomeOracle:", prediction.oracleAddress);
  console.log("GoldClob:         ", prediction.clobAddress);
  console.log(
    "\nThese addresses are identical on every EVM chain with the same args.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
