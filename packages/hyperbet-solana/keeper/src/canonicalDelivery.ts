export type CanonicalStreamDelivery = {
  mode: "self_hls" | "external_hls";
  provider: string | null;
  playbackUrl: string | null;
  hlsUrl: string | null;
  llhlsUrl: string | null;
  ingestUrl: string | null;
};

export function mergeCanonicalDeliveryOverride(params: {
  baseDelivery: CanonicalStreamDelivery | null;
  overrideDelivery: CanonicalStreamDelivery | null;
  hasAuthoritativeCanonicalDestination: boolean;
}): CanonicalStreamDelivery | null {
  const {
    baseDelivery,
    overrideDelivery,
    hasAuthoritativeCanonicalDestination,
  } = params;

  if (!hasAuthoritativeCanonicalDestination) {
    return overrideDelivery ?? baseDelivery;
  }

  if (!baseDelivery) {
    return overrideDelivery;
  }

  if (!overrideDelivery) {
    return baseDelivery;
  }

  return {
    mode: baseDelivery.mode,
    provider: baseDelivery.provider,
    playbackUrl: baseDelivery.playbackUrl ?? overrideDelivery.playbackUrl,
    hlsUrl: baseDelivery.hlsUrl ?? overrideDelivery.hlsUrl,
    llhlsUrl: baseDelivery.llhlsUrl ?? overrideDelivery.llhlsUrl,
    ingestUrl: baseDelivery.ingestUrl,
  };
}
