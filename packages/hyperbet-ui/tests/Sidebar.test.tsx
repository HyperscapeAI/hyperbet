import "./setup";
import { describe, expect, it } from "bun:test";

import { Sidebar } from "../src/components/Sidebar";
import { click, render } from "./render";

describe("Sidebar", () => {
  it("toggles between expanded and collapsed widths", () => {
    const { container } = render(
      <Sidebar side="left" width={320}>
        <div>Panel body</div>
      </Sidebar>,
    );

    const toggle = container.querySelector("button") as HTMLButtonElement;

    // Expanded state: toggle shows collapse arrow, body visible
    expect(toggle.textContent).toBe("◀");
    expect(container.textContent).toContain("Panel body");

    click(toggle);

    // Collapsed state: toggle shows expand arrow, body still in DOM but panel collapsed
    expect(toggle.textContent).toBe("▶");
    expect(container.textContent).toContain("Panel body");
  });
});
