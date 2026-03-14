import { PublicKey } from "@solana/web3.js";

const ORACLE_PROGRAM_ID = new PublicKey(
  "6QWeT6FpJrm8AF1btu6WH2k2Xhq6t5vbheKVfQavmeoZ",
);
const CLOB_PROGRAM_ID = new PublicKey(
  "8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKh",
);
const MARKET_STATE = new PublicKey(
  "C9YqoB8G4mQDKg4VPtWwfvX2gYdExgkt1PyfuzMdudH8",
);
const STORY_WALLET = new PublicKey(
  "9YQ6U3b1i3Qxb38nSxrdbidKdvUSsfx8bVsgcuyo6edS",
);

function createProgramFacade() {
  const marketConfig = {
    config: {},
  };
  const marketState = {
    status: { open: {} },
    winner: { none: {} },
    nextOrderId: 42n,
    bestBid: 482,
    bestAsk: 518,
  };

  return {
    programId: CLOB_PROGRAM_ID,
    account: {
      marketConfig: {
        fetchNullable: async () => marketConfig,
        fetch: async () => marketConfig,
      },
      marketState: {
        fetchNullable: async () => marketState,
        fetch: async () => marketState,
      },
      duelState: {
        fetchNullable: async () => ({ active: true }),
      },
      priceLevel: {
        fetchNullable: async () => null,
        all: async () => [
          {
            publicKey: MARKET_STATE,
            account: {
              side: 1,
              price: 482,
              headOrderId: 11n,
              tailOrderId: 11n,
              totalOpen: 3_400_000_000n,
              marketState: MARKET_STATE,
            },
          },
          {
            publicKey: MARKET_STATE,
            account: {
              side: 2,
              price: 518,
              headOrderId: 12n,
              tailOrderId: 12n,
              totalOpen: 2_100_000_000n,
              marketState: MARKET_STATE,
            },
          },
        ],
      },
      order: {
        fetch: async () => ({
          id: 11n,
          side: 1,
          price: 482,
          maker: STORY_WALLET,
          amount: 2_000_000_000n,
          filled: 0n,
          prevOrderId: 0n,
          nextOrderId: 0n,
          active: true,
          marketState: MARKET_STATE,
        }),
        all: async () => [
          {
            publicKey: MARKET_STATE,
            account: {
              id: 11n,
              side: 1,
              price: 482,
              maker: STORY_WALLET,
              amount: 2_000_000_000n,
              filled: 0n,
              prevOrderId: 0n,
              nextOrderId: 0n,
              active: true,
              marketState: MARKET_STATE,
            },
          },
        ],
      },
      userBalance: {
        all: async () => [
          {
            publicKey: MARKET_STATE,
            account: {
              user: STORY_WALLET,
              marketState: MARKET_STATE,
              aShares: 7_400_000_000n,
              bShares: 4_200_000_000n,
            },
          },
          {
            publicKey: MARKET_STATE,
            account: {
              user: new PublicKey(
                "Fhtx3Vck7M3N86D2PfYZ7R6puj949iFDUFxuDrPq3NbS",
              ),
              marketState: MARKET_STATE,
              aShares: 5_100_000_000n,
              bShares: 6_800_000_000n,
            },
          },
        ],
      },
    },
  };
}

export function createReadonlyPrograms() {
  return {
    lvrMarket: createProgramFacade(),
    fightOracle: {
      programId: ORACLE_PROGRAM_ID,
      account: {
        duelState: {
          fetchNullable: async () => ({ active: true }),
        },
      },
    },
  };
}

export function createPrograms() {
  return createReadonlyPrograms();
}
