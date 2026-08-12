import type { Meta, StoryObj } from "@storybook/react";
import { SolanaManagedOrderConfirmationDialog } from "../src/components/SolanaManagedOrderConfirmationDialog";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaManagedOrderConfirmationDialog",
  component: SolanaManagedOrderConfirmationDialog,
  parameters: { chain: "solana", layout: "padded" },
  render: (args) => (
    <StorySurface width={520}>
      <SolanaManagedOrderConfirmationDialog {...args} />
    </StorySurface>
  ),
  args: {
    order: {
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
    submitting: false,
    compact: false,
    onBack: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof SolanaManagedOrderConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Cancel: Story = {};

export const Reclaim: Story = {
  args: { order: { ...meta.args.order, action: "RECLAIM" } },
};

export const FilledOrderRentRecovery: Story = {
  args: {
    order: {
      ...meta.args.order,
      action: "CLOSE_FILLED",
      filledUnits: meta.args.order.originalUnits,
      remainingUnits: 0n,
      refundableCollateralLamports: 0n,
      grossWalletCreditLamports:
        meta.args.order.returnedOrderAccountRentLamports,
      previousOrderId: 0n,
      nextOrderId: 0n,
      adjacentOrderIds: [],
    },
  },
};

export const Submitting: Story = { args: { submitting: true } };
