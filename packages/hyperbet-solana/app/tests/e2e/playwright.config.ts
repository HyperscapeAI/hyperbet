import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const IS_LINUX = process.platform === "linux";
const PW_HEADLESS = (process.env.PW_HEADLESS ?? "1") !== "0";
const RECORD_VIDEO = (process.env.E2E_RECORD_VIDEO ?? "0") === "1";
const BROWSER_CHANNEL = process.env.PW_BROWSER_CHANNEL?.trim() || undefined;
const DEFAULT_LINUX_WEBGPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--ozone-platform=x11",
  "--use-angle=vulkan",
  "--enable-features=Vulkan,VulkanFromANGLE",
];
const EXTRA_WEBGPU_ARGS = (process.env.PW_WEBGPU_ARGS ?? "")
  .split(" ")
  .map((arg) => arg.trim())
  .filter(Boolean);
const WEBGPU_LAUNCH_ARGS = [
  ...(IS_LINUX ? DEFAULT_LINUX_WEBGPU_ARGS : []),
  ...EXTRA_WEBGPU_ARGS,
];
const DESKTOP_CHROMIUM = {
  viewport: { width: 1280, height: 720 },
  screen: { width: 1280, height: 720 },
};
const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(E2E_DIR, "../..");
const PLAYWRIGHT_OUTPUT_DIR = path.join(APP_DIR, "test-results");
const PLAYWRIGHT_REPORT_DIR = path.join(APP_DIR, "playwright-report");

// Playwright sets FORCE_COLOR; if NO_COLOR is also present it emits noisy startup warnings.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["html", { open: "never", outputFolder: PLAYWRIGHT_REPORT_DIR }],
        ["github"],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: PLAYWRIGHT_REPORT_DIR }],
      ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4181",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: RECORD_VIDEO
      ? { mode: "on", size: { width: 1280, height: 720 } }
      : "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    headless: PW_HEADLESS,
    channel: BROWSER_CHANNEL,
    launchOptions: WEBGPU_LAUNCH_ARGS.length
      ? { args: WEBGPU_LAUNCH_ARGS }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: PW_HEADLESS ? DESKTOP_CHROMIUM : { ...devices["Desktop Chrome"] },
    },
  ],
});
