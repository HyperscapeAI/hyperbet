/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";

import BN from "bn.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  createPrograms,
  duelKeyHexToBytes,
  enumIs,
  findDuelStatePda,
  findOracleConfigPda,
  readKeypair,
  requireEnv,
} from "./common";

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
const oracleProgram: any = fightOracle;

const duelKey = duelKeyHexToBytes(args["duel-key"]);
const duelPda = findDuelStatePda(fightOracle.programId, duelKey);
const oracleConfigPda = findOracleConfigPda(fightOracle.programId);

const duelState = await oracleProgram.account.duelState.fetch(duelPda);
const nowTs = Math.floor(Date.now() / 1000);

let postResultSig: string | null = null;
if (!enumIs(duelState.status, "resolved")) {
  if (nowTs < Number(duelState.betCloseTs)) {
    throw new Error("Bet window still open; refusing to resolve early");
  }

  const replayHashHex = args["replay-hash"].trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(replayHashHex)) {
    throw new Error("replay-hash must be a 32-byte hex string");
  }

  const resultHash = Array.from(
    createHash("sha256")
      .update(
        JSON.stringify({
          duelKey: args["duel-key"].trim().toLowerCase(),
          winner: args.winner,
          seed: args.seed,
          replayHashHex,
        }),
      )
      .digest(),
  );

  postResultSig = await oracleProgram.methods
    .reportResult(
      Array.from(duelKey),
      args.winner === "a" ? ({ a: {} } as any) : ({ b: {} } as any),
      new BN(args.seed),
      Array.from(Buffer.from(replayHashHex, "hex")),
      resultHash,
      new BN(nowTs),
      args.metadata,
    )
    .accounts({
      reporter: oracleAuthority.publicKey,
      oracleConfig: oracleConfigPda,
      duelState: duelPda,
    })
    .rpc();
}

console.log(
  JSON.stringify(
    {
      duel: duelPda.toBase58(),
      postResultSig,
    },
    null,
    2,
  ),
);
