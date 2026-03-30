import "./setup";
import { describe, expect, it } from "bun:test";

import { Tabs } from "../src/components/Tabs";
import { click, getButtonByText, render } from "./render";

describe("Tabs", () => {
  it("renders the active tab and reports changes", () => {
    const changes: string[] = [];

    const { container } = render(
      <Tabs
        tabs={[
          { id: "markets", label: "Markets" },
          { id: "history", label: "History" },
        ]}
        activeTab="markets"
        onChange={(id) => changes.push(id)}
      />,
    );

    const activeButton = getButtonByText(container, "Markets");
    const inactiveButton = getButtonByText(container, "History");
    expect(activeButton.style.fontWeight).toBe("700");
    expect(inactiveButton.style.fontWeight).toBe("500");

    click(inactiveButton);
    expect(changes).toEqual(["history"]);
  });
});
