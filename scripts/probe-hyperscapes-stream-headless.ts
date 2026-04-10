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

type ProbeFailure = {
  source: "console" | "pageerror" | "requestfailed" | "response";
  kind: string;
  text: string;
  url?: string;
  status?: number;
};

type AssetAuditEntry = {
  label: string;
  url: string;
  expectedType: "binary" | "json";
  ok: boolean;
  kind?: string;
  status?: number;
  contentType?: string | null;
  bodyPreview?: string;
  error?: string;
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
    throw new Error(`could not locate playwright runtime under ${bunModulesDir}`);
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
      (window as typeof window & { __HYPERSCAPE_STREAM_READY__?: boolean })
        .__HYPERSCAPE_STREAM_READY__ ?? null,
    rendererHealth:
      (
        window as typeof window & {
          __HYPERSCAPE_STREAM_RENDERER_HEALTH__?: {
            ready?: boolean | null;
            degradedReason?: string | null;
            updatedAt?: number | null;
            phase?: string | null;
          } | null;
        }
      ).__HYPERSCAPE_STREAM_RENDERER_HEALTH__ ?? null,
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
          (window as typeof window & { __HYPERSCAPE_STREAM_READY__?: boolean })
            .__HYPERSCAPE_STREAM_READY__ ?? null,
        rendererHealth:
          (
            window as typeof window & {
              __HYPERSCAPE_STREAM_RENDERER_HEALTH__?: {
                ready?: boolean | null;
                degradedReason?: string | null;
                updatedAt?: number | null;
                phase?: string | null;
              } | null;
            }
          ).__HYPERSCAPE_STREAM_RENDERER_HEALTH__ ?? null,
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

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isIgnoredProbeNoise(text: string): boolean {
  return (
    text.includes("Cannot redefine property: ethereum") ||
    text.includes("Origin not allowed") ||
    text.includes("onPlayerUpdated: No local player found")
  );
}

function isHyperscapeHost(hostname: string): boolean {
  return /(?:hyperscape|hyperbet)/i.test(hostname);
}

function isFirstPartyAssetUrl(rawUrl: string | undefined, targetUrl: string): boolean {
  if (!rawUrl) return false;

  try {
    const parsed = new URL(rawUrl);
    const target = new URL(targetUrl);
    const pathname = parsed.pathname.toLowerCase();
    const looksLikeAssetPath =
      pathname.includes("/game-assets/") ||
      pathname.includes("/manifests/") ||
      pathname.includes("/models/") ||
      pathname.includes("/emotes/") ||
      pathname.endsWith(".vrm") ||
      pathname.endsWith(".glb") ||
      pathname.endsWith(".gltf") ||
      pathname.endsWith(".json");

    return (
      looksLikeAssetPath &&
      (parsed.origin === target.origin || isHyperscapeHost(parsed.hostname))
    );
  } catch {
    return false;
  }
}

function extractRelevantUrl(
  text: string,
  fallbackUrl: string | undefined,
  targetUrl: string,
): string | undefined {
  if (isFirstPartyAssetUrl(fallbackUrl, targetUrl)) {
    return fallbackUrl;
  }

  const matches = text.match(/https?:\/\/\S+/g) ?? [];
  for (const match of matches) {
    const candidate = match.replace(/[),.;]+$/, "");
    if (isFirstPartyAssetUrl(candidate, targetUrl)) {
      return candidate;
    }
  }

  return undefined;
}

