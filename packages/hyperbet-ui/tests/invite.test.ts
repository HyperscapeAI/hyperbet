import "./setup";
import { describe, expect, it } from "bun:test";

import {
  normalizeInviteCode,
  extractInviteCodeFromInput,
  buildInviteShareLink,
  getStoredInviteCode,
  wasInviteAppliedForWallet,
  markInviteAppliedForWallet,
} from "../src/lib/invite";

describe("normalizeInviteCode", () => {
  it("uppercases and returns a valid code", () => {
    expect(normalizeInviteCode("alpha")).toBe("ALPHA");
  });

  it("returns null for null/undefined/empty", () => {
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode(undefined)).toBeNull();
    expect(normalizeInviteCode("")).toBeNull();
  });

  it("returns null for codes with invalid characters", () => {
    expect(normalizeInviteCode("a b c")).toBeNull();
    expect(normalizeInviteCode("abc!")).toBeNull();
  });

  it("returns null for codes shorter than 4 characters", () => {
    expect(normalizeInviteCode("AB")).toBeNull();
  });

  it("allows hyphens and underscores", () => {
    expect(normalizeInviteCode("CODE-123_X")).toBe("CODE-123_X");
  });
});

describe("extractInviteCodeFromInput", () => {
  it("extracts from a raw code string", () => {
    expect(extractInviteCodeFromInput("HELLO")).toBe("HELLO");
  });

  it("extracts from a URL with ?invite= param", () => {
    expect(extractInviteCodeFromInput("https://hyperia.bet/?invite=BETA")).toBe(
      "BETA",
    );
  });

  it("extracts from a URL with ?ref= param", () => {
    expect(extractInviteCodeFromInput("https://example.com/?ref=GAMMA")).toBe(
      "GAMMA",
    );
  });

  it("returns null for a URL without an invite param", () => {
    expect(extractInviteCodeFromInput("https://example.com/page")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractInviteCodeFromInput("")).toBeNull();
  });
});

describe("buildInviteShareLink", () => {
  it("builds a link using current origin when window is available", () => {
    // happy-dom starts at about:blank with origin "null".
    // Mock a real location so the URL constructor in buildInviteShareLink works.
    const savedLocation = window.location;
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:3000/"),
      writable: true,
      configurable: true,
    });
    try {
      const link = buildInviteShareLink("DELTA");
      expect(link).toContain("invite=DELTA");
      expect(link.startsWith("http")).toBe(true);
    } finally {
      Object.defineProperty(window, "location", {
        value: savedLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it("returns empty string for invalid code", () => {
    expect(buildInviteShareLink("")).toBe("");
    expect(buildInviteShareLink("AB")).toBe("");
  });
});

describe("invite localStorage integration", () => {
  it("getStoredInviteCode returns null when nothing stored", () => {
    window.localStorage.removeItem("arena:invite:code");
    expect(getStoredInviteCode()).toBeNull();
  });

  it("getStoredInviteCode returns normalized code when stored", () => {
    window.localStorage.setItem("arena:invite:code", "stored");
    expect(getStoredInviteCode()).toBe("STORED");
    window.localStorage.removeItem("arena:invite:code");
  });

  it("wasInviteAppliedForWallet returns false initially", () => {
    expect(wasInviteAppliedForWallet("0xWALLET", "MYCODE")).toBe(false);
  });

  it("markInviteAppliedForWallet then wasInviteAppliedForWallet returns true", () => {
    markInviteAppliedForWallet("0xWALLET", "MYCODE");
    expect(wasInviteAppliedForWallet("0xWALLET", "MYCODE")).toBe(true);
    // Cleanup
    window.localStorage.removeItem("arena:invite:applied:0xWALLET:MYCODE");
  });

  it("invite application is scoped per wallet", () => {
    markInviteAppliedForWallet("wallet-a", "CODE1");
    expect(wasInviteAppliedForWallet("wallet-a", "CODE1")).toBe(true);
    expect(wasInviteAppliedForWallet("wallet-b", "CODE1")).toBe(false);
    window.localStorage.removeItem("arena:invite:applied:wallet-a:CODE1");
  });

  it("handles invalid inputs gracefully", () => {
    expect(wasInviteAppliedForWallet("", "CODE")).toBe(false);
    expect(wasInviteAppliedForWallet("wallet", "")).toBe(false);
  });
});
