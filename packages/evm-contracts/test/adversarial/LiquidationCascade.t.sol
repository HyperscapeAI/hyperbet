// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

/// @title Liquidation cascade stress test
/// @notice Tests the Hyperliquid failure mode: many positions become liquidatable
///         simultaneously after an oracle crash. Verifies orderly processing,
///         insurance fund accounting, and bad debt handling.
contract LiquidationCascadeTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(0xA1);
    address operator = address(0xA3);
    address pauser = address(0xA4);
    address liquidatorBot = address(0xF1);

    bytes32 agentId = keccak256("CASCADE_AGENT");
    bytes32 agentIdAnchor = keccak256("ANCHOR_AGENT"); // anchors globalMeanMu

    uint256 constant NUM_TRADERS = 10;
    address[10] traders;

    function setUp() public {
        // Generate trader addresses
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            traders[i] = address(uint160(0xD000 + i));
        }

        vm.startPrank(admin);

        oracle = new SkillOracle(100e18, 2 hours, admin, admin, pauser);
        oracle.updateAgentSkill(agentId, 1500, 0);
        oracle.updateAgentSkill(agentIdAnchor, 1500, 0); // anchor globalMeanMu

        marginToken = new MockERC20("USDC", "USDC");

        engine = new AgentPerpEngine(
            oracle, IERC20(address(marginToken)), 1_000_000e18,
            admin, operator, pauser
        );

        vm.stopPrank();

        vm.prank(operator);
        engine.createMarket(agentId);

        // Fund all traders and approve
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            vm.startPrank(admin);
            marginToken.mint(traders[i], 500e18);
            vm.stopPrank();
            vm.prank(traders[i]);
            marginToken.approve(address(engine), type(uint256).max);
        }

        // Fund admin for insurance
        vm.startPrank(admin);
        marginToken.mint(admin, 1_000_000e18);
        marginToken.approve(address(engine), type(uint256).max);
        vm.stopPrank();

        // Fund liquidator
        vm.startPrank(admin);
        marginToken.mint(liquidatorBot, 100e18);
        vm.stopPrank();
        vm.prank(liquidatorBot);
        marginToken.approve(address(engine), type(uint256).max);
    }

    /// @notice 10 traders open near-max-leverage longs, oracle crashes, all liquidated orderly
    function test_liquidationCascade_allPositionsProcessed() public {
        // Seed insurance fund (enough to cover some losses, not all)
        vm.prank(admin);
        engine.depositInsuranceFund(agentId, 500e18);

        // All 10 traders open long positions at near-max leverage
        // Mark price ~100e18, size 5e18, notional = ~500e18
        // Margin 110e18 gives ~4.5x leverage (max is 5x)
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            vm.prank(traders[i]);
            engine.modifyPosition(agentId, int256(110e18), int256(5e18));
        }

        // Verify all positions open
        (,,,,,,,,,,,,,,uint256 openBefore,) = engine.markets(agentId);
        assertEq(openBefore, NUM_TRADERS, "All positions should be open");

        // Record insurance fund before crash
        (,,,,,,,, uint256 vaultBefore, uint256 insuranceBefore,,,,,, ) = engine.markets(agentId);

        // Oracle crash: mu 1500 -> 1000 (max delta 500)
        // With anchor at 1500, globalMeanMu = (1000+1500)/2 = 1250
        // conservativeSkill = 1000 - 0 = 1000
        // price = 100e18 * (1 - (1250-1000)/500) = 100e18 * 0.5 = 50e18
        // PnL per position = (50 - 100) * 5 = -250e18
        // With 110e18 margin, equity = 110 - 250 = -140e18 -> deeply underwater
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1000, 0);
        engine.syncOracle(agentId);

        // Verify all positions are liquidatable
        uint256 liquidatableCount = 0;
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            AgentPerpEngine.PositionHealth memory h = engine.getPositionHealth(agentId, traders[i]);
            if (h.liquidatable) liquidatableCount++;
        }
        assertEq(liquidatableCount, NUM_TRADERS, "All positions should be liquidatable");

        // Liquidator processes all positions (cascade)
        uint256 liquidated = 0;
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            vm.prank(liquidatorBot);
            try engine.liquidate(agentId, traders[i]) {
                liquidated++;
            } catch {}
        }

        // All positions should have been processed
        assertEq(liquidated, NUM_TRADERS, "All positions should be liquidated");

        // Verify market state after cascade
        (
            uint256 totalLongOI,,,,,,,,,
            uint256 insuranceAfter,
            uint256 badDebt,,,,
            uint256 openAfter,
        ) = engine.markets(agentId);

        // No open positions remaining
        assertEq(openAfter, 0, "No positions should remain open");
        assertEq(totalLongOI, 0, "Long OI should be zero");

        // Balance sheet must still balance
        uint256 totalTraderMargins;
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            (, uint256 m,,) = engine.positions(agentId, traders[i]);
            totalTraderMargins += m;
        }
        // All margins should be zero (positions fully closed)
        assertEq(totalTraderMargins, 0, "All trader margins should be zero");

        // Insurance fund should have absorbed losses (may be depleted)
        // or bad debt should be recorded
        assertTrue(
            insuranceAfter < insuranceBefore || badDebt > 0,
            "Insurance should decrease or bad debt should appear"
        );

        // Token balance consistency: engine holds exactly what's accounted for
        (,,,,,,,,uint256 vaultAfter2, uint256 insAfter2,,,uint256 treasuryFees, uint256 mmFees,,) = engine.markets(agentId);
        uint256 expectedBalance = totalTraderMargins + insAfter2 + vaultAfter2 + treasuryFees + mmFees;
        assertEq(
            marginToken.balanceOf(address(engine)),
            expectedBalance,
            "Balance sheet must balance after cascade"
        );
    }

    /// @notice Cascade with insufficient insurance fund creates bad debt
    function test_liquidationCascade_insuranceDepletedBadDebt() public {
        // Minimal insurance fund (1 token)
        vm.prank(admin);
        engine.depositInsuranceFund(agentId, 1e18);

        // 10 traders open leveraged longs
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            vm.prank(traders[i]);
            engine.modifyPosition(agentId, int256(110e18), int256(5e18));
        }

        // Oracle crash
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1000, 0);
        engine.syncOracle(agentId);

        // Liquidate all
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            vm.prank(liquidatorBot);
            try engine.liquidate(agentId, traders[i]) {} catch {}
        }

        // Bad debt should be recorded (insurance was insufficient for 10 positions)
        (,,,,,,,,, uint256 insuranceAfter, uint256 badDebt,,,,,) = engine.markets(agentId);
        assertTrue(badDebt > 0, "Bad debt should be recorded when insurance insufficient");
        assertEq(insuranceAfter, 0, "Insurance should be fully depleted");
    }

    /// @notice Cascade doesn't affect well-collateralized positions
    function test_liquidationCascade_wellCollateralizedSurvive() public {
        vm.prank(admin);
        engine.depositInsuranceFund(agentId, 10_000e18);

        // 9 traders open near-max leverage (will be liquidated)
        for (uint256 i = 0; i < NUM_TRADERS - 1; i++) {
            vm.prank(traders[i]);
            engine.modifyPosition(agentId, int256(110e18), int256(5e18));
        }

        // Last trader opens well-collateralized position (will survive)
        vm.prank(traders[NUM_TRADERS - 1]);
        engine.modifyPosition(agentId, int256(400e18), int256(5e18));

        // Oracle crash
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1000, 0);
        engine.syncOracle(agentId);

        // Verify last trader is NOT liquidatable
        AgentPerpEngine.PositionHealth memory h = engine.getPositionHealth(agentId, traders[NUM_TRADERS - 1]);
        assertFalse(h.liquidatable, "Well-collateralized position should survive");

        // Liquidate only the liquidatable positions
        for (uint256 i = 0; i < NUM_TRADERS - 1; i++) {
            vm.prank(liquidatorBot);
            try engine.liquidate(agentId, traders[i]) {} catch {}
        }

        // Last trader's position should still be open
        (int256 survivorSize,,,) = engine.positions(agentId, traders[NUM_TRADERS - 1]);
        assertGt(survivorSize, 0, "Survivor position should remain open");

        // Attempting to liquidate survivor should revert
        vm.prank(liquidatorBot);
        vm.expectRevert();
        engine.liquidate(agentId, traders[NUM_TRADERS - 1]);
    }

    /// @notice Fuzz: random number of positions, random margins, oracle crash
    function testFuzz_liquidationCascade(
        uint8 numPositions,
        uint96 marginRaw,
        uint256 crashMu
    ) public {
        uint256 n = bound(uint256(numPositions), 1, NUM_TRADERS);
        uint256 margin = bound(uint256(marginRaw), 110e18, 400e18);
        crashMu = bound(crashMu, 1000, 1400);

        vm.prank(admin);
        engine.depositInsuranceFund(agentId, 100_000e18);

        // Open positions
        for (uint256 i = 0; i < n; i++) {
            vm.startPrank(admin);
            marginToken.mint(traders[i], margin);
            vm.stopPrank();
            vm.prank(traders[i]);
            marginToken.approve(address(engine), type(uint256).max);
            vm.prank(traders[i]);
            try engine.modifyPosition(agentId, int256(margin), int256(5e18)) {} catch { continue; }
        }

        // Crash oracle
        vm.prank(admin);
        try oracle.updateAgentSkill(agentId, crashMu, 0) {} catch { return; }
        try engine.syncOracle(agentId) {} catch { return; }

        // Liquidate everything possible
        for (uint256 i = 0; i < n; i++) {
            vm.prank(liquidatorBot);
            try engine.liquidate(agentId, traders[i]) {} catch {}
        }

        // Balance sheet invariant must hold after any cascade
        uint256 totalMargins;
        for (uint256 i = 0; i < NUM_TRADERS; i++) {
            (, uint256 m,,) = engine.positions(agentId, traders[i]);
            totalMargins += m;
        }
        (,,,,,,,, uint256 vault, uint256 ins,,,uint256 tf, uint256 mf,,) = engine.markets(agentId);
        assertEq(
            marginToken.balanceOf(address(engine)),
            totalMargins + ins + vault + tf + mf,
            "Balance sheet must hold after fuzzed cascade"
        );
    }
}
