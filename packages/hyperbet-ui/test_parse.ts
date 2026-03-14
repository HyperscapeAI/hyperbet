import { Program, Idl } from "@coral-xyz/anchor";
import lvrMarketIdl from "./src/idl/lvr_amm.json";

console.log("Keys in IDL accounts:", (lvrMarketIdl as any).accounts?.map((a: any) => a.name));
try {
  const p = new Program(lvrMarketIdl as Idl, { connection: {} as any } as any);
  console.log("Keys in account namespace:", Object.keys(p.account));
} catch(e: any) {
  console.log("Failed to construct Program:", e.message);
}
