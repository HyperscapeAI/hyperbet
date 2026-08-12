import { PublicKey } from "@solana/web3.js";

import { CONFIG } from "./config";
import { FIGHT_ORACLE_PROGRAM_ADDRESS } from "../generated/fight-oracle/programs";

function configuredAddress(configured: string, fallback: string): string {
  const trimmed = configured.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export const fightOracleProgramAddress = configuredAddress(
  CONFIG.fightOracleProgramId,
  FIGHT_ORACLE_PROGRAM_ADDRESS,
);

export const FIGHT_ORACLE_PROGRAM_ID = new PublicKey(fightOracleProgramAddress);
