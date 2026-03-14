// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DuelOutcomeOracle} from "../contracts/DuelOutcomeOracle.sol";

contract DuelOutcomeOracleEchidna {
    bytes32 private constant DUEL_KEY = keccak256("echidna-duel");
    bytes32 private constant PARTICIPANT_A = keccak256("participant-a");
    bytes32 private constant PARTICIPANT_B = keccak256("participant-b");

    DuelOutcomeOracle private immutable oracle;

    constructor() {
        oracle = new DuelOutcomeOracle(address(this), address(this));
    }

    function upsert(
        uint64 betOpenTs,
        uint32 betWindow,
        uint32 startDelay,
        uint8 rawStatus
    ) external {
        uint64 openTs = _boundNonZero(betOpenTs);
        uint64 closeTs = openTs + uint64((betWindow % 30 days) + 1);
        uint64 startTs = closeTs + uint64(startDelay % 7 days);
        DuelOutcomeOracle.DuelStatus status = _boundOpenStatus(rawStatus);

        try oracle.upsertDuel(
            DUEL_KEY,
            PARTICIPANT_A,
            PARTICIPANT_B,
            openTs,
            closeTs,
            startTs,
            "echidna-open",
            status
        ) {} catch {}
    }

    function cancel() external {
        try oracle.cancelDuel(DUEL_KEY, "echidna-cancelled") {} catch {}
    }

    function resolve(
        uint8 rawWinner,
        uint64 duelEndDelay,
        uint64 seed,
        bytes32 replayHash,
        bytes32 resultHash
    ) external {
        DuelOutcomeOracle.DuelState memory duel = oracle.getDuel(DUEL_KEY);
        if (duel.status == DuelOutcomeOracle.DuelStatus.NULL) return;

        DuelOutcomeOracle.Side winner =
            rawWinner % 2 == 0 ? DuelOutcomeOracle.Side.A : DuelOutcomeOracle.Side.B;
        uint64 duelEndTs = duel.betCloseTs + uint64(duelEndDelay % 7 days);
        bytes32 boundedReplayHash = replayHash == bytes32(0) ? bytes32(uint256(1)) : replayHash;
        bytes32 boundedResultHash = resultHash == bytes32(0) ? bytes32(uint256(2)) : resultHash;

        try oracle.reportResult(
            DUEL_KEY,
            winner,
            seed,
            boundedReplayHash,
            boundedResultHash,
            duelEndTs,
            "echidna-resolved"
        ) {} catch {}
    }

    function echidna_duel_shape_remains_valid() external view returns (bool) {
        DuelOutcomeOracle.DuelState memory duel = oracle.getDuel(DUEL_KEY);
        if (duel.status == DuelOutcomeOracle.DuelStatus.NULL) return true;
        if (duel.duelKey != DUEL_KEY) return false;
        if (duel.participantAHash != PARTICIPANT_A) return false;
        if (duel.participantBHash != PARTICIPANT_B) return false;
        if (duel.participantAHash == duel.participantBHash) return false;
        if (duel.betOpenTs == 0 || duel.betCloseTs <= duel.betOpenTs) return false;
        if (duel.duelStartTs < duel.betCloseTs) return false;

        if (duel.status == DuelOutcomeOracle.DuelStatus.RESOLVED) {
            if (duel.winner != DuelOutcomeOracle.Side.A && duel.winner != DuelOutcomeOracle.Side.B) {
                return false;
            }
            if (duel.duelEndTs < duel.betCloseTs) return false;
            if (duel.resultHash == bytes32(0) || duel.replayHash == bytes32(0)) return false;
        }

        if (duel.status == DuelOutcomeOracle.DuelStatus.CANCELLED && duel.winner != DuelOutcomeOracle.Side.NONE) {
            return false;
        }

        return true;
    }

    function _boundOpenStatus(uint8 rawStatus) private pure returns (DuelOutcomeOracle.DuelStatus) {
        uint8 statusIndex = (rawStatus % 3) + 1;
        return DuelOutcomeOracle.DuelStatus(statusIndex);
    }

    function _boundNonZero(uint64 rawValue) private pure returns (uint64) {
        return rawValue == 0 ? 1 : rawValue;
    }
}
