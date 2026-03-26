import { fileURLToPath } from "node:url";

import { runEvmCanary } from "../../../../scripts/staged-proof-evm-common";

async function main(): Promise<void> {
  const result = await runEvmCanary("bsc");
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
