import type { Meta, StoryObj } from "@storybook/react";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

const meta = {
  title: "Components/ErrorBoundary",
  component: ErrorBoundary,
  render: (args) => <ErrorBoundary {...args} />,
  args: {
    children: <div>Boundary is active</div>,
  },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
