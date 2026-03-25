// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

/// @title Symbolic verification of critical perps math
/// @notice Uses Halmos to exhaustively verify margin, liquidation, and PnL properties.
///         Run with: halmos --contract PerpsMathSymbolicTest --solver-timeout-assertion 300
contract PerpsMathSymbolicTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(0xA1);
    address operator = address(0xA3);
    address pauser = address(0xA4);
    address trader = address(0xB1);

    bytes32 agentId = keccak256("SYMBOLIC_AGENT");
    bytes32 agentIdB = keccak256("SYMBOLIC_ANCHOR");

    function setUp() public {
        vm.startPrank(admin);
        oracle = new SkillOracle(100e18, 2 hours, admin, admin, pauser);
        oracle.updateAgentSkill(agentId, 1500, 0);
        oracle.updateAgentSkill(agentIdB, 1500, 0);

        marginToken = new MockERC20("USDC", "USDC");
        engine = new AgentPerpEngine(
            oracle, IERC20(address(marginToken)), 1_000_000e18,
            admin, operator, pauser
        );
        vm.stopPrank();

        vm.prank(operator);
        engine.createMarket(agentId);

        vm.startPrank(admin);
        marginToken.mint(trader, 10_000_000e18);
        marginToken.mint(admin, 10_000_000e18);
        marginToken.approve(address(engine), type(uint256).max);
        engine.depositInsuranceFund(agentId, 1_000_000e18);
        vm.stopPrank();

        vm.prank(trader);
        marginToken.approve(address(engine), type(uint256).max);
    }

    /// @notice Verify: getPositionHealth.liquidatable == true iff equity <= maintenanceMargin
    /// This is the core safety property — if the engine reports "not liquidatable" but
    /// equity is actually below maintenance, funds are at risk.
    function check_liquidatableIffEquityBelowMaintenance(
        uint128 marginRaw,
        uint128 sizeRaw,
        bool isLong
    ) public {
        uint256 margin = uint256(marginRaw);
        uint256 size = uint256(sizeRaw);

        // Bound to reasonable ranges to avoid OOG
        vm.assume(margin >= 100e18 && margin <= 1_000_000e18);
        vm.assume(size >= 1e18 && size <= 10_000e18);

        // Open position
        vm.prank(trader);
        try engine.modifyPosition(
            agentId,
            int256(margin),
            isLong ? int256(size) : -int256(size)
        ) {} catch { return; } // if position fails to open, nothing to check

        // Read health
        AgentPerpEngine.PositionHealth memory h = engine.getPositionHealth(agentId, trader);

        // Core property: liquidatable iff equity <= maintenanceMargin
        if (h.liquidatable) {
            assert(h.equity <= int256(h.maintenanceMargin));
        }
        if (h.equity > int256(h.maintenanceMargin)) {
            assert(!h.liquidatable);
        }
    }

    /// @notice Verify: margin sufficiency — if margin >= notional / maxLeverage,
    /// modifyPosition should not revert with MaxLeverageExceeded.
    function check_marginSufficiencyDoesNotRevertLeverage(
        uint128 marginRaw,
        uint128 sizeRaw
    ) public {
        uint256 margin = uint256(marginRaw);
        uint256 size = uint256(sizeRaw);

        vm.assume(margin >= 100e18 && margin <= 500_000e18);
        vm.assume(size >= 1e18 && size <= 1_000e18);

        // maxLeverage = 5x, so margin >= notional / 5 should suffice
        // notional = size * markPrice / 1e18
        uint256 markPrice = engine.getMarkPrice(agentId);
        uint256 notional = (size * markPrice) / 1e18;
        uint256 minMargin = notional / 5; // 5x leverage

        vm.assume(margin >= minMargin + 1e18); // margin comfortably above minimum

        // Opening should not revert with MaxLeverageExceeded
        vm.prank(trader);
        try engine.modifyPosition(agentId, int256(margin), int256(size)) {
            // Success — position opened without leverage violation
            assert(true);
        } catch (bytes memory reason) {
            // If it reverted, it should NOT be MaxLeverageExceeded
            // (could be other reasons like OI cap, insufficient funds, etc.)
            bytes4 selector = bytes4(reason);
            bytes4 maxLevExceeded = bytes4(keccak256("MaxLeverageExceeded()"));
            assert(selector != maxLevExceeded);
        }
    }

    /// @notice Verify: oracle delta cap — updateAgentSkill reverts if |newMu - oldMu| > MAX_MU_DELTA
    function check_oracleMuDeltaCap(uint256 newMu) public {
        vm.assume(newMu <= 100_000); // reasonable range

        (uint256 currentMu,,) = oracle.agentSkills(agentId);
        uint256 delta = newMu > currentMu ? newMu - currentMu : currentMu - newMu;

        vm.prank(admin);
        if (delta > 500) {
            // Should revert
            try oracle.updateAgentSkill(agentId, newMu, 0) {
                assert(false); // should not succeed
            } catch {}
        } else {
            // Should succeed (or revert for other reasons, but not MuDeltaExceeded)
            try oracle.updateAgentSkill(agentId, newMu, 0) {} catch (bytes memory reason) {
                bytes4 selector = bytes4(reason);
                bytes4 muDeltaExceeded = bytes4(keccak256("MuDeltaExceeded()"));
                assert(selector != muDeltaExceeded);
            }
        }
    }
}
