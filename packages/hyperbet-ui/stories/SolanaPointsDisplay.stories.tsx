import type { Meta, StoryObj } from "@storybook/react";
import { SolanaPointsDisplay } from "../src/components/SolanaPointsDisplay";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaPointsDisplay",
  component: SolanaPointsDisplay,
  parameters: { chain: "solana" },
  render: (args) => (
    <StorySurface width={460}>
      <SolanaPointsDisplay {...args} />
    </StorySurface>
  ),
  args: {
    walletAddress: null,
    compact: false,
  },
} satisfies Meta<typeof SolanaPointsDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {};
