/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gold_clob_market.json`.
 */
export type GoldClobMarket = {
  "address": "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi",
  "metadata": {
    "name": "goldClobMarket",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "marketState",
          "writable": true
        },
        {
          "name": "duelState"
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "priceLevel",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              }
            ]
          }
        },
        {
          "name": "user",
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
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "price",
          "type": "u16"
        }
      ]
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "marketState",
          "writable": true
        },
        {
          "name": "duelState"
        },
        {
          "name": "userBalance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
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
          "name": "marketMaker",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
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
          "name": "authority",
          "writable": true,
          "signer": true
        },
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
          "name": "program",
          "address": "ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi"
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
          "name": "marketOperator",
          "type": "pubkey"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "marketMaker",
          "type": "pubkey"
        },
        {
          "name": "tradeTreasuryFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeMarketMakerFeeBps",
          "type": "u16"
        },
        {
          "name": "winningsMarketMakerFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeMarket",
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
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
          "name": "duelState"
        },
        {
          "name": "marketState",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "duelKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "marketKind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "marketState",
          "writable": true
        },
        {
          "name": "duelState"
        },
        {
          "name": "userBalance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "newOrder",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "restingLevel",
          "writable": true
        },
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
          "name": "treasury",
          "writable": true
        },
        {
          "name": "marketMaker",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "marketState"
              }
            ]
          }
        },
        {
          "name": "user",
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
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "price",
          "type": "u16"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "syncMarketFromDuel",
      "discriminator": [
        235,
        180,
        137,
        53,
        242,
        12,
        85,
        213
      ],
      "accounts": [
        {
          "name": "marketState",
          "writable": true
        },
        {
          "name": "duelState"
        }
      ],
      "args": []
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
          "name": "authority",
          "signer": true
        },
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
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "marketOperator",
          "type": "pubkey"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "marketMaker",
          "type": "pubkey"
        },
        {
          "name": "tradeTreasuryFeeBps",
          "type": "u16"
        },
        {
          "name": "tradeMarketMakerFeeBps",
          "type": "u16"
        },
        {
          "name": "winningsMarketMakerFeeBps",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "duelState",
      "discriminator": [
        149,
        213,
        59,
        165,
        124,
        116,
        145,
        120
      ]
    },
    {
      "name": "marketConfig",
      "discriminator": [
        119,
        255,
        200,
        88,
        252,
        82,
        128,
        24
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
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    },
    {
      "name": "priceLevel",
      "discriminator": [
        236,
        106,
        90,
        162,
        188,
        41,
        219,
        186
      ]
    },
    {
      "name": "userBalance",
      "discriminator": [
        187,
        237,
        208,
        146,
        86,
        132,
        29,
        191
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedInitializer",
      "msg": "Only the upgrade authority can initialize config"
    },
    {
      "code": 6001,
      "name": "unauthorizedConfigAuthority",
      "msg": "Config authority is required for this action"
    },
    {
      "code": 6002,
      "name": "unauthorizedMarketOperator",
      "msg": "Market operator is not authorized"
    },
    {
      "code": 6003,
      "name": "invalidOperator",
      "msg": "Market operator pubkey is invalid"
    },
    {
      "code": 6004,
      "name": "invalidAuthority",
      "msg": "Authority pubkey is invalid"
    },
    {
      "code": 6005,
      "name": "invalidFeeAccount",
      "msg": "The provided fee account is invalid"
    },
    {
      "code": 6006,
      "name": "feeTooHigh",
      "msg": "Fee configuration exceeds 100%"
    },
    {
      "code": 6007,
      "name": "invalidMarketKind",
      "msg": "Only duel-winner markets are currently supported"
    },
    {
      "code": 6008,
      "name": "duelMismatch",
      "msg": "The duel account does not match the market"
    },
    {
      "code": 6009,
      "name": "marketCreationClosed",
      "msg": "Markets can only be created while betting is open or locked"
    },
    {
      "code": 6010,
      "name": "marketNotOpen",
      "msg": "Market is not open for new orders"
    },
    {
      "code": 6011,
      "name": "marketNotResolved",
      "msg": "Market is not resolved"
    },
    {
      "code": 6012,
      "name": "marketAlreadyResolved",
      "msg": "Market is already resolved or cancelled"
    },
    {
      "code": 6013,
      "name": "bettingClosed",
      "msg": "Betting is closed"
    },
    {
      "code": 6014,
      "name": "invalidSide",
      "msg": "Side must be bid (1) or ask (2)"
    },
    {
      "code": 6015,
      "name": "invalidPrice",
      "msg": "Price must be between 1 and 999"
    },
    {
      "code": 6016,
      "name": "invalidAmount",
      "msg": "Order amount must be greater than zero"
    },
    {
      "code": 6017,
      "name": "invalidOrderId",
      "msg": "Order id does not match the next expected id"
    },
    {
      "code": 6018,
      "name": "precisionError",
      "msg": "The precision implied by amount and price is invalid"
    },
    {
      "code": 6019,
      "name": "costTooLow",
      "msg": "Order cost is too low"
    },
    {
      "code": 6020,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6021,
      "name": "priceLevelMismatch",
      "msg": "The supplied price level does not match the order"
    },
    {
      "code": 6022,
      "name": "orderSideMismatch",
      "msg": "The supplied order side does not match the stored order"
    },
    {
      "code": 6023,
      "name": "orderPriceMismatch",
      "msg": "The supplied order price does not match the stored order"
    },
    {
      "code": 6024,
      "name": "notOrderMaker",
      "msg": "Only the order maker can cancel this order"
    },
    {
      "code": 6025,
      "name": "missingMatchAccounts",
      "msg": "Required maker match accounts were not supplied"
    },
    {
      "code": 6026,
      "name": "missingTailOrder",
      "msg": "Required resting tail order account was not supplied"
    },
    {
      "code": 6027,
      "name": "missingLinkedOrderAccount",
      "msg": "A linked prev/next order account is missing"
    },
    {
      "code": 6028,
      "name": "invalidRemainingAccount",
      "msg": "Remaining account verification failed"
    },
    {
      "code": 6029,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    }
  ],
  "types": [
    {
      "name": "duelState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "duelKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "participantAHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "participantBHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "duelStatus"
              }
            }
          },
          {
            "name": "winner",
            "type": {
              "defined": {
                "name": "marketSide"
              }
            }
          },
          {
            "name": "betOpenTs",
            "type": "i64"
          },
          {
            "name": "betCloseTs",
            "type": "i64"
          },
          {
            "name": "duelStartTs",
            "type": "i64"
          },
          {
            "name": "duelEndTs",
            "type": "i64"
          },
          {
            "name": "seed",
            "type": "u64"
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "replayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "metadataUri",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "duelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "scheduled"
          },
          {
            "name": "bettingOpen"
          },
          {
            "name": "locked"
          },
          {
            "name": "resolved"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "marketConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "marketOperator",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "marketMaker",
            "type": "pubkey"
          },
          {
            "name": "tradeTreasuryFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeMarketMakerFeeBps",
            "type": "u16"
          },
          {
            "name": "winningsMarketMakerFeeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "a"
          },
          {
            "name": "b"
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
            "name": "duelState",
            "type": "pubkey"
          },
          {
            "name": "duelKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "marketKind",
            "type": "u8"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "winner",
            "type": {
              "defined": {
                "name": "marketSide"
              }
            }
          },
          {
            "name": "nextOrderId",
            "type": "u64"
          },
          {
            "name": "bestBid",
            "type": "u16"
          },
          {
            "name": "bestAsk",
            "type": "u16"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "bidBitmap",
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "askBitmap",
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "locked"
          },
          {
            "name": "resolved"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketState",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u16"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "filled",
            "type": "u64"
          },
          {
            "name": "prevOrderId",
            "type": "u64"
          },
          {
            "name": "nextOrderId",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "priceLevel",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketState",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u16"
          },
          {
            "name": "headOrderId",
            "type": "u64"
          },
          {
            "name": "tailOrderId",
            "type": "u64"
          },
          {
            "name": "totalOpen",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userBalance",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "marketState",
            "type": "pubkey"
          },
          {
            "name": "aShares",
            "type": "u64"
          },
          {
            "name": "bShares",
            "type": "u64"
          },
          {
            "name": "aStake",
            "type": "u64"
          },
          {
            "name": "bStake",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
