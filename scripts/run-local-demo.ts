import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { runDoctor } from "./dev-doctor";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

const packageByTarget: Record<string, string> = {
  solana: "packages/hyperbet-solana",
  bsc: "packages/hyperbet-bsc",
  avax: "packages/hyperbet-avax",
};

if (!target || !packageByTarget[target]) {
  console.error("Usage: bun scripts/run-local-demo.ts <solana|bsc|avax>");
  process.exit(1);
}

const doctor = runDoctor();
const missingInstalls = doctor.messages.some(
  (message) =>
    message === "root node_modules missing" ||
    message.startsWith("missing install for "),
);

if (!doctor.ok || missingInstalls) {
  console.error("Local demo prerequisites are not satisfied. Run `bun run dev:doctor`.");
  process.exit(1);
}

const packageDir = path.join(rootDir, packageByTarget[target]);
const result = spawnSync("bun", ["run", "dev:local"], {
  cwd: packageDir,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
