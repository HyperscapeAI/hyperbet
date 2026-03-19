// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DuelOutcomeOracle} from "../contracts/DuelOutcomeOracle.sol";

/**
 * @title OracleFinality Foundry Tests
 * @notice PM16 — Fuzz and invariant tests for oracle resolution truth
 */
contract OracleFinalityTest is Test {
    DuelOutcomeOracle oracle;

    address admin = address(0xA);
    address reporter = address(0xB);
    address finalizer = address(0xC);
    address challenger = address(0xD);
    address pauser = address(0xE);
    address other = address(0xF);

    uint64 constant DEFAULT_WINDOW = 3600;

    function setUp() public {
        oracle = new DuelOutcomeOracle(
            admin,
            reporter,
            finalizer,
            challenger,
            pauser,
            DEFAULT_WINDOW
        );
    }

    // ── Helpers ──────────────────────────────────────────────────

    function _duelKey(uint256 id) internal pure returns (bytes32) {
        return bytes32(id);
    }

    bytes32 constant PART_A = bytes32(uint256(0xAAAA));
    bytes32 constant PART_B = bytes32(uint256(0xBBBB));

    function _createLockedDuel(uint256 id) internal returns (bytes32) {
        bytes32 key = _duelKey(id);
        if (block.timestamp < 2_001) vm.warp(2_001);
        vm.prank(reporter);
        oracle.upsertDuel(
            key,
            PART_A,
            PART_B,
            1_000,
            2_000,
            3_000,
            "",
            DuelOutcomeOracle.DuelStatus.LOCKED
        );
        return key;
    }

    function _proposeAndFinalize(bytes32 key) internal {
        bytes32 resultHash = keccak256(abi.encode("result", key));
        bytes32 replayHash = keccak256(abi.encode("replay", key));

        // Warp past betCloseTs (2_000) so proposing is allowed
        if (block.timestamp < 2_001) vm.warp(2_001);

        vm.prank(reporter);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.A, 42, replayHash, resultHash, 4_000, "");

        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        vm.prank(finalizer);
        oracle.finalizeResult(key, "");
    }

    // ── Fuzz: Dispute Window Range ──────────────────────────────

    function testFuzz_disputeWindowConstructor(uint64 window) public {
        vm.assume(window >= 60);
        vm.assume(window <= 365 days); // reasonable upper bound

        DuelOutcomeOracle o = new DuelOutcomeOracle(
            admin, reporter, finalizer, challenger, pauser, window
        );
        assertEq(o.disputeWindowSeconds(), window);
    }

    function testFuzz_tooSmallDisputeWindowReverts(uint64 window) public {
        vm.assume(window < 60);
        vm.expectRevert(DuelOutcomeOracle.InvalidDisputeWindow.selector);
        new DuelOutcomeOracle(
            admin, reporter, finalizer, challenger, pauser, window
        );
    }

    // ── Fuzz: Finalization Timing ───────────────────────────────

    function testFuzz_finalizationTiming(uint64 window, uint64 delay) public {
        vm.assume(window >= 60 && window <= 30 days);
        vm.assume(delay <= 365 days);

        DuelOutcomeOracle o = new DuelOutcomeOracle(
            admin, reporter, finalizer, challenger, pauser, window
        );

        bytes32 key = _duelKey(1);
        if (block.timestamp < 2_001) vm.warp(2_001);
        vm.prank(reporter);
        o.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);

        bytes32 rh = keccak256("r");
        bytes32 rp = keccak256("p");
        // Warp past betCloseTs (2_000) so proposing is allowed
        vm.warp(2_001);
        vm.prank(reporter);
        o.proposeResult(key, DuelOutcomeOracle.Side.A, 1, rp, rh, 4_000, "");

        uint256 proposedAt = block.timestamp;
        vm.warp(proposedAt + delay);

        if (delay < window) {
            // Should revert — too early
            vm.prank(finalizer);
            vm.expectRevert(DuelOutcomeOracle.DisputeWindowActive.selector);
            o.finalizeResult(key, "");
        } else {
            // Should succeed — window elapsed
            vm.prank(finalizer);
            o.finalizeResult(key, "");

            DuelOutcomeOracle.DuelState memory duel = o.getDuel(key);
            assertEq(uint8(duel.status), uint8(DuelOutcomeOracle.DuelStatus.RESOLVED));
            assertEq(uint8(duel.winner), uint8(DuelOutcomeOracle.Side.A));
        }
    }

    // ── Invariant: Resolved duels are immutable ─────────────────

    function testFuzz_resolvedDuelCannotBeUpserted(uint8 newStatus) public {
        vm.assume(newStatus >= 1 && newStatus <= 3); // SCHEDULED, BETTING_OPEN, LOCKED

        bytes32 key = _createLockedDuel(100);
        _proposeAndFinalize(key);

        vm.prank(reporter);
        vm.expectRevert(DuelOutcomeOracle.DuelAlreadyResolved.selector);
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus(newStatus));
    }

    function test_resolvedDuelCannotBeCancelled() public {
        bytes32 key = _createLockedDuel(101);
        _proposeAndFinalize(key);

        vm.prank(pauser);
        vm.expectRevert(DuelOutcomeOracle.DuelAlreadyResolved.selector);
        oracle.cancelDuel(key, "");
    }

    // ── Invariant: Cancelled duels are immutable ────────────────

    function testFuzz_cancelledDuelCannotBeUpserted(uint8 newStatus) public {
        vm.assume(newStatus >= 1 && newStatus <= 3);

        bytes32 key = _createLockedDuel(200);
        vm.prank(pauser);
        oracle.cancelDuel(key, "");

        vm.prank(reporter);
        vm.expectRevert(DuelOutcomeOracle.DuelAlreadyCancelled.selector);
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus(newStatus));
    }

    function test_cancelledDuelCannotBeCancelledAgain() public {
        bytes32 key = _createLockedDuel(201);
        vm.prank(pauser);
        oracle.cancelDuel(key, "");

        vm.prank(pauser);
        vm.expectRevert(DuelOutcomeOracle.DuelAlreadyCancelled.selector);
        oracle.cancelDuel(key, "");
    }

    // ── Invariant: No winner before terminal ────────────────────

    function test_noWinnerInScheduled() public {
        bytes32 key = _duelKey(300);
        vm.prank(reporter);
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus.SCHEDULED);
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(key);
        assertEq(uint8(d.winner), 0);
    }

    function test_noWinnerInLocked() public {
        bytes32 key = _createLockedDuel(301);
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(key);
        assertEq(uint8(d.winner), 0);
    }

    function test_noWinnerInProposed() public {
        bytes32 key = _createLockedDuel(302);
        vm.warp(2_001);
        vm.prank(reporter);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.B, 99,
            keccak256("rp"), keccak256("rh"), 4_000, "");
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(key);
        assertEq(uint8(d.winner), 0);
    }

    function test_noWinnerInChallenged() public {
        bytes32 key = _createLockedDuel(303);
        vm.warp(2_001);
        vm.prank(reporter);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.A, 1,
            keccak256("rp2"), keccak256("rh2"), 4_000, "");
        vm.prank(challenger);
        oracle.challengeResult(key, "");
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(key);
        assertEq(uint8(d.winner), 0);
    }

    function test_noWinnerInCancelled() public {
        bytes32 key = _createLockedDuel(304);
        vm.prank(pauser);
        oracle.cancelDuel(key, "");
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(key);
        assertEq(uint8(d.winner), 0);
    }

    // ── State transition: no regression ─────────────────────────

    function testFuzz_noStateRegression(uint8 initial, uint8 attempted) public {
        vm.assume(initial >= 1 && initial <= 3); // valid upsert statuses
        vm.assume(attempted >= 1 && attempted <= 3);
        vm.assume(attempted < initial); // regression

        bytes32 key = _duelKey(400 + uint256(initial) * 10 + attempted);
        if (initial == uint8(DuelOutcomeOracle.DuelStatus.LOCKED) && block.timestamp < 2_001) {
            vm.warp(2_001);
        }
        vm.prank(reporter);
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus(initial));

        vm.prank(reporter);
        vm.expectRevert(DuelOutcomeOracle.InvalidTransition.selector);
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus(attempted));
    }

    // ── Access control ──────────────────────────────────────────

    function test_onlyReporterCanUpsert() public {
        bytes32 key = _duelKey(500);
        vm.prank(other);
        vm.expectRevert();
        oracle.upsertDuel(key, PART_A, PART_B, 1_000, 2_000, 3_000, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);
    }

    function test_lockedUpsertBeforeBetCloseReverts() public {
        bytes32 key = _duelKey(505);
        uint64 nowTs = uint64(block.timestamp);

        vm.prank(reporter);
        vm.expectRevert(DuelOutcomeOracle.BettingWindowActive.selector);
        oracle.upsertDuel(key, PART_A, PART_B, nowTs, nowTs + 60, nowTs + 120, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);
    }

    function test_lockedUpsertAtBetCloseSucceeds() public {
        bytes32 key = _duelKey(506);
        uint64 nowTs = uint64(block.timestamp);
        uint64 betCloseTs = nowTs + 60;

        vm.warp(betCloseTs);
        vm.prank(reporter);
        oracle.upsertDuel(key, PART_A, PART_B, nowTs, betCloseTs, nowTs + 120, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);

        DuelOutcomeOracle.DuelState memory duel = oracle.getDuel(key);
        assertEq(uint8(duel.status), uint8(DuelOutcomeOracle.DuelStatus.LOCKED));
    }

    function test_onlyReporterCanPropose() public {
        bytes32 key = _createLockedDuel(501);
        vm.warp(2_001);
        vm.prank(other);
        vm.expectRevert();
        oracle.proposeResult(key, DuelOutcomeOracle.Side.A, 1,
            keccak256("r"), keccak256("h"), 4_000, "");
    }

    function test_onlyFinalizerCanFinalize() public {
        bytes32 key = _createLockedDuel(502);
        vm.warp(2_001);
        vm.prank(reporter);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.A, 1,
            keccak256("r3"), keccak256("h3"), 4_000, "");
        vm.warp(block.timestamp + DEFAULT_WINDOW + 1);

        vm.prank(other);
        vm.expectRevert();
        oracle.finalizeResult(key, "");
    }

    function test_onlyChallengerCanChallenge() public {
        bytes32 key = _createLockedDuel(503);
        vm.warp(2_001);
        vm.prank(reporter);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.B, 1,
            keccak256("r4"), keccak256("h4"), 4_000, "");

        vm.prank(other);
        vm.expectRevert();
        oracle.challengeResult(key, "");
    }

    function test_onlyPauserCanCancel() public {
        bytes32 key = _createLockedDuel(504);
        vm.prank(other);
        vm.expectRevert();
        oracle.cancelDuel(key, "");
    }

    // ── Exploit edge cases: post-terminal operations ─────────────

    function test_doubleFinalizeReverts() public {
        bytes32 key = _createLockedDuel(600);
        _proposeAndFinalize(key);

        vm.prank(finalizer);
        vm.expectRevert(DuelOutcomeOracle.NotProposed.selector);
        oracle.finalizeResult(key, "");
    }

    function test_challengeAfterFinalizeReverts() public {
        bytes32 key = _createLockedDuel(601);
        _proposeAndFinalize(key);

        vm.prank(challenger);
        vm.expectRevert(DuelOutcomeOracle.NotProposed.selector);
        oracle.challengeResult(key, "");
    }

    function test_proposeAfterCancelReverts() public {
        bytes32 key = _createLockedDuel(602);
        vm.prank(pauser);
        oracle.cancelDuel(key, "");

        vm.prank(reporter);
        vm.expectRevert(DuelOutcomeOracle.DuelAlreadyCancelled.selector);
        oracle.proposeResult(key, DuelOutcomeOracle.Side.A, 1,
            keccak256("r5"), keccak256("h5"), 4_000, "");
    }
}
