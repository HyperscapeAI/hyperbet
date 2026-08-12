import type { Meta, StoryObj } from "@storybook/react";
import { SolanaReferralPanel } from "../src/components/SolanaReferralPanel";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaReferralPanel",
  component: SolanaReferralPanel,
  parameters: { chain: "solana" },
  render: (args) => (
    <StorySurface width={460}>
      <SolanaReferralPanel {...args} />
    </StorySurface>
  ),
  args: {
    solanaWallet: null,
  },
} satisfies Meta<typeof SolanaReferralPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {};
