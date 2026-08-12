import { describe, expect, test } from "bun:test";

import {
  deriveSolanaBettorShellState,
  getSolanaBettorShellMessage,
  normalizePublicLegalDocumentUrl,
  resolvePublicLegalDocumentUrls,
  type SolanaBettorShellInput,
} from "../../src/lib/solanaBettorShell";
import { parseSolanaLaunchReadiness } from "../../src/lib/useSolanaLaunchReadiness";

const DUEL_KEY = "ab".repeat(32);
const OTHER_DUEL_KEY = "cd".repeat(32);
const NOW_MS = 1_700_000_000_000;

function makeInput(
  overrides: Partial<SolanaBettorShellInput> = {},
): SolanaBettorShellInput {
  return {
    programsChecked: true,
    programsReady: true,
    walletConnected: true,
    legalDocumentsReady: true,
    keeperChecked: true,
    keeperReady: true,
    nowMs: NOW_MS,
    streamMaxAgeMs: 15_000,
    streamConnected: true,
    hasReceivedStreamState: true,
    streamCycle: {
      cycleId: "cycle-42",
      phase: "ANNOUNCEMENT",
      emittedAt: NOW_MS - 1_000,
      duelId: "duel-42",
      duelKeyHex: DUEL_KEY,
      agent1Name: "Astra",
      agent2Name: "Boros",
    },
    lifecycleDuel: {
      duelId: "duel-42",
      duelKey: DUEL_KEY,
      agent1Name: "Astra",
      agent2Name: "Boros",
    },
    lifecycleMarket: {
      duelId: "duel-42",
      duelKey: DUEL_KEY,
      lifecycleStatus: "OPEN",
    },
    marketSnapshot: {
      duelKeyHex: DUEL_KEY,
      marketStatus: "open",
    },
    ...overrides,
  };
}

