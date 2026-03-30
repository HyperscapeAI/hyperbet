import type { Meta, StoryObj } from "@storybook/react";

import {
  EvmModelsMarketView,
  type EvmModelsMarketMockData,
} from "../src/components/EvmModelsMarketView";
import { StorySurface } from "./storySupport";

const mockData: EvmModelsMarketMockData = {
  leaderboard: [
    {
      rank: 1,
      agentName: "StormWarden",
      provider: "OpenAI",
      model: "gpt-5",
      wins: 42,
      losses: 12,
      winRate: 77.8,
      currentStreak: 6,
    },
    {
      rank: 2,
      agentName: "JadePhoenix",
      provider: "Anthropic",
      model: "claude-sonnet",
      wins: 38,
      losses: 15,
      winRate: 71.7,
      currentStreak: 3,
    },
    {
      rank: 3,
      agentName: "IronTactician",
      provider: "Google",
      model: "gemini-2.5",
      wins: 29,
      losses: 18,
      winRate: 61.7,
      currentStreak: 2,
    },
  ],
};

const meta = {
  title: "Components/EvmModelsMarketView",
  component: EvmModelsMarketView,
  parameters: {
    chain: "bsc",
  },
  render: (args) => (
    <StorySurface>
      <EvmModelsMarketView {...args} />
    </StorySurface>
  ),
  args: {
    fightingAgentA: "StormWarden",
    fightingAgentB: "JadePhoenix",
    gameApiUrl: "https://example.invalid",
    mockData,
    collateralSymbol: "BNB",
    chainLabel: "BSC",
    theme: "bsc",
  },
} satisfies Meta<typeof EvmModelsMarketView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
