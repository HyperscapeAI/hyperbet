import "./setup";
import { describe, expect, it } from "bun:test";
import { LocaleSelector } from "../src/components/LocaleSelector";
import { changeValue, getByTestId, render } from "./render";

describe("LocaleSelector", () => {
  it("shows the current locale and reports changes", () => {
    let nextLocale = "en";

    const { container } = render(
      <LocaleSelector
        locale="en"
        onChange={(locale) => {
          nextLocale = locale;
        }}
      />,
    );

    const select = getByTestId(container, "locale-selector") as HTMLSelectElement;
    expect(select.value).toBe("en");

    changeValue(select, "zh");
    expect(nextLocale).toBe("zh");
  });
});