function classifyProbeFailure(
  source: ProbeFailure["source"],
  text: string,
  targetUrl: string,
  fallbackUrl?: string,
  status?: number,
): ProbeFailure | null {
  const normalized = normalizeText(text);
  if (!normalized || isIgnoredProbeNoise(normalized)) {
    return null;
  }

  let relevantUrl = extractRelevantUrl(normalized, fallbackUrl, targetUrl);
  if (!relevantUrl) {
    if (normalized.includes("world-config.json")) {
      relevantUrl = "world-config.json";
    } else if (normalized.includes("buildings.json")) {
      relevantUrl = "buildings.json";
    } else if (normalized.includes("vegetation.json")) {
      relevantUrl = "vegetation.json";
    } else if (normalized.includes("lod-settings.json")) {
      relevantUrl = "lod-settings.json";
    }
  }

  if (
    typeof status === "number" &&
    status >= 400 &&
    isFirstPartyAssetUrl(relevantUrl, targetUrl)
  ) {
    return {
      source,
      kind:
        relevantUrl?.includes("world-config.json") && status === 404
          ? "missing-world-config"
          : `asset-http-${status}`,
      text: normalized,
      url: relevantUrl,
      status,
    };
  }

  if (!relevantUrl) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  let kind: string | null = null;
  if (lowered.includes("no-response")) {
    kind = "asset-service-worker-no-response";
  } else if (lowered.includes("net::err_failed")) {
    kind = "asset-net-err-failed";
  } else if (lowered.includes("failed to fetch")) {
    kind = "asset-fetch-failed";
  } else if (lowered.includes("cors")) {
    kind = "asset-cors";
  } else if (
    relevantUrl.includes("world-config.json") &&
    (lowered.includes("404") || lowered.includes("not found"))
  ) {
    kind = "missing-world-config";
  } else if (
    relevantUrl.includes("buildings.json") &&
    lowered.includes("invalid")
  ) {
    kind = "invalid-buildings-manifest";
  } else if (
    relevantUrl.includes("vegetation.json") &&
    (lowered.includes("unexpected token <") ||
      lowered.includes("json") ||
      lowered.includes("parse"))
  ) {
    kind = "invalid-vegetation-manifest";
  } else if (
    relevantUrl.includes("lod-settings.json") &&
    (lowered.includes("unexpected token <") ||
      lowered.includes("json") ||
      lowered.includes("parse"))
  ) {
    kind = "invalid-lod-settings-manifest";
  }

  if (!kind) {
    return null;
  }

  return {
    source,
    kind,
    text: normalized,
    url: relevantUrl,
    status,
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

async function runAssetAudit(
  page: any,
  targetUrl: string,
  assetBaseOverride?: string,
): Promise<AssetAuditEntry[]> {
  const auditScript = `
    const pointerPrefix = "version https://git-lfs.github.com/spec/v1";
    const runtimeEnvBase =
      typeof window.env?.PUBLIC_CDN_URL === "string"
        ? window.env.PUBLIC_CDN_URL.trim()
        : "";
    const runtimeWindowBase =
      typeof window.__CDN_URL === "string" ? window.__CDN_URL.trim() : "";
    const normalizeAssetBaseUrl = (value) =>
      typeof value === "string" && value.trim().length > 0
        ? value.trim().replace(/\\/+$/, "")
        : "";
    const resolveAssetBaseUrl = async () => {
      if (assetBaseOverride) {
        return normalizeAssetBaseUrl(assetBaseOverride);
      }
      if (runtimeEnvBase) {
        return normalizeAssetBaseUrl(runtimeEnvBase);
      }
      if (runtimeWindowBase) {
        return normalizeAssetBaseUrl(runtimeWindowBase);
      }

      const assetConfigScriptUrls = Array.from(
        document.querySelectorAll('script[src], link[rel="modulepreload"][href]'),
      )
        .map((node) => node.getAttribute("src") || node.getAttribute("href"))
        .filter((value) => typeof value === "string" && value.length > 0)
        .map((value) => new URL(value, pageUrl).toString());
      const apiConfigScriptUrl = assetConfigScriptUrls.find((scriptUrl) =>
        /\\/assets\\/api-config-[^/]+\\.js(?:$|\\?)/.test(scriptUrl),
      );
      if (apiConfigScriptUrl) {
        try {
          const apiConfigModule = await import(apiConfigScriptUrl);
          for (const exportValue of Object.values(apiConfigModule)) {
            const normalized = normalizeAssetBaseUrl(exportValue);
            if (normalized.endsWith("/game-assets")) {
              return normalized;
            }
          }
        } catch {
          // Fall through to text scanning if dynamic import fails.
        }
      }
      for (const scriptUrl of assetConfigScriptUrls) {
        try {
          const scriptText = await fetch(scriptUrl, { cache: "no-store" }).then((response) =>
            response.ok ? response.text() : ""
          );
          const match = scriptText.match(/https?:\\/\\/[^"'\\s]+\\/game-assets/g);
          if (match && match[0]) {
            return normalizeAssetBaseUrl(match[0]);
          }
        } catch {
          continue;
        }
      }

      return normalizeAssetBaseUrl(new URL("/game-assets", pageUrl).toString());
    };
    const assetBaseUrl = await resolveAssetBaseUrl();

    const targets = [
      { label: "avatar-vrm", expectedType: "binary", path: "avatars/avatar-male-01.vrm" },
      { label: "mob-vrm", expectedType: "binary", path: "models/mobs/bandit/bandit.vrm" },
      { label: "npc-vrm", expectedType: "binary", path: "models/npcs/banker/banker.vrm" },
      { label: "resource-glb", expectedType: "binary", path: "models/mining-rocks/essence-rock/essence-rock.glb" },
      { label: "emote-glb", expectedType: "binary", path: "emotes/emote-walk.glb?s=1.3" },
      { label: "item-manifest", expectedType: "json", path: "manifests/items/ammunition.json" },
      { label: "vegetation-manifest", expectedType: "json", path: "manifests/vegetation.json" },
      { label: "world-config-manifest", expectedType: "json", path: "manifests/world-config.json" },
      { label: "buildings-manifest", expectedType: "json", path: "manifests/buildings.json" }
    ];

    const readBinaryPrefix = async (response, maxBytes = 256) => {
      const reader = response.body && response.body.getReader ? response.body.getReader() : null;
      if (!reader) {
        return (await response.text()).slice(0, maxBytes);
      }

      const decoder = new TextDecoder();
      const chunks = [];
      let totalBytes = 0;
      try {
        while (totalBytes < maxBytes) {
          const { done, value } = await reader.read();
          if (done || !value) {
            break;
          }
          const slice = value.subarray(0, Math.max(0, maxBytes - totalBytes));
          chunks.push(slice);
          totalBytes += slice.byteLength;
          if (totalBytes >= maxBytes) {
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }

      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return decoder.decode(merged).slice(0, maxBytes);
    };

    const results = [];
    for (const target of targets) {
      const url = new URL(target.path, assetBaseUrl + "/").toString();
      try {
        const response = await fetch(url, { mode: "cors", cache: "no-store" });
        const baseEntry = {
          label: target.label,
          url,
          expectedType: target.expectedType,
          status: response.status,
          contentType: response.headers.get("content-type")
        };

        if (!response.ok) {
          results.push({ ...baseEntry, ok: false, kind: "http-" + response.status });
          continue;
        }

        if (target.expectedType === "json") {
          const body = await response.text();
          const bodyPreview = body.slice(0, 200);
          if (bodyPreview.startsWith(pointerPrefix)) {
            results.push({ ...baseEntry, ok: false, kind: "git-lfs-pointer", bodyPreview });
            continue;
          }

          try {
            JSON.parse(body);
            results.push({ ...baseEntry, ok: true, bodyPreview });
          } catch (error) {
            results.push({
              ...baseEntry,
              ok: false,
              kind: "invalid-json",
              bodyPreview,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          continue;
        }

        const bodyPreview = await readBinaryPrefix(response);
        if (
          (baseEntry.contentType || "").toLowerCase().includes("text/html") ||
          bodyPreview.trimStart().startsWith("<!doctype")
        ) {
          results.push({ ...baseEntry, ok: false, kind: "unexpected-html", bodyPreview });
          continue;
        }
        if (bodyPreview.startsWith(pointerPrefix)) {
          results.push({ ...baseEntry, ok: false, kind: "git-lfs-pointer", bodyPreview });
          continue;
        }

        results.push({ ...baseEntry, ok: true, bodyPreview });
      } catch (error) {
        results.push({
          label: target.label,
          url,
          expectedType: target.expectedType,
          ok: false,
          kind: "fetch-error",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  `;

  return (await page.evaluate(
    ({
      pageUrl,
      script,
      assetBaseOverride,
    }: {
      pageUrl: string;
      script: string;
      assetBaseOverride?: string;
    }) =>
      new Function(
        "pageUrl",
        "assetBaseOverride",
        `${script}`,
      )(pageUrl, assetBaseOverride) as Promise<AssetAuditEntry[]>,
    {
      pageUrl: targetUrl,
      script: `return (async () => { ${auditScript} })();`,
      assetBaseOverride,
    },
  )) as AssetAuditEntry[];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const targetUrl =
    args.url ??
    firstEnv(["HYPERSCAPES_UI_URL", "STREAM_URL", "VITE_STREAM_URL", "GAME_CLIENT_URL"]);
  if (!targetUrl) {
    throw new Error("missing stream URL; set HYPERSCAPES_UI_URL or pass --url");
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
    firstEnv(["PM_STREAM_PROBE_BROWSER_CHANNEL", "PM_SOAK_BROWSER_CHANNEL", "PW_BROWSER_CHANNEL"]) ??
    undefined;
  const assetBaseOverride =
    firstEnv(["PM_STREAM_PROBE_ASSET_BASE_URL", "PUBLIC_CDN_URL"]) ?? undefined;
  const launchArgs = parseLaunchArgs(
    firstEnv(["PM_STREAM_PROBE_WEBGPU_ARGS", "PM_SOAK_WEBGPU_ARGS", "PW_WEBGPU_ARGS"]),
  );
  const launchCandidates = buildBrowserLaunchCandidates(
    browserChannel,
    launchArgs,
  );
  const artifactRoot = resolveArtifactRoot("stream-probe");

  const runtime = (await import(
    resolvePlaywrightModuleUrl()
  )) as PlaywrightRuntime;
  let browser: Awaited<ReturnType<PlaywrightRuntime["chromium"]["launch"]>> | null =
    null;
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
      assetAuditOk: false,
      assetAudit: [],
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
  const failures: ProbeFailure[] = [];
  const failureKeys = new Set<string>();
  const recordFailure = (failure: ProbeFailure | null) => {
    if (!failure) {
      return;
    }
    const key = JSON.stringify({
      source: failure.source,
      kind: failure.kind,
      url: failure.url ?? null,
      status: failure.status ?? null,
    });
    if (failureKeys.has(key)) {
      return;
    }
    failureKeys.add(key);
    failures.push(failure);
  };

  page.on("console", (message: any) => {
    recordFailure(classifyProbeFailure("console", message.text(), targetUrl));
  });
  page.on("pageerror", (error: Error) => {
    recordFailure(
      classifyProbeFailure(
        "pageerror",
        error?.stack || error?.message || String(error),
        targetUrl,
      ),
    );
  });
  page.on("requestfailed", (request: any) => {
    const failureText = request.failure()?.errorText ?? "request failed";
    recordFailure(
      classifyProbeFailure(
        "requestfailed",
        `${request.url()} ${failureText}`,
        targetUrl,
        request.url(),
      ),
    );
  });
  page.on("response", (response: any) => {
    if (response.status() < 400) {
      return;
    }
    recordFailure(
      classifyProbeFailure(
        "response",
        `${response.url()} HTTP ${response.status()}`,
        targetUrl,
        response.url(),
        response.status(),
      ),
    );
  });

  let lastSnapshot: ProbeSnapshot | null = null;
  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(30_000, args.timeoutMs),
    });
    const assetAudit = await runAssetAudit(page, targetUrl, assetBaseOverride);
    const assetAuditOk = assetAudit.every((entry) => entry.ok);
    const startedAt = Date.now();
    while (Date.now() - startedAt < args.timeoutMs) {
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
      lastSnapshot = await collectPageState(page);
      if (isReady(lastSnapshot)) {
        break;
      }
    }

    const status =
      lastSnapshot &&
      isReady(lastSnapshot) &&
      failures.length === 0 &&
      assetAuditOk
        ? "ready"
        : "not-ready";
    const screenshotPath = path.join(artifactRoot, `stream-${status}.png`);
    let screenshotError: string | null = null;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : String(error);
    }
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
      screenshotError,
      snapshot: lastSnapshot,
      failures,
      assetAuditOk,
      assetAudit,
    };
    writeJsonArtifact(artifactRoot, "probe-result.json", probeResult);

    if (status !== "ready") {
      if (failures.length > 0) {
        throw new Error(
          `headless stream probe failed: detected ${failures.length} first-party asset error(s): ${failures
            .slice(0, 3)
            .map((failure) => failure.kind)
            .join(", ")}`,
        );
      }
      if (!assetAuditOk) {
        throw new Error(
          `headless stream probe failed: detected ${assetAudit.filter((entry) => !entry.ok).length} asset audit failure(s): ${assetAudit
            .filter((entry) => !entry.ok)
            .slice(0, 3)
            .map((entry) => `${entry.label}:${entry.kind ?? "unknown"}`)
            .join(", ")}`,
        );
      }
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
