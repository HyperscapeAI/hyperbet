import type { Meta, StoryObj } from "@storybook/react";
import { SolanaAmmPanel } from "../src/components/SolanaAmmPanel";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaAmmPanel",
  component: SolanaAmmPanel,
  parameters: {
    chain: "solana",
  },
  render: (args) => (
    <StorySurface width={1180}>
      <SolanaAmmPanel {...args} />
    </StorySurface>
  ),
  args: {
    agent1Name: "StormWarden",
    agent2Name: "JadePhoenix",
    compact: false,
  },
} satisfies Meta<typeof SolanaAmmPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
