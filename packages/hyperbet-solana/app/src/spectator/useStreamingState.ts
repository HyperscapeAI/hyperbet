import { useStreamingState as useSharedStreamingState } from "@hyperbet/ui/spectator/useStreamingState";

import { CONFIG, UI_SYNC_DELAY_MS } from "../lib/config";

export function useStreamingState(
  options: { disabled?: boolean; presentationTimeMs?: number | null } = {},
) {
  return useSharedStreamingState({
    disabled: options.disabled,
    apiUrl: CONFIG.gameApiUrl,
    uiSyncDelayMs: UI_SYNC_DELAY_MS,
    presentationTimeMs: options.presentationTimeMs,
  });
}
