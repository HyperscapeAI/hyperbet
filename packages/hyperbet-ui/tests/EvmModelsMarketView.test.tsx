import "./setup";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, createElement } from "react";

import { EvmModelsMarketView } from "../src/components/EvmModelsMarketView";
import { render } from "./render";

const originalFetch = globalThis.fetch;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

describe("EvmModelsMarketView", () => {
  it("requests chain-scoped market data with no-store caching and polls both endpoints", async () => {
    const intervalCallbacks: Array<() => void> = [];
    globalThis.setInterval = (((handler: TimerHandler) => {
      intervalCallbacks.push(handler as () => void);
      return intervalCallbacks.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown) as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;

    const fetchMock = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/perps/markets")) {
          return jsonResponse({
            chainKey: "bsc",
            markets: [
              {
                chainKey: "bsc",
                characterId: "agent-a",
                marketId: 7,
                rank: 1,
                name: "Agent A",
                provider: "OpenAI",
                model: "gpt-5",
                wins: 12,
                losses: 3,
                winRate: 80,
                combatLevel: 99,
                currentStreak: 4,
                status: "ACTIVE",
                lastSeenAt: 1,
                deprecatedAt: null,
                updatedAt: 2,
              },
            ],
            updatedAt: 2,
          });
        }
        if (url.includes("/api/perps/oracle-history")) {
          return jsonResponse({
            chainKey: "bsc",
            characterId: "agent-a",
            marketId: 7,
            snapshots: [],
            updatedAt: 3,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      createElement(EvmModelsMarketView, {
        gameApiUrl: "https://keeper.example",
        chainKey: "bsc",
        chainLabel: "BSC",
        collateralSymbol: "BNB",
        fightingAgentA: "Agent A",
        fightingAgentB: "Agent B",
      }),
    );

    await flushEffects();
    await flushEffects();

    const marketCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/perps/markets?chainKey=bsc"),
    );
    const oracleCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes(
        "/api/perps/oracle-history?chainKey=bsc&characterId=agent-a&limit=24",
      ),
    );

    expect(marketCalls.length).toBe(1);
    expect(marketCalls[0]?.[1]).toMatchObject({ cache: "no-store" });
    expect(oracleCalls.length).toBe(1);
    expect(oracleCalls[0]?.[1]).toMatchObject({ cache: "no-store" });

    expect(intervalCallbacks.length).toBe(2);

    await act(async () => {
      intervalCallbacks[0]?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      intervalCallbacks[1]?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/api/perps/markets?chainKey=bsc"),
      ).length,
    ).toBe(2);
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes(
          "/api/perps/oracle-history?chainKey=bsc&characterId=agent-a&limit=24",
        ),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("renders a chain-specific empty state when the selected chain has no indexed models", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        chainKey: "base",
        markets: [],
        updatedAt: 2,
      }),
    ) as unknown as typeof fetch;

    const view = render(
      createElement(EvmModelsMarketView, {
        gameApiUrl: "https://keeper.example",
        chainKey: "base",
        chainLabel: "Base",
        collateralSymbol: "ETH",
        fightingAgentA: "Agent A",
        fightingAgentB: "Agent B",
      }),
    );

    await flushEffects();

    expect(view.container.textContent).toContain(
      "No Base models are indexed yet.",
    );
  });
});
