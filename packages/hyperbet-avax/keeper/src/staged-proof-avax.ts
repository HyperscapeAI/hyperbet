import { fileURLToPath } from "node:url";

import { runEvmCanary } from "../../../../scripts/staged-proof-evm-common";

async function main(): Promise<void> {
  const result = await runEvmCanary("avax");
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
