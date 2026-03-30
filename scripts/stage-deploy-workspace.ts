import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

type KeeperTarget = "keeper:bsc" | "keeper:avax" | "keeper:solana";

const rootDir = path.resolve(import.meta.dirname, "..");

function parseTarget(argv: string[]): KeeperTarget {
  const targetArg = argv.find((arg) => arg.startsWith("--target="));
  const target = targetArg?.slice("--target=".length) as KeeperTarget | undefined;
  if (target === "keeper:bsc" || target === "keeper:avax" || target === "keeper:solana") {
    return target;
  }
  throw new Error("usage: node --import tsx scripts/stage-deploy-workspace.ts --target=keeper:bsc|keeper:avax|keeper:solana");
}

function ensureCleanDirectory(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function copyPackageDir(relativeDir: string, destinationRoot: string) {
  const sourceDir = path.join(rootDir, relativeDir);
  const destinationDir = path.join(destinationRoot, relativeDir);
  if (!existsSync(sourceDir)) {
    throw new Error(`missing package directory: ${relativeDir}`);
  }
  mkdirSync(path.dirname(destinationDir), { recursive: true });
  cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const base = path.basename(entry);
      if (base === "node_modules" || base === "dist" || base === ".turbo" || base === ".git") {
        return false;
      }
      return true;
    },
  });
}

function buildWorkspaceManifest(workspaces: string[]) {
  const rootPackagePath = path.join(rootDir, "package.json");
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  rootPackage.workspaces = workspaces;
  return rootPackage;
}

function stagePackageRootManifest(relativeDir: string, destinationRoot: string) {
  const packageJsonPath = path.join(rootDir, relativeDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`missing package manifest: ${relativeDir}/package.json`);
  }
  const destinationPath = path.join(destinationRoot, relativeDir, "package.json");
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, readFileSync(packageJsonPath));
}

function stageForTarget(target: KeeperTarget) {
  const keeperDirByTarget: Record<KeeperTarget, string> = {
    "keeper:bsc": path.join(rootDir, "packages/hyperbet-bsc/keeper"),
    "keeper:avax": path.join(rootDir, "packages/hyperbet-avax/keeper"),
    "keeper:solana": path.join(rootDir, "packages/hyperbet-solana/keeper"),
  };
  const sharedPackagesByTarget: Record<KeeperTarget, string[]> = {
    "keeper:bsc": [
      "packages/hyperbet-chain-registry",
      "packages/hyperbet-mm-core",
      "packages/hyperbet-evm-keeper-core",
    ],
    "keeper:avax": [
      "packages/hyperbet-chain-registry",
      "packages/hyperbet-mm-core",
      "packages/hyperbet-evm-keeper-core",
    ],
    "keeper:solana": [
      "packages/hyperbet-chain-registry",
      "packages/hyperbet-mm-core",
      "packages/market-maker-bot",
    ],
  };
  const packageRootByTarget: Record<KeeperTarget, string> = {
    "keeper:bsc": "packages/hyperbet-bsc",
    "keeper:avax": "packages/hyperbet-avax",
    "keeper:solana": "packages/hyperbet-solana",
  };

  const keeperDir = keeperDirByTarget[target];
  const workspacePackagesRoot = path.join(keeperDir, "workspace-packages");
  ensureCleanDirectory(workspacePackagesRoot);
  stagePackageRootManifest(packageRootByTarget[target], workspacePackagesRoot);
  for (const packageDir of sharedPackagesByTarget[target]) {
    copyPackageDir(packageDir, workspacePackagesRoot);
  }

  const workspaceManifest = buildWorkspaceManifest([
    packageRootByTarget[target],
    `${packageRootByTarget[target]}/keeper`,
    ...sharedPackagesByTarget[target],
  ]);
  writeFileSync(
    path.join(keeperDir, "workspace.package.json"),
    JSON.stringify(workspaceManifest, null, 2) + "\n",
  );
  writeWorkspaceLockfile(keeperDir, workspacePackagesRoot, packageRootByTarget[target], workspaceManifest);
}

function writeWorkspaceLockfile(
  keeperDir: string,
  workspacePackagesRoot: string,
  packageRoot: string,
  workspaceManifest: Record<string, unknown>,
) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hyperbet-deploy-workspace-"));
  try {
    const tempPackagesRoot = path.join(tempRoot, "packages");
    mkdirSync(tempPackagesRoot, { recursive: true });
    writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify(workspaceManifest, null, 2) + "\n");
    cpSync(path.join(rootDir, "bun.lock"), path.join(tempRoot, "bun.lock"), { force: true });
    cpSync(path.join(workspacePackagesRoot, "packages"), tempPackagesRoot, { recursive: true, force: true });

    const keeperPackageJson = path.join(rootDir, packageRoot, "keeper", "package.json");
    const tempKeeperPackageJson = path.join(tempRoot, packageRoot, "keeper", "package.json");
    mkdirSync(path.dirname(tempKeeperPackageJson), { recursive: true });
    cpSync(keeperPackageJson, tempKeeperPackageJson, { force: true });

    execFileSync("bun", ["install", "--lockfile-only"], {
      cwd: tempRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: path.join(tempRoot, ".bun-cache"),
      },
    });

    cpSync(path.join(tempRoot, "bun.lock"), path.join(keeperDir, "workspace.bun.lock"), { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to generate staged workspace lockfile for ${packageRoot}: ${message}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const target = parseTarget(process.argv.slice(2));
stageForTarget(target);
