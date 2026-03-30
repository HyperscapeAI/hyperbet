import type { Meta, StoryObj } from "@storybook/react";
import { ThemeSelector } from "../src/components/ThemeSelector";
import {
  HyperbetThemeProvider,
  type HyperbetThemeId,
} from "../src/lib/theme";
import { StorySurface } from "./storySupport";

const themeIds: HyperbetThemeId[] = ["evm", "avax", "bsc", "base", "solana"];

const meta = {
  title: "Components/ThemeSelector",
  component: ThemeSelector,
  decorators: [
    (Story) => (
      <HyperbetThemeProvider themeId="evm" storageKey="storybook-theme-selector">
        <Story />
      </HyperbetThemeProvider>
    ),
  ],
  render: (args) => (
    <StorySurface width={280}>
      <ThemeSelector {...args} />
    </StorySurface>
  ),
  args: {
    compact: false,
  },
} satisfies Meta<typeof ThemeSelector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Compact: Story = {
  args: {
    compact: true,
  },
};

export const ThemeMatrix: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 16,
      }}
    >
      {themeIds.map((themeId) => (
        <HyperbetThemeProvider
          key={themeId}
          themeId={themeId}
          storageKey={`storybook-theme-selector-${themeId}`}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 12,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.65)",
              }}
            >
              {themeId}
            </p>
            <ThemeSelector {...args} theme={themeId} />
          </div>
        </HyperbetThemeProvider>
      ))}
    </div>
  ),
};
