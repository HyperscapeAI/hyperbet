/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lvr_amm.json`.
 */
export type LvrAmm = {
  "address": "12E8Lz5w8Qxyj8Fh6LgsCgPDQNJMCLMV1y43LhPrH66w",
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
          "name": "ammConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "ammConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "duelKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "freezeConfig",
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
          "name": "ammConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
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
          "name": "ammConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "signer",
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
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "marketMaker",
          "type": "pubkey"
        },
        {
          "name": "fightOracleProgram",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "sell",
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
          "name": "ammConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "ammConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleBet",
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
        },
        {
          "name": "ammConfig",
          "docs": [
            "Optional to preserve the instruction interface, but required in practice for settlement validation."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
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
          "name": "duelState",
          "docs": [
            "Optional to preserve the instruction interface, but required in practice for settlement validation."
          ],
          "optional": true
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
      "name": "ammConfig",
      "discriminator": [
        218,
        244,
        33,
        104,
        203,
        203,
        43,
        111
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
    },
    {
      "name": "ammConfigFrozen",
      "discriminator": [
        247,
        80,
        58,
        72,
        123,
        117,
        119,
        164
      ]
    },
    {
      "name": "ammConfigInitialized",
      "discriminator": [
        105,
        30,
        129,
        183,
        100,
        137,
        26,
        239
      ]
    },
    {
      "name": "ammPausedChanged",
      "discriminator": [
        69,
        202,
        147,
        173,
        81,
        7,
        62,
        82
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
      "name": "betNotInitialized",
      "msg": "Bet not initialized"
    },
    {
      "code": 6011,
      "name": "betNotSettled",
      "msg": "Bet not settled"
    },
    {
      "code": 6012,
      "name": "betNotExpired",
      "msg": "Bet not expired"
    },
    {
      "code": 6013,
      "name": "invalidOracleAccount",
      "msg": "Invalid oracle account"
    },
    {
      "code": 6014,
      "name": "oracleBetMismatch",
      "msg": "Oracle duel does not match bet"
    },
    {
      "code": 6015,
      "name": "mathErr",
      "msg": "Overflow or Underflow"
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6017,
      "name": "insufficientReserves",
      "msg": "Insufficient reserves for swap"
    },
    {
      "code": 6018,
      "name": "marketExpired",
      "msg": "Market has expired"
    },
    {
      "code": 6019,
      "name": "invalidSettlementOutcome",
      "msg": "Invalid settlement outcome"
    },
    {
      "code": 6020,
      "name": "invalidAddress",
      "msg": "Invalid address (zero/default)"
    },
    {
      "code": 6021,
      "name": "feeTooHigh",
      "msg": "Fee BPS exceeds maximum (1000 = 10%)"
    },
    {
      "code": 6022,
      "name": "marketPaused",
      "msg": "Market is paused"
    },
    {
      "code": 6023,
      "name": "configFrozen",
      "msg": "Config is frozen"
    },
    {
      "code": 6024,
      "name": "invalidDuelState",
      "msg": "Invalid duel state account"
    },
    {
      "code": 6025,
      "name": "missingAmmConfig",
      "msg": "AMM config account required for oracle settlement"
    },
    {
      "code": 6026,
      "name": "invalidFightOracleProgram",
      "msg": "Fight oracle program mismatch"
    },
    {
      "code": 6027,
      "name": "mathConvergenceError",
      "msg": "AMM Newton-Raphson solver did not converge"
    },
    {
      "code": 6028,
      "name": "mathFixedPointOverflow",
      "msg": "AMM fixed-point overflow"
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
      "name": "ammConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
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
            "name": "fightOracleProgram",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "configFrozen",
            "type": "bool"
          },
          {
            "name": "paused",
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
      "name": "ammConfigFrozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "ammConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "fightOracleProgram",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ammPausedChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
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
            "name": "duelKey",
            "type": {
              "array": [
                "u8",
                32
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
