// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

contract AgentPerpEngineFuzzTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(1);
    address operator = address(6);
    address pauser = address(7);
    address alice = address(2);
    address bob = address(3);
    address carol = address(4);
    address liquidator = address(5);

    bytes32 agentId = keccak256("MODEL_A");

    function setUp() public {
        vm.startPrank(admin);
        oracle = new SkillOracle(100 * 1e18, 2 hours, admin, admin, pauser);
        marginToken = new MockERC20("USDC", "USDC");
        engine = new AgentPerpEngine(oracle, IERC20(address(marginToken)), 1_000_000 * 1e18, admin, operator, pauser);

        oracle.updateAgentSkill(agentId, 1500, 0);
        vm.stopPrank();

        vm.prank(operator);
        engine.createMarket(agentId);

        address[4] memory funded = [alice, bob, carol, liquidator];
        for (uint256 i = 0; i < funded.length; i++) {
            vm.startPrank(admin);
            marginToken.mint(funded[i], 1_000_000 * 1e18);
            vm.stopPrank();

            vm.prank(funded[i]);
            marginToken.approve(address(engine), type(uint256).max);
        }

        vm.startPrank(admin);
        marginToken.mint(admin, 1_000_000 * 1e18);
        marginToken.approve(address(engine), type(uint256).max);
        engine.depositInsuranceFund(agentId, 100_000 * 1e18);
        vm.stopPrank();
    }

    function testFuzz_BalanceSheetRemainsExplicit(
        uint96 aliceMarginRaw,
        uint96 bobMarginRaw,
        uint96 aliceSizeRaw,
        uint96 bobSizeRaw,
        uint256 updatedMu,
        bool aliceLong,
        bool bobLong
    ) public {
        uint256 aliceMargin = bound(uint256(aliceMarginRaw), 1_000e18, 100_000e18);
        uint256 bobMargin = bound(uint256(bobMarginRaw), 1_000e18, 100_000e18);
        uint256 aliceSize = bound(uint256(aliceSizeRaw), 1e18, 2_000e18);
        uint256 bobSize = bound(uint256(bobSizeRaw), 1e18, 2_000e18);
        updatedMu = bound(updatedMu, 1000, 2000); // within delta caps of 1500

        vm.prank(alice);
        try engine.modifyPosition(
            agentId,
            int256(aliceMargin),
            aliceLong ? int256(aliceSize) : -int256(aliceSize)
        ) {} catch {}

        vm.prank(bob);
        try engine.modifyPosition(
            agentId,
            int256(bobMargin),
            bobLong ? int256(bobSize) : -int256(bobSize)
        ) {} catch {}

        vm.warp(block.timestamp + 1 hours);

        vm.prank(admin);
        try oracle.updateAgentSkill(agentId, updatedMu, 0) {} catch {}

        vm.prank(alice);
        try engine.modifyPosition(
            agentId,
            0,
            aliceLong ? -int256(aliceSize / 2) : int256(aliceSize / 2)
        ) {} catch {}

        vm.prank(bob);
        try engine.modifyPosition(
            agentId,
            0,
            bobLong ? -int256(bobSize / 2) : int256(bobSize / 2)
        ) {} catch {}

        _assertBalanceSheet();
    }

    function testFuzz_LiquidationKeepsBadDebtExplicit(
        uint96 marginRaw,
        uint96 insuranceRaw,
        uint256 entryMu,
        uint256 crashMu
    ) public {
        uint256 traderMargin = bound(uint256(marginRaw), 5e18, 1_000e18);
        uint256 insuranceTopUp = bound(uint256(insuranceRaw), 0, 1_000e18);
        entryMu = bound(entryMu, 1_400, 2_000);
        crashMu = bound(crashMu, 1000, entryMu); // within delta caps

        vm.startPrank(admin);
        try oracle.updateAgentSkill(agentId, entryMu, 0) {} catch {}
        if (insuranceTopUp > 0) {
            engine.depositInsuranceFund(agentId, insuranceTopUp);
        }
        vm.stopPrank();

        vm.prank(carol);
        try engine.modifyPosition(agentId, int256(traderMargin), int256(5e18)) {} catch {
            _assertBalanceSheet();
            return;
        }

        vm.warp(block.timestamp + 1 hours);
        vm.prank(admin);
        try oracle.updateAgentSkill(agentId, crashMu, 0) {} catch {}

        vm.prank(liquidator);
        try engine.liquidate(agentId, carol) {} catch {}

        _assertBalanceSheet();
    }

    function _sumTrackedMargins() internal view returns (uint256 totalMargins) {
        address[4] memory tracked = [alice, bob, carol, liquidator];
        for (uint256 i = 0; i < tracked.length; i++) {
            (, uint256 margin,,) = engine.positions(agentId, tracked[i]);
            totalMargins += margin;
        }
    }

    function _assertBalanceSheet() internal view {
        (,,,,,,,, uint256 vaultBalance, uint256 insuranceFund,,,uint256 treasuryFees, uint256 mmFees,) = engine.markets(agentId);
        uint256 expectedBalance = _sumTrackedMargins() + insuranceFund + vaultBalance + treasuryFees + mmFees;
        assertEq(
            marginToken.balanceOf(address(engine)),
            expectedBalance,
            "engine balance must equal tracked trader margin plus reserves plus fees"
        );
    }
}
