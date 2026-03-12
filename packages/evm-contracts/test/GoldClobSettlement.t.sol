// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../contracts/DuelOutcomeOracle.sol";
import "../contracts/GoldClob.sol";

contract GoldClobSettlementTest is Test {
    uint8 private constant MARKET_KIND_DUEL_WINNER = 0;
    uint8 private constant BUY_SIDE = 1;
    uint8 private constant SELL_SIDE = 2;

    address private admin = address(0xA11CE);
    address private operator = address(0x0F03);
    address private reporter = address(0xB0B);
    address private treasury = address(0x7001);
    address private marketMaker = address(0xAA01);
    address private traderA = address(0xAAA1);
    address private traderB = address(0xBBB1);

    DuelOutcomeOracle private oracle;
    GoldClob private clob;

    function setUp() public {
        vm.txGasPrice(0);
        vm.warp(1_000);

        oracle = new DuelOutcomeOracle(admin, reporter);

        vm.prank(admin);
        clob = new GoldClob(admin, operator, address(oracle), treasury, marketMaker);

        vm.deal(traderA, 100 ether);
        vm.deal(traderB, 100 ether);
    }

    function testWinnerClaimPaysOutAndClearsState() public {
        bytes32 duel = _createOpenMarket("winner-payout");
        uint128 amount = 1_000;

        _matchTrade(duel, 600, amount);
        _resolveDuel(duel, DuelOutcomeOracle.Side.A);

        bytes32 key = clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
        (uint128 aSharesBefore,,, ) = clob.positions(key, traderB);
        assertEq(aSharesBefore, amount, "winner should hold A shares before claim");

        uint256 traderBefore = traderB.balance;
        uint256 mmBefore = marketMaker.balance;

        vm.prank(traderB);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);

        uint256 expectedFee = (uint256(amount) * 200) / 10_000;
        assertEq(traderB.balance - traderBefore, uint256(amount) - expectedFee, "winner payout should net MM fee");
        assertEq(marketMaker.balance - mmBefore, expectedFee, "MM should receive winnings fee");

        (uint128 aSharesAfter, uint128 bSharesAfter, uint128 aStakeAfter, uint128 bStakeAfter) =
            clob.positions(key, traderB);
        assertEq(aSharesAfter, 0, "winner A shares should clear");
        assertEq(bSharesAfter, 0, "winner B shares should clear");
        assertEq(aStakeAfter, 0, "winner A stake should clear");
        assertEq(bStakeAfter, 0, "winner B stake should clear");

        vm.expectRevert(bytes("nothing to claim"));
        vm.prank(traderB);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);
    }

    function testResolvedLoserClaimClearsStateAndRejectsRepeat() public {
        bytes32 duel = _createOpenMarket("loser-clear");
        uint128 amount = 1_000;

        _matchTrade(duel, 600, amount);
        _resolveDuel(duel, DuelOutcomeOracle.Side.A);

        bytes32 key = clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
        (, uint128 bSharesBefore,, uint128 bStakeBefore) = clob.positions(key, traderA);
        assertEq(bSharesBefore, amount, "loser should hold B shares before claim");
        assertEq(bStakeBefore, _quoteCost(SELL_SIDE, 600, amount), "loser stake should be tracked");

        uint256 traderBefore = traderA.balance;

        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);

        assertEq(traderA.balance, traderBefore, "loser cleanup should not pay out");

        (uint128 aSharesAfter, uint128 bSharesAfter, uint128 aStakeAfter, uint128 bStakeAfter) =
            clob.positions(key, traderA);
        assertEq(aSharesAfter, 0, "loser A shares should clear");
        assertEq(bSharesAfter, 0, "loser B shares should clear");
        assertEq(aStakeAfter, 0, "loser A stake should clear");
        assertEq(bStakeAfter, 0, "loser B stake should clear");

        vm.expectRevert(bytes("nothing to claim"));
        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);
    }

    function testCancelledMarketRefundsStakeAndClearsState() public {
        bytes32 duel = _createOpenMarket("cancelled-refund");
        uint128 amount = 1_000;

        _matchTrade(duel, 600, amount);

        bytes32 key = clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
        (, uint128 bSharesBefore,, uint128 bStakeBefore) = clob.positions(key, traderA);
        assertEq(bSharesBefore, amount, "seller should hold B shares before cancel");

        uint256 traderBefore = traderA.balance;
        vm.prank(reporter);
        oracle.cancelDuel(duel, "cancelled");

        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);

        assertEq(traderA.balance - traderBefore, bStakeBefore, "cancelled market should refund full stake");

        (uint128 aSharesAfter, uint128 bSharesAfter, uint128 aStakeAfter, uint128 bStakeAfter) =
            clob.positions(key, traderA);
        assertEq(aSharesAfter, 0, "cancelled A shares should clear");
        assertEq(bSharesAfter, 0, "cancelled B shares should clear");
        assertEq(aStakeAfter, 0, "cancelled A stake should clear");
        assertEq(bStakeAfter, 0, "cancelled B stake should clear");

        vm.expectRevert(bytes("nothing to claim"));
        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);
    }

    function testRejectsClaimBeforeSettlement() public {
        bytes32 duel = _createOpenMarket("unresolved-claim");
        _matchTrade(duel, 600, 1_000);

        vm.expectRevert(GoldClob.MarketNotSettled.selector);
        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);
    }

    function _createOpenMarket(string memory label) private returns (bytes32 duel) {
        duel = _duelKey(label);
        bytes32 participantA = _hashLabel(string.concat(label, "-a"));
        bytes32 participantB = _hashLabel(string.concat(label, "-b"));
        uint64 nowTs = uint64(block.timestamp);

        vm.prank(reporter);
        oracle.upsertDuel(
            duel,
            participantA,
            participantB,
            nowTs,
            nowTs + 60,
            nowTs + 120,
            label,
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN
        );

        vm.prank(operator);
        clob.createMarketForDuel(duel, MARKET_KIND_DUEL_WINNER);
    }

    function _matchTrade(bytes32 duel, uint16 price, uint128 amount) private {
        vm.prank(traderA);
        clob.placeOrder{value: _totalOrderValue(SELL_SIDE, price, amount)}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            SELL_SIDE,
            price,
            amount
        );

        vm.prank(traderB);
        clob.placeOrder{value: _totalOrderValue(BUY_SIDE, price, amount)}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            BUY_SIDE,
            price,
            amount
        );
    }

    function _resolveDuel(bytes32 duel, DuelOutcomeOracle.Side winner) private {
        vm.prank(reporter);
        oracle.reportResult(
            duel,
            winner,
            42,
            _hashLabel("replay"),
            _hashLabel("result"),
            uint64(block.timestamp + 180),
            "resolved"
        );
    }

    function _duelKey(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _hashLabel(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _quoteCost(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 priceComponent = side == BUY_SIDE ? price : 1000 - price;
        uint256 total = uint256(amount) * priceComponent;
        require(total % 1000 == 0, "precision error");
        return total / 1000;
    }

    function _totalOrderValue(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 cost = _quoteCost(side, price, amount);
        uint256 treasuryFee = (cost * 100) / 10_000;
        uint256 marketMakerFee = (cost * 100) / 10_000;
        return cost + treasuryFee + marketMakerFee;
    }
}
