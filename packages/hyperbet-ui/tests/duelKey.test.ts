import "./setup";
import { describe, expect, it } from "bun:test";

import { duelKeyHexToBytes, shortDuelKey } from "../src/lib/duelKey";

describe("duelKeyHexToBytes", () => {
    it("converts a valid 64-char hex string to 32 bytes", () => {
        const hex =
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        const bytes = duelKeyHexToBytes(hex);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(32);
        expect(bytes[0]).toBe(0xab);
        expect(bytes[31]).toBe(0x89);
    });

    it("handles uppercase hex", () => {
        const hex =
            "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
        const bytes = duelKeyHexToBytes(hex);
        expect(bytes.length).toBe(32);
    });

    it("accepts a 0x-prefixed hex string", () => {
        const hex =
            "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        const bytes = duelKeyHexToBytes(hex);
        expect(bytes.length).toBe(32);
        expect(bytes[0]).toBe(0xab);
    });

    it("throws on too-short input", () => {
        expect(() => duelKeyHexToBytes("abcd")).toThrow();
    });

    it("throws on non-hex characters", () => {
        const bad =
            "zzzzzz0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        expect(() => duelKeyHexToBytes(bad)).toThrow();
    });

    it("throws on empty string", () => {
        expect(() => duelKeyHexToBytes("")).toThrow();
    });
});

describe("shortDuelKey", () => {
    it("truncates a long hex key to first 8 and last 6 chars", () => {
        const hex =
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        expect(shortDuelKey(hex)).toBe("abcdef01...456789");
    });

    it('returns "unavailable" for null', () => {
        expect(shortDuelKey(null)).toBe("unavailable");
    });

    it('returns "unavailable" for undefined', () => {
        expect(shortDuelKey(undefined)).toBe("unavailable");
    });

    it('returns "unavailable" for empty string', () => {
        expect(shortDuelKey("")).toBe("unavailable");
    });
});
