import React from "react";
import { PublicKey } from "@solana/web3.js";

export const STORY_TIME = Date.now();

export function StorySurface({
  children,
  width = 1120,
}: {
  children: React.ReactNode;
  width?: number | string;
}) {
  return (
    <div
      style={{
        width,
        maxWidth: "100%",
        margin: "0 auto",
      }}
    >
      {children}
    </div>
  );
}

export const sampleChartData = [
  { time: STORY_TIME - 25 * 60_000, pct: 47 },
  { time: STORY_TIME - 20 * 60_000, pct: 49 },
  { time: STORY_TIME - 15 * 60_000, pct: 52 },
  { time: STORY_TIME - 10 * 60_000, pct: 55 },
  { time: STORY_TIME - 5 * 60_000, pct: 58 },
  { time: STORY_TIME, pct: 56 },
];

export const sampleBids = [
  { price: 0.482, amount: 4.8, total: 4.8 },
  { price: 0.476, amount: 3.4, total: 8.2 },
  { price: 0.469, amount: 2.7, total: 10.9 },
];

export const sampleAsks = [
  { price: 0.518, amount: 3.1, total: 3.1 },
  { price: 0.524, amount: 2.4, total: 5.5 },
  { price: 0.531, amount: 1.8, total: 7.3 },
];

export const sampleTrades = [
  {
    id: "trade-1",
    side: "YES" as const,
    amount: 3.25,
    price: 0.49,
    time: STORY_TIME - 28_000,
    trader: "9YQ6U3b1i3Qxb38nSxrdbidKdvUSsfx8bVsgcuyo6edS",
  },
  {
    id: "trade-2",
    side: "NO" as const,
    amount: 1.1,
    price: 0.51,
    time: STORY_TIME - 62_000,
    trader: "6F6ePKprCddjcLm9uAwXpi4eCV7H7fLS1c1zFqaHkJn4",
  },
  {
    id: "trade-3",
    side: "YES" as const,
    amount: 0.68,
    price: 0.56,
    time: STORY_TIME - 94_000,
    trader: "8YDEsxBTFGKgWdGZRE7BMb6yJ5rXKc12QE8RrJGEJJJr",
  },
];

export const sampleAgent = {
  id: "YES",
  name: "StormWarden",
  provider: "OpenAI",
  model: "gpt-5",
  hp: 82,
  maxHp: 100,
  combatLevel: 94,
  wins: 42,
  losses: 12,
  damageDealtThisFight: 311,
  inventory: [
    { slot: 0, itemId: "storm-blade", quantity: 1 },
    { slot: 1, itemId: "focus-rune", quantity: 2 },
    { slot: 5, itemId: "hp-vial", quantity: 3 },
  ],
  monologues: [
    {
      id: "mono-1",
      type: "thought",
      content: "Targeting weak left flank.",
      timestamp: STORY_TIME - 30_000,
    },
    {
      id: "mono-2",
      type: "action",
      content: "Deploying charge sequence.",
      timestamp: STORY_TIME - 10_000,
    },
  ],
};

export const sampleFightAgent1 = {
  ...sampleAgent,
  equipment: {
    weapon: "storm-blade",
    shield: "arc-shield",
    helm: "oracle-visor",
  },
  rank: 1,
  headToHeadWins: 3,
  headToHeadLosses: 1,
};

export const sampleFightAgent2 = {
  ...sampleAgent,
  id: "NO",
  name: "JadePhoenix",
  provider: "Anthropic",
  model: "claude-sonnet",
  hp: 67,
  combatLevel: 89,
  wins: 38,
  losses: 15,
  damageDealtThisFight: 287,
  equipment: {
    weapon: "jade-spear",
    boots: "phoenix-steps",
  },
  rank: 2,
  headToHeadWins: 1,
  headToHeadLosses: 3,
};

export const sampleSolanaWallet = new PublicKey(
  "9YQ6U3b1i3Qxb38nSxrdbidKdvUSsfx8bVsgcuyo6edS",
).toBase58();