describe("Solana bettor shell authority gate", () => {
  test("loads fail-closed while program deployment is being checked", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({ programsChecked: false, programsReady: false }),
    );

    expect(state.mode).toBe("loading");
    expect(state.canOpenMarketPanel).toBe(false);
    expect(state.canPlaceBet).toBe(false);
  });

  test("enables betting only for an exact live and on-chain snapshot identity", () => {
    const state = deriveSolanaBettorShellState(makeInput());

    expect(state.mode).toBe("tradeable");
    expect(state.hasMatchup).toBe(true);
    expect(state.canOpenMarketPanel).toBe(true);
    expect(state.canPlaceBet).toBe(true);
    expect(state.showMarketData).toBe(true);
    expect(state.actionLabel).toBe("Place Bet");
  });

  test("pauses an open market when the stream disconnects", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({ streamConnected: false }),
    );

    expect(state.reason).toBe("stream-disconnected");
    expect(state.activityLabel).toBe("RECONNECTING");
    expect(state.hasMatchup).toBe(false);
    expect(state.canOpenMarketPanel).toBe(false);
    expect(state.canPlaceBet).toBe(false);
  });

  test("pauses an open market when a connected stream frame becomes stale", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        streamCycle: {
          ...makeInput().streamCycle,
          emittedAt: NOW_MS - 15_001,
        },
      }),
    );

    expect(state.reason).toBe("stream-stale");
    expect(state.activityLabel).toBe("RECONNECTING");
    expect(state.canOpenMarketPanel).toBe(false);
    expect(state.canPlaceBet).toBe(false);
  });

  test("accepts a stream frame exactly at the keeper freshness boundary", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        streamCycle: {
          ...makeInput().streamCycle,
          emittedAt: NOW_MS - 15_000,
        },
      }),
    );

    expect(state.mode).toBe("tradeable");
  });

  test("rejects a stream whose duel identity differs from the lifecycle market", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        streamCycle: {
          ...makeInput().streamCycle,
          duelKeyHex: OTHER_DUEL_KEY,
        },
      }),
    );

    expect(state.reason).toBe("stream-identity-mismatch");
    expect(state.hasMatchup).toBe(false);
    expect(state.canOpenMarketPanel).toBe(false);
  });

  test("rejects stale pricing from a previous market snapshot", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        marketSnapshot: {
          duelKeyHex: OTHER_DUEL_KEY,
          marketStatus: "open",
        },
      }),
    );

    expect(state.mode).toBe("watching");
    expect(state.canOpenMarketPanel).toBe(true);
    expect(state.canPlaceBet).toBe(false);
    expect(state.showMarketData).toBe(false);
  });

  test("blocks open-market controls until real legal documents are configured", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({ legalDocumentsReady: false }),
    );

    expect(state.reason).toBe("legal-documents-unavailable");
    expect(state.canOpenMarketPanel).toBe(false);
    expect(state.canPlaceBet).toBe(false);
    expect(state.actionLabel).toBe("Betting unavailable");
  });

  test("blocks open-market controls until keeper readiness is checked and green", () => {
    const checking = deriveSolanaBettorShellState(
      makeInput({ keeperChecked: false, keeperReady: false }),
    );
    const unavailable = deriveSolanaBettorShellState(
      makeInput({ keeperChecked: true, keeperReady: false }),
    );

    expect(checking.mode).toBe("loading");
    expect(checking.reason).toBe("checking-keeper");
    expect(unavailable.reason).toBe("keeper-unavailable");
    expect(checking.canOpenMarketPanel).toBe(false);
    expect(unavailable.canPlaceBet).toBe(false);
  });

  test("never treats a synthetic cycle or missing names as a canonical matchup", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        streamCycle: {
          ...makeInput().streamCycle,
          cycleId: "cycle-0",
          agent1Name: "",
          agent2Name: null,
        },
      }),
    );

    expect(state.hasMatchup).toBe(false);
    expect(state.canPlaceBet).toBe(false);
  });

  test("keeps a locked market viewable but not tradeable", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        lifecycleMarket: {
          duelId: "duel-42",
          duelKey: DUEL_KEY,
          lifecycleStatus: "LOCKED",
        },
        marketSnapshot: {
          duelKeyHex: DUEL_KEY,
          marketStatus: "locked",
        },
      }),
    );

    expect(state.mode).toBe("locked");
    expect(state.canOpenMarketPanel).toBe(true);
    expect(state.canPlaceBet).toBe(false);
    expect(state.actionLabel).toBe("View Market");
  });

  test("keeps verified settlement accessible without claiming the stream is live", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        legalDocumentsReady: false,
        streamConnected: false,
        streamCycle: null,
        lifecycleMarket: {
          duelId: "duel-42",
          duelKey: DUEL_KEY,
          lifecycleStatus: "RESOLVED",
        },
        marketSnapshot: {
          duelKeyHex: DUEL_KEY,
          marketStatus: "resolved",
        },
      }),
    );

    expect(state.mode).toBe("settlement");
    expect(state.hasMatchup).toBe(true);
    expect(state.canOpenMarketPanel).toBe(true);
    expect(state.canPlaceBet).toBe(false);
    expect(state.activityLabel).toBe("RECONNECTING");
    expect(state.actionLabel).toBe("View Settlement");
  });

  test("labels cancellation as refund review rather than promising a refund", () => {
    const state = deriveSolanaBettorShellState(
      makeInput({
        lifecycleMarket: {
          duelId: "duel-42",
          duelKey: DUEL_KEY,
          lifecycleStatus: "CANCELLED",
        },
        marketSnapshot: {
          duelKeyHex: DUEL_KEY,
          marketStatus: "cancelled",
        },
      }),
    );

    expect(state.mode).toBe("refund");
    expect(state.actionLabel).toBe("Review Refund");
    expect(state.canPlaceBet).toBe(false);
  });

  test("keeps wallet activity accessible across a lifecycle rollover without enabling trade", () => {
    const connected = deriveSolanaBettorShellState(
      makeInput({
        lifecycleDuel: null,
        lifecycleMarket: null,
        marketSnapshot: null,
        streamCycle: {
          ...makeInput().streamCycle,
          duelId: "duel-43",
          duelKeyHex: OTHER_DUEL_KEY,
        },
      }),
    );
    const disconnected = deriveSolanaBettorShellState(
      makeInput({
        walletConnected: false,
        lifecycleDuel: null,
        lifecycleMarket: null,
        marketSnapshot: null,
      }),
    );

    expect(connected.reason).toBe("waiting-lifecycle");
    expect(connected.canOpenMarketPanel).toBe(false);
    expect(connected.canAccessMarketPanel).toBe(true);
    expect(connected.canPlaceBet).toBe(false);
    expect(connected.actionLabel).toBe("View Activity");
    expect(disconnected.canAccessMarketPanel).toBe(false);
  });

  test("maps every public state to bounded copy without raw transport details", () => {
    const messages = [
      "checking-programs",
      "programs-unavailable",
      "waiting-lifecycle",
      "stream-disconnected",
      "stream-stale",
      "stream-identity-mismatch",
      "checking-keeper",
      "keeper-unavailable",
      "legal-documents-unavailable",
      "verifying-market",
      "market-open",
      "market-locked",
      "settlement-available",
      "refund-review",
    ].map((reason) =>
      getSolanaBettorShellMessage(
        reason as Parameters<typeof getSolanaBettorShellMessage>[0],
      ),
    );

    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(messages.join(" ")).not.toMatch(
      /rpc|429|json|exception|program id|duel key/i,
    );
  });
});

