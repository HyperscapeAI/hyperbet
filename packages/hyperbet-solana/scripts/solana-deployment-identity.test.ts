import { describe, expect, test } from "bun:test";
import { type AccountInfo, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  deriveProgramDataAddress,
} from "../keeper/src/solanaProgramIdentity";
import { evaluateSolanaProgramDeploymentIdentity } from "./solana-deployment-identity";

function key(byte: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, byte));
}

function account(
  data: Buffer,
  options: { executable?: boolean; owner?: PublicKey } = {},
): AccountInfo<Buffer> {
  return {
    data,
    executable: options.executable ?? false,
    lamports: 1,
    owner: options.owner ?? BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function programAccount(programId: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  deriveProgramDataAddress(programId).toBuffer().copy(data, 4);
  return account(data, { executable: true });
}

function programDataAccount(authority: PublicKey | null): AccountInfo<Buffer> {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(99n, 4);
  if (authority) {
    data.writeUInt8(1, 12);
    authority.toBuffer().copy(data, 13);
  }
  return account(data);
}

describe("Solana deployment identity gate", () => {
  test("allows a genuinely absent identity only before a fresh deployment", () => {
    const programId = key(1);
    expect(
      evaluateSolanaProgramDeploymentIdentity({
        label: "fight oracle",
        programId,
        programAccount: null,
        programDataAccount: null,
        expectedUpgradeAuthority: key(2),
        requireDeployed: false,
      }),
    ).toEqual({
      mode: "fresh-deploy",
      programId,
      programDataAddress: deriveProgramDataAddress(programId),
    });
  });

  test("rejects an absent identity after deployment and orphaned ProgramData", () => {
    const programId = key(3);
    const base = {
      label: "duel market",
      programId,
      programAccount: null,
      expectedUpgradeAuthority: key(4),
      requireDeployed: true,
    };
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        ...base,
        programDataAccount: null,
      }),
    ).toThrow("is absent after deployment");
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        ...base,
        requireDeployed: false,
        programDataAccount: programDataAccount(key(4)),
      }),
    ).toThrow("orphaned ProgramData");
  });

  test("rejects an immutable policy for a fresh deployment", () => {
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        label: "fight oracle",
        programId: key(5),
        programAccount: null,
        programDataAccount: null,
        expectedUpgradeAuthority: null,
        requireDeployed: false,
      }),
    ).toThrow("cannot be fresh-deployed as immutable");
  });

  test("accepts an existing canonical upgradeable program and records identity", () => {
    const programId = key(6);
    const authority = key(7);
    expect(
      evaluateSolanaProgramDeploymentIdentity({
        label: "fight oracle",
        programId,
        programAccount: programAccount(programId),
        programDataAccount: programDataAccount(authority),
        expectedUpgradeAuthority: authority,
        requireDeployed: true,
      }),
    ).toEqual({
      mode: "upgrade",
      programId,
      programDataAddress: deriveProgramDataAddress(programId),
      upgradeAuthority: authority,
      deployedSlot: 99n,
    });
  });

  test("rejects non-executable, wrong-loader, and authority-drift identities", () => {
    const programId = key(8);
    const authority = key(9);
    const base = {
      label: "duel market",
      programId,
      programDataAccount: programDataAccount(authority),
      expectedUpgradeAuthority: authority,
      requireDeployed: false,
    };
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        ...base,
        programAccount: account(programAccount(programId).data),
      }),
    ).toThrow("is not executable");
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        ...base,
        programAccount: account(programAccount(programId).data, {
          executable: true,
          owner: SystemProgram.programId,
        }),
      }),
    ).toThrow("not owned by the upgradeable loader");
    expect(() =>
      evaluateSolanaProgramDeploymentIdentity({
        ...base,
        programAccount: programAccount(programId),
        expectedUpgradeAuthority: key(10),
      }),
    ).toThrow("does not match");
  });
});
