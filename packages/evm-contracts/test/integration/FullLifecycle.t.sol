// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DuelOutcomeOracle} from "../../contracts/DuelOutcomeOracle.sol";
import {GoldClob} from "../../contracts/GoldClob.sol";
import {SkillOracle} from "../../contracts/perps/SkillOracle.sol";
import {AgentPerpEngine} from "../../contracts/perps/AgentPerpEngine.sol";
import {MockERC20} from "../../contracts/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Cross-contract integration tests — full duel lifecycle
contract FullLifecycleTest is Test {
    uint8 constant MK = 0;
    uint8 constant BUY = 1;
    uint8 constant SELL = 2;
    uint8 constant GTC = 0x01;
    uint16 constant MAX_PRICE = 1000;

    address admin = address(0xA1);
    address reporter = address(0xA2);
    address operator = address(0xA3);
    address finalizer = address(0xA4);
    address pauser = address(0xA5);
    address treasury = address(0xA6);
    address mmAddr = address(0xA7);

    DuelOutcomeOracle duelOracle;
    GoldClob clob;
    SkillOracle skillOracle;
    AgentPerpEngine perpEngine;
    MockERC20 marginToken;

    bytes32 perpAgentA = keccak256("AGENT_A");
    bytes32 perpAgentB = keccak256("AGENT_B");

    // 20 trader addresses
    address[20] traders;

    function setUp() public {
        vm.txGasPrice(0);
        vm.warp(10_000);

        // Deploy all contracts
        duelOracle = new DuelOutcomeOracle(admin, reporter, finalizer, reporter, pauser, 3600);
        vm.prank(admin);
        clob = new GoldClob(admin, operator, address(duelOracle), treasury, mmAddr, pauser);

        vm.startPrank(admin);
        skillOracle = new SkillOracle(100e18, 2 hours, admin, admin, pauser);
        skillOracle.updateAgentSkill(perpAgentA, 1500, 0);
        skillOracle.updateAgentSkill(perpAgentB, 1500, 0);

        marginToken = new MockERC20("USDC", "USDC");
        perpEngine = new AgentPerpEngine(
            skillOracle, IERC20(address(marginToken)), 1_000_000e18,
            admin, operator, pauser
        );
        vm.stopPrank();

        vm.prank(operator);
        perpEngine.createMarket(perpAgentA);

        // Fund traders
        for (uint256 i = 0; i < 20; i++) {
            traders[i] = address(uint160(0xD000 + i));
            vm.deal(traders[i], 1000 ether);
            vm.startPrank(admin);
            marginToken.mint(traders[i], 1_000_000e18);
            vm.stopPrank();
            vm.prank(traders[i]);
            marginToken.approve(address(perpEngine), type(uint256).max);
        }

        // Fund admin for insurance
        vm.startPrank(admin);
        marginToken.mint(admin, 10_000_000e18);
        marginToken.approve(address(perpEngine), type(uint256).max);
        perpEngine.depositInsuranceFund(perpAgentA, 100_000e18);
        vm.stopPrank();
    }

    function _orderCost(uint8 side, uint16 price, uint128 amount) private pure returns (uint256) {
        uint256 priceComp = side == BUY ? price : MAX_PRICE - price;
        uint256 cost = (uint256(amount) * priceComp) / MAX_PRICE;
        uint256 fee = (cost * 100) / 10_000 + (cost * 100) / 10_000;
        return cost + fee;
    }

    // ─── Test 1: Full duel lifecycle — CLOB + Perps ──────────────────────

    function test_fullDuelLifecycle_clobAndPerps() public {
        // 1. Create duel
        bytes32 duel = keccak256("lifecycle-duel");
        vm.prank(reporter);
        duelOracle.upsertDuel(duel, keccak256("a"), keccak256("b"),
            uint64(block.timestamp), uint64(block.timestamp + 3600),
            uint64(block.timestamp + 7200), "lifecycle",
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN);

        // 2. Create CLOB market
        vm.prank(operator);
        clob.createMarketForDuel(duel, MK);
        bytes32 key = clob.marketKey(duel, MK);

        // 3. 5 users place CLOB orders (mix of buy/sell)
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(traders[i]);
            clob.placeOrder{value: _orderCost(BUY, 600, 1000)}(duel, MK, BUY, 600, 1000, GTC);
        }
        for (uint256 i = 3; i < 5; i++) {
            vm.prank(traders[i]);
            clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(duel, MK, SELL, 600, 1000, GTC);
        }

        // 4. 2 users open perps positions
        vm.prank(traders[5]);
        perpEngine.modifyPosition(perpAgentA, int256(200e18), int256(5e18));
        vm.prank(traders[6]);
        perpEngine.modifyPosition(perpAgentA, int256(200e18), int256(-5e18));

        // 5. Warp past betClose
        DuelOutcomeOracle.DuelState memory d = duelOracle.getDuel(duel);
        vm.warp(d.betCloseTs + 1);

        // 6. Lock, propose, finalize
        vm.prank(reporter);
        duelOracle.upsertDuel(duel, d.participantAHash, d.participantBHash,
            d.betOpenTs, d.betCloseTs, d.duelStartTs, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);

        vm.prank(reporter);
        duelOracle.proposeResult(duel, DuelOutcomeOracle.Side.A, 42,
            keccak256("r"), keccak256("h"), uint64(block.timestamp + 100), "");

        vm.warp(block.timestamp + 3601);
        vm.prank(finalizer);
        duelOracle.finalizeResult(duel, "");

        // 7. Sync CLOB market
        GoldClob.MarketStatus status = clob.syncMarketFromOracle(duel, MK);
        assertTrue(uint8(status) == 3, "market should be RESOLVED"); // RESOLVED=3

        // 8. All CLOB users claim
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(traders[i]);
            try clob.claim(duel, MK) {} catch {}
        }

        // 9. Update skill oracle, sync perps
        vm.prank(admin);
        skillOracle.updateAgentSkill(perpAgentA, 1800, 0);
        perpEngine.syncOracle(perpAgentA);

        // 10. Close perps positions
        for (uint256 i = 5; i <= 6; i++) {
            (int256 size,,,) = perpEngine.positions(perpAgentA, traders[i]);
            if (size != 0) {
                vm.prank(traders[i]);
                try perpEngine.modifyPosition(perpAgentA, 0, -size) {} catch {}
            }
        }

        // Reclaim any resting orders (unfilled ones leave ETH in contract)
        for (uint256 i = 0; i < 5; i++) {
            for (uint64 oid = 1; oid <= 10; oid++) {
                vm.prank(traders[i]);
                try clob.reclaimRestingOrder(duel, MK, oid) {} catch {}
            }
        }

        // 11. Assert: CLOB contract nearly empty
        uint256 clobBal = address(clob).balance;
        assertTrue(clobBal < 100, "CLOB should be nearly empty after all claims");

        // Perps balance sheet holds
        (,,,,,,,,uint256 vault, uint256 ins,,,uint256 tf, uint256 mf,,) = perpEngine.markets(perpAgentA);
        uint256 totalMargins;
        for (uint256 i = 5; i <= 6; i++) {
            (, uint256 m,,) = perpEngine.positions(perpAgentA, traders[i]);
            totalMargins += m;
        }
        assertEq(marginToken.balanceOf(address(perpEngine)), totalMargins + ins + vault + tf + mf,
            "perps balance sheet must hold");
    }

    // ─── Test 2: Cancelled duel — full refund ────────────────────────────

    function test_cancelledDuel_fullRefund() public {
        bytes32 duel = keccak256("cancel-duel");
        vm.prank(reporter);
        duelOracle.upsertDuel(duel, keccak256("a"), keccak256("b"),
            uint64(block.timestamp), uint64(block.timestamp + 3600),
            uint64(block.timestamp + 7200), "",
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN);
        vm.prank(operator);
        clob.createMarketForDuel(duel, MK);

        // Place matching orders
        vm.prank(traders[0]);
        clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(duel, MK, SELL, 600, 1000, GTC);
        vm.prank(traders[1]);
        clob.placeOrder{value: _orderCost(BUY, 600, 1000)}(duel, MK, BUY, 600, 1000, GTC);

        uint256 bal0Before = traders[0].balance;
        uint256 bal1Before = traders[1].balance;

        // Cancel duel via PAUSER_ROLE (cancelDuel, not upsertDuel)
        vm.prank(pauser);
        duelOracle.cancelDuel(duel, "cancelled");
        clob.syncMarketFromOracle(duel, MK);

        // Both claim (cancelled = full refund of stakes)
        vm.prank(traders[0]);
        clob.claim(duel, MK);
        vm.prank(traders[1]);
        clob.claim(duel, MK);

        // Both should receive their stakes back
        assertTrue(traders[0].balance > bal0Before, "seller should be refunded");
        assertTrue(traders[1].balance > bal1Before, "buyer should be refunded");

        // Contract should be empty
        assertEq(address(clob).balance, 0, "CLOB empty after cancelled refunds");
    }

    // ─── Test 3: Multi-market isolation ──────────────────────────────────

    function test_multiMarket_isolation() public {
        bytes32[5] memory duels;
        for (uint256 i = 0; i < 5; i++) {
            duels[i] = keccak256(abi.encodePacked("multi-", i));
            vm.prank(reporter);
            duelOracle.upsertDuel(duels[i], keccak256("a"), keccak256("b"),
                uint64(block.timestamp), uint64(block.timestamp + 3600),
                uint64(block.timestamp + 7200),
                string.concat("multi-", vm.toString(i)),
                DuelOutcomeOracle.DuelStatus.BETTING_OPEN);
            vm.prank(operator);
            clob.createMarketForDuel(duels[i], MK);
        }

        // Place orders in all 5 markets
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(traders[i * 2]);
            clob.placeOrder{value: _orderCost(SELL, 600, 1000)}(duels[i], MK, SELL, 600, 1000, GTC);
            vm.prank(traders[i * 2 + 1]);
            clob.placeOrder{value: _orderCost(BUY, 600, 1000)}(duels[i], MK, BUY, 600, 1000, GTC);
        }

        // Resolve duels 0, 2, 4 (A wins). Cancel duels 1, 3.
        for (uint256 i = 0; i < 5; i++) {
            DuelOutcomeOracle.DuelState memory d = duelOracle.getDuel(duels[i]);
            vm.warp(d.betCloseTs + 1);

            if (i % 2 == 0) {
                // Resolve A wins
                vm.prank(reporter);
                duelOracle.upsertDuel(duels[i], d.participantAHash, d.participantBHash,
                    d.betOpenTs, d.betCloseTs, d.duelStartTs, "",
                    DuelOutcomeOracle.DuelStatus.LOCKED);
                vm.prank(reporter);
                duelOracle.proposeResult(duels[i], DuelOutcomeOracle.Side.A, 42,
                    keccak256(abi.encodePacked("r", i)), keccak256(abi.encodePacked("h", i)),
                    uint64(block.timestamp + 100), "");
                vm.warp(block.timestamp + 3601);
                vm.prank(finalizer);
                duelOracle.finalizeResult(duels[i], "");
            } else {
                // Cancel via PAUSER_ROLE
                vm.prank(pauser);
                duelOracle.cancelDuel(duels[i], "cancelled");
            }
            clob.syncMarketFromOracle(duels[i], MK);
        }

        // Claim in all 5 markets
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(traders[i * 2]);
            try clob.claim(duels[i], MK) {} catch {}
            vm.prank(traders[i * 2 + 1]);
            try clob.claim(duels[i], MK) {} catch {}
        }

        // Each market should have independent accounting
        // Verify CLOB is nearly empty (all claimed)
        assertTrue(address(clob).balance < 500, "CLOB should be nearly empty after 5 market claims");
    }

    // ─── Test 4: 20 concurrent traders ───────────────────────────────────

    function test_concurrentUsers_20traders() public {
        bytes32 duel = keccak256("20-users");
        vm.prank(reporter);
        duelOracle.upsertDuel(duel, keccak256("a"), keccak256("b"),
            uint64(block.timestamp), uint64(block.timestamp + 3600),
            uint64(block.timestamp + 7200), "",
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN);
        vm.prank(operator);
        clob.createMarketForDuel(duel, MK);

        // 10 buyers at various prices, 10 sellers at various prices
        for (uint256 i = 0; i < 10; i++) {
            uint16 price = uint16(500 + i * 20); // 500, 520, 540, ..., 680
            vm.prank(traders[i]);
            clob.placeOrder{value: _orderCost(BUY, price, 1000)}(duel, MK, BUY, price, 1000, GTC);
        }
        for (uint256 i = 10; i < 20; i++) {
            uint16 price = uint16(500 + (i - 10) * 20); // 500, 520, ..., 680
            vm.prank(traders[i]);
            clob.placeOrder{value: _orderCost(SELL, price, 1000)}(duel, MK, SELL, price, 1000, GTC);
        }

        // Resolve: A wins
        DuelOutcomeOracle.DuelState memory d = duelOracle.getDuel(duel);
        vm.warp(d.betCloseTs + 1);
        vm.prank(reporter);
        duelOracle.upsertDuel(duel, d.participantAHash, d.participantBHash,
            d.betOpenTs, d.betCloseTs, d.duelStartTs, "",
            DuelOutcomeOracle.DuelStatus.LOCKED);
        vm.prank(reporter);
        duelOracle.proposeResult(duel, DuelOutcomeOracle.Side.A, 42,
            keccak256("r"), keccak256("h"), uint64(block.timestamp + 100), "");
        vm.warp(block.timestamp + 3601);
        vm.prank(finalizer);
        duelOracle.finalizeResult(duel, "");
        clob.syncMarketFromOracle(duel, MK);

        // All 20 claim
        uint256 totalClaimed;
        for (uint256 i = 0; i < 20; i++) {
            uint256 before = traders[i].balance;
            vm.prank(traders[i]);
            try clob.claim(duel, MK) {
                totalClaimed += traders[i].balance - before;
            } catch {}
        }

        // Also reclaim resting orders (some may not have matched)
        for (uint256 i = 0; i < 20; i++) {
            uint64 orderId = uint64(i + 1);
            vm.prank(traders[i]);
            try clob.reclaimRestingOrder(duel, MK, orderId) {} catch {}
        }

        // Contract should be nearly empty
        assertTrue(address(clob).balance < 500, "CLOB nearly empty after 20-user settlement");
    }
}
