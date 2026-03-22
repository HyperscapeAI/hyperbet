import { describe, expect, it } from "bun:test";

import { POINTS_DRAWER_OVERLAY_STYLE } from "./pointsDrawer";

describe("POINTS_DRAWER_OVERLAY_STYLE", () => {
  it("uses a fixed viewport overlay", () => {
    expect(POINTS_DRAWER_OVERLAY_STYLE.position).toBe("fixed");
    expect(POINTS_DRAWER_OVERLAY_STYLE.top).toBe(0);
    expect(POINTS_DRAWER_OVERLAY_STYLE.left).toBe(0);
    expect(POINTS_DRAWER_OVERLAY_STYLE.right).toBe(0);
    expect(POINTS_DRAWER_OVERLAY_STYLE.bottom).toBe(0);
  });
});
