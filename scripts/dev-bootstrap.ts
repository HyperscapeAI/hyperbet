import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { runDoctor } from "./dev-doctor";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[], cwd = rootDir): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const doctor = runDoctor();
if (doctor.missingTools.length > 0 || doctor.versionMismatches.length > 0) {
  console.error("Refusing to bootstrap until required tools and pinned versions match.");
  process.exit(1);
}

run("bun", ["install"], rootDir);

run("bash", [
  "scripts/ci-install-verified.sh",
  "root",
  "hyperbet-solana-anchor",
  "hyperbet-solana-app",
  "hyperbet-solana-keeper",
  "hyperbet-bsc-app",
  "hyperbet-bsc-keeper",
  "hyperbet-avax-app",
  "hyperbet-avax-keeper",
]);
