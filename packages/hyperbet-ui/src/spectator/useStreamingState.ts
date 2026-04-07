import { useMemo } from "react";

import type { StreamingStateUpdate } from "./types";
import {
  canonicalSessionToStreamingState,
  useCanonicalStreamSession,
} from "./useCanonicalStreamSession";

export function useStreamingState(options: { disabled?: boolean } = {}) {
  const { session, isConnected } = useCanonicalStreamSession(options);
  const state = useMemo<StreamingStateUpdate | null>(
    () => (session ? canonicalSessionToStreamingState(session) : null),
    [session],
  );
  return { state, isConnected };
}
