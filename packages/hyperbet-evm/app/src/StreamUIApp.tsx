import { MockDataProvider } from "./lib/useMockAvaxStreamData";
import { App } from "./App";

// App with simulated market data injected (bids/asks/trades/chart).
export function StreamUIApp() {
  return (
    <MockDataProvider>
      <App />
    </MockDataProvider>
  );
}
