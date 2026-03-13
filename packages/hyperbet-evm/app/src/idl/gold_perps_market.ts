/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gold_perps_market.json`.
 */
export type GoldPerpsMarket = {
  "address": "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik",
  "metadata": {
    "name": "goldPerpsMarket",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "Native-SOL isolated perpetual markets for model ranking derivatives.",
    "",
    "Each model gets its own MarketState PDA which holds:",
    "- oracle inputs (synthetic spot index, mu, sigma)",
    "- market risk configuration (skew scale, funding velocity)",
    "- isolated liquidity/insurance for that model only",
    "- long/short open interest and funding accumulator",
    "",
    "Positions are managed with signed size deltas through `modify_position`,",
    "which supports opening, increasing, reducing, flipping, depositing margin,",
    "withdrawing margin, and fully closing the account."
  ],
  "instructions": [
    {
      "name": "depositInsurance",
      "discriminator": [
        34,
        221,
        238,
        103,
        190,
        136,
        23,
        194
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "program",
          "address": "HbXhqEFevpkfYdZCN6YmJGRmQmj9vsBun2ZHjeeaLRik"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keeperAuthority",
          "type": "pubkey"
        },
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        },
        {
          "name": "marketMakerAuthority",
          "type": "pubkey"
        },
        {
          "name": "defaultSkewScale",
          "type": "u64"
        },
        {
          "name": "defaultFundingVelocity",
          "type": "u64"
        },
        {
          "name": "maxOracleStalenessSeconds",
          "type": "i64"
        },
        {
          "name": "minOracleSpotIndex",
          "type": "u64"
        },
        {
          "name": "maxOracleSpotIndex",
          "type": "u64"
        },
        {
          "name": "maxOraclePriceDeltaBps",
          "type": "u16"
        },
        {
          "name": "maxLeverage",
          "type": "u64"
        },
        {
          "name": "minMarginLamports",
          "type": "u64"
        },
        {
          "name": "maxMarketOpenInterest",
          "type": "u64"
        },
        {
          "name": "minMarketInsuranceLamports",
          "type": "u64"
        },
        {
          "name": "maintenanceMarginBps",
          "type": "u16"
        },
        {
          "name": "liquidationFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeTreasuryFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeMarketMakerFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "liquidatePosition",
      "discriminator": [
        187,
        74,
        229,
        149,
        102,
        81,
        221,
        68
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "liquidator",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "modifyPosition",
      "discriminator": [
        48,
        249,
        6,
        139,
        14,
        95,
        106,
        88
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "marginDelta",
          "type": "i64"
        },
        {
          "name": "sizeDelta",
          "type": "i64"
        },
        {
          "name": "acceptablePrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recycleMarketMakerFees",
      "discriminator": [
        223,
        161,
        208,
        139,
        228,
        66,
        247,
        207
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setMarketStatus",
      "discriminator": [
        101,
        175,
        83,
        107,
        200,
        141,
        155,
        182
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "nextStatus",
          "type": "u8"
        },
        {
          "name": "settlementSpotIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "keeperAuthority",
          "type": "pubkey"
        },
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        },
        {
          "name": "marketMakerAuthority",
          "type": "pubkey"
        },
        {
          "name": "defaultSkewScale",
          "type": "u64"
        },
        {
          "name": "defaultFundingVelocity",
          "type": "u64"
        },
        {
          "name": "maxOracleStalenessSeconds",
          "type": "i64"
        },
        {
          "name": "minOracleSpotIndex",
          "type": "u64"
        },
        {
          "name": "maxOracleSpotIndex",
          "type": "u64"
        },
        {
          "name": "maxOraclePriceDeltaBps",
          "type": "u16"
        },
        {
          "name": "maxLeverage",
          "type": "u64"
        },
        {
          "name": "minMarginLamports",
          "type": "u64"
        },
        {
          "name": "maxMarketOpenInterest",
          "type": "u64"
        },
        {
          "name": "minMarketInsuranceLamports",
          "type": "u64"
        },
        {
          "name": "maintenanceMarginBps",
          "type": "u16"
        },
        {
          "name": "liquidationFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeTreasuryFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeMarketMakerFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateMarketOracle",
      "discriminator": [
        195,
        200,
        114,
        92,
        227,
        5,
        15,
        119
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "spotIndex",
          "type": "u64"
        },
        {
          "name": "mu",
          "type": "u64"
        },
        {
          "name": "sigma",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawFeeBalance",
      "discriminator": [
        226,
        225,
        74,
        191,
        99,
        227,
        10,
        156
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "feeBucket",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "configState",
      "discriminator": [
        193,
        77,
        160,
        128,
        208,
        254,
        180,
        135
      ]
    },
    {
      "name": "marketState",
      "discriminator": [
        0,
        125,
        123,
        215,
        95,
        96,
        164,
        194
      ]
    },
    {
      "name": "positionState",
      "discriminator": [
        154,
        47,
        151,
        70,
        8,
        128,
        206,
        231
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidAuthority",
      "msg": "Operator is not authorized to manage perps markets"
    },
    {
      "code": 6001,
      "name": "unauthorizedInitializer",
      "msg": "Only the configured bootstrap authority can initialize the config"
    },
    {
      "code": 6002,
      "name": "invalidRiskConfig",
      "msg": "Risk configuration is invalid"
    },
    {
      "code": 6003,
      "name": "invalidMarket",
      "msg": "Market does not exist or does not match the requested id"
    },
    {
      "code": 6004,
      "name": "staleOracle",
      "msg": "Oracle price is stale and cannot be used for trading"
    },
    {
      "code": 6005,
      "name": "invalidSpotIndex",
      "msg": "Oracle spot index must be greater than zero"
    },
    {
      "code": 6006,
      "name": "oracleSpotIndexOutOfBounds",
      "msg": "Oracle spot index is outside the configured market bounds"
    },
    {
      "code": 6007,
      "name": "oraclePriceDeltaTooLarge",
      "msg": "Oracle price move exceeds the configured maximum step"
    },
    {
      "code": 6008,
      "name": "noopPositionUpdate",
      "msg": "Position update must change margin or size"
    },
    {
      "code": 6009,
      "name": "noOpenPosition",
      "msg": "No open position exists for this trader and market"
    },
    {
      "code": 6010,
      "name": "invalidPositionOwner",
      "msg": "Position owner does not match the provided signer"
    },
    {
      "code": 6011,
      "name": "invalidMargin",
      "msg": "Margin is invalid for the requested trade"
    },
    {
      "code": 6012,
      "name": "invalidLeverage",
      "msg": "Requested leverage exceeds the configured maximum"
    },
    {
      "code": 6013,
      "name": "openInterestLimitExceeded",
      "msg": "Projected market open interest exceeds the configured cap"
    },
    {
      "code": 6014,
      "name": "marketInsufficientInsurance",
      "msg": "Market does not have enough isolated insurance to grow open interest"
    },
    {
      "code": 6015,
      "name": "insufficientLiquidity",
      "msg": "Market account has insufficient liquidity to settle this payout"
    },
    {
      "code": 6016,
      "name": "notLiquidatable",
      "msg": "Position is not undercollateralized; cannot liquidate"
    },
    {
      "code": 6017,
      "name": "marketNotActive",
      "msg": "Market is not active for new oracle updates"
    },
    {
      "code": 6018,
      "name": "marketCloseOnly",
      "msg": "Market is close-only; only reductions and closes are allowed"
    },
    {
      "code": 6019,
      "name": "marketArchived",
      "msg": "Market is archived and cannot be traded"
    },
    {
      "code": 6020,
      "name": "invalidMarketStatus",
      "msg": "Market status transition is invalid"
    },
    {
      "code": 6021,
      "name": "marketHasOpenPositions",
      "msg": "Market still has open positions or open interest"
    },
    {
      "code": 6022,
      "name": "invalidInsuranceDeposit",
      "msg": "Insurance deposit amount must be greater than zero"
    },
    {
      "code": 6023,
      "name": "slippageExceeded",
      "msg": "Trade execution exceeded the caller's acceptable price"
    },
    {
      "code": 6024,
      "name": "invalidFeeWithdrawal",
      "msg": "Fee balance or fee withdrawal is invalid"
    },
    {
      "code": 6025,
      "name": "invalidFeeRecipient",
      "msg": "Fee recipient does not match the configured authority"
    },
    {
      "code": 6026,
      "name": "invalidFeeBucket",
      "msg": "Fee bucket is invalid"
    },
    {
      "code": 6027,
      "name": "invalidPositionState",
      "msg": "Position state is invalid"
    },
    {
      "code": 6028,
      "name": "overflow",
      "msg": "Numeric overflow in perps calculation"
    }
  ],
  "types": [
    {
      "name": "configState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "keeperAuthority",
            "type": "pubkey"
          },
          {
            "name": "treasuryAuthority",
            "type": "pubkey"
          },
          {
            "name": "marketMakerAuthority",
            "type": "pubkey"
          },
          {
            "name": "defaultSkewScale",
            "type": "u64"
          },
          {
            "name": "defaultFundingVelocity",
            "type": "u64"
          },
          {
            "name": "maxOracleStalenessSeconds",
            "type": "i64"
          },
          {
            "name": "minOracleSpotIndex",
            "type": "u64"
          },
          {
            "name": "maxOracleSpotIndex",
            "type": "u64"
          },
          {
            "name": "maxOraclePriceDeltaBps",
            "type": "u16"
          },
          {
            "name": "maxLeverage",
            "type": "u64"
          },
          {
            "name": "minMarginLamports",
            "type": "u64"
          },
          {
            "name": "maxMarketOpenInterest",
            "type": "u64"
          },
          {
            "name": "minMarketInsuranceLamports",
            "type": "u64"
          },
          {
            "name": "maintenanceMarginBps",
            "type": "u16"
          },
          {
            "name": "liquidationFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeTreasuryFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeMarketMakerFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "marketState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "type": "bool"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "insuranceFund",
            "type": "u64"
          },
          {
            "name": "treasuryFeeBalance",
            "type": "u64"
          },
          {
            "name": "marketMakerFeeBalance",
            "type": "u64"
          },
          {
            "name": "openPositions",
            "type": "u32"
          },
          {
            "name": "skewScale",
            "type": "u64"
          },
          {
            "name": "fundingVelocity",
            "type": "u64"
          },
          {
            "name": "spotIndex",
            "type": "u64"
          },
          {
            "name": "settlementSpotIndex",
            "type": "u64"
          },
          {
            "name": "mu",
            "type": "u64"
          },
          {
            "name": "sigma",
            "type": "u64"
          },
          {
            "name": "oracleLastUpdated",
            "type": "i64"
          },
          {
            "name": "lastFundingTime",
            "type": "i64"
          },
          {
            "name": "currentFundingRate",
            "type": "i64"
          },
          {
            "name": "totalLongOi",
            "type": "u64"
          },
          {
            "name": "totalShortOi",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "positionState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialized",
            "type": "bool"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "margin",
            "type": "u64"
          },
          {
            "name": "size",
            "type": "i64"
          },
          {
            "name": "entryPrice",
            "type": "u64"
          },
          {
            "name": "lastFundingRate",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
