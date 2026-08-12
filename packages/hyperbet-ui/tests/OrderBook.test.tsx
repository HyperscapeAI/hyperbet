import "./setup";
import { describe, expect, it } from "bun:test";

import { OrderBook } from "../src/components/OrderBook";
import { render } from "./render";

describe("OrderBook", () => {
  it("renders spread, price levels, and pool summaries", () => {
    const { container } = render(
      <OrderBook
        yesPot={40}
        noPot={60}
        totalPot={100}
        assetPriceUsd={2015.1234}
        bids={[{ price: 0.55, amount: 10, total: 10 }]}
        asks={[{ price: 0.65, amount: 8, total: 8 }]}
      />,
    );

    expect(container.textContent).toContain("ORDER BOOK");
    expect(container.textContent).toContain("0.400");
    expect(container.textContent).toContain("Spread: 0.000");
    expect(container.textContent).toContain("0.550");
    expect(container.textContent).toContain("0.650");
  });

  it("renders localized Chinese labels", () => {
    const { container } = render(
      <OrderBook
        yesPot={40}
        noPot={60}
        totalPot={100}
        assetPriceUsd={2015.1234}
        locale="zh"
        bids={[{ price: 0.55, amount: 10, total: 10 }]}
        asks={[{ price: 0.65, amount: 8, total: 8 }]}
      />,
    );

    expect(container.textContent).toContain("订单簿");
    expect(container.textContent).toContain("价格");
    expect(container.textContent).toContain("数量");
    expect(container.textContent).toContain("总计");
    expect(container.textContent).toContain("价差: 0.000");
  });

  it("does not invent a midpoint or spread when the CLOB quote is unavailable", () => {
    const { container } = render(
      <OrderBook
        yesPot={0}
        noPot={0}
        totalPot={0}
        assetPriceUsd={null}
        midPrice={null}
      />,
    );

    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("0.500");
    expect(container.textContent).not.toContain("Spread: 0.000");
  });
});
