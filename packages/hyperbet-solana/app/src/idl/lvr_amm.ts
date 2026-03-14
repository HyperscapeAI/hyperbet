/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lvr_amm.json`.
 */
export type LvrAmm = {
  "address": "Af4LMYfaBtcFFM6dBjwLYH6QJLMqEwneQ8VHfn2z7NY5",
  "metadata": {
    "name": "lvrAmm",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "lvrAmm"
  },
  "instructions": [
    {
      "name": "buy",
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "mintYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  121,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "mintNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  110,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "destinationYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintYes"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintNo"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": "u64"
        },
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "amountIn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createBetAccount",
      "discriminator": [
        24,
        219,
        70,
        229,
        81,
        50,
        3,
        28
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "mintYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  121,
                  101,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "mintNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  110,
                  111
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": "u64"
        },
        {
          "name": "initialLiq",
          "type": "u64"
        },
        {
          "name": "isDynamic",
          "type": "bool"
        },
        {
          "name": "betPrompt",
          "type": "string"
        },
        {
          "name": "expirationAt",
          "type": "i64"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "getPrice",
      "discriminator": [
        238,
        38,
        193,
        106,
        228,
        32,
        210,
        33
      ],
      "accounts": [
        {
          "name": "bet",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "u8"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "initBetAccount",
      "discriminator": [
        229,
        240,
        116,
        140,
        5,
        177,
        61,
        69
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "signer"
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
          "name": "betId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "adminState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
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
      "name": "sell",
      "docs": [
        "Sell shares of a bet, 0 for yes, 1 for no and q for quantity of shares."
      ],
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "mintYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  121,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "mintNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  110,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "destinationYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintYes"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintNo"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "treasuryYesAta",
          "writable": true
        },
        {
          "name": "treasuryNoAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": "u64"
        },
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "amountIn",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleBet",
      "docs": [
        "Only the settle_pubkey from `Admin` can call this function."
      ],
      "discriminator": [
        115,
        55,
        234,
        177,
        227,
        4,
        10,
        67
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "adminState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": "u64"
        },
        {
          "name": "sideWon",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdrawPostSettle",
      "docs": [
        "Withdraw shares after bet has been settled"
      ],
      "discriminator": [
        133,
        23,
        211,
        230,
        77,
        52,
        64,
        154
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "betId"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "mintYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  121,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "mintNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  110,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "bet.bet_id",
                "account": "bet"
              },
              {
                "kind": "account",
                "path": "bet.creator",
                "account": "bet"
              }
            ]
          }
        },
        {
          "name": "destinationYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintYes"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "signer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mintNo"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "betId",
          "type": "u64"
        },
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "q",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "admin",
      "discriminator": [
        244,
        158,
        220,
        65,
        8,
        73,
        4,
        65
      ]
    },
    {
      "name": "bet",
      "discriminator": [
        147,
        23,
        35,
        59,
        15,
        75,
        155,
        32
      ]
    }
  ],
  "events": [
    {
      "name": "adminStateInitialized",
      "discriminator": [
        211,
        115,
        86,
        90,
        176,
        197,
        254,
        121
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "canOnlyBeInitializedByOwner",
      "msg": "Can only be initialized by owner"
    },
    {
      "code": 6001,
      "name": "outComeCanOnlyBe01",
      "msg": "outcome can only be 0 for yes or 1 for no"
    },
    {
      "code": 6002,
      "name": "invalidInitialLiq",
      "msg": "initial liq must be greater than 100000"
    },
    {
      "code": 6003,
      "name": "quantityMustBeGreaterThanZero",
      "msg": "quantity must be greater than zero"
    },
    {
      "code": 6004,
      "name": "signerDoesntHaveEnoughTokens",
      "msg": "Signer doesn't have enough tokens"
    },
    {
      "code": 6005,
      "name": "notEnoughLamports",
      "msg": "Bet account doesn't have enough lamports"
    },
    {
      "code": 6006,
      "name": "notEnoughSharesToReduce",
      "msg": "Bet account doesn't have enough shares"
    },
    {
      "code": 6007,
      "name": "adminStateAlreadyInitialized",
      "msg": "Admin state already initialized"
    },
    {
      "code": 6008,
      "name": "signerIsNotSettlePubKey",
      "msg": "Signer is not the settle pub key"
    },
    {
      "code": 6009,
      "name": "betAlreadySettled",
      "msg": "Bet already settled"
    },
    {
      "code": 6010,
      "name": "betNotSettled",
      "msg": "Bet not settled"
    },
    {
      "code": 6011,
      "name": "betNotExpired",
      "msg": "Bet not expired"
    },
    {
      "code": 6012,
      "name": "mathErr",
      "msg": "Overflow or Underflow"
    },
    {
      "code": 6013,
      "name": "invalidTreasuryAta",
      "msg": "Invalid Treasury ATA"
    }
  ],
  "types": [
    {
      "name": "admin",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "isInitialized",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "adminStateInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "isInitialized",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "bet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "betId",
            "type": "u64"
          },
          {
            "name": "initialLiq",
            "type": "u64"
          },
          {
            "name": "isDynamic",
            "type": "bool"
          },
          {
            "name": "reserves",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "betPrompt",
            "type": "string"
          },
          {
            "name": "isInitialized",
            "type": "bool"
          },
          {
            "name": "sideWon",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "expirationAt",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    }
  ]
};
