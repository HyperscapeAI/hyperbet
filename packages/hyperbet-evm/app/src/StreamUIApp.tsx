import { MockDataProvider } from "./lib/useMockAvaxStreamData";
import { App } from "./App";

// ── StreamUIApp ───────────────────────────────────────────────────────────────
// Renders the real App layout connected to the live backend (SSE, duel-context)
// exactly like bun run dev, but with simulated bids/asks/trades/chart injected
// so the UI looks active even before real market data exists on-chain.

export function StreamUIApp() {
  return (
    <MockDataProvider>
      <App />
    </MockDataProvider>
  );
}
