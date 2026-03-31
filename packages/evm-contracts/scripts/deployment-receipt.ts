import fs from "node:fs";
import path from "node:path";

export type DeploymentReceipt = Record<string, unknown>;

export function resolveDeploymentReceiptPath(networkName: string): string {
  return path.resolve(__dirname, "..", "deployments", `${networkName}.json`);
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function stripUndefined(payload: DeploymentReceipt): DeploymentReceipt {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

export function loadDeploymentReceipt(
  networkName: string,
): DeploymentReceipt | null {
  const outputPath = resolveDeploymentReceiptPath(networkName);
  if (!fs.existsSync(outputPath)) return null;
  return JSON.parse(fs.readFileSync(outputPath, "utf8")) as DeploymentReceipt;
}

export function writeDeploymentReceipt(
  networkName: string,
  payload: DeploymentReceipt,
): void {
  const outputPath = resolveDeploymentReceiptPath(networkName);
  ensureDir(outputPath);
  const merged = {
    ...(loadDeploymentReceipt(networkName) ?? {}),
    ...stripUndefined(payload),
  };
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2) + "\n");
  console.log("Deployment receipt written to:", outputPath);
}
