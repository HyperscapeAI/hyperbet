// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {DuelOutcomeOracle} from "../../contracts/DuelOutcomeOracle.sol";
import {GoldClob} from "../../contracts/GoldClob.sol";

contract GoldClobFuzzTest is Test {
    uint8 private constant MARKET_KIND_DUEL_WINNER = 0;
    uint8 private constant BUY_SIDE = 1;
    uint8 private constant SELL_SIDE = 2;
    uint8 private constant ORDER_FLAG_GTC = 0x01;

    address private admin = address(0xA11CE);
    address private operator = address(0x0F03);
    address private reporter = address(0xB0B);
    address private finalizer = address(0xF1A1);
    address private challenger = address(0xC0B1);
    address private treasury = address(0x7001);
    address private marketMaker = address(0xAA01);
    address private traderA = address(0xAAA1);
    address private traderB = address(0xBBB1);

    DuelOutcomeOracle private oracle;
    GoldClob private clob;

    function setUp() public {
        vm.txGasPrice(0);
        vm.warp(1_000);

        oracle = new DuelOutcomeOracle(admin, reporter, finalizer, challenger, admin, 3_600);

        vm.prank(admin);
        clob = new GoldClob(admin, operator, address(oracle), treasury, marketMaker, admin);

        vm.deal(traderA, 1_000 ether);
        vm.deal(traderB, 1_000 ether);
    }

    function testFuzz_RevertsWhenRestingOrderValueIsUnderfunded(
        uint8 sideSeed,
        uint16 rawPrice,
        uint96 rawAmountUnits,
        uint256 rawShortfall
    ) public {
        bytes32 duel = _createOpenMarket("underfunded-order");
        uint8 side = sideSeed % 2 == 0 ? BUY_SIDE : SELL_SIDE;
        uint16 price = _boundPrice(rawPrice);
        uint128 amount = _boundAmount(rawAmountUnits, 1, 200);
        uint256 requiredValue = _quoteCost(side, price, amount);
        uint256 shortfall = bound(rawShortfall, 1, requiredValue);

        vm.expectRevert(GoldClob.InsufficientNativeValue.selector);
        vm.prank(traderA);
        clob.placeOrder{value: requiredValue - shortfall}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            side,
            price,
            amount,
            ORDER_FLAG_GTC
        );
    }

    function testFuzz_CancelRefundsRemainingQuoteCostAndClearsQueue(
        uint16 rawPrice,
        uint96 rawMakerUnits,
        uint96 rawFillUnits
    ) public {
        bytes32 duel = _createOpenMarket("cancel-refund");
        uint16 price = _boundPrice(rawPrice);
        uint256 makerUnits = bound(uint256(rawMakerUnits), 2, 200);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 makerAmount = uint128(makerUnits * 1_000);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 fillAmount = uint128(bound(uint256(rawFillUnits), 1, makerUnits - 1) * 1_000);

        vm.prank(traderA);
        clob.placeOrder{value: _totalOrderValue(BUY_SIDE, price, makerAmount)}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            BUY_SIDE,
            price,
            makerAmount,
            ORDER_FLAG_GTC
        );

        vm.prank(traderB);
        clob.placeOrder{value: _totalOrderValue(SELL_SIDE, price, fillAmount)}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            SELL_SIDE,
            price,
            fillAmount,
            ORDER_FLAG_GTC
        );

        uint128 remainingAmount = makerAmount - fillAmount;
        uint256 expectedRefund = _quoteCost(BUY_SIDE, price, remainingAmount);
        uint256 traderBefore = traderA.balance;

        vm.prank(traderA);
        clob.cancelOrder(duel, MARKET_KIND_DUEL_WINNER, 1);

        assertEq(traderA.balance - traderBefore, expectedRefund, "cancel should refund remaining quote cost");

        (uint64 headOrderId, uint64 tailOrderId, uint128 totalOpen) = clob.getPriceLevel(
            duel,
            MARKET_KIND_DUEL_WINNER,
            BUY_SIDE,
            price
        );
        assertEq(headOrderId, 0, "bid level head should clear");
        assertEq(tailOrderId, 0, "bid level tail should clear");
        assertEq(totalOpen, 0, "bid level open total should clear");

        GoldClob.Market memory market = clob.getMarket(duel, MARKET_KIND_DUEL_WINNER);
        assertEq(market.bestBid, 0, "best bid should clear after cancelling the only resting order");

        (
            uint64 orderId,
            uint8 side,
            uint16 orderPrice,
            address maker,
            uint128 amount,
            uint128 filled,
            uint64 prevOrderId,
            uint64 nextOrderId,
            bool active
        ) = clob.orders(clob.marketKey(duel, MARKET_KIND_DUEL_WINNER), 1);
        assertEq(orderId, 1, "order id should remain stable");
        assertEq(side, BUY_SIDE, "order side should remain BUY");
        assertEq(orderPrice, price, "order price should remain stable");
        assertEq(maker, traderA, "order maker should remain traderA");
        assertEq(amount, makerAmount, "order amount should remain stable");
        assertEq(filled, makerAmount, "cancel should mark remaining size as filled");
        assertEq(prevOrderId, 0, "cancel should clear previous order link");
        assertEq(nextOrderId, 0, "cancel should clear next order link");
        assertTrue(!active, "cancel should deactivate the order");
    }

    function testFuzz_ResolvedClaimClearsPositionAndPaysWinner(
        uint16 rawPrice,
        uint96 rawAmountUnits
    ) public {
        bytes32 duel = _createOpenMarket("resolved-claim");
        uint16 price = _boundPrice(rawPrice);
        uint128 amount = _boundAmount(rawAmountUnits, 1, 200);

        _matchTrade(duel, price, amount);
        _resolveDuel(duel, DuelOutcomeOracle.Side.A);

        bytes32 key = clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
        (uint128 aSharesBefore, uint128 bSharesBefore, uint128 aStakeBefore, uint128 bStakeBefore) =
            clob.positions(key, traderB);
        assertEq(aSharesBefore, amount, "winner should hold A shares before claim");

        uint256 traderBefore = traderB.balance;
        uint256 mmBefore = marketMaker.balance;

        vm.prank(traderB);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);

        uint256 expectedFee = (uint256(amount) * 200) / 10_000;
        assertEq(traderB.balance - traderBefore, uint256(amount) - expectedFee, "winner payout should net MM fee");
        assertEq(marketMaker.balance - mmBefore, expectedFee, "MM should receive the winnings fee");

        _assertClearedPosition(key, traderB);
        assertEq(bSharesBefore, 0, "winner should not hold B shares");
        assertEq(aStakeBefore, _quoteCost(BUY_SIDE, price, amount), "winner A stake should be tracked");
        assertEq(bStakeBefore, 0, "winner B stake should be zero");
    }

    function testFuzz_CancelledClaimClearsPositionAndRefundsStake(
        uint16 rawPrice,
        uint96 rawAmountUnits
    ) public {
        bytes32 duel = _createOpenMarket("cancelled-claim");
        uint16 price = _boundPrice(rawPrice);
        uint128 amount = _boundAmount(rawAmountUnits, 1, 200);

        _matchTrade(duel, price, amount);

        bytes32 key = clob.marketKey(duel, MARKET_KIND_DUEL_WINNER);
        (, uint128 bSharesBefore,, uint128 bStakeBefore) = clob.positions(key, traderA);
        assertEq(bSharesBefore, amount, "seller should hold B shares before cancellation");

        uint256 traderBefore = traderA.balance;

        vm.prank(admin);
        oracle.cancelDuel(duel, "cancelled");

        vm.prank(traderA);
        clob.claim(duel, MARKET_KIND_DUEL_WINNER);

        assertEq(traderA.balance - traderBefore, bStakeBefore, "cancelled market should refund tracked stake");
        _assertClearedPosition(key, traderA);
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
            amount,
            ORDER_FLAG_GTC
        );

        vm.prank(traderB);
        clob.placeOrder{value: _totalOrderValue(BUY_SIDE, price, amount)}(
            duel,
            MARKET_KIND_DUEL_WINNER,
            BUY_SIDE,
            price,
            amount,
            ORDER_FLAG_GTC
        );
    }

    function _resolveDuel(bytes32 duel, DuelOutcomeOracle.Side winner) private {
        _lockDuel(duel);

        vm.prank(reporter);
        oracle.proposeResult(
            duel,
            winner,
            42,
            _hashLabel("replay"),
            _hashLabel("result"),
            uint64(block.timestamp + 180),
            "resolved"
        );
        vm.warp(block.timestamp + 3_600);
        vm.prank(finalizer);
        oracle.finalizeResult(duel, "finalized");
    }

    function _lockDuel(bytes32 duel) private {
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(duel);
        vm.warp(d.betCloseTs + 1);
        vm.prank(reporter);
        oracle.upsertDuel(
            duel,
            d.participantAHash,
            d.participantBHash,
            d.betOpenTs,
            d.betCloseTs,
            d.duelStartTs,
            "locked",
            DuelOutcomeOracle.DuelStatus.LOCKED
        );
    }

    function _assertClearedPosition(bytes32 key, address trader) private view {
        (uint128 aShares, uint128 bShares, uint128 aStake, uint128 bStake) =
            clob.positions(key, trader);
        assertEq(aShares, 0, "A shares should clear");
        assertEq(bShares, 0, "B shares should clear");
        assertEq(aStake, 0, "A stake should clear");
        assertEq(bStake, 0, "B stake should clear");
    }

    function _boundPrice(uint16 rawPrice) private pure returns (uint16) {
        return uint16(bound(uint256(rawPrice), 1, 999));
    }

    function _boundAmount(
        uint96 rawAmountUnits,
        uint256 minUnits,
        uint256 maxUnits
    ) private pure returns (uint128) {
        return uint128(bound(uint256(rawAmountUnits), minUnits, maxUnits) * 1_000);
    }

    function _duelKey(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _hashLabel(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _quoteCost(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 priceComponent = side == BUY_SIDE ? price : 1_000 - price;
        return (uint256(amount) * priceComponent) / 1_000;
    }

    function _totalOrderValue(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 cost = _quoteCost(side, price, amount);
        uint256 treasuryFee = (cost * 100) / 10_000;
        uint256 marketMakerFee = (cost * 100) / 10_000;
        return cost + treasuryFee + marketMakerFee;
    }
}
