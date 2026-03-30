import type { Meta, StoryObj } from "@storybook/react";
import { HmChart } from "../src/components/HmChart";
import type { HyperbetThemeId } from "../src/lib/theme";
import { StorySurface, sampleChartData } from "./storySupport";

const themeIds: HyperbetThemeId[] = ["evm", "avax", "bsc", "base", "solana"];

const meta = {
  title: "Components/HmChart",
  component: HmChart,
  render: (args) => (
    <StorySurface width={960}>
      <div style={{ height: 280 }}>
        <HmChart {...args} />
      </div>
    </StorySurface>
  ),
  args: {
    data: sampleChartData,
  },
} satisfies Meta<typeof HmChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrix: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 16,
      }}
    >
      {themeIds.map((themeId) => (
        <section key={themeId}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {themeId}
          </p>
          <div style={{ height: 220 }}>
            <HmChart {...args} theme={themeId} />
          </div>
        </section>
      ))}
    </div>
  ),
};
