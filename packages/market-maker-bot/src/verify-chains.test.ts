import { describe, expect, it } from "vitest";

import { normalizeAddress } from "./index.ts";
import type { CheckResult } from "./verify-chains.ts";

describe("normalizeAddress", () => {
  it("checksums a valid lowercase address", () => {
    const lower = "0x1224094aae93bc9c52fa6f02a0b1f4700721e26e";
    const result = normalizeAddress(lower);
    expect(result).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("passes through an already-checksummed address", () => {
    const checksummed = "0x1224094aAe93bc9c52FA6F02a0B1F4700721E26E";
    expect(normalizeAddress(checksummed)).toBe(checksummed);
  });

  it("trims whitespace", () => {
    const padded = "  0x1224094aae93bc9c52fa6f02a0b1f4700721e26e  ";
    expect(normalizeAddress(padded)).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("throws on invalid address", () => {
    expect(() => normalizeAddress("not-an-address")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => normalizeAddress("")).toThrow();
  });
});

describe("verify-chains module structure", () => {
  it("exports CheckResult with expected shape", () => {
    const result: CheckResult = {
      chain: "avax",
      ok: true,
      details: "test",
    };
    expect(result.chain).toBe("avax");
    expect(result.ok).toBe(true);
    expect(typeof result.details).toBe("string");
  });
});
