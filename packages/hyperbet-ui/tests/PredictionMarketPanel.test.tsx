import "./setup";
import { describe, expect, it } from "bun:test";
import type { ComponentProps } from "react";

import { PredictionMarketPanel } from "../src/components/PredictionMarketPanel";
import { changeValue, click, getByTestId, render } from "./render";

function renderPanel(
  overrides: Partial<ComponentProps<typeof PredictionMarketPanel>> = {},
) {
  const sideChanges: string[] = [];
  const amountChanges: string[] = [];
  let placedBets = 0;

  const rendered = render(
    <PredictionMarketPanel
      yesPercent={55}
      noPercent={45}
      yesPool={125}
      noPool={75}
      side="YES"
      setSide={(side) => sideChanges.push(side)}
      amountInput="100"
      setAmountInput={(value) => amountChanges.push(value)}
      onPlaceBet={() => {
        placedBets += 1;
      }}
      isWalletReady
      programsReady
      agent1Name="Alpha"
      agent2Name="Bravo"
      compact
      {...overrides}
    />,
  );

  return {
    container: rendered.container,
    sideChanges,
    amountChanges,
    get placedBets() {
      return placedBets;
    },
  };
}

describe("PredictionMarketPanel", () => {
  it("submits buy-side interactions through the provided handlers", () => {
    const state = renderPanel();
    const { container } = state;

    click(getByTestId(container, "prediction-select-no"));
    changeValue(
      getByTestId(container, "prediction-amount-input") as HTMLInputElement,
      "250.5",
    );
    click(getByTestId(container, "prediction-submit"));

    expect(getByTestId(container, "prediction-submit").textContent).toContain(
      "BUY YES",
    );
    expect(state.sideChanges).toEqual(["NO"]);
    expect(state.placedBets).toBe(1);
  });

  it("disables buying when the wallet is unavailable", () => {
    const { container } = renderPanel({ isWalletReady: false });

    const submit = getByTestId(container, "prediction-submit");
    expect(submit.textContent).toContain("CONNECT WALLET");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders public matchup data without transaction controls in spectator mode", () => {
    const state = renderPanel({ readOnly: true });
    const { container } = state;

    expect(container.textContent).toContain(
      "Spectator mode · transaction controls disabled",
    );
    expect(container.querySelector('[data-testid="prediction-tab-buy"]')).toBe(
      null,
    );
    expect(
      container.querySelector('[data-testid="prediction-amount-input"]'),
    ).toBe(null);
    expect(container.querySelector('[data-testid="prediction-submit"]')).toBe(
      null,
    );
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Bravo");
    expect(state.placedBets).toBe(0);
  });

  it("shows sell-side content only when selling is supported", () => {
    const { container } = renderPanel({
      supportsSell: true,
      children: <div>Sell controls</div>,
    });

    const sellTab = getByTestId(container, "prediction-tab-sell");
    expect((sellTab as HTMLButtonElement).disabled).toBe(false);

    click(sellTab);

    expect(container.textContent).toContain("Sell controls");
  });

  it("renders localized Chinese action labels and SOL denomination text", () => {
    const { container } = renderPanel({
      locale: "zh",
      currencySymbol: "SOL",
    });

    expect(getByTestId(container, "prediction-tab-buy").textContent).toContain(
      "买入",
    );
    expect(getByTestId(container, "prediction-tab-sell").textContent).toContain(
      "卖出",
    );
    expect(
      getByTestId(container, "prediction-amount-input").getAttribute(
        "aria-label",
      ),
    ).toBe("下注金额（SOL）");
    expect(getByTestId(container, "prediction-submit").textContent).toContain(
      "买入 YES",
    );
  });

  it("does not invent probability percentages when a CLOB quote is unavailable", () => {
    const { container } = renderPanel({ yesPercent: null, noPercent: null });
    const yesSelection = getByTestId(container, "prediction-select-yes");
    const noSelection = getByTestId(container, "prediction-select-no");

    expect(yesSelection.textContent).toContain("—");
    expect(noSelection.textContent).toContain("—");
    expect(yesSelection.textContent).not.toContain("50%");
    expect(noSelection.textContent).not.toContain("null%");
  });
});
