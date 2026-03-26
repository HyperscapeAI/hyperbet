import "./setup";
import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";

const componentsDir = path.resolve(import.meta.dir, "../src/components");
const storiesDir = path.resolve(import.meta.dir, "../stories");

function basenameSet(dir: string, suffix: string): Set<string> {
  return new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith(suffix))
      .map((file) => file.slice(0, -suffix.length))
      .sort(),
  );
}

describe("storybook coverage", () => {
  it("keeps component stories aligned with shared components", () => {
    const components = basenameSet(componentsDir, ".tsx");
    const stories = basenameSet(storiesDir, ".stories.tsx");

    expect([...stories]).toEqual([...components]);
  });
});
