import { useCallback, useEffect, useState } from "react";

import { GAME_API_URL } from "./config";

const READINESS_URL = `${GAME_API_URL.replace(/\/$/, "")}/ready`;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

type SolanaLaunchReadinessState = {
  checked: boolean;
  ready: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSolanaLaunchReadiness(payload: unknown): boolean {
  const envelope = asRecord(payload);
  const readiness = asRecord(envelope?.readiness);
  return (
    envelope?.ok === true &&
    envelope.service === "hyperbet-solana-backend" &&
    typeof envelope.now === "number" &&
    Number.isFinite(envelope.now) &&
    readiness?.ready === true
  );
}

export function useSolanaLaunchReadiness(
  options: { pollIntervalMs?: number; enabled?: boolean } = {},
): SolanaLaunchReadinessState {
  const enabled = options.enabled ?? true;
  const pollIntervalMs = Math.max(
    1_000,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const [state, setState] = useState<SolanaLaunchReadinessState>({
    checked: !enabled,
    ready: false,
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(READINESS_URL, {
        cache: "no-store",
        signal,
      });
      const payload = await response.json();
      if (!signal?.aborted) {
        setState({
          checked: true,
          ready: response.ok && parseSolanaLaunchReadiness(payload),
        });
      }
    } catch {
      if (!signal?.aborted) {
        setState({ checked: true, ready: false });
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const initialController = new AbortController();
    let pollController: AbortController | null = null;
    void refresh(initialController.signal);
    const intervalId = window.setInterval(() => {
      pollController?.abort();
      pollController = new AbortController();
      void refresh(pollController.signal);
    }, pollIntervalMs);

    return () => {
      initialController.abort();
      pollController?.abort();
      window.clearInterval(intervalId);
    };
  }, [enabled, pollIntervalMs, refresh]);

  return state;
}
