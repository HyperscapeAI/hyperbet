import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import {
  resolveKeeperRoleRefs,
  validateKeeperRoleSeparation,
  type KeeperRolePublicKeys,
} from "./keeperRoles";

function distinctRoles(): KeeperRolePublicKeys {
  return {
    feePayer: Keypair.generate().publicKey,
    oracleReporter: Keypair.generate().publicKey,
    oracleFinalizer: Keypair.generate().publicKey,
    oracleChallenger: Keypair.generate().publicKey,
    clobMarketOperator: Keypair.generate().publicKey,
    marketMaker: Keypair.generate().publicKey,
    oracleConfigAuthority: Keypair.generate().publicKey,
    clobConfigAuthority: Keypair.generate().publicKey,
  };
}

describe("keeper role policy", () => {
  test("requires every automated role and the public challenger wallet", () => {
    expect(() => resolveKeeperRoleRefs({})).toThrow("KEEPER_FEE_PAYER_KEYPAIR");
    expect(() =>
      resolveKeeperRoleRefs({
        KEEPER_FEE_PAYER_KEYPAIR: "fee-payer.json",
        ORACLE_REPORTER_KEYPAIR: "reporter.json",
        ORACLE_FINALIZER_KEYPAIR: "finalizer.json",
        CLOB_MARKET_OPERATOR_KEYPAIR: "operator.json",
        MARKET_MAKER_KEYPAIR: "maker.json",
      }),
    ).toThrow("ORACLE_CHALLENGER_WALLET");
  });

  test("does not accept the removed broad authority variable as a fallback", () => {
    expect(() =>
      resolveKeeperRoleRefs({ ORACLE_AUTHORITY_KEYPAIR: "legacy.json" }),
    ).toThrow("KEEPER_FEE_PAYER_KEYPAIR");
  });

  test("accepts distinct mainnet runtime, challenger, and config roles", () => {
    expect(() =>
      validateKeeperRoleSeparation("mainnet-beta", distinctRoles()),
    ).not.toThrow();
  });

  test("rejects shared mainnet automated wallets", () => {
    const roles = distinctRoles();
    roles.oracleReporter = roles.feePayer;
    expect(() => validateKeeperRoleSeparation("mainnet", roles)).toThrow(
      "fee payer and oracle reporter",
    );
  });

  test("rejects a mainnet challenger controlled by the keeper", () => {
    const roles = distinctRoles();
    roles.oracleChallenger = roles.oracleFinalizer;
    expect(() => validateKeeperRoleSeparation("mainnet-beta", roles)).toThrow(
      "challenger must be independent",
    );
  });

  test("rejects hot runtime reuse of an optional mainnet config authority", () => {
    const roles = distinctRoles();
    roles.oracleConfigAuthority = roles.marketMaker;
    expect(() => validateKeeperRoleSeparation("mainnet-beta", roles)).toThrow(
      "oracle config authority must be independent",
    );
  });

  test("allows shared roles for local smoke environments", () => {
    const key = Keypair.generate().publicKey;
    expect(() =>
      validateKeeperRoleSeparation("localnet", {
        feePayer: key,
        oracleReporter: key,
        oracleFinalizer: key,
        oracleChallenger: key,
        clobMarketOperator: key,
        marketMaker: key,
        oracleConfigAuthority: key,
        clobConfigAuthority: key,
      }),
    ).not.toThrow();
  });
});
