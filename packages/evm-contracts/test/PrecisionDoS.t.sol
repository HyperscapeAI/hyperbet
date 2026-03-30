// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

import {DuelOutcomeOracle} from "../contracts/DuelOutcomeOracle.sol";
import {GoldClob} from "../contracts/GoldClob.sol";

contract GoldClobPrecisionDoSTest is Test {
    uint8 private constant MARKET_KIND_DUEL_WINNER = 0;
    uint8 private constant BUY_SIDE = 1;
    uint8 private constant SELL_SIDE = 2;
    uint8 private constant ORDER_FLAG_GTC = 0x01;

    address private admin = address(0xA11CE);
    address private maker = address(0xB0B1);
    address private taker = address(0xB0B2);

    DuelOutcomeOracle private oracle;
    GoldClob private clob;

    event OrderMatched(
        bytes32 indexed marketKey,
        uint64 makerOrderId,
        uint64 takerOrderId,
        uint256 matchedAmount,
        uint16 price
    );

    function setUp() public {
        vm.txGasPrice(0);
        oracle = new DuelOutcomeOracle(admin, admin, admin, admin, admin, 3_600);

        vm.prank(admin);
        clob = new GoldClob(admin, admin, address(oracle), admin, admin, admin);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(GoldClob.GovernanceSurfaceFrozen.selector));
        clob.setFeeConfig(0, 0, 0);

        vm.deal(maker, 10 ether);
        vm.deal(taker, 10 ether);
    }

    function testMixedQuantityMatchingDoesNotRevertOnPrecision() public {
        bytes32 duelKey = keccak256("duel-123");

        vm.prank(admin);
        oracle.upsertDuel(
            duelKey,
            keccak256("p1"),
            keccak256("p2"),
            1,
            2_000_000_000,
            2_000_000_001,
            "m",
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN
        );

        vm.prank(admin);
        clob.createMarketForDuel(duelKey, MARKET_KIND_DUEL_WINNER);

        vm.prank(maker);
        clob.placeOrder{value: 3000}(duelKey, MARKET_KIND_DUEL_WINNER, SELL_SIDE, 250, 4000, ORDER_FLAG_GTC);

        bytes32 expectedMarketKey = clob.marketKey(duelKey, MARKET_KIND_DUEL_WINNER);

        vm.expectEmit(true, false, false, true);
        emit OrderMatched(expectedMarketKey, 1, 2, 2000, 250);

        vm.prank(taker);
        clob.placeOrder{value: 1000}(duelKey, MARKET_KIND_DUEL_WINNER, BUY_SIDE, 500, 2000, ORDER_FLAG_GTC);
    }
}
