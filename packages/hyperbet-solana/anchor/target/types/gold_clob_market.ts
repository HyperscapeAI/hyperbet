/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/gold_clob_market.json`.
 */
export type GoldClobMarket = {
  "address": "DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf",
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
      "name": "continueOrder",
      "discriminator": [
        52,
        137,
        158,
        152,
        162,
        246,
        203,
        104
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
        }
      ]
    },
    {
      "name": "freezeConfig",
      "docs": [
        "One-way config freeze — after calling, update_config reverts permanently.",
        "Pause controls remain functional."
      ],
      "discriminator": [
        30,
        68,
        20,
        154,
        197,
        42,
        47,
        122
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
          "address": "DYtd7AoyTX2tbmZ8vpC3mxZgqTpyaDei4TFXZukWBJEf"
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
        },
        {
          "name": "orderBehavior",
          "type": "u8"
        }
      ]
    },
    {
      "name": "reclaimRestingOrder",
      "discriminator": [
        6,
        69,
        10,
        23,
        16,
        193,
        161,
        163
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
      "name": "setMarketPaused",
      "docs": [
        "Emergency pause/unpause for market creation and order placement.",
        "Remains functional even after config freeze."
      ],
      "discriminator": [
        233,
        31,
        161,
        248,
        178,
        111,
        102,
        65
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
          "name": "orderPlacementPaused",
          "type": "bool"
        },
        {
          "name": "marketCreationPaused",
          "type": "bool"
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
  "events": [
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketSynced",
      "discriminator": [
        12,
        197,
        233,
        97,
        244,
        67,
        27,
        33
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderMatched",
      "discriminator": [
        211,
        0,
        178,
        174,
        61,
        245,
        45,
        250
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "restingOrderReclaimed",
      "discriminator": [
        119,
        79,
        122,
        108,
        115,
        169,
        15,
        78
      ]
    },
    {
      "name": "selfTradePolicyTriggered",
      "discriminator": [
        83,
        88,
        117,
        16,
        191,
        232,
        1,
        86
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
      "name": "configAuthorityImmutable",
      "msg": "Config authority is immutable"
    },
    {
      "code": 6003,
      "name": "unauthorizedMarketOperator",
      "msg": "Market operator is not authorized"
    },
    {
      "code": 6004,
      "name": "invalidOperator",
      "msg": "Market operator pubkey is invalid"
    },
    {
      "code": 6005,
      "name": "invalidAuthority",
      "msg": "Authority pubkey is invalid"
    },
    {
      "code": 6006,
      "name": "invalidFeeAccount",
      "msg": "The provided fee account is invalid"
    },
    {
      "code": 6007,
      "name": "feeTooHigh",
      "msg": "Fee configuration exceeds 100%"
    },
    {
      "code": 6008,
      "name": "invalidMarketKind",
      "msg": "Only duel-winner markets are currently supported"
    },
    {
      "code": 6009,
      "name": "duelMismatch",
      "msg": "The duel account does not match the market"
    },
    {
      "code": 6010,
      "name": "marketCreationClosed",
      "msg": "Markets can only be created while betting is open or locked"
    },
    {
      "code": 6011,
      "name": "marketNotOpen",
      "msg": "Market is not open for new orders"
    },
    {
      "code": 6012,
      "name": "marketNotResolved",
      "msg": "Market is not resolved"
    },
    {
      "code": 6013,
      "name": "marketAlreadyResolved",
      "msg": "Market is already resolved or cancelled"
    },
    {
      "code": 6014,
      "name": "bettingClosed",
      "msg": "Betting is closed"
    },
    {
      "code": 6015,
      "name": "invalidSide",
      "msg": "Side must be bid (1) or ask (2)"
    },
    {
      "code": 6016,
      "name": "invalidOrderBehavior",
      "msg": "Order behavior must be GTC (0), IOC (1), or POST_ONLY (2)"
    },
    {
      "code": 6017,
      "name": "invalidPrice",
      "msg": "Price must be between 1 and 999"
    },
    {
      "code": 6018,
      "name": "invalidAmount",
      "msg": "Order amount must be greater than zero"
    },
    {
      "code": 6019,
      "name": "invalidOrderId",
      "msg": "Order id does not match the next expected id"
    },
    {
      "code": 6020,
      "name": "postOnlyWouldCross",
      "msg": "Post-only orders cannot cross the book"
    },
    {
      "code": 6021,
      "name": "precisionError",
      "msg": "The precision implied by amount and price is invalid"
    },
    {
      "code": 6022,
      "name": "costTooLow",
      "msg": "Order cost is too low"
    },
    {
      "code": 6023,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6024,
      "name": "priceLevelMismatch",
      "msg": "The supplied price level does not match the order"
    },
    {
      "code": 6025,
      "name": "orderSideMismatch",
      "msg": "The supplied order side does not match the stored order"
    },
    {
      "code": 6026,
      "name": "orderPriceMismatch",
      "msg": "The supplied order price does not match the stored order"
    },
    {
      "code": 6027,
      "name": "notOrderMaker",
      "msg": "Only the order maker can cancel this order"
    },
    {
      "code": 6028,
      "name": "missingMatchAccounts",
      "msg": "Required maker match accounts were not supplied"
    },
    {
      "code": 6029,
      "name": "missingTailOrder",
      "msg": "Required resting tail order account was not supplied"
    },
    {
      "code": 6030,
      "name": "missingLinkedOrderAccount",
      "msg": "A linked prev/next order account is missing"
    },
    {
      "code": 6031,
      "name": "invalidRemainingAccount",
      "msg": "Remaining account verification failed"
    },
    {
      "code": 6032,
      "name": "orderNotContinuable",
      "msg": "Order does not require continuation"
    },
    {
      "code": 6033,
      "name": "nothingToContinue",
      "msg": "No order remainder is left to continue"
    },
    {
      "code": 6034,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6035,
      "name": "alreadyInitialized",
      "msg": "Config is already initialized"
    },
    {
      "code": 6036,
      "name": "orderPlacementPaused",
      "msg": "Order placement is paused"
    },
    {
      "code": 6037,
      "name": "marketCreationPaused",
      "msg": "Market creation is paused"
    },
    {
      "code": 6038,
      "name": "configFrozen",
      "msg": "Config is permanently frozen"
    },
    {
      "code": 6039,
      "name": "marketStillOpen",
      "msg": "Market is still open"
    },
    {
      "code": 6040,
      "name": "nothingToReclaim",
      "msg": "Nothing to reclaim"
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
            "name": "activeProposal",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pendingWinner",
            "type": {
              "defined": {
                "name": "marketSide"
              }
            }
          },
          {
            "name": "pendingSeed",
            "type": "u64"
          },
          {
            "name": "pendingResultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pendingReplayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pendingDuelEndTs",
            "type": "i64"
          },
          {
            "name": "pendingProposedAt",
            "type": "i64"
          },
          {
            "name": "pendingChallenged",
            "type": "bool"
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
            "name": "proposed"
          },
          {
            "name": "challenged"
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
            "name": "orderPlacementPaused",
            "type": "bool"
          },
          {
            "name": "marketCreationPaused",
            "type": "bool"
          },
          {
            "name": "configFrozen",
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
      "name": "marketCreated",
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
            "name": "marketKey",
            "type": "pubkey"
          },
          {
            "name": "marketKind",
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
            "name": "tradeTreasuryFeeBpsSnapshot",
            "type": "u16"
          },
          {
            "name": "tradeMarketMakerFeeBpsSnapshot",
            "type": "u16"
          },
          {
            "name": "winningsMarketMakerFeeBpsSnapshot",
            "type": "u16"
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
            "name": "marketMaker",
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
      "name": "marketSynced",
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
            "name": "marketKey",
            "type": "pubkey"
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
            "name": "orderBehavior",
            "type": "u8"
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
            "name": "continuationPending",
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
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketKey",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderMatched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketKey",
            "type": "pubkey"
          },
          {
            "name": "makerOrderId",
            "type": "u64"
          },
          {
            "name": "takerOrderId",
            "type": "u64"
          },
          {
            "name": "matchedAmount",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketKey",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "maker",
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
            "name": "amount",
            "type": "u64"
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
      "name": "restingOrderReclaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketKey",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "selfTradePolicyTriggered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketRef",
            "type": "pubkey"
          },
          {
            "name": "makerAuthority",
            "type": "pubkey"
          },
          {
            "name": "takerAuthority",
            "type": "pubkey"
          },
          {
            "name": "makerOrderId",
            "type": "u64"
          },
          {
            "name": "takerOrderId",
            "type": "u64"
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
            "name": "aLockedLamports",
            "type": "u64"
          },
          {
            "name": "bLockedLamports",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
