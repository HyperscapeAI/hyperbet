export type ResultCatchupBearerTokenSource =
  | "hyperscapes-result"
  | null;

export type ResultCatchupBearerTokenResolution = {
  token: string | null;
  source: ResultCatchupBearerTokenSource;
};

type EnvLike = Record<string, string | undefined>;

function nonEmptyEnv(env: EnvLike, key: string): string | null {
  return env[key]?.trim() || null;
}

/**
 * Resolve the bearer token used by the missed-duel-result catch-up path.
 *
 * Hyperscape only accepts a dedicated result lookup token for
 * `/api/streaming/results/:duelId`. Broad betting-feed/source tokens are
 * intentionally not accepted here because this endpoint returns settlement
 * proof material (`duelKeyHex`, `seed`, `replayHash`).
 */
export function resolveResultCatchupBearerToken(
  env: EnvLike,
): ResultCatchupBearerTokenResolution {
  const resultLookupToken = nonEmptyEnv(
    env,
    "HYPERSCAPES_RESULT_LOOKUP_BEARER_TOKEN",
  );
  if (resultLookupToken) {
    return {
      token: resultLookupToken,
      source: "hyperscapes-result",
    };
  }
  return {
    token: null,
    source: null,
  };
}
