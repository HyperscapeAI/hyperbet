export type ResultCatchupBearerTokenSource =
  | "hyperscapes-result"
  | "oracle-proof-alias"
  | "betting-feed"
  | "stream-state"
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
 * Hyperscape production only accepts a dedicated oracle-proof/result token for
 * `/api/streaming/results/:duelId`; broad betting-feed/source tokens are kept
 * as non-production fallbacks only so local and staging migrations fail
 * visibly instead of relying on a token the provider will reject in prod.
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

  const oracleProofAlias = nonEmptyEnv(env, "STREAMING_ORACLE_PROOF_TOKEN");
  if (oracleProofAlias) {
    return {
      token: oracleProofAlias,
      source: "oracle-proof-alias",
    };
  }

  if (env.NODE_ENV === "production") {
    return {
      token: null,
      source: null,
    };
  }

  const bettingFeedToken = nonEmptyEnv(env, "BETTING_FEED_ACCESS_TOKEN");
  if (bettingFeedToken) {
    return {
      token: bettingFeedToken,
      source: "betting-feed",
    };
  }

  const streamStateToken = nonEmptyEnv(env, "STREAM_STATE_SOURCE_BEARER_TOKEN");
  if (streamStateToken) {
    return {
      token: streamStateToken,
      source: "stream-state",
    };
  }

  return {
    token: null,
    source: null,
  };
}
