import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";

import {
  deriveProgramDataAddress,
  type ExpectedUpgradeAuthority,
  type VerifiedProgramIdentity,
  verifyUpgradeableProgramIdentity,
} from "../keeper/src/solanaProgramIdentity";

export type SolanaProgramDeploymentIdentity =
  | {
      mode: "fresh-deploy";
      programId: PublicKey;
      programDataAddress: PublicKey;
    }
  | ({ mode: "upgrade" } & VerifiedProgramIdentity);

export function evaluateSolanaProgramDeploymentIdentity(input: {
  label: string;
  programId: PublicKey;
  programAccount: AccountInfo<Buffer> | null;
  programDataAccount: AccountInfo<Buffer> | null;
  expectedUpgradeAuthority: ExpectedUpgradeAuthority;
  requireDeployed: boolean;
}): SolanaProgramDeploymentIdentity {
  const programDataAddress = deriveProgramDataAddress(input.programId);
  if (!input.programAccount) {
    if (input.programDataAccount) {
      throw new Error(
        `${input.label} has orphaned ProgramData at ${programDataAddress.toBase58()} without its program account`,
      );
    }
    if (input.requireDeployed) {
      throw new Error(
        `${input.label} program account ${input.programId.toBase58()} is absent after deployment`,
      );
    }
    if (input.expectedUpgradeAuthority === null) {
      throw new Error(
        `${input.label} cannot be fresh-deployed as immutable by the current deployment command`,
      );
    }
    return {
      mode: "fresh-deploy",
      programId: input.programId,
      programDataAddress,
    };
  }

  return {
    mode: "upgrade",
    ...verifyUpgradeableProgramIdentity(input),
  };
}

export async function fetchSolanaProgramDeploymentIdentity(input: {
  connection: Connection;
  label: string;
  programId: PublicKey;
  expectedUpgradeAuthority: ExpectedUpgradeAuthority;
  requireDeployed: boolean;
}): Promise<SolanaProgramDeploymentIdentity> {
  const programDataAddress = deriveProgramDataAddress(input.programId);
  const [programAccount, programDataAccount] =
    await input.connection.getMultipleAccountsInfo(
      [input.programId, programDataAddress],
      "finalized",
    );
  return evaluateSolanaProgramDeploymentIdentity({
    ...input,
    programAccount,
    programDataAccount,
  });
}
