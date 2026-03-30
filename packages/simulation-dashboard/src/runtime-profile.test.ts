import { describe, expect, test } from "bun:test";

import { isScenarioCloseGuardWindow } from "./runtime-profile.js";

describe("runtime profile helpers", () => {
  test("enters the close guard window before the exact bet close tick", () => {
    expect(
      isScenarioCloseGuardWindow(
        {
          betCloseTick: 4,
          marketMakerBetCloseGuardMs: 750,
        },
        2,
      ),
    ).toBe(false);
    expect(
      isScenarioCloseGuardWindow(
        {
          betCloseTick: 4,
          marketMakerBetCloseGuardMs: 750,
        },
        3,
      ),
    ).toBe(true);
    expect(
      isScenarioCloseGuardWindow(
        {
          betCloseTick: 4,
          marketMakerBetCloseGuardMs: 750,
        },
        4,
      ),
    ).toBe(true);
  });

  test("returns false when there is no close tick configured", () => {
    expect(
      isScenarioCloseGuardWindow(
        {
          marketMakerBetCloseGuardMs: 750,
        },
        4,
      ),
    ).toBe(false);
  });
});
