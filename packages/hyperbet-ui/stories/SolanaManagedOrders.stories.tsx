import type { Meta, StoryObj } from "@storybook/react";
import { SolanaManagedOrders } from "../src/components/SolanaManagedOrders";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaManagedOrders",
  component: SolanaManagedOrders,
  parameters: { chain: "solana", layout: "padded" },
  render: (args) => (
    <StorySurface width={520}>
      <SolanaManagedOrders {...args} />
    </StorySurface>
  ),
  args: {
    orders: [
      {
        action: "CANCEL",
        marketState: "market",
        orderId: 7n,
        side: 1,
        outcomeSide: "YES",
        outcomePriceMillis: 600,
        programPriceMillis: 600,
        originalUnits: 2_000_000_000n,
        filledUnits: 500_000_000n,
        remainingUnits: 1_500_000_000n,
        refundableCollateralLamports: 900_000_000n,
        returnedOrderAccountRentLamports: 1_719_120n,
        grossWalletCreditLamports: 901_719_120n,
        previousOrderId: 6n,
        nextOrderId: 8n,
        adjacentOrderIds: [6n, 8n],
        continuationPending: false,
      },
      {
        action: "RECLAIM",
        marketState: "market",
        orderId: 9n,
        side: 2,
        outcomeSide: "NO",
        outcomePriceMillis: 350,
        programPriceMillis: 650,
        originalUnits: 2_000_000_000n,
        filledUnits: 0n,
        remainingUnits: 2_000_000_000n,
        refundableCollateralLamports: 700_000_000n,
        returnedOrderAccountRentLamports: 1_719_120n,
        grossWalletCreditLamports: 701_719_120n,
        previousOrderId: 0n,
        nextOrderId: 0n,
        adjacentOrderIds: [],
        continuationPending: false,
      },
      {
        action: "CLOSE_FILLED",
        marketState: "market",
        orderId: 10n,
        side: 1,
        outcomeSide: "YES",
        outcomePriceMillis: 600,
        programPriceMillis: 600,
        originalUnits: 2_000_000_000n,
        filledUnits: 2_000_000_000n,
        remainingUnits: 0n,
        refundableCollateralLamports: 0n,
        returnedOrderAccountRentLamports: 1_719_120n,
        grossWalletCreditLamports: 1_719_120n,
        previousOrderId: 0n,
        nextOrderId: 0n,
        adjacentOrderIds: [],
        continuationPending: false,
      },
    ],
    submittingOrderId: null,
    disabled: false,
    onRequestAction: () => undefined,
  },
} satisfies Meta<typeof SolanaManagedOrders>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveOrders: Story = {};

export const Submitting: Story = {
  args: { submittingOrderId: 7n },
};
