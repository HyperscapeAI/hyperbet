import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { PredictionMarketPanel } from "../src/components/PredictionMarketPanel";
import {
  StorySurface,
  sampleAsks,
  sampleBids,
  sampleChartData,
  sampleTrades,
} from "./storySupport";

const meta = {
  title: "Components/PredictionMarketPanel",
  component: PredictionMarketPanel,
  parameters: {
    locale: "zh",
  },
  render: (args) => {
    const [side, setSide] = React.useState<"YES" | "NO">("YES");
    const [amountInput, setAmountInput] = React.useState("2.5");

    return (
      <StorySurface width={1180}>
        <PredictionMarketPanel
          {...args}
          side={side}
          setSide={setSide}
          amountInput={amountInput}
          setAmountInput={setAmountInput}
        />
      </StorySurface>
    );
  },
  args: {
    yesPercent: 56,
    noPercent: 44,
    yesPool: "145.2 SOL",
    noPool: "112.4 SOL",
    side: "YES",
    setSide: () => undefined,
    amountInput: "2.5",
    setAmountInput: () => undefined,
    onPlaceBet: () => undefined,
    isWalletReady: true,
    programsReady: true,
    agent1Name: "StormWarden",
    agent2Name: "JadePhoenix",
    supportsSell: true,
    chartData: sampleChartData,
    bids: sampleBids,
    asks: sampleAsks,
    recentTrades: sampleTrades,
    assetPriceUsd: 0.0712,
    currencySymbol: "SOL",
    locale: "zh",
    marketAssetSymbol: "SOL",
  },
} satisfies Meta<typeof PredictionMarketPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
