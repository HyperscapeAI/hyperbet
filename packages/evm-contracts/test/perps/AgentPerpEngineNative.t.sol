// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/AgentPerpEngineNative.sol";
import "../../contracts/perps/SkillOracle.sol";

contract AgentPerpEngineNativeTest is Test {
    SkillOracle oracle;
    AgentPerpEngineNative engine;

    address admin = address(1);
    address operator = address(6);
    address pauser = address(7);
    address alice = address(2);
    address bob = address(3);

    bytes32 agentId = keccak256("MODEL_A");

    function setUp() public {
        oracle = new SkillOracle(100 ether, 2 minutes, admin, admin, pauser);
        engine = new AgentPerpEngineNative(oracle, 1_000_000 ether, admin, operator, pauser);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(admin, 1_000 ether);

        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1500, 0);

        vm.prank(operator);
        engine.createMarket(agentId);
    }

    function testNativeLiquidationRecordsBadDebtAfterMarginAndInsuranceAreConsumed() public {
        vm.prank(admin);
        engine.depositInsuranceFund{value: 50 ether}(agentId);

        vm.prank(alice);
        engine.modifyPosition{value: 200 ether}(agentId, 5 ether);

        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1500, 100);

        vm.prank(bob);
        engine.liquidate(agentId, alice);

        (int256 size, uint256 margin,,) = engine.positions(agentId, alice);
        (,,,,,,, uint256 insuranceFund, uint256 badDebt,,,,,) = engine.markets(agentId);

        assertEq(size, 0, "liquidation should close insolvent position");
        assertEq(margin, 0, "realized loss should consume trader margin");
        assertEq(insuranceFund, 0, "insurance should be consumed before bad debt");
        assertGt(badDebt, 40 ether, "residual realized loss should be recorded as bad debt");
    }

    function testNativeLiquidationDoesNotCreditConsumedLossMarginToInsurance() public {
        vm.prank(alice);
        engine.modifyPosition{value: 200 ether}(agentId, 5 ether);

        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1500, 100);

        vm.prank(bob);
        engine.liquidate(agentId, alice);

        (,,,,,,, uint256 insuranceFund, uint256 badDebt,,,,,) = engine.markets(agentId);

        assertEq(insuranceFund, 0, "loss-absorbing margin must not become withdrawable insurance");
        assertGt(badDebt, 90 ether, "loss beyond margin should be visible as bad debt");
    }
}
