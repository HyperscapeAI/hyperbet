import { PublicKey } from "@solana/web3.js";

import { CONFIG } from "./config";
import {
  FIGHT_ORACLE_PROGRAM_ADDRESS,
} from "../generated/fight-oracle/programs";
import {
  LVR_AMM_PROGRAM_ADDRESS,
} from "../generated/lvr-amm-market/programs";
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

export const lvrMarketProgramAddress = configuredAddress(
  CONFIG.lvrMarketProgramId,
  LVR_AMM_PROGRAM_ADDRESS,
);

export const goldPerpsMarketProgramAddress = configuredAddress(
  CONFIG.goldPerpsMarketProgramId,
  GOLD_PERPS_MARKET_PROGRAM_ADDRESS,
);

export const FIGHT_ORACLE_PROGRAM_ID = new PublicKey(
  fightOracleProgramAddress,
);

export const LVR_AMM_PROGRAM_ID = new PublicKey(
  lvrMarketProgramAddress,
);

export const GOLD_PERPS_MARKET_PROGRAM_ID = new PublicKey(
  goldPerpsMarketProgramAddress,
);
