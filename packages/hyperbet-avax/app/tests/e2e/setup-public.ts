import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeStageAPublicFixture } from "../../../../hyperbet-bsc/app/tests/e2e/stage-a-public-fixtures";

async function main(): Promise<void> {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(dirname, "../..");
  const statePath = path.resolve(dirname, "./state.json");
  await writeStageAPublicFixture({
    appDir,
    statePath,
    evmChain: "avax",
  });
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
