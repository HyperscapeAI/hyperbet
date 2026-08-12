import type { Meta, StoryObj } from "@storybook/react";
import { OrderBook } from "../src/components/OrderBook";
import { StorySurface, sampleAsks, sampleBids } from "./storySupport";

const meta = {
  title: "Components/OrderBook",
  component: OrderBook,
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
        <OrderBook {...args} />
      </div>
    </StorySurface>
  ),
  args: {
    yesPot: 145.2,
    noPot: 112.4,
    totalPot: 257.6,
    assetPriceUsd: 0.0712,
    bids: sampleBids,
    asks: sampleAsks,
    locale: "en",
    assetSymbol: "SOL",
  },
} satisfies Meta<typeof OrderBook>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
