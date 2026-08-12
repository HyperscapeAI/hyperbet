import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  cpSync,
  existsSync,
  writeFileSync,
  readFileSync,
  createWriteStream,
  type WriteStream,
  openSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function buildCommandEnv(extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? "";
  const pathEntries = [
    process.env.PATH ?? "",
    "/opt/homebrew/bin",
    home ? path.join(home, ".bun", "bin") : "",
    home ? path.join(home, ".cargo", "bin") : "",
    home
      ? path.join(home, ".local", "share", "solana", "install", "active_release", "bin")
      : "",
  ]
    .flatMap((entry) => entry.split(path.delimiter))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    ...process.env,
    ...extraEnv,
    PATH: Array.from(new Set(pathEntries)).join(path.delimiter),
  };
}

export function resolveArtifactRoot(name: string): string {
  const base =
    process.env.HYPERBET_CI_ARTIFACT_DIR?.trim() ||
    path.join(rootDir, ".ci-artifacts");
  const target = path.join(base, name);
  mkdirSync(target, { recursive: true });
  return target;
}

export function writeJsonArtifact(
  artifactRoot: string,
  relativePath: string,
  value: unknown,
): string {
  const filePath = path.join(artifactRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

export function copyIntoArtifacts(
  artifactRoot: string,
  sourcePath: string,
  relativePath?: string,
): void {
  if (!existsSync(sourcePath)) return;
  const targetPath = path.join(
    artifactRoot,
    relativePath ?? path.basename(sourcePath),
  );
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

export function materializeCiSolanaWallet(
  walletPath: string,
  homeDir: string,
): void {
  if (!existsSync(walletPath)) {
    throw new Error(`missing bootstrap wallet at ${walletPath}`);
  }

  const payload = readFileSync(walletPath, "utf8");
  const targets = [
    path.join(homeDir, ".config", "solana", "id.json"),
    path.join(homeDir, ".config", "solana", "hyperia-keys", "deployer.json"),
  ];

  for (const target of targets) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, payload, "utf8");
  }
}

export function runSync(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: buildCommandEnv(options.env),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdoutFile?: string;
    stderrFile?: string;
  } = {},
): Promise<void> {
  if (options.stdoutFile) {
    mkdirSync(path.dirname(options.stdoutFile), { recursive: true });
    writeFileSync(options.stdoutFile, "");
  }
  if (options.stderrFile) {
    mkdirSync(path.dirname(options.stderrFile), { recursive: true });
    writeFileSync(options.stderrFile, "");
  }
  await new Promise<void>((resolve, reject) => {
    const streams: WriteStream[] = [];
    const finalizeStreams = () =>
      Promise.all(
        streams.map(
          (stream) =>
            new Promise<void>((streamResolve) => {
              if (stream.closed || stream.destroyed) {
                streamResolve();
                return;
              }
              stream.once("finish", () => streamResolve());
              stream.end();
            }),
        ),
      );
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: buildCommandEnv(options.env),
      stdio: [
        "ignore",
        options.stdoutFile ? "pipe" : "inherit",
        options.stderrFile ? "pipe" : "inherit",
      ],
    });
    if (options.stdoutFile && child.stdout) {
      const out = createWriteStream(options.stdoutFile, { flags: "a" });
      streams.push(out);
      child.stdout.pipe(process.stdout);
      child.stdout.pipe(out);
    }
    if (options.stderrFile && child.stderr) {
      const err = createWriteStream(options.stderrFile, { flags: "a" });
      streams.push(err);
      child.stderr.pipe(process.stderr);
      child.stderr.pipe(err);
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      void finalizeStreams().then(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? 1}`));
      }, reject);
    });
  });
}

export async function spawnBackground(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logFile: string;
  },
): Promise<{ pid: number; stop: (options?: { timeoutMs?: number }) => Promise<void> }> {
  mkdirSync(path.dirname(options.logFile), { recursive: true });
  writeFileSync(options.logFile, "");
  const logFd = openSync(options.logFile, "a");
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    env: buildCommandEnv(options.env),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  if (!child.pid) {
    closeSync(logFd);
    throw new Error(`failed to start background command: ${command}`);
  }
  let logClosed = false;
  const closeLog = () => {
    if (logClosed) {
      return;
    }
    logClosed = true;
    closeSync(logFd);
  };
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      closeLog();
      resolve();
    });
    child.once("error", () => {
      closeLog();
      resolve();
    });
  });
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  let stopPromise: Promise<void> | null = null;
  const pid = child.pid;
  child.unref();

  const terminateProcessGroup = (signal: NodeJS.Signals) => {
    if (!pid) {
      return;
    }

    const groupPid = -pid;
    try {
      process.kill(groupPid, signal);
      return;
    } catch {
      // On some platforms/process types, negative PIDs may fail.
    }

    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited.
    }
  };

  return {
    pid,
    stop: async (stopOptions = {}) => {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        const timeoutMs = Math.max(1_000, stopOptions.timeoutMs ?? 10_000);

        if (child.exitCode != null || child.signalCode != null) {
          await exitPromise;
          return;
        }

        try {
          terminateProcessGroup("SIGTERM");
        } catch {
          await exitPromise;
          return;
        }

        const exitedAfterTerm = await Promise.race([
          exitPromise.then(() => true),
          sleep(timeoutMs).then(() => false),
        ]);
        if (exitedAfterTerm) {
          return;
        }

        try {
          terminateProcessGroup("SIGKILL");
        } catch {
          // Process already exited between timeout and escalation.
        }

        await Promise.race([exitPromise, sleep(2_000)]);
        closeLog();
      })();

      return stopPromise;
    },
  };
}

export async function waitForJsonEndpoint(
  url: string,
  options: {
    timeoutMs?: number;
    validate?: (payload: any) => boolean;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "endpoint did not become ready";
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const text = await response.text();
      if (!response.ok) {
        lastError = text.trim() || `${response.status} ${response.statusText}`;
      } else {
        const payload = JSON.parse(text || "null");
        if (!options.validate || options.validate(payload)) return;
        lastError = `validation failed for ${url}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(lastError);
}

export async function findAvailablePort(preferredPort: number): Promise<number> {
  const { createServer } = await import("node:net");

  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const assignedPort =
          typeof address === "object" && address ? address.port : port;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(assignedPort);
        });
      });
    });

  try {
    return await tryPort(preferredPort);
  } catch {
    return tryPort(0);
  }
}
