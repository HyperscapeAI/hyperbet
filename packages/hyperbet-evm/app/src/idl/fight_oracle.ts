/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fight_oracle.json`.
 */
export type FightOracle = {
  "address": "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD",
  "metadata": {
    "name": "fightOracle",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "cancelDuel",
      "discriminator": [
        83,
        124,
        224,
        237,
        235,
        44,
        38,
        57
      ],
      "accounts": [
        {
          "name": "reporter",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
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
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  117,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "duelKey"
              }
            ]
          }
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
          "name": "metadataUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "initializeOracle",
      "discriminator": [
        144,
        223,
        131,
        120,
        196,
        253,
        181,
        99
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
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
          "name": "program",
          "address": "6tpRysBFd1yXRipYEYwAw9jxEoVHk15kVXfkDGFLMqcD"
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
          "name": "reporter",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "reportResult",
      "discriminator": [
        195,
        187,
        161,
        107,
        75,
        154,
        102,
        183
      ],
      "accounts": [
        {
          "name": "reporter",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
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
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  117,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "duelKey"
              }
            ]
          }
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
          "name": "winner",
          "type": {
            "defined": {
              "name": "marketSide"
            }
          }
        },
        {
          "name": "seed",
          "type": "u64"
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
          "name": "resultHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "duelEndTs",
          "type": "i64"
        },
        {
          "name": "metadataUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateOracleConfig",
      "discriminator": [
        83,
        16,
        11,
        254,
        57,
        99,
        156,
        58
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "oracleConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
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
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "reporter",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "upsertDuel",
      "discriminator": [
        174,
        7,
        139,
        223,
        70,
        128,
        251,
        128
      ],
      "accounts": [
        {
          "name": "reporter",
          "writable": true,
          "signer": true
        },
        {
          "name": "oracleConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
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
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  117,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "duelKey"
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
          "name": "metadataUri",
          "type": "string"
        },
        {
          "name": "status",
          "type": {
            "defined": {
              "name": "duelStatus"
            }
          }
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
      "name": "oracleConfig",
      "discriminator": [
        133,
        196,
        152,
        50,
        27,
        21,
        145,
        254
      ]
    }
  ],
  "events": [
    {
      "name": "duelCancelled",
      "discriminator": [
        138,
        79,
        20,
        163,
        207,
        11,
        111,
        213
      ]
    },
    {
      "name": "duelResolved",
      "discriminator": [
        224,
        245,
        214,
        212,
        111,
        151,
        50,
        5
      ]
    },
    {
      "name": "duelUpserted",
      "discriminator": [
        37,
        241,
        232,
        195,
        196,
        76,
        240,
        120
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized oracle action"
    },
    {
      "code": 6001,
      "name": "unauthorizedInitializer",
      "msg": "Only the current upgrade authority can initialize the oracle"
    },
    {
      "code": 6002,
      "name": "invalidReporter",
      "msg": "Reporter pubkey cannot be the default address"
    },
    {
      "code": 6003,
      "name": "invalidAuthority",
      "msg": "Authority pubkey cannot be the default address"
    },
    {
      "code": 6004,
      "name": "invalidBetWindow",
      "msg": "Betting window is invalid"
    },
    {
      "code": 6005,
      "name": "invalidParticipants",
      "msg": "Participants must be present and distinct"
    },
    {
      "code": 6006,
      "name": "invalidLifecycleTransition",
      "msg": "Duel lifecycle transition is invalid"
    },
    {
      "code": 6007,
      "name": "duelKeyMismatch",
      "msg": "The provided duel key does not match the stored duel"
    },
    {
      "code": 6008,
      "name": "duelAlreadyFinalized",
      "msg": "The duel is already finalized"
    },
    {
      "code": 6009,
      "name": "duelAlreadyCancelled",
      "msg": "The duel was cancelled and cannot be resolved"
    },
    {
      "code": 6010,
      "name": "invalidWinner",
      "msg": "Winner must be side A or side B"
    }
  ],
  "types": [
    {
      "name": "duelCancelled",
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
            "name": "metadataUri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "duelResolved",
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
            "name": "winner",
            "type": {
              "defined": {
                "name": "marketSide"
              }
            }
          },
          {
            "name": "seed",
            "type": "u64"
          },
          {
            "name": "duelEndTs",
            "type": "i64"
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
          }
        ]
      }
    },
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
      "name": "duelUpserted",
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
            "name": "status",
            "type": {
              "defined": {
                "name": "duelStatus"
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
            "name": "metadataUri",
            "type": "string"
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
      "name": "oracleConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "reporter",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
