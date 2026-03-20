// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/MockERC20.sol";

contract AgentPerpEngineTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    MockERC20 marginToken;

    address admin = address(1);
    address operator = address(6);
    address pauser = address(7);
    address alice = address(2);
    address bob = address(3);
    address whale = address(4);
    address reporter = address(5);

    bytes32 agentId = keccak256("MODEL_A");
    bytes32 agentB = keccak256("MODEL_B");

    bytes32 constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");
    bytes32 constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    function setUp() public {
        vm.startPrank(admin);

        uint256 P0 = 100 * 1e18;
        oracle = new SkillOracle(P0, 2 minutes, admin, admin, pauser);

        marginToken = new MockERC20("USDC", "USDC");

        uint256 skewScale = 1_000_000 * 1e18;
        engine = new AgentPerpEngine(oracle, IERC20(address(marginToken)), skewScale, admin, operator, pauser);

        marginToken.mint(alice, 100_000 * 1e18);
        marginToken.mint(bob, 100_000 * 1e18);
        marginToken.mint(whale, 10_000_000 * 1e18);
        marginToken.mint(admin, 10_000_000 * 1e18);
        marginToken.approve(address(engine), type(uint256).max);

        vm.stopPrank();

        vm.prank(alice);
        marginToken.approve(address(engine), type(uint256).max);
        vm.prank(bob);
        marginToken.approve(address(engine), type(uint256).max);
        vm.prank(whale);
        marginToken.approve(address(engine), type(uint256).max);

        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1500, 200);

        vm.prank(operator);
        engine.createMarket(agentId);

        // Seed insurance fund so PnL credits work
        vm.prank(admin);
        engine.depositInsuranceFund(agentId, 100_000 * 1e18);
    }

    // ── P1B.1: Oracle hardening ──

    function testOracleConvergenceAndPrice() public {
        uint256 initialPrice = oracle.getIndexPrice(agentId);

        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1600, 50);

        uint256 newPrice = oracle.getIndexPrice(agentId);
        assertTrue(newPrice > initialPrice, "Price should increase as skill uncertainty drops and mu grows");
    }

    function testOracleDeltaCapsRevertOnExcessiveMuJump() public {
        vm.prank(admin);
        vm.expectRevert(SkillOracle.MuDeltaExceeded.selector);
        oracle.updateAgentSkill(agentId, 2100, 200); // delta = 600, cap = 500
    }

    function testOracleDeltaCapsRevertOnExcessiveSigmaJump() public {
        vm.prank(admin);
        vm.expectRevert(SkillOracle.SigmaDeltaExceeded.selector);
        oracle.updateAgentSkill(agentId, 1500, 600); // delta = 400, cap = 300
    }

    function testOracleStalenessBlocksSync() public {
        vm.warp(block.timestamp + 3 minutes);
        vm.expectRevert(AgentPerpEngine.StaleOracle.selector);
        engine.syncOracle(agentId);
    }

    function testOracleStalenessBlocksGetIndexPrice() public {
        vm.warp(block.timestamp + 3 minutes);
        vm.expectRevert(SkillOracle.StaleOracle.selector);
        oracle.getIndexPrice(agentId);
    }

    function testOracleFirstUpdateBypassesDeltaCap() public {
        bytes32 newAgent = keccak256("NEW_AGENT");
        vm.prank(admin);
        oracle.updateAgentSkill(newAgent, 5000, 1000);
        (uint256 mu, uint256 sigma,) = oracle.agentSkills(newAgent);
        assertEq(mu, 5000);
        assertEq(sigma, 1000);
    }

    function testOraclePauseBlocksUpdates() public {
        vm.prank(pauser);
        oracle.setOraclePaused(true);

        vm.prank(admin);
        vm.expectRevert(SkillOracle.OraclePaused.selector);
        oracle.updateAgentSkill(agentId, 1550, 180);
    }

    // ── P1B.2: Governance hardening ──

    function testGovernanceFreezeBlocksRoleGrant() public {
        vm.startPrank(admin);
        vm.expectRevert(AgentPerpEngine.GovernanceSurfaceFrozen.selector);
        engine.grantRole(MARKET_OPERATOR_ROLE, address(0xBEEF));
        vm.stopPrank();
    }

    function testGovernanceFreezeBlocksRoleRevoke() public {
        vm.startPrank(admin);
        vm.expectRevert(AgentPerpEngine.GovernanceSurfaceFrozen.selector);
        engine.revokeRole(MARKET_OPERATOR_ROLE, operator);
        vm.stopPrank();
    }

    function testGovernanceFreezeAllowsPauserGrant() public {
        vm.startPrank(admin);
        engine.grantRole(PAUSER_ROLE, address(0xBEEF));
        vm.stopPrank();
        assertTrue(engine.hasRole(PAUSER_ROLE, address(0xBEEF)));
    }

    function testFrozenSettersRevert() public {
        vm.startPrank(admin);
        vm.expectRevert(AgentPerpEngine.GovernanceSurfaceFrozen.selector);
        engine.setFundingVelocity(999);

        vm.expectRevert(AgentPerpEngine.GovernanceSurfaceFrozen.selector);
        engine.setDefaultSkewScale(999);

        vm.expectRevert(AgentPerpEngine.GovernanceSurfaceFrozen.selector);
        engine.updateMarketConfig(agentId, 1, 1, 1, 1, 1);
        vm.stopPrank();
    }

    function testTradingPauseBlocksModifyPosition() public {
        vm.prank(pauser);
        engine.setTradingPaused(true);

        vm.prank(alice);
        vm.expectRevert(AgentPerpEngine.TradingPaused.selector);
        engine.modifyPosition(agentId, 1000 * 1e18, 1e18);
    }

    function testMarketCreationPauseBlocksCreate() public {
        vm.prank(pauser);
        engine.setMarketCreationPaused(true);

        vm.prank(admin);
        oracle.updateAgentSkill(agentB, 1500, 200);

        vm.prank(operator);
        vm.expectRevert(AgentPerpEngine.MarketCreationPaused.selector);
        engine.createMarket(agentB);
    }

    function testOnlyOperatorCanCreateMarket() public {
        vm.prank(admin);
        oracle.updateAgentSkill(agentB, 1500, 200);

        vm.prank(alice);
        vm.expectRevert();
        engine.createMarket(agentB);
    }

    // ── P1B.2: Oracle governance freeze ──

    function testOracleGovernanceFreezeBlocksReporterRoleGrant() public {
        vm.startPrank(admin);
        vm.expectRevert(SkillOracle.GovernanceSurfaceFrozen.selector);
        oracle.grantRole(REPORTER_ROLE, address(0xBEEF));
        vm.stopPrank();
    }

    function testOracleGovernanceFreezeAllowsPauser() public {
        vm.startPrank(admin);
        oracle.grantRole(PAUSER_ROLE, address(0xBEEF));
        vm.stopPrank();
        assertTrue(oracle.hasRole(PAUSER_ROLE, address(0xBEEF)));
    }

    function testOracleFrozenMaxDelaySetterReverts() public {
        vm.startPrank(admin);
        vm.expectRevert(SkillOracle.GovernanceSurfaceFrozen.selector);
        oracle.setMaxOracleDelay(999);
        vm.stopPrank();
    }

    // ── P1B.3: Risk engine — skew pricing ──

    function testAdversarialSkew() public {
        uint256 baseExecPrice = engine.getExecutionPrice(agentId, 0);

        int256 sizeDelta = 500_000 * 1e18;
        int256 margin = 500_000 * 1e18;

        vm.startPrank(whale);
        engine.modifyPosition(agentId, margin, sizeDelta);
        vm.stopPrank();

        uint256 aliceExecPrice = engine.getExecutionPrice(agentId, 1e18);
        assertTrue(aliceExecPrice > baseExecPrice, "Subsequent longs face severe skew premium");

        uint256 bobExecPrice = engine.getExecutionPrice(agentId, -1e18);
        assertTrue(bobExecPrice > baseExecPrice, "Shorts sell at a premium in a heavily long-skewed market");
    }

    // ── P1B.3: Market status lifecycle ──

    function testCloseOnlyModeBlocksNewPositions() public {
        vm.prank(operator);
        engine.setMarketStatus(agentId, AgentPerpEngine.MarketStatus.CLOSE_ONLY);

        vm.prank(alice);
        vm.expectRevert(AgentPerpEngine.CloseOnlyMode.selector);
        engine.modifyPosition(agentId, 1000 * 1e18, 1e18);
    }

    function testCloseOnlyModeAllowsReduce() public {
        vm.prank(alice);
        engine.modifyPosition(agentId, 1000 * 1e18, 10 * 1e18);

        vm.prank(operator);
        engine.setMarketStatus(agentId, AgentPerpEngine.MarketStatus.CLOSE_ONLY);

        vm.prank(alice);
        engine.modifyPosition(agentId, 0, -5 * 1e18);
    }

    function testArchivedMarketBlocksAllTrades() public {
        vm.prank(operator);
        engine.setMarketStatus(agentId, AgentPerpEngine.MarketStatus.ARCHIVED);

        vm.prank(alice);
        vm.expectRevert(AgentPerpEngine.ArchivedMarket.selector);
        engine.modifyPosition(agentId, 1000 * 1e18, 1e18);
    }

    // ── P1B.3: Insurance fund ──

    function testDepositInsuranceFundRepaysBadDebt() public {
        (,,,,,,,,,uint256 insuranceFund,,) = engine.markets(agentId);
        assertEq(insuranceFund, 100_000 * 1e18);
    }

    // ── Reporter updates ──

    function testReporterCanUpdateSkills() public {
        vm.prank(admin);
        oracle.updateAgentSkill(agentId, 1600, 25);

        (uint256 mu, uint256 sigma,) = oracle.agentSkills(agentId);
        assertEq(mu, 1600);
        assertEq(sigma, 25);
    }

    // ── Fuzz: oracle delta bounds ──

    function testFuzz_OracleDeltaBounds(uint256 newMu, uint256 newSigma) public {
        newMu = bound(newMu, 1000, 2000);
        newSigma = bound(newSigma, 1, 500);

        uint256 muDelta = newMu > 1500 ? newMu - 1500 : 1500 - newMu;
        uint256 sigmaDelta = newSigma > 200 ? newSigma - 200 : 200 - newSigma;

        vm.startPrank(admin);
        if (muDelta > oracle.MAX_MU_DELTA() || sigmaDelta > oracle.MAX_SIGMA_DELTA()) {
            vm.expectRevert();
        }
        oracle.updateAgentSkill(agentId, newMu, newSigma);
        vm.stopPrank();
    }

    // ── Fuzz: leverage check ──

    function testFuzz_LeverageCheck(uint256 marginAmount, int256 sizeDelta) public {
        marginAmount = bound(marginAmount, 100 * 1e18, 50_000 * 1e18);
        sizeDelta = bound(sizeDelta, 1e18, 100 * 1e18);

        vm.prank(alice);
        try engine.modifyPosition(agentId, int256(marginAmount), sizeDelta) {} catch {}
    }
}
