import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncStageAProgramKeypairs } from "./stage-a-identity";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function main(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(__dirname, "..");
  const anchorRoot = path.join(packageRoot, "anchor");
  const manifest = syncStageAProgramKeypairs(anchorRoot, {
    rotate: hasFlag("--rotate"),
  });

  console.log(
    JSON.stringify(
      {
        root: manifest.root,
        syncedAt: manifest.syncedAt,
        programs: manifest.programs,
      },
      null,
      2,
    ),
  );
}

main();
