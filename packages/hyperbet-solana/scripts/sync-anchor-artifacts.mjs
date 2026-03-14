import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const anchorIdlDir = path.join(rootDir, "anchor", "target", "idl");
const anchorTypesDir = path.join(rootDir, "anchor", "target", "types");
const appIdlDir = path.join(rootDir, "app", "src", "idl");
const keeperIdlDir = path.join(rootDir, "keeper", "src", "idl");

const programNames = [
  "fight_oracle",
  "lvr_amm",
  "gold_perps_market",
];

for (const programName of programNames) {
  const sourceFile = path.join(anchorIdlDir, `${programName}.json`);
  if (!existsSync(sourceFile)) {
    throw new Error(`Missing generated Anchor IDL: ${sourceFile}`);
  }

  cpSync(sourceFile, path.join(appIdlDir, `${programName}.json`));
  cpSync(sourceFile, path.join(keeperIdlDir, `${programName}.json`));

  const sourceTypeFile = path.join(anchorTypesDir, `${programName}.ts`);
  if (existsSync(sourceTypeFile)) {
    cpSync(sourceTypeFile, path.join(appIdlDir, `${programName}.ts`));
    cpSync(sourceTypeFile, path.join(keeperIdlDir, `${programName}.ts`));
  }
}

console.log(
  "[sync-anchor-artifacts] copied Anchor IDLs and generated types into app and keeper",
);
