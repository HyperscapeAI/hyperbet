import { test } from "@playwright/test";

test("debug page boot", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`console:${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.log(`pageerror: ${error.stack || error.message}`);
  });
  page.on("requestfailed", (request) => {
    console.log(
      `requestfailed: ${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  const response = await page.goto("/?debug=1", {
    waitUntil: "domcontentloaded",
  });
  console.log(`status: ${response?.status() ?? "null"}`);
  await page.waitForTimeout(5_000);
  console.log(`body: ${((await page.locator("body").textContent()) || "").trim()}`);
});
