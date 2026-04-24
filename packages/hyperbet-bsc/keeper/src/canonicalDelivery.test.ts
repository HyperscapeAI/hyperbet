import { describe, expect, test } from "bun:test";

import {
  mergeCanonicalDeliveryOverride,
  type CanonicalStreamDelivery,
} from "./canonicalDelivery";

const BASE_DELIVERY: CanonicalStreamDelivery = {
  mode: "external_hls",
  provider: "cloudflare_stream",
  playbackUrl: "https://videodelivery.net/live.m3u8",
  hlsUrl: null,
  llhlsUrl: "https://videodelivery.net/live.m3u8?protocol=llhls",
  ingestUrl: "srt://live.cloudflare.example/input",
};

const OVERRIDE_DELIVERY: CanonicalStreamDelivery = {
  mode: "external_hls",
  provider: "cloudflare_stream",
  playbackUrl: "https://override.example/video.m3u8",
  hlsUrl: "https://override.example/video.m3u8",
  llhlsUrl: null,
  ingestUrl: "rtmps://override.example/live",
};

describe("mergeCanonicalDeliveryOverride", () => {
  test("preserves authoritative canonical transport metadata", () => {
    const delivery = mergeCanonicalDeliveryOverride({
      baseDelivery: BASE_DELIVERY,
      overrideDelivery: OVERRIDE_DELIVERY,
      hasAuthoritativeCanonicalDestination: true,
    });

    expect(delivery).toEqual({
      mode: "external_hls",
      provider: "cloudflare_stream",
      playbackUrl: "https://videodelivery.net/live.m3u8",
      hlsUrl: "https://override.example/video.m3u8",
      llhlsUrl: "https://videodelivery.net/live.m3u8?protocol=llhls",
      ingestUrl: "srt://live.cloudflare.example/input",
    });
  });

  test("allows override delivery when no authoritative canonical destination exists", () => {
    const delivery = mergeCanonicalDeliveryOverride({
      baseDelivery: BASE_DELIVERY,
      overrideDelivery: OVERRIDE_DELIVERY,
      hasAuthoritativeCanonicalDestination: false,
    });

    expect(delivery).toEqual(OVERRIDE_DELIVERY);
  });

  test("fills missing playback fields from the override without replacing ingest", () => {
    const delivery = mergeCanonicalDeliveryOverride({
      baseDelivery: {
        ...BASE_DELIVERY,
        playbackUrl: null,
        hlsUrl: null,
        llhlsUrl: null,
      },
      overrideDelivery: OVERRIDE_DELIVERY,
      hasAuthoritativeCanonicalDestination: true,
    });

    expect(delivery).toEqual({
      mode: "external_hls",
      provider: "cloudflare_stream",
      playbackUrl: "https://override.example/video.m3u8",
      hlsUrl: "https://override.example/video.m3u8",
      llhlsUrl: null,
      ingestUrl: "srt://live.cloudflare.example/input",
    });
  });
});
