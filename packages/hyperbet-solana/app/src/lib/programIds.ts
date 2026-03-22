import { PublicKey } from "@solana/web3.js";

import { CONFIG } from "./config";
import {
  FIGHT_ORACLE_PROGRAM_ADDRESS,
} from "../generated/fight-oracle/programs";
import {
  GOLD_CLOB_MARKET_PROGRAM_ADDRESS,
} from "../generated/gold-clob-market/programs";
import {
  GOLD_PERPS_MARKET_PROGRAM_ADDRESS,
} from "../generated/gold-perps-market/programs";

function configuredAddress(configured: string, fallback: string): string {
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export const fightOracleProgramAddress = configuredAddress(
  CONFIG.fightOracleProgramId,
  FIGHT_ORACLE_PROGRAM_ADDRESS,
);

export const goldClobMarketProgramAddress = configuredAddress(
  CONFIG.goldClobMarketProgramId,
  GOLD_CLOB_MARKET_PROGRAM_ADDRESS,
);

export const goldPerpsMarketProgramAddress = configuredAddress(
  CONFIG.goldPerpsMarketProgramId,
  GOLD_PERPS_MARKET_PROGRAM_ADDRESS,
);

export const FIGHT_ORACLE_PROGRAM_ID = new PublicKey(
  fightOracleProgramAddress,
);

export const GOLD_CLOB_MARKET_PROGRAM_ID = new PublicKey(
  goldClobMarketProgramAddress,
);

export const GOLD_PERPS_MARKET_PROGRAM_ID = new PublicKey(
  goldPerpsMarketProgramAddress,
);

export const goldAmmMarketProgramAddress = configuredAddress(
  CONFIG.goldAmmMarketProgramId,
  "Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5",
);

export const GOLD_AMM_MARKET_PROGRAM_ID = new PublicKey(
  goldAmmMarketProgramAddress,
);
