import "./setup";
import { afterEach, describe, expect, it } from "bun:test";

import { RecentTrades } from "../src/components/RecentTrades";
import { render } from "./render";

const originalNow = Date.now;

afterEach(() => {
  Date.now = originalNow;
});

describe("RecentTrades", () => {
  it("renders the empty state when there are no trades", () => {
    const { container } = render(
      <RecentTrades
        yesPot={0}
        noPot={0}
        totalPot={0}
        goldPriceUsd={null}
        trades={[]}
      />,
    );

    expect(container.textContent).toContain("No trades yet");
  });

  it("renders trades with formatted amounts and relative times", () => {
    Date.now = () => 120_000;

    const { container } = render(
      <RecentTrades
        yesPot={20}
        noPot={30}
        totalPot={50}
        goldPriceUsd={1934.2}
        trades={[
          { id: "t-1", side: "YES", amount: 12.3456, time: 30_000 },
          { id: "t-2", side: "NO", amount: 1_500, time: 119_000 },
        ]}
      />,
    );

    expect(container.textContent).toContain("RECENT TRADES");
    expect(container.textContent).toContain("12.3456");
    expect(container.textContent).toContain("1.5K");
    expect(container.textContent).toContain("1m 30s ago");
    expect(container.textContent).toContain("1s ago");
  });

  it("renders localized Chinese trade labels", () => {
    Date.now = () => 120_000;

    const { container } = render(
      <RecentTrades
        yesPot={20}
        noPot={30}
        totalPot={50}
        goldPriceUsd={1934.2}
        locale="zh"
        trades={[{ id: "t-1", side: "YES", amount: 12.3456, time: 30_000 }]}
      />,
    );

    expect(container.textContent).toContain("最近成交");
    expect(container.textContent).toContain("方向");
    expect(container.textContent).toContain("数量");
    expect(container.textContent).toContain("时间");
    expect(container.textContent).toContain("1分30秒前");
  });
});
