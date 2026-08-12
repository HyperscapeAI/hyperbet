export type DuelFeedConfig = {
  gameUrl: string;
  bearerToken: string;
};

export type StreamStateSourceConfig = {
  sourceUrl: string;
  bearerToken: string;
};

function isMainnetCluster(cluster: string): boolean {
  const normalized = cluster.trim().toLowerCase();
  return normalized === "mainnet" || normalized === "mainnet-beta";
}

export function resolveDuelFeedConfig(input: {
  cluster: string;
  gameUrl: string;
  bearerToken?: string;
}): DuelFeedConfig {
  const gameUrl = input.gameUrl.trim().replace(/\/$/, "");
  const bearerToken = input.bearerToken?.trim() ?? "";

  let parsed: URL;
  try {
    parsed = new URL(gameUrl);
  } catch {
    throw new Error("GAME_URL must be an absolute URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("GAME_URL must not contain embedded credentials");
  }
  if (isMainnetCluster(input.cluster)) {
    if (parsed.protocol !== "https:") {
      throw new Error("GAME_URL must use HTTPS on mainnet-beta");
    }
    if (!bearerToken) {
      throw new Error(
        "BET_SYNC_SOURCE_BEARER_TOKEN is required on mainnet-beta",
      );
    }
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("GAME_URL must use HTTP or HTTPS");
  }

  return { gameUrl, bearerToken };
}

export function resolveStreamStateSourceConfig(input: {
  production: boolean;
  sourceUrl?: string;
  bearerToken?: string;
}): StreamStateSourceConfig {
  const sourceUrl = input.sourceUrl?.trim() ?? "";
  const bearerToken = input.bearerToken?.trim() ?? "";

  if (!sourceUrl) {
    if (input.production) {
      throw new Error(
        "STREAM_STATE_SOURCE_URL is required in production and must target the canonical Hyperia /api/streaming/state endpoint",
      );
    }
    return { sourceUrl: "", bearerToken };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("STREAM_STATE_SOURCE_URL must be an absolute URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "STREAM_STATE_SOURCE_URL must not contain embedded credentials",
    );
  }
  if (parsed.pathname !== "/api/streaming/state") {
    throw new Error(
      "STREAM_STATE_SOURCE_URL must target exactly /api/streaming/state",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "STREAM_STATE_SOURCE_URL must not include query parameters or a fragment",
    );
  }
  if (input.production) {
    if (parsed.protocol !== "https:") {
      throw new Error("STREAM_STATE_SOURCE_URL must use HTTPS in production");
    }
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("STREAM_STATE_SOURCE_URL must use HTTP or HTTPS");
  }

  return {
    sourceUrl: `${parsed.origin}${parsed.pathname}`,
    bearerToken,
  };
}

export function canAcceptStreamStatePublish(input: {
  production: boolean;
  sourceConfigured: boolean;
}): boolean {
  return !input.production && !input.sourceConfigured;
}
