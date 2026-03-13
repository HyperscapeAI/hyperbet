import { defineConfig, loadEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
// @ts-ignore
import { createRequire } from "module";
import { nodePolyfills } from "vite-plugin-node-polyfills";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC_SECRET_PATTERNS = [
  /[?&](api[-_]?key|token)=/i,
  /helius-rpc\.com\/\?api-key=/i,
  /alchemy\.com\/v2\//i,
  /infura\.io\/v3\//i,
  /quicknode\.(com|pro)\//i,
  /drpc\.org\//i,
] as const;

function looksLikePublicSecretUrl(value: string | undefined): boolean {
  if (!value) return false;
  return PUBLIC_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function readGitRevision(): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
  } catch {
    return null;
  }
}

function assertPublicBuildSecrets(
  mode: string,
  env: Record<string, string>,
): void {
  const isPublicBuild =
    mode === "production" || mode === "mainnet" || mode === "mainnet-beta";
  if (!isPublicBuild) return;

  const publicRpcVars = [
    "VITE_SOLANA_RPC_URL",
    "VITE_BSC_RPC_URL",
    "VITE_BASE_RPC_URL",
  ] as const;
  for (const name of publicRpcVars) {
    if (looksLikePublicSecretUrl(env[name]?.trim())) {
      throw new Error(
        `[build] ${name} contains a provider-keyed RPC URL. Keep provider keys on the keeper service and proxy public traffic through the backend.`,
      );
    }
  }

  const forbiddenPublicVars = [
    "VITE_HEADLESS_WALLET_SECRET_KEY",
    "VITE_HEADLESS_WALLETS",
  ] as const;
  for (const name of forbiddenPublicVars) {
    if (env[name]?.trim()) {
      throw new Error(
        `[build] ${name} must not be set for public builds. Move secrets to server-side environment variables instead.`,
      );
    }
  }
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const isE2eMode = mode === "e2e";
  assertPublicBuildSecrets(mode, env);
  const plugins: any[] = [react()];
  const aliasMap: Record<string, string> = {};
  const require = createRequire(import.meta.url);
  const nodePolyfillsRoot = path.dirname(
    path.dirname(require.resolve("vite-plugin-node-polyfills")),
  );

  // Some transitive deps (for example @metamask/sdk) import these shim paths
  // directly. Resolve them from the installed package root so the build remains
  // stable whether Bun installs them locally or hoists them in CI, while still
  // pointing Vite dev/build at the ESM shim files.
  aliasMap["vite-plugin-node-polyfills/shims/global"] = path.join(
    nodePolyfillsRoot,
    "shims",
    "global",
    "dist",
    "index.js",
  );
  aliasMap["vite-plugin-node-polyfills/shims/process"] = path.join(
    nodePolyfillsRoot,
    "shims",
    "process",
    "dist",
    "index.js",
  );
  aliasMap["vite-plugin-node-polyfills/shims/buffer"] = path.join(
    nodePolyfillsRoot,
    "shims",
    "buffer",
    "dist",
    "index.js",
  );
  aliasMap["@hyperbet/ui"] = path.resolve(
    __dirname,
    "..",
    "..",
    "hyperbet-ui",
    "src",
  );

  const curvesMainPath = require.resolve("@noble/curves");

  // Fix for @noble/curves import resolution inside the turbo monorepo
  // Try to use the ESM version first, but if it doesn't exist (e.g., due to CI environment issues),
  // fall back to the CommonJS version in the package root.
  let ed25519Path = curvesMainPath.replace(/index\.js$/, "esm/ed25519.js");
  if (!fs.existsSync(ed25519Path)) {
    ed25519Path = curvesMainPath.replace(/index\.js$/, "ed25519.js");
  }
  let secp256k1Path = curvesMainPath.replace(/index\.js$/, "esm/secp256k1.js");
  if (!fs.existsSync(secp256k1Path)) {
    secp256k1Path = curvesMainPath.replace(/index\.js$/, "secp256k1.js");
  }

  // Fix for @noble/curves import resolution inside the turbo monorepo
  aliasMap["@noble/curves/ed25519"] = ed25519Path;
  aliasMap["@noble/curves/secp256k1"] = secp256k1Path;
  const alias = Object.entries(aliasMap).map(([find, replacement]) => ({
    find,
    replacement,
  }));
  plugins.push({
    name: "resolve-node-polyfill-shims",
    enforce: "pre",
    resolveId(source: string) {
      return aliasMap[source] ?? null;
    },
  });

  const polyfills = nodePolyfills({
    include: ["buffer", "process"],
    globals: { global: true, process: true, Buffer: true },
    protocolImports: true,
  }) as any;
  if (Array.isArray(polyfills)) {
    plugins.push(...polyfills);
  } else {
    plugins.push(polyfills);
  }

  // HLS live streaming middleware — serves .m3u8 and .ts segments
  // from public/live/ (where the duel-stack RTMP bridge writes HLS output).
  // This middleware is required because Vite's dev server intercepts .ts files
  // as TypeScript modules instead of serving them as raw video/mp2t data.
  const localAppHlsRoot = path.resolve(__dirname, "public", "live");
  const serverHlsRoot = path.resolve(
    __dirname,
    "..",
    "..",
    "server",
    "public",
    "live",
  );
  const useLocalAppHlsFallback =
    (process.env.VITE_ALLOW_LOCAL_HLS_FALLBACK || "").trim().toLowerCase() ===
    "true";
  const hlsRoots = useLocalAppHlsFallback
    ? [serverHlsRoot, localAppHlsRoot]
    : [serverHlsRoot];
  const hlsPlugin = {
    name: "hls-live-serve",
    configureServer(server: any) {
      server.middlewares.use("/live", (req: any, res: any, next: any) => {
        let requestPath = "/";
        try {
          const parsed = new URL(req.url || "/", "http://localhost");
          requestPath = decodeURIComponent(parsed.pathname || "/");
        } catch {
          requestPath = "/";
        }

        const relativePath =
          requestPath === "/" ? "stream.m3u8" : requestPath.replace(/^\/+/, "");
        const resolveFromRoots = () => {
          for (const root of hlsRoots) {
            const candidate = path.resolve(root, relativePath);
            if (!candidate.startsWith(`${root}${path.sep}`)) {
              continue;
            }
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
          return null;
        };

        const filePath = resolveFromRoots();
        if (!filePath) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("HLS stream unavailable");
          return;
        }
        const ext = path.extname(filePath);
        const contentType =
          ext === ".m3u8"
            ? "application/vnd.apple.mpegurl"
            : ext === ".ts"
              ? "video/mp2t"
              : ext === ".m4s"
                ? "video/iso.segment"
                : ext === ".mp4"
                  ? "video/mp4"
                  : "application/octet-stream";

        const stat = fs.statSync(filePath);
        const rangeHeader = req.headers?.range as string | undefined;

        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Accept-Ranges", "bytes");

        // Manifest should be revalidated; segments are immutable and CDN-cacheable.
        if (ext === ".m3u8") {
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.setHeader("Surrogate-Control", "no-store");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }

        if (rangeHeader) {
          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (match) {
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2]
              ? Number.parseInt(match[2], 10)
              : stat.size - 1;

            if (
              Number.isFinite(start) &&
              Number.isFinite(end) &&
              start >= 0 &&
              end >= start &&
              end < stat.size
            ) {
              res.statusCode = 206;
              res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${stat.size}`,
              );
              res.setHeader("Content-Length", String(end - start + 1));
              fs.createReadStream(filePath, { start, end }).pipe(res);
              return;
            }
          }

          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${stat.size}`);
          res.end();
          return;
        }

        res.setHeader("Content-Length", String(stat.size));
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
  plugins.push(hlsPlugin);

  const buildInfoPlugin = {
    name: "emit-build-info",
    generateBundle(this: {
      emitFile: (file: {
        type: "asset";
        fileName: string;
        source: string;
      }) => void;
    }) {
      const commitHash =
        env.CF_PAGES_COMMIT_SHA?.trim() ||
        process.env.GITHUB_SHA?.trim() ||
        readGitRevision();
      const buildInfo = {
        app: "hyperbet-bsc",
        mode,
        commitHash: commitHash || null,
        builtAt: new Date().toISOString(),
      };
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: JSON.stringify(buildInfo, null, 2),
      });
    },
  };
  plugins.push(buildInfoPlugin);

  const solanaRpcTarget = env.VITE_SOLANA_RPC_URL?.trim();
  const solanaWsTarget = env.VITE_SOLANA_WS_URL?.trim();
  const useLocalSolanaProxy =
    Boolean(solanaRpcTarget) &&
    /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::\d+)?/i.test(
      solanaRpcTarget,
    );
  const solanaProxyConfig = useLocalSolanaProxy
    ? {
        "/__solana/rpc": {
          target: solanaRpcTarget,
          changeOrigin: true,
          secure: false,
          rewrite: () => "/",
        },
        "/__solana/ws": {
          target: solanaWsTarget || solanaRpcTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: () => "/",
        },
      }
    : undefined;

  const config: UserConfig = {
    plugins,
    server: {
      host: true,
      port: 4179,
      proxy: solanaProxyConfig,
      watch: {
        ignored: [
          "**/test-results/**",
          "**/tests/e2e/playwright-report/**",
          "**/.e2e-*.log",
          "**/.env.e2e",
          ...(isE2eMode
            ? [
                "**/packages/hyperbet-ui/src/**",
                "**/packages/hyperbet-*/deployments/**",
              ]
            : []),
        ],
      },
    },
    preview: {
      host: true,
      proxy: solanaProxyConfig,
    },
    resolve: {
      alias,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@solana/wallet-adapter-base",
        "@solana/wallet-adapter-react",
        "@solana/wallet-adapter-react-ui",
        "@solana/wallet-adapter-phantom",
        "@solana/web3.js",
        "wagmi",
        "@wagmi/core",
        "@rainbow-me/rainbowkit",
        "@tanstack/react-query",
        "viem",
      ],
    },
    optimizeDeps: {
      include: [
        "buffer",
        "process",
        "vite-plugin-node-polyfills/shims/buffer",
        "vite-plugin-node-polyfills/shims/global",
        "vite-plugin-node-polyfills/shims/process",
      ],
    },
    build: {
      outDir: "dist",
      sourcemap: env.VITE_BUILD_SOURCEMAP === "true",
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        onwarn(warning, warn) {
          if (
            warning.code === "SOURCEMAP_ERROR" ||
            warning.code === "UNRESOLVED_IMPORT" ||
            (warning.message &&
              warning.message.includes(
                "contains an annotation that Rollup cannot interpret",
              ))
          ) {
            return;
          }
          warn(warning);
        },
      },
    },
  };

  return config;
});
