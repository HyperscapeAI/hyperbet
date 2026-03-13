import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const anchorIdlDir = path.join(rootDir, "anchor", "target", "idl");
const appIdlDir = path.join(rootDir, "app", "src", "idl");
const keeperIdlDir = path.join(rootDir, "keeper", "src", "idl");

const programNames = [
  "fight_oracle",
  "gold_clob_market",
  "gold_perps_market",
];

for (const programName of programNames) {
  const sourceFile = path.join(anchorIdlDir, `${programName}.json`);
  if (!existsSync(sourceFile)) {
    throw new Error(`Missing generated Anchor IDL: ${sourceFile}`);
  }

  copyFileSync(sourceFile, path.join(appIdlDir, `${programName}.json`));
  copyFileSync(sourceFile, path.join(keeperIdlDir, `${programName}.json`));
}

console.log("[sync-anchor-artifacts] copied Anchor IDLs into app and keeper");
