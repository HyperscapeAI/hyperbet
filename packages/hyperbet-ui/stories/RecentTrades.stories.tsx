import type { Meta, StoryObj } from "@storybook/react";
import { RecentTrades } from "../src/components/RecentTrades";
import { StorySurface, sampleTrades } from "./storySupport";

const meta = {
  title: "Components/RecentTrades",
  component: RecentTrades,
  parameters: {
    locale: "zh",
  },
  render: (args) => (
    <StorySurface width={360}>
      <div
        style={{
          padding: 16,
          borderRadius: 16,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <RecentTrades {...args} />
      </div>
    </StorySurface>
  ),
  args: {
    yesPot: 145.2,
    noPot: 112.4,
    totalPot: 257.6,
    assetPriceUsd: 0.0712,
    locale: "zh",
    assetSymbol: "SOL",
    trades: sampleTrades,
  },
} satisfies Meta<typeof RecentTrades>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
