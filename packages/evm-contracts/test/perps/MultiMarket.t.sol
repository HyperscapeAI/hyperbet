// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

/// @title Multi-market isolation tests — verify markets don't share state
contract MultiMarketTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(1);
    address operator = address(6);
    address pauser = address(7);
    address alice = address(2);
    address bob = address(3);
    address liquidator_ = address(5);

    bytes32 agentA = keccak256("AGENT_A");
    bytes32 agentB = keccak256("AGENT_B");
    bytes32 anchor = keccak256("ANCHOR");

    function setUp() public {
        vm.startPrank(admin);
        oracle = new SkillOracle(100e18, 2 hours, admin, admin, pauser);
        oracle.updateAgentSkill(agentA, 1500, 0);
        oracle.updateAgentSkill(agentB, 1500, 0);
        oracle.updateAgentSkill(anchor, 1500, 0); // anchors globalMeanMu

        marginToken = new MockERC20("USDC", "USDC");
        engine = new AgentPerpEngine(oracle, IERC20(address(marginToken)), 1_000_000e18, admin, operator, pauser);
        vm.stopPrank();

        vm.prank(operator);
        engine.createMarket(agentA);
        vm.prank(operator);
        engine.createMarket(agentB);

        address[] memory actors = _actors();
        for (uint256 i = 0; i < actors.length; i++) {
            vm.startPrank(admin);
            marginToken.mint(actors[i], 1_000_000e18);
            vm.stopPrank();
            vm.prank(actors[i]);
            marginToken.approve(address(engine), type(uint256).max);
        }

        vm.startPrank(admin);
        marginToken.mint(admin, 10_000_000e18);
        marginToken.approve(address(engine), type(uint256).max);
        engine.depositInsuranceFund(agentA, 100_000e18);
        engine.depositInsuranceFund(agentB, 100_000e18);
        vm.stopPrank();
    }

    function _actors() private view returns (address[] memory) {
        address[] memory a = new address[](3);
        a[0] = alice; a[1] = bob; a[2] = liquidator_;
        return a;
    }

    // ─── Test 1: Independent pricing after oracle crash ──────────────────

    function test_twoMarkets_independentPricing() public {
        // Open longs in both markets
        vm.prank(alice);
        engine.modifyPosition(agentA, int256(200e18), int256(5e18));
        vm.prank(bob);
        engine.modifyPosition(agentB, int256(200e18), int256(5e18));

        // Crash agentA oracle only
        vm.prank(admin);
        oracle.updateAgentSkill(agentA, 1000, 0); // crash A
        engine.syncOracle(agentA);
        engine.syncOracle(agentB);

        // A should be liquidatable, B should be healthy
        AgentPerpEngine.PositionHealth memory hA = engine.getPositionHealth(agentA, alice);
        AgentPerpEngine.PositionHealth memory hB = engine.getPositionHealth(agentB, bob);

        assertTrue(hA.liquidatable, "A position should be liquidatable after oracle crash");
        assertFalse(hB.liquidatable, "B position should be healthy (unchanged oracle)");
    }

    // ─── Test 2: Independent insurance funds ─────────────────────────────

    function test_multiMarket_independentInsurance() public {
        // Open leveraged long in market A
        vm.prank(alice);
        engine.modifyPosition(agentA, int256(110e18), int256(5e18));

        // Crash A oracle → liquidate → depletes A's insurance
        vm.prank(admin);
        oracle.updateAgentSkill(agentA, 1000, 0);
        engine.syncOracle(agentA);

        vm.prank(liquidator_);
        engine.liquidate(agentA, alice);

        // Check A's insurance was affected
        (,,,,,,,,, uint256 insA,,,,,, ) = engine.markets(agentA);

        // B's insurance should be untouched
        (,,,,,,,,, uint256 insB,,,,,, ) = engine.markets(agentB);
        assertEq(insB, 100_000e18, "market B insurance should be untouched");
    }

    // ─── Test 3: Position counts are independent ─────────────────────────

    function test_multiMarket_positionCountIndependent() public {
        // Open in both
        vm.prank(alice);
        engine.modifyPosition(agentA, int256(200e18), int256(5e18));
        vm.prank(bob);
        engine.modifyPosition(agentB, int256(200e18), int256(5e18));

        (,,,,,,,,,,,,,,uint256 openA,) = engine.markets(agentA);
        (,,,,,,,,,,,,,,uint256 openB,) = engine.markets(agentB);
        assertEq(openA, 1, "A should have 1 position");
        assertEq(openB, 1, "B should have 1 position");

        // Close A
        vm.prank(alice);
        engine.modifyPosition(agentA, 0, int256(-5e18));

        (,,,,,,,,,,,,,,openA,) = engine.markets(agentA);
        (,,,,,,,,,,,,,,openB,) = engine.markets(agentB);
        assertEq(openA, 0, "A should have 0 positions after close");
        assertEq(openB, 1, "B should still have 1 position");
    }
}
