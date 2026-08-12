import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveArtifactRoot, rootDir, writeJsonArtifact } from "./ci-lib";

type CliOptions = {
  url?: string;
  timeoutMs: number;
};

type FrameState = {
  source: "page" | "iframe";
  href: string;
  title: string;
  bodyPreview: string;
  streamReady: boolean | null;
  rendererHealth: {
    ready?: boolean | null;
    degradedReason?: string | null;
    updatedAt?: number | null;
    phase?: string | null;
  } | null;
  canvasCount: number;
};

type ProbeSnapshot = {
  checkedAt: string;
  page: FrameState;
  frames: FrameState[];
  bestState: FrameState | null;
};

type PlaywrightRuntime = {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<{
      newContext(options?: Record<string, unknown>): Promise<{
        newPage(): Promise<any>;
        close(options?: Record<string, unknown>): Promise<unknown>;
      }>;
      close(options?: Record<string, unknown>): Promise<unknown>;
    }>;
  };
};

type BrowserLaunchCandidate = {
  channel?: string;
  args?: string[];
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let url: string | undefined;
  let timeoutMs = 60_000;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--url" && next) {
      url = next;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        timeoutMs = parsed;
      }
      index += 1;
    }
  }
  return { url, timeoutMs };
}

function parsePositiveIntEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name]?.trim() ?? "";
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function parseBooleanEnv(names: string[], fallback: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) continue;
    if (["1", "true", "yes", "on"].includes(raw)) return true;
    if (["0", "false", "no", "off"].includes(raw)) return false;
  }
  return fallback;
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseLaunchArgs(value: string | undefined): string[] | undefined {
  const args = value
    ?.split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return args && args.length > 0 ? args : undefined;
}

