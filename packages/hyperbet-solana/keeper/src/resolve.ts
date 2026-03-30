import BN from "bn.js";
import { type Program } from "@coral-xyz/anchor";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FightOracle } from "./idl/fight_oracle";

import {
  createPrograms,
  duelKeyHexToBytes,
  enumIs,
  findDuelStatePda,
  findOracleConfigPda,
  readKeypair,
  requireEnv,
} from "./common";
import { buildResultHash } from "./resultHash";

const args = await yargs(hideBin(process.argv))
  .option("duel-key", {
    type: "string",
    demandOption: true,
    describe: "Canonical 32-byte duel key hex string",
  })
  .option("winner", {
    type: "string",
    choices: ["a", "b"],
    demandOption: true,
    describe: "Authoritative winner side",
  })
  .option("seed", {
    type: "string",
    demandOption: true,
    describe: "Authoritative duel seed as an unsigned integer string",
  })
  .option("replay-hash", {
    type: "string",
    demandOption: true,
    describe: "Authoritative 32-byte replay hash hex string",
  })
  .option("metadata", {
    type: "string",
    default: "",
    describe: "Optional metadata uri/json payload",
  })
  .strict()
  .parse();

const oracleAuthority = readKeypair(requireEnv("ORACLE_AUTHORITY_KEYPAIR"));
const { fightOracle } = createPrograms(oracleAuthority);
const oracleProgram: Program<FightOracle> = fightOracle;
const oracleAccounts = oracleProgram.account as Record<
  string,
  { fetch: (pubkey: unknown) => Promise<Record<string, unknown>> }
>;

const duelKey = duelKeyHexToBytes(args["duel-key"]);
const duelPda = findDuelStatePda(fightOracle.programId, duelKey);
const oracleConfigPda = findOracleConfigPda(fightOracle.programId);

const duelState = await oracleAccounts["duelState"].fetch(duelPda);
const oracleConfig = await oracleAccounts["oracleConfig"].fetch(oracleConfigPda);
const nowTs = Math.floor(Date.now() / 1000);

let proposeResultSig: string | null = null;
let finalizeResultSig: string | null = null;

if (!enumIs(duelState.status, "resolved")) {
  if (enumIs(duelState.status, "challenged")) {
    throw new Error("Duel result is challenged; refusing to finalize");
  }
  if (nowTs < Number(duelState.betCloseTs)) {
    throw new Error("Bet window still open; refusing to resolve early");
  }

  const replayHashHex = args["replay-hash"].trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(replayHashHex)) {
    throw new Error("replay-hash must be a 32-byte hex string");
  }

  if (enumIs(duelState.status, "locked")) {
    const resultHash = buildResultHash(
      args["duel-key"],
      args.winner === "a" ? "A" : "B",
      args.seed,
      replayHashHex,
    );

    proposeResultSig = await oracleProgram.methods
      .proposeResult(
        Array.from(duelKey),
        args.winner === "a" ? { a: {} } : { b: {} },
        new BN(args.seed),
        Array.from(Buffer.from(replayHashHex, "hex")),
        resultHash,
        new BN(nowTs),
        args.metadata,
      )
      .accounts(
        {
          reporter: oracleAuthority.publicKey,
          oracleConfig: oracleConfigPda,
          duelState: duelPda,
        } as never,
      )
      .rpc();
  }

  const refreshedDuelState = await oracleAccounts["duelState"].fetch(duelPda);
  if (enumIs(refreshedDuelState.status, "challenged")) {
    throw new Error("Duel result is challenged; refusing to finalize");
  }

  if (enumIs(refreshedDuelState.status, "proposed")) {
    const finalizableAt =
      Number(refreshedDuelState.pendingProposedAt) +
      Number(oracleConfig.disputeWindowSecs);
    if (nowTs >= finalizableAt) {
      finalizeResultSig = await oracleProgram.methods
        .finalizeResult(Array.from(duelKey), args.metadata)
        .accounts(
          {
            finalizer: oracleAuthority.publicKey,
            oracleConfig: oracleConfigPda,
            duelState: duelPda,
          } as never,
        )
        .rpc();
    }
  }
}

console.log(
  JSON.stringify(
    {
      duel: duelPda.toBase58(),
      proposeResultSig,
      finalizeResultSig,
    },
    null,
    2,
  ),
);
