// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {DuelOutcomeOracle} from "../contracts/DuelOutcomeOracle.sol";
import {GoldClob} from "../contracts/GoldClob.sol";

/// @title CLOB functional depth tests — order queue, FIFO, stress, cancellation
contract GoldClobStressTest is Test {
    uint8 private constant MK = 0;
    uint8 private constant BUY = 1;
    uint8 private constant SELL = 2;
    uint8 private constant GTC = 0x01;
    uint8 private constant IOC = 0x02;
    uint8 private constant POST_ONLY = 0x05;
    uint16 private constant MAX_PRICE = 1000;

    address private admin = address(0xA11CE);
    address private operator = address(0x0F03);
    address private reporter = address(0xB0B);
    address private finalizer = address(0xF1A1);
    address private treasury = address(0x7001);
    address private marketMaker = address(0xAA01);

    DuelOutcomeOracle private oracle;
    GoldClob private clob;

    // 60 maker addresses for high-volume tests
    address[60] makers;

    function setUp() public {
        vm.txGasPrice(0);
        vm.warp(1_000);

        oracle = new DuelOutcomeOracle(admin, reporter, finalizer, reporter, admin, 3_600);
        vm.prank(admin);
        clob = new GoldClob(admin, operator, address(oracle), treasury, marketMaker, admin);

        for (uint256 i = 0; i < 60; i++) {
            makers[i] = address(uint160(0xD000 + i));
            vm.deal(makers[i], 1000 ether);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    function _createMarket(string memory label) private returns (bytes32) {
        bytes32 duel = keccak256(bytes(label));
        vm.prank(reporter);
        oracle.upsertDuel(duel, keccak256("a"), keccak256("b"),
            uint64(block.timestamp), uint64(block.timestamp + 3600),
            uint64(block.timestamp + 7200), label,
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN);
        vm.prank(operator);
        clob.createMarketForDuel(duel, MK);
        return duel;
    }

    function _orderCost(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 priceComp = side == BUY ? price : MAX_PRICE - price;
        uint256 cost = (uint256(amount) * priceComp) / MAX_PRICE;
        uint256 fee = (cost * 100) / 10_000 + (cost * 100) / 10_000; // treasury + mm fee
        return cost + fee;
    }

    function _resolve(bytes32 duel, DuelOutcomeOracle.Side winner) private {
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(duel);
        vm.warp(d.betCloseTs + 1);
        vm.prank(reporter);
        oracle.upsertDuel(duel, d.participantAHash, d.participantBHash,
            d.betOpenTs, d.betCloseTs, d.duelStartTs, "", DuelOutcomeOracle.DuelStatus.LOCKED);
        vm.prank(reporter);
        oracle.proposeResult(duel, winner, 42, keccak256("r"), keccak256("h"),
            uint64(block.timestamp + 100), "");
        vm.warp(block.timestamp + 3_601);
        vm.prank(finalizer);
        oracle.finalizeResult(duel, "");
        clob.syncMarketFromOracle(duel, MK);
    }

    // ─── Test 1: FIFO matching with 50 orders ────────────────────────────

    function test_fifoMatchingOrder_50orders() public {
        bytes32 duel = _createMarket("fifo-50");
        uint128 perOrder = 1000; // 1000 wei per order (divisible by 1000)

        // 50 makers place SELL at price 600
        for (uint256 i = 0; i < 50; i++) {
            vm.prank(makers[i]);
            clob.placeOrder{value: _orderCost(SELL, 600, perOrder)}(
                duel, MK, SELL, 600, perOrder, GTC);
        }

        // Verify book state
        GoldClob.Market memory mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestAsk, 600, "bestAsk should be 600");
        assertEq(mkt.nextOrderId, 51, "50 orders placed + 1 base");

        // 1 large BUY crosses all 50
        uint128 totalAmount = 50 * perOrder;
        vm.deal(makers[50], 10000 ether);
        vm.prank(makers[50]);
        clob.placeOrder{value: _orderCost(BUY, 600, totalAmount)}(
            duel, MK, BUY, 600, totalAmount, GTC);

        // Verify: all makers got matched (each has aShares from selling)
        bytes32 key = clob.marketKey(duel, MK);
        for (uint256 i = 0; i < 50; i++) {
            (, uint128 bShares,,) = clob.positions(key, makers[i]);
            assertEq(bShares, perOrder, string.concat("maker ", vm.toString(i), " should have bShares"));
        }

        // Buyer has all aShares
        (uint128 buyerAShares,,,) = clob.positions(key, makers[50]);
        assertEq(buyerAShares, totalAmount, "buyer should have all aShares");
    }

    // ─── Test 2: Multi-price-level depth matching ────────────────────────

    function test_multiPriceLevel_depthMatching() public {
        bytes32 duel = _createMarket("depth-levels");
        uint128 perOrder = 1000;

        // Place asks at 5 price levels: 500, 510, 520, 530, 540
        uint16[5] memory prices = [uint16(500), 510, 520, 530, 540];
        for (uint256 p = 0; p < 5; p++) {
            for (uint256 i = 0; i < 10; i++) {
                uint256 idx = p * 10 + i;
                vm.prank(makers[idx]);
                clob.placeOrder{value: _orderCost(SELL, prices[p], perOrder)}(
                    duel, MK, SELL, prices[p], perOrder, GTC);
            }
        }

        // bestAsk should be 500 (lowest ask)
        GoldClob.Market memory mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestAsk, 500, "bestAsk should be lowest price 500");

        // Place large BUY at 540 — sweeps all 50 orders across 5 levels
        uint128 totalAmount = 50 * perOrder;
        vm.deal(makers[50], 100000 ether);
        vm.prank(makers[50]);
        clob.placeOrder{value: _orderCost(BUY, 540, totalAmount)}(
            duel, MK, BUY, 540, totalAmount, GTC);

        // bestAsk should now be MAX_PRICE (no asks left)
        mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestAsk, MAX_PRICE, "all asks consumed, bestAsk = MAX_PRICE");

        // All 50 sellers should have positions
        bytes32 key = clob.marketKey(duel, MK);
        for (uint256 i = 0; i < 50; i++) {
            (, uint128 bShares,,) = clob.positions(key, makers[i]);
            assertEq(bShares, perOrder, "each seller should have bShares");
        }
    }

    // ─── Test 3: Partial fill with resting remainder ─────────────────────

    function test_partialFill_restingRemainder() public {
        bytes32 duel = _createMarket("partial");
        bytes32 key = clob.marketKey(duel, MK);

        // Seller places 10000 at 600
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(SELL, 600, 10_000)}(
            duel, MK, SELL, 600, 10_000, GTC);

        // Buyer takes 3000 (partial fill)
        vm.prank(makers[1]);
        clob.placeOrder{value: _orderCost(BUY, 600, 3_000)}(
            duel, MK, BUY, 600, 3_000, GTC);

        // Seller should still have resting order
        GoldClob.Market memory mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestAsk, 600, "seller order still resting at 600");

        // Buyer takes remaining 7000
        vm.prank(makers[2]);
        clob.placeOrder{value: _orderCost(BUY, 600, 7_000)}(
            duel, MK, BUY, 600, 7_000, GTC);

        // Seller fully filled, bestAsk should move
        mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestAsk, MAX_PRICE, "seller fully consumed");

        // Verify positions
        (, uint128 sellerB,,) = clob.positions(key, makers[0]);
        assertEq(sellerB, 10_000, "seller has full bShares");

        (uint128 buyer1A,,,) = clob.positions(key, makers[1]);
        assertEq(buyer1A, 3_000, "first buyer has 3000 aShares");

        (uint128 buyer2A,,,) = clob.positions(key, makers[2]);
        assertEq(buyer2A, 7_000, "second buyer has 7000 aShares");
    }

    // ─── Test 4: Cancel order in middle of queue ─────────────────────────

    function test_cancelOrder_middleOfQueue() public {
        bytes32 duel = _createMarket("cancel-mid");
        uint128 amount = 1000;

        // Place 5 SELL orders at same price (A=1, B=2, C=3, D=4, E=5)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(makers[i]);
            clob.placeOrder{value: _orderCost(SELL, 600, amount)}(
                duel, MK, SELL, 600, amount, GTC);
        }

        // Cancel order C (id=3, the 3rd order)
        vm.prank(makers[2]); // maker of order 3
        clob.cancelOrder(duel, MK, 3);

        // Place large BUY to cross remaining 4 orders
        vm.prank(makers[5]);
        clob.placeOrder{value: _orderCost(BUY, 600, 4 * amount)}(
            duel, MK, BUY, 600, 4 * amount, GTC);

        // Verify: A, B, D, E got matched (not C)
        bytes32 key = clob.marketKey(duel, MK);
        for (uint256 i = 0; i < 5; i++) {
            (, uint128 bShares,,) = clob.positions(key, makers[i]);
            if (i == 2) {
                assertEq(bShares, 0, "cancelled maker C should have no position");
            } else {
                assertEq(bShares, amount, string.concat("maker ", vm.toString(i), " should be matched"));
            }
        }
    }

    // ─── Test 5: reclaimRestingOrder after market lock ───────────────────

    function test_reclaimRestingOrder_afterMarketLock() public {
        bytes32 duel = _createMarket("reclaim");

        // Place GTC order during OPEN
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(
            duel, MK, SELL, 600, 1000, GTC);

        uint256 balBefore = makers[0].balance;

        // Lock the market via oracle
        DuelOutcomeOracle.DuelState memory d = oracle.getDuel(duel);
        vm.warp(d.betCloseTs + 1);
        vm.prank(reporter);
        oracle.upsertDuel(duel, d.participantAHash, d.participantBHash,
            d.betOpenTs, d.betCloseTs, d.duelStartTs, "", DuelOutcomeOracle.DuelStatus.LOCKED);
        clob.syncMarketFromOracle(duel, MK);

        // cancelOrder should revert (market not OPEN)
        vm.prank(makers[0]);
        vm.expectRevert();
        clob.cancelOrder(duel, MK, 1);

        // reclaimRestingOrder should succeed
        vm.prank(makers[0]);
        clob.reclaimRestingOrder(duel, MK, 1);

        // Maker should get refund
        assertTrue(makers[0].balance > balBefore, "maker should receive refund");
    }

    // ─── Test 6: Self-trade prevention ───────────────────────────────────

    function test_selfTradePrevention() public {
        bytes32 duel = _createMarket("self-trade");
        bytes32 key = clob.marketKey(duel, MK);

        // Place SELL
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(
            duel, MK, SELL, 600, 1000, GTC);

        // Same maker places crossing BUY — should trigger self-trade prevention
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(BUY, 600, 1000)}(
            duel, MK, BUY, 600, 1000, GTC);

        // Self-trade should not create a fill — check positions
        (uint128 aShares, uint128 bShares,,) = clob.positions(key, makers[0]);
        // With GTC + self-trade: the buy order should rest at 600 without matching
        // The sell is still resting too
        assertEq(aShares, 0, "no fill from self-trade on buy side");
    }

    // ─── Test 7: POST_ONLY reverts when crossing ─────────────────────────

    function test_postOnlyReverts() public {
        bytes32 duel = _createMarket("post-only");

        // Place SELL at 600
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(
            duel, MK, SELL, 600, 1000, GTC);

        // POST_ONLY BUY at 600 should revert (would cross)
        vm.prank(makers[1]);
        vm.expectRevert(GoldClob.PostOnlyWouldCross.selector);
        clob.placeOrder{value: _orderCost(BUY, 600, 1000)}(
            duel, MK, BUY, 600, 1000, POST_ONLY);
    }

    // ─── Test 8: IOC cancels unfilled ────────────────────────────────────

    function test_iocCancelsUnfilled() public {
        bytes32 duel = _createMarket("ioc");

        uint256 balBefore = makers[0].balance;

        // IOC BUY at 400 — no sells exist, should not rest
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(BUY, 400, 1000)}(
            duel, MK, BUY, 400, 1000, IOC);

        // bestBid should still be 0 (IOC didn't rest)
        GoldClob.Market memory mkt = clob.getMarket(duel, MK);
        assertEq(mkt.bestBid, 0, "IOC should not rest in book");

        // Maker should get refund (minus gas at txGasPrice=0)
        assertEq(makers[0].balance, balBefore, "IOC should refund fully");
    }

    // ─── Test 9: Full settlement — 20 traders claim correctly ────────────

    function test_20traders_settlementCorrect() public {
        bytes32 duel = _createMarket("20-traders");
        bytes32 key = clob.marketKey(duel, MK);
        uint128 amount = 1000;

        uint256 totalDeposited;

        // 10 buyers at 600, 10 sellers at 600
        for (uint256 i = 0; i < 10; i++) {
            uint256 buyCost = _orderCost(BUY, 600, amount);
            vm.prank(makers[i]);
            clob.placeOrder{value: buyCost}(duel, MK, BUY, 600, amount, GTC);
            totalDeposited += buyCost;
        }
        for (uint256 i = 10; i < 20; i++) {
            uint256 sellCost = _orderCost(SELL, 600, amount);
            vm.prank(makers[i]);
            clob.placeOrder{value: sellCost}(duel, MK, SELL, 600, amount, GTC);
            totalDeposited += sellCost;
        }

        // Resolve: A wins
        _resolve(duel, DuelOutcomeOracle.Side.A);

        // All 20 traders claim
        uint256 totalPaidOut;
        for (uint256 i = 0; i < 20; i++) {
            uint256 balBefore = makers[i].balance;
            vm.prank(makers[i]);
            try clob.claim(duel, MK) {
                uint256 payout = makers[i].balance - balBefore;
                totalPaidOut += payout;
            } catch {}
        }

        // Contract should be nearly empty (only rounding dust)
        uint256 clobBalance = address(clob).balance;
        assertTrue(clobBalance < 100, "CLOB should be nearly empty after all claims");
    }

    // ─── Test 10: Gas measurement at scale ───────────────────────────────

    function test_gasAtScale_100orders() public {
        bytes32 duel = _createMarket("gas-scale");

        // Place 100 SELL orders across 20 prices (5 per price)
        for (uint256 i = 0; i < 100; i++) {
            uint256 idx = i % 60; // reuse maker addresses
            uint16 price = uint16(500 + (i / 5) * 10); // 500, 510, 520, ... 690
            vm.prank(makers[idx]);
            clob.placeOrder{value: _orderCost(SELL, price, 1000)}(
                duel, MK, SELL, price, 1000, GTC);
        }

        // Measure gas for placing 101st order
        uint256 gasBefore = gasleft();
        vm.prank(makers[0]);
        clob.placeOrder{value: _orderCost(BUY, 499, 1000)}(
            duel, MK, BUY, 499, 1000, GTC);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("Gas for placing order in 100-deep book:", gasUsed);
        assertTrue(gasUsed < 500_000, "place order gas should be under 500k");

        // Measure gas for crossing 10 price levels (50 orders at 5 prices)
        gasBefore = gasleft();
        vm.prank(makers[1]);
        clob.placeOrder{value: _orderCost(BUY, 540, 25_000)}(
            duel, MK, BUY, 540, 25_000, GTC);
        gasUsed = gasBefore - gasleft();
        console.log("Gas for crossing 25 orders across 5 levels:", gasUsed);
        assertTrue(gasUsed < 15_000_000, "cross gas should be under 15M (half block limit)");
    }
}