function buildBrowserLaunchCandidates(
  browserChannel: string | undefined,
  launchArgs: string[] | undefined,
): BrowserLaunchCandidate[] {
  const dedupe = new Set<string>();
  const candidates: BrowserLaunchCandidate[] = [];
  const push = (candidate: BrowserLaunchCandidate) => {
    const key = JSON.stringify({
      channel: candidate.channel ?? null,
      args: candidate.args ?? [],
    });
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    candidates.push(candidate);
  };

  push({ channel: browserChannel, args: launchArgs });
  if (browserChannel) {
    push({ args: launchArgs });
  }
  if (launchArgs && launchArgs.length > 0) {
    push({ channel: browserChannel });
    if (browserChannel) {
      push({});
    }
  }
  return candidates;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resolvePlaywrightModuleUrl(): string {
  const bunModulesDir = path.join(rootDir, "node_modules", ".bun");
  const playwrightEntry = readdirSync(bunModulesDir).find((entry) =>
    entry.startsWith("playwright@"),
  );
  if (!playwrightEntry) {
    throw new Error(
      `could not locate playwright runtime under ${bunModulesDir}`,
    );
  }
  return pathToFileURL(
    path.join(
      bunModulesDir,
      playwrightEntry,
      "node_modules",
      "playwright",
      "index.mjs",
    ),
  ).href;
}

async function collectPageState(page: any): Promise<ProbeSnapshot> {
  const pageState = (await page.evaluate(() => ({
    source: "page",
    href: location.href,
    title: document.title,
    bodyPreview: (document.body?.innerText ?? "").slice(0, 2_000),
    streamReady:
      (window as typeof window & { __HYPERIA_STREAM_READY__?: boolean })
        .__HYPERIA_STREAM_READY__ ?? null,
    rendererHealth:
      (
        window as typeof window & {
          __HYPERIA_STREAM_RENDERER_HEALTH__?: {
            ready?: boolean | null;
            degradedReason?: string | null;
            updatedAt?: number | null;
            phase?: string | null;
          } | null;
        }
      ).__HYPERIA_STREAM_RENDERER_HEALTH__ ?? null,
    canvasCount: document.querySelectorAll("canvas").length,
  }))) as FrameState;

  const frames: FrameState[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    try {
      const frameState = (await frame.evaluate(() => ({
        source: "iframe",
        href: location.href,
        title: document.title,
        bodyPreview: (document.body?.innerText ?? "").slice(0, 2_000),
        streamReady:
          (window as typeof window & { __HYPERIA_STREAM_READY__?: boolean })
            .__HYPERIA_STREAM_READY__ ?? null,
        rendererHealth:
          (
            window as typeof window & {
              __HYPERIA_STREAM_RENDERER_HEALTH__?: {
                ready?: boolean | null;
                degradedReason?: string | null;
                updatedAt?: number | null;
                phase?: string | null;
              } | null;
            }
          ).__HYPERIA_STREAM_RENDERER_HEALTH__ ?? null,
        canvasCount: document.querySelectorAll("canvas").length,
      }))) as FrameState;
      frames.push(frameState);
    } catch {
      continue;
    }
  }

  const states = [pageState, ...frames];
  const bestState =
    states.find(
      (state) =>
        state.streamReady === true &&
        state.rendererHealth?.ready === true &&
        !state.rendererHealth?.degradedReason,
    ) ??
    states.find(
      (state) =>
        state.streamReady != null ||
        state.rendererHealth != null ||
        state.canvasCount > 0,
    ) ??
    pageState;

  return {
    checkedAt: new Date().toISOString(),
    page: pageState,
    frames,
    bestState,
  };
}

function isReady(snapshot: ProbeSnapshot): boolean {
  const state = snapshot.bestState;
  return Boolean(
    state &&
    state.streamReady === true &&
    state.rendererHealth?.ready === true &&
    !state.rendererHealth?.degradedReason,
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const targetUrl =
    args.url ??
    firstEnv([
      "HYPERIA_UI_URL",
      "STREAM_URL",
      "VITE_STREAM_URL",
      "GAME_CLIENT_URL",
    ]);
  if (!targetUrl) {
    throw new Error("missing stream URL; set HYPERIA_UI_URL or pass --url");
  }

  const viewportWidth = parsePositiveIntEnv(
    ["PM_STREAM_PROBE_SCREENSHOT_WIDTH", "PM_SOAK_SCREENSHOT_WIDTH"],
    1280,
  );
  const viewportHeight = parsePositiveIntEnv(
    ["PM_STREAM_PROBE_SCREENSHOT_HEIGHT", "PM_SOAK_SCREENSHOT_HEIGHT"],
    720,
  );
  const headless = parseBooleanEnv(
    ["PM_STREAM_PROBE_HEADLESS", "PM_SOAK_HEADLESS", "PW_HEADLESS"],
    true,
  );
  const browserChannel =
    firstEnv([
      "PM_STREAM_PROBE_BROWSER_CHANNEL",
      "PM_SOAK_BROWSER_CHANNEL",
      "PW_BROWSER_CHANNEL",
    ]) ?? undefined;
  const launchArgs = parseLaunchArgs(
    firstEnv([
      "PM_STREAM_PROBE_WEBGPU_ARGS",
      "PM_SOAK_WEBGPU_ARGS",
      "PW_WEBGPU_ARGS",
    ]),
  );
  const launchCandidates = buildBrowserLaunchCandidates(
    browserChannel,
    launchArgs,
  );
  const artifactRoot = resolveArtifactRoot("stream-probe");

  const runtime = (await import(
    resolvePlaywrightModuleUrl()
  )) as PlaywrightRuntime;
  let browser: Awaited<
    ReturnType<PlaywrightRuntime["chromium"]["launch"]>
  > | null = null;
  let selectedLaunch: BrowserLaunchCandidate | null = null;
  const launchErrors: Array<{
    channel: string | null;
    args: string[];
    error: string;
  }> = [];
  for (const candidate of launchCandidates) {
    try {
      browser = await withTimeout(
        runtime.chromium.launch({
          headless,
          channel: candidate.channel,
          args: candidate.args,
          timeout: 20_000,
        }),
        20_000,
        `probe browser launch (${candidate.channel ?? "chromium"})`,
      );
      selectedLaunch = candidate;
      break;
    } catch (error) {
      launchErrors.push({
        channel: candidate.channel ?? null,
        args: candidate.args ?? [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!browser) {
    writeJsonArtifact(artifactRoot, "probe-result.json", {
      ok: false,
      checkedAt: new Date().toISOString(),
      targetUrl,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      headless,
      browserChannel: browserChannel ?? "chromium",
      launchArgs: launchArgs ?? [],
      selectedLaunch: null,
      launchErrors,
      screenshotPath: null,
      snapshot: null,
    });
    throw new Error(
      `headless stream probe launch failed: ${launchErrors.map((entry) => `${entry.channel ?? "chromium"}:${entry.error}`).join(" | ")}`,
    );
  }
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let lastSnapshot: ProbeSnapshot | null = null;
  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const startedAt = Date.now();
    while (Date.now() - startedAt < args.timeoutMs) {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);
      lastSnapshot = await collectPageState(page);
      if (isReady(lastSnapshot)) {
        break;
      }
    }

    const status =
      lastSnapshot && isReady(lastSnapshot) ? "ready" : "not-ready";
    const screenshotPath = path.join(artifactRoot, `stream-${status}.png`);
    const probeResult = {
      ok: status === "ready",
      checkedAt: new Date().toISOString(),
      targetUrl,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      headless,
      browserChannel: selectedLaunch?.channel ?? "chromium",
      launchArgs: selectedLaunch?.args ?? [],
      launchErrors,
      screenshotPath,
      snapshot: lastSnapshot,
    };
    writeJsonArtifact(artifactRoot, "probe-result.json", probeResult);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    if (status !== "ready") {
      const degradedReason =
        lastSnapshot?.bestState?.rendererHealth?.degradedReason ??
        "renderer_not_ready";
      throw new Error(`headless stream probe failed: ${degradedReason}`);
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
