import "./setup";
import { describe, expect, it } from "bun:test";

import {
    normalizeUiLocale,
    resolveUiLocale,
    getUiCopy,
    getLocaleTag,
    formatLocaleAmount,
    formatTimeAgoLabel,
} from "../src/i18n";

describe("normalizeUiLocale", () => {
    it("maps zh-CN to zh", () => {
        expect(normalizeUiLocale("zh-CN")).toBe("zh");
    });

    it("maps ko-KR to ko", () => {
        expect(normalizeUiLocale("ko-KR")).toBe("ko");
    });

    it("maps pt-BR to pt", () => {
        expect(normalizeUiLocale("pt-BR")).toBe("pt");
    });

    it("maps es-ES to es", () => {
        expect(normalizeUiLocale("es-ES")).toBe("es");
    });

    it("defaults to en for unknown locales", () => {
        expect(normalizeUiLocale("de-DE")).toBe("en");
        expect(normalizeUiLocale("fr")).toBe("en");
    });

    it("defaults to en for null/undefined/empty", () => {
        expect(normalizeUiLocale(null)).toBe("en");
        expect(normalizeUiLocale(undefined)).toBe("en");
        expect(normalizeUiLocale("")).toBe("en");
    });
});

describe("resolveUiLocale", () => {
    it("normalizes explicit value", () => {
        expect(resolveUiLocale("zh-TW")).toBe("zh");
        expect(resolveUiLocale("en-US")).toBe("en");
    });
});

describe("getLocaleTag", () => {
    it("returns BCP 47 tags for each locale", () => {
        expect(getLocaleTag("en")).toBe("en-US");
        expect(getLocaleTag("zh")).toBe("zh-CN");
        expect(getLocaleTag("ko")).toBe("ko-KR");
        expect(getLocaleTag("pt")).toBe("pt-BR");
        expect(getLocaleTag("es")).toBe("es-ES");
    });
});

describe("getUiCopy", () => {
    it("returns English copy with expected keys", () => {
        const copy = getUiCopy("en");
        expect(copy.buy).toBe("BUY");
        expect(copy.sell).toBe("SELL");
        expect(copy.connectWallet).toBe("CONNECT WALLET");
        expect(copy.fight).toBe("FIGHT!");
    });

    it("returns Chinese copy", () => {
        const copy = getUiCopy("zh");
        expect(copy.buy).toBe("买入");
        expect(copy.sell).toBe("卖出");
    });

    it("actionLabel returns localized labels", () => {
        expect(getUiCopy("en").actionLabel("buy")).toBe("BUY");
        expect(getUiCopy("en").actionLabel("sell")).toBe("SELL");
        expect(getUiCopy("zh").actionLabel("buy")).toBe("买入");
    });

    it("betAmountLabel includes symbol", () => {
        expect(getUiCopy("en").betAmountLabel("SOL")).toBe("Bet amount in SOL");
        expect(getUiCopy("zh").betAmountLabel("BNB")).toContain("BNB");
    });

    it("sellPanelDescription returns mode-specific text", () => {
        const en = getUiCopy("en");
        expect(en.sellPanelDescription("supported")).toContain("sell-side");
        expect(en.sellPanelDescription("evm")).toContain("EVM");
        expect(en.sellPanelDescription("disabled")).toContain("resolution");
    });
});

describe("formatLocaleAmount", () => {
    it("formats large English numbers with K/M/B suffixes", () => {
        expect(formatLocaleAmount(1_500, "en")).toBe("1.5K");
        expect(formatLocaleAmount(2_500_000, "en")).toBe("2.5M");
        expect(formatLocaleAmount(3_000_000_000, "en")).toBe("3.0B");
    });

    it("formats large Chinese numbers with 万/亿 suffixes", () => {
        expect(formatLocaleAmount(50_000, "zh")).toBe("5.0万");
        expect(formatLocaleAmount(200_000_000, "zh")).toBe("2.0亿");
    });

    it("handles very small positive numbers", () => {
        expect(formatLocaleAmount(0.0000001, "en")).toBe("<0.000001");
    });

    it("returns 0 for zero", () => {
        expect(formatLocaleAmount(0, "en")).toBe("0");
    });
});

describe("formatTimeAgoLabel", () => {
    it("returns seconds ago for English", () => {
        const recent = Date.now() - 30_000;
        expect(formatTimeAgoLabel(recent, "en")).toContain("s ago");
    });

    it("returns Chinese time format", () => {
        const recent = Date.now() - 90_000;
        expect(formatTimeAgoLabel(recent, "zh")).toContain("分");
    });

    it("returns 'just now' type string for future timestamps", () => {
        const future = Date.now() + 10_000;
        expect(formatTimeAgoLabel(future, "en")).toBe("just now");
        expect(formatTimeAgoLabel(future, "zh")).toBe("刚刚");
    });
});
