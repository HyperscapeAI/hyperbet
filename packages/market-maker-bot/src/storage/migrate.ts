import { createDefaultMarketMakerStateStore } from "./index.ts";

async function main() {
  const store = createDefaultMarketMakerStateStore();
  await store.ensureReady();
  await store.close();
  console.log("[mm-storage] schema ready");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[mm-storage] failed:", error);
    process.exit(1);
  });
}
