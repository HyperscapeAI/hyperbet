import "./setup";
import { describe, expect, it } from "bun:test";

import { normalizeUiLocale, resolveUiLocale } from "../src/i18n";
import { getLocalizedChainDisplay, getChainUiConfig, isSupportedEvmChain } from "../src/tokens";

describe("locale helpers", () => {
  it("normalizes Chinese locale variants", () => {
    expect(normalizeUiLocale("zh-CN")).toBe("zh");
    expect(resolveUiLocale("zh-TW")).toBe("zh");
    expect(resolveUiLocale("en-US")).toBe("en");
  });

  it("defaults to Chinese when the browser prefers Chinese", () => {
    window.localStorage.removeItem("hyperbet_ui_locale");
    window.history.replaceState({}, "", "/");

    const languageDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "language",
    );
    const languagesDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "languages",
    );

    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "zh-CN",
    });
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-CN", "en-US"],
    });

    expect(resolveUiLocale()).toBe("zh");

    if (languageDescriptor) {
      Object.defineProperty(navigator, "language", languageDescriptor);
    }
    if (languagesDescriptor) {
      Object.defineProperty(navigator, "languages", languagesDescriptor);
    }
  });
});

describe("chain token metadata", () => {
  it("exposes localized chain labels and native token symbols", () => {
    expect(getLocalizedChainDisplay("solana", "en").nativeToken.symbol).toBe(
      "SOL",
    );
    expect(getLocalizedChainDisplay("bsc", "en").nativeToken.symbol).toBe(
      "BNB",
    );
    expect(getLocalizedChainDisplay("base", "en").nativeToken.symbol).toBe(
      "ETH",
    );
    expect(getLocalizedChainDisplay("avax", "zh").name).toBe("雪崩链");
    expect(getLocalizedChainDisplay("avax", "zh").nativeToken.symbol).toBe(
      "AVAX",
    );
  });
});

describe("getChainUiConfig", () => {
  it("returns config with correct chainId", () => {
    expect(getChainUiConfig("solana").chainId).toBe("solana");
    expect(getChainUiConfig("bsc").chainId).toBe("bsc");
    expect(getChainUiConfig("base").chainId).toBe("base");
    expect(getChainUiConfig("avax").chainId).toBe("avax");
  });

  it("includes icon and color for each chain", () => {
    for (const chain of ["solana", "bsc", "base", "avax"] as const) {
      const config = getChainUiConfig(chain);
      expect(config.icon.length).toBeGreaterThan(0);
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("isSupportedEvmChain", () => {
  it("returns true for BSC, Base, and AVAX", () => {
    expect(isSupportedEvmChain("bsc")).toBe(true);
    expect(isSupportedEvmChain("base")).toBe(true);
    expect(isSupportedEvmChain("avax")).toBe(true);
  });

  it("returns false for Solana", () => {
    expect(isSupportedEvmChain("solana")).toBe(false);
  });
});
