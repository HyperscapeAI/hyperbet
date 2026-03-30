import { execSync } from "child_process";

const DEPLOYER_KEY = process.env.TESTNET_DEPLOYER_PRIVATE_KEY;
if (!DEPLOYER_KEY) {
  console.error("TESTNET_DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const SIGNERS = [
  "0xFC951Ead43344CaBF775E077dcf3334BAe228730",
  "0x785fceED2d6ab37e5a22329E2ED496427A58CbE2",
  "0x62e7028DEe826a2a6F811021a5eAA379713A36C6",
];

const CHAINS = [
  { name: "BSC Testnet", rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", amount: "0.005ether" },
  { name: "AVAX Fuji", rpc: "https://api.avax-test.network/ext/bc/C/rpc", amount: "0.02ether" },
];

for (const chain of CHAINS) {
  console.log(`\n=== ${chain.name} ===`);
  for (const signer of SIGNERS) {
    console.log(`Sending ${chain.amount} to ${signer}...`);
    try {
      const result = execSync(
        `cast send "${signer}" --value ${chain.amount} --rpc-url "${chain.rpc}" --private-key "${DEPLOYER_KEY}"`,
        { encoding: "utf-8", timeout: 30000 }
      );
      const txHash = result.match(/transactionHash\s+(0x[a-f0-9]+)/i);
      console.log(`  ✓ tx: ${txHash ? txHash[1] : "sent"}`);
    } catch (e: any) {
      console.error(`  ✗ Failed: ${e.message?.split("\n")[0]}`);
    }
  }
}

console.log("\n=== Verifying balances ===");
for (const chain of CHAINS) {
  console.log(`\n${chain.name}:`);
  for (const signer of SIGNERS) {
    try {
      const bal = execSync(
        `cast balance "${signer}" --rpc-url "${chain.rpc}" --ether`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();
      console.log(`  ${signer.slice(0, 10)}...: ${bal}`);
    } catch {
      console.log(`  ${signer.slice(0, 10)}...: check failed`);
    }
  }
}