describe("Solana launch readiness envelope", () => {
  test("accepts only the exact healthy keeper service envelope", () => {
    expect(
      parseSolanaLaunchReadiness({
        ok: true,
        service: "hyperbet-solana-backend",
        now: NOW_MS,
        readiness: { ready: true },
      }),
    ).toBe(true);
  });

  test("fails closed for degraded, malformed, or wrong-service payloads", () => {
    expect(
      parseSolanaLaunchReadiness({
        ok: false,
        service: "hyperbet-solana-backend",
        now: NOW_MS,
        readiness: { ready: false },
      }),
    ).toBe(false);
    expect(
      parseSolanaLaunchReadiness({
        ok: true,
        service: "another-service",
        now: NOW_MS,
        readiness: { ready: true },
      }),
    ).toBe(false);
    expect(parseSolanaLaunchReadiness(null)).toBe(false);
  });
});

describe("public legal document URLs", () => {
  test("accepts HTTPS documents and same-origin local development paths", () => {
    expect(
      normalizePublicLegalDocumentUrl(
        "https://legal.hyperia.example/terms",
        "https://bet.hyperia.example",
      ),
    ).toBe("https://legal.hyperia.example/terms");
    expect(
      normalizePublicLegalDocumentUrl("/privacy", "http://127.0.0.1:4177"),
    ).toBe("http://127.0.0.1:4177/privacy");
  });

  test("rejects fragments, credentials, and insecure public documents", () => {
    expect(
      normalizePublicLegalDocumentUrl("#terms", "https://bet.hyperia.example"),
    ).toBeNull();
    expect(
      normalizePublicLegalDocumentUrl(
        "https://user:secret@legal.hyperia.example/terms",
        "https://bet.hyperia.example",
      ),
    ).toBeNull();
    expect(
      normalizePublicLegalDocumentUrl(
        "http://legal.hyperia.example/terms",
        "https://bet.hyperia.example",
      ),
    ).toBeNull();
  });

  test("requires both documents before returning a launch-ready pair", () => {
    expect(
      resolvePublicLegalDocumentUrls(
        {
          termsUrl: "https://legal.hyperia.example/terms",
          privacyUrl: "https://legal.hyperia.example/privacy",
        },
        "https://bet.hyperia.example",
      ),
    ).toEqual({
      termsUrl: "https://legal.hyperia.example/terms",
      privacyUrl: "https://legal.hyperia.example/privacy",
    });
    expect(
      resolvePublicLegalDocumentUrls(
        { termsUrl: "https://legal.hyperia.example/terms" },
        "https://bet.hyperia.example",
      ),
    ).toBeNull();
  });
});
