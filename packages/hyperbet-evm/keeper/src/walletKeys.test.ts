import { describe, expect, test } from "bun:test";

import {
  isLegacyDerivedPointsWalletKey,
  normalizePointsWalletInput,
} from "./walletKeys";

describe("wallet key helpers", () => {
  test("detects legacy derived points wallet keys", () => {
    expect(
      isLegacyDerivedPointsWalletKey(
        "rank/DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ",
      ),
    ).toBe(true);
    expect(
      isLegacyDerivedPointsWalletKey(
        "multiplier/0x49620FE71DFC9ccACF37D89fA5f4bd0Cd83dEafB",
      ),
    ).toBe(true);
    expect(
      isLegacyDerivedPointsWalletKey(
        "DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ",
      ),
    ).toBe(false);
  });

  test("normalizes legacy leaderboard wallet inputs back to the base wallet", () => {
    expect(
      normalizePointsWalletInput(
        "rank/DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ",
      ),
    ).toBe("DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ");
    expect(
      normalizePointsWalletInput(
        "multiplier/0x49620FE71DFC9ccACF37D89fA5f4bd0Cd83dEafB",
      ),
    ).toBe("0x49620FE71DFC9ccACF37D89fA5f4bd0Cd83dEafB");
  });

  test("strips repeated legacy prefixes until only the wallet remains", () => {
    expect(
      normalizePointsWalletInput(
        "rank/multiplier/rank/0x49620FE71DFC9ccACF37D89fA5f4bd0Cd83dEafB",
      ),
    ).toBe("0x49620FE71DFC9ccACF37D89fA5f4bd0Cd83dEafB");
  });
});
