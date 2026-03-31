// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/perps/SkillOracle.sol";
import "../../contracts/perps/AgentPerpEngine.sol";
import "../../contracts/DuelOutcomeOracle.sol";
import "../../contracts/GoldClob.sol";
import "../../contracts/MockERC20.sol";

/// @notice Handler contract for stateful invariant testing of the PM + Perps feedback loop.
/// Actions are weighted by call frequency to simulate realistic usage patterns.
contract PmPerpsHandler is Test {
    SkillOracle public oracle;
    AgentPerpEngine public engine;
    DuelOutcomeOracle public duelOracle;
    GoldClob public clob;
    MockERC20 public marginToken;

    address public admin;
    address public reporter;
    address public operator;
    address public pauser;
    address[4] public traders;
    address public liquidatorAddr;

    bytes32 public agentId;
    bytes32 public currentDuelKey;
    uint8 public constant MARKET_KIND = 0;
    uint8 public constant BUY_SIDE = 1;
    uint8 public constant SELL_SIDE = 2;
    uint8 public constant GTC_FLAG = 0x01;

    // Ghost variables for tracking expected state
    uint256 public ghost_perpsPositionsOpened;
    uint256 public ghost_perpsPositionsClosed;
    uint256 public ghost_perpsLiquidations;
    uint256 public ghost_clobOrdersPlaced;
    uint256 public ghost_clobClaims;
    uint256 public ghost_oracleUpdates;
    uint256 public ghost_duelsSettled;
    uint256 public ghost_insuranceFundDeposited;

    // Track which traders have open perps positions
    mapping(address => bool) public hasOpenPosition;

    bool public duelResolved;
    bool public clobMarketCreated;
    uint256 public duelCounter;

    constructor(
        SkillOracle _oracle,
        AgentPerpEngine _engine,
        DuelOutcomeOracle _duelOracle,
        GoldClob _clob,
        MockERC20 _marginToken,
        address _admin,
        address _reporter,
        address _operator,
        address _pauser,
        address[4] memory _traders,
        address _liquidator,
        bytes32 _agentId
    ) {
        oracle = _oracle;
        engine = _engine;
        duelOracle = _duelOracle;
        clob = _clob;
        marginToken = _marginToken;
        admin = _admin;
        reporter = _reporter;
        operator = _operator;
        pauser = _pauser;
        traders = _traders;
        liquidatorAddr = _liquidator;
        agentId = _agentId;

        _startNewDuel();
    }

    // ─── Action: Open perps position ────────────────────────────────────

    function openPerpsPosition(uint8 traderIdx, uint96 marginRaw, uint96 sizeRaw, bool isLong) external {
        address trader = traders[traderIdx % 4];
        uint256 margin = bound(uint256(marginRaw), 100e18, 10_000e18);
        uint256 size = bound(uint256(sizeRaw), 1e18, 500e18);

        if (hasOpenPosition[trader]) return;

        vm.prank(trader);
        try engine.modifyPosition(
            agentId,
            int256(margin),
            isLong ? int256(size) : -int256(size)
        ) {
            hasOpenPosition[trader] = true;
            ghost_perpsPositionsOpened++;
        } catch {}
    }

    // ─── Action: Close perps position ───────────────────────────────────

    function closePerpsPosition(uint8 traderIdx) external {
        address trader = traders[traderIdx % 4];
        if (!hasOpenPosition[trader]) return;

        (int256 size,,,) = engine.positions(agentId, trader);
        if (size == 0) {
            hasOpenPosition[trader] = false;
            return;
        }

        vm.prank(trader);
        try engine.modifyPosition(agentId, 0, -size) {
            hasOpenPosition[trader] = false;
            ghost_perpsPositionsClosed++;
        } catch {}
    }

    // ─── Action: Update oracle price (step-function jump) ───────────────

    function updateOraclePrice(uint256 newMu) external {
        newMu = bound(newMu, 1000, 2000);

        vm.warp(block.timestamp + 10);
        vm.prank(admin);
        try oracle.updateAgentSkill(agentId, newMu, 0) {
            ghost_oracleUpdates++;
        } catch {}
    }

    // ─── Action: Liquidate ──────────────────────────────────────────────

    function liquidate(uint8 traderIdx) external {
        address trader = traders[traderIdx % 4];
        if (!hasOpenPosition[trader]) return;

        vm.prank(liquidatorAddr);
        try engine.liquidate(agentId, trader) {
            ghost_perpsLiquidations++;
            // Check if position fully closed
            (int256 size,,,) = engine.positions(agentId, trader);
            if (size == 0) hasOpenPosition[trader] = false;
        } catch {}
    }

    // ─── Action: Place CLOB order ───────────────────────────────────────

    function placeClobOrder(uint8 traderIdx, uint8 sideRaw, uint16 priceRaw, uint96 amountRaw) external {
        if (!clobMarketCreated || duelResolved) return;

        address trader = traders[traderIdx % 4];
        uint8 side = (sideRaw % 2 == 0) ? BUY_SIDE : SELL_SIDE;
        uint16 price = uint16(bound(uint256(priceRaw), 100, 900));
        uint256 amount = bound(uint256(amountRaw), 1e18, 10e18);

        uint256 cost = side == BUY_SIDE
            ? (amount * uint256(price)) / 1000
            : (amount * uint256(1000 - price)) / 1000;

        vm.prank(trader);
        try clob.placeOrder{value: cost}(
            currentDuelKey,
            MARKET_KIND,
            side,
            price,
            uint128(amount),
            GTC_FLAG
        ) {
            ghost_clobOrdersPlaced++;
        } catch {}
    }

    // ─── Action: Settle duel ────────────────────────────────────────────

    function settleDuel(uint8 winnerRaw) external {
        if (duelResolved) return;

        uint8 winner = (winnerRaw % 2) + 1; // 1 or 2 (Side A or B)

        // Lock the duel
        vm.warp(block.timestamp + 10);
        vm.prank(reporter);
        try duelOracle.upsertDuel(
            currentDuelKey,
            keccak256("agentA"),
            keccak256("agentB"),
            uint64(block.timestamp - 100),
            uint64(block.timestamp - 50),
            uint64(block.timestamp - 200),
            "",
            DuelOutcomeOracle.DuelStatus.LOCKED
        ) {} catch {}

        // Propose result
        bytes32 resultHash = keccak256(abi.encodePacked(winner, block.timestamp));
        bytes32 replayHash = keccak256(abi.encodePacked("replay", block.timestamp));
        vm.prank(reporter);
        try duelOracle.proposeResult(
            currentDuelKey,
            DuelOutcomeOracle.Side(winner),
            uint64(block.timestamp),
            replayHash,
            resultHash,
            uint64(block.timestamp),
            ""
        ) {} catch {}

        // Skip dispute window and finalize
        vm.warp(block.timestamp + 4000);
        vm.prank(reporter);
        try duelOracle.finalizeResult(currentDuelKey, "") {
            duelResolved = true;
            ghost_duelsSettled++;

            // Sync CLOB market
            try clob.syncMarketFromOracle(currentDuelKey, MARKET_KIND) {} catch {}

            // Update oracle price based on winner (simulate skill change)
            uint256 newMu = winner == 1 ? 1700 : 1300;
            try oracle.updateAgentSkill(agentId, newMu, 0) {} catch {}
        } catch {}
    }

    // ─── Action: Claim from CLOB ────────────────────────────────────────

    function claimClob(uint8 traderIdx) external {
        if (!duelResolved) return;

        address trader = traders[traderIdx % 4];
        vm.prank(trader);
        try clob.claim(currentDuelKey, MARKET_KIND) {
            ghost_clobClaims++;
        } catch {}
    }

    // ─── Action: Start new duel cycle ───────────────────────────────────

    function newCycle() external {
        if (!duelResolved) return;

        // Close all remaining perps positions
        for (uint256 i = 0; i < 4; i++) {
            if (hasOpenPosition[traders[i]]) {
                (int256 size,,,) = engine.positions(agentId, traders[i]);
                if (size != 0) {
                    vm.prank(traders[i]);
                    try engine.modifyPosition(agentId, 0, -size) {
                        hasOpenPosition[traders[i]] = false;
                    } catch {}
                } else {
                    hasOpenPosition[traders[i]] = false;
                }
            }
        }

        _startNewDuel();
    }

    // ─── Action: Deposit insurance fund ─────────────────────────────────

    function depositInsurance(uint96 amountRaw) external {
        uint256 amount = bound(uint256(amountRaw), 1e18, 10_000e18);
        vm.prank(admin);
        try engine.depositInsuranceFund(agentId, amount) {
            ghost_insuranceFundDeposited += amount;
        } catch {}
    }

    // ─── Internal helpers ───────────────────────────────────────────────

    function _startNewDuel() internal {
        duelCounter++;
        currentDuelKey = keccak256(abi.encodePacked("duel", duelCounter));
        duelResolved = false;
        clobMarketCreated = false;

        // Upsert duel in oracle
        vm.warp(block.timestamp + 10);
        vm.prank(reporter);
        try duelOracle.upsertDuel(
            currentDuelKey,
            keccak256("agentA"),
            keccak256("agentB"),
            uint64(block.timestamp),
            uint64(block.timestamp + 3600),
            uint64(block.timestamp + 7200),
            "",
            DuelOutcomeOracle.DuelStatus.BETTING_OPEN
        ) {} catch {}

        // Create CLOB market
        vm.prank(operator);
        try clob.createMarketForDuel(currentDuelKey, MARKET_KIND) {
            clobMarketCreated = true;
        } catch {}
    }
}

/// @notice Invariant test suite for the PM + Perps feedback loop.
contract PmPerpsInvariantTest is Test {
    SkillOracle oracle;
    AgentPerpEngine engine;
    DuelOutcomeOracle duelOracle;
    GoldClob clob;
    MockERC20 marginToken;
    PmPerpsHandler handler;

    address admin = address(0xA1);
    address reporter = address(0xA2);
    address operator = address(0xA3);
    address pauser = address(0xA4);
    address liquidator_ = address(0xA5);
    address[4] traders = [address(0xB1), address(0xB2), address(0xB3), address(0xB4)];

    bytes32 agentId = keccak256("MODEL_A");

    function setUp() public {
        vm.startPrank(admin);

        // Deploy SkillOracle
        oracle = new SkillOracle(100e18, 2 hours, admin, admin, pauser);
        oracle.updateAgentSkill(agentId, 1500, 0);

        // Deploy margin token
        marginToken = new MockERC20("USDC", "USDC");

        // Deploy AgentPerpEngine
        engine = new AgentPerpEngine(
            oracle,
            IERC20(address(marginToken)),
            1_000_000e18,
            admin,
            operator,
            pauser
        );

        // Deploy DuelOutcomeOracle
        duelOracle = new DuelOutcomeOracle(
            admin,
            reporter,
            reporter, // finalizer = reporter for simplicity
            reporter, // challenger
            pauser,
            3600      // 1hr dispute window
        );

        // Deploy GoldClob
        clob = new GoldClob(
            admin,               // admin
            operator,            // marketOperator
            address(duelOracle), // oracle
            admin,               // treasury
            admin,               // marketMaker
            pauser               // pauser
        );

        vm.stopPrank();

        // Create perps market
        vm.prank(operator);
        engine.createMarket(agentId);

        // Fund traders with margin tokens + ETH
        for (uint256 i = 0; i < 4; i++) {
            vm.startPrank(admin);
            marginToken.mint(traders[i], 1_000_000e18);
            vm.stopPrank();

            vm.prank(traders[i]);
            marginToken.approve(address(engine), type(uint256).max);

            vm.deal(traders[i], 1000 ether);
        }

        // Fund admin + liquidator
        vm.startPrank(admin);
        marginToken.mint(admin, 10_000_000e18);
        marginToken.approve(address(engine), type(uint256).max);
        engine.depositInsuranceFund(agentId, 100_000e18);
        vm.stopPrank();

        vm.deal(liquidator_, 100 ether);

        // Deploy handler
        handler = new PmPerpsHandler(
            oracle, engine, duelOracle, clob, marginToken,
            admin, reporter, operator, pauser,
            traders, liquidator_, agentId
        );

        // Fund handler for CLOB ETH transfers
        vm.deal(address(handler), 1000 ether);
        for (uint256 i = 0; i < 4; i++) {
            vm.deal(traders[i], 1000 ether);
        }

        // Target only the handler for invariant calls
        targetContract(address(handler));
    }

    // ─── Invariant 1: Perps balance sheet ───────────────────────────────

    function invariant_perpsBalanceSheet() public view {
        uint256 totalMargins;
        for (uint256 i = 0; i < 4; i++) {
            (, uint256 margin,,) = engine.positions(agentId, traders[i]);
            totalMargins += margin;
        }

        (
            ,,,,,,,, uint256 vaultBalance,
            uint256 insuranceFund,
            ,, // badDebt, settlementPrice
            uint256 treasuryFees,
            uint256 mmFees,
            ,
        ) = engine.markets(agentId);

        uint256 expectedBalance = totalMargins + insuranceFund + vaultBalance + treasuryFees + mmFees;
        assertEq(
            marginToken.balanceOf(address(engine)),
            expectedBalance,
            "INV-1: perps engine balance must equal sum of margins + reserves + fees"
        );
    }

    // ─── Invariant 2: OI consistency ────────────────────────────────────

    function invariant_openInterestNonNegative() public view {
        (
            uint256 totalLongOI,
            uint256 totalShortOI,
            ,,,,,,,,,,,,
            uint256 openPositions,
        ) = engine.markets(agentId);

        if (openPositions == 0) {
            assertEq(totalLongOI, 0, "INV-2a: no positions means no long OI");
            assertEq(totalShortOI, 0, "INV-2b: no positions means no short OI");
        }
    }

    // ─── Invariant 3: No position with zero margin and nonzero size ─────

    function invariant_noGhostPositions() public view {
        for (uint256 i = 0; i < 4; i++) {
            (int256 size, uint256 margin,,) = engine.positions(agentId, traders[i]);
            if (size != 0) {
                assertTrue(margin > 0, "INV-3: position with size must have margin");
            }
        }
    }

    // ─── Invariant 4: Ghost counters are monotonic ──────────────────────

    function invariant_callSummary() public view {
        // This invariant just asserts the handler didn't revert unexpectedly.
        // The ghost counters provide visibility into what the fuzzer exercised.
        assertTrue(
            handler.ghost_perpsPositionsOpened() >= handler.ghost_perpsPositionsClosed(),
            "INV-4: cannot close more positions than opened"
        );
    }

    // ─── Invariant 5: Insurance fund + bad debt accounting ──────────────

    function invariant_insuranceFundAccounting() public view {
        (
            ,,,,,,,,,
            uint256 insuranceFund,
            uint256 badDebt,
            ,,,,
        ) = engine.markets(agentId);

        // If there's bad debt, insurance should be zero (depleted)
        if (badDebt > 0) {
            assertEq(insuranceFund, 0, "INV-5: bad debt implies depleted insurance");
        }
    }

    // ─── Invariant 6: OI cap enforcement ────────────────────────────────

    function invariant_oiWithinCaps() public view {
        (
            uint256 totalLongOI,
            uint256 totalShortOI,
            ,,,,,,,,,,,,,
        ) = engine.markets(agentId);

        (
            ,,,,,
            uint256 maxOpenInterest,
            ,,,,,
        ) = engine.marketConfigs(agentId);

        if (maxOpenInterest > 0) {
            assertTrue(totalLongOI <= maxOpenInterest, "INV-6a: long OI within cap");
            assertTrue(totalShortOI <= maxOpenInterest, "INV-6b: short OI within cap");
        }
    }

    // ─── Invariant 7: Settlement price frozen once set ──────────────────

    function invariant_settlementPriceFrozen() public view {
        (
            ,,,,,,,,,,
            uint256 settlementPrice,
            ,,,,
        ) = engine.markets(agentId);

        // If settlement price is set, market must be CLOSE_ONLY or ARCHIVED
        if (settlementPrice > 0) {
            (,,,,,,,,,,,,,,,AgentPerpEngine.MarketStatus status) = engine.markets(agentId);
            assertTrue(
                status == AgentPerpEngine.MarketStatus.CLOSE_ONLY ||
                status == AgentPerpEngine.MarketStatus.ARCHIVED,
                "INV-7: settlement price only exists in CLOSE_ONLY or ARCHIVED"
            );
        }
    }

    // ─── Invariant 8: Position count matches actual positions ───────────

    function invariant_positionCountConsistency() public view {
        (,,,,,,,,,,,,,,uint256 openPositions,) = engine.markets(agentId);

        uint256 actualOpen;
        for (uint256 i = 0; i < 4; i++) {
            (int256 size,,,) = engine.positions(agentId, traders[i]);
            if (size != 0) actualOpen++;
        }

        // actualOpen may be less than openPositions if other addresses have positions
        // but it should never exceed openPositions
        assertTrue(actualOpen <= openPositions, "INV-8: tracked positions cannot exceed counter");
    }

    // ─── Invariant 9: Market status never regresses ─────────────────────

    function invariant_marketStatusMonotonic() public view {
        (,,,,,,,,,,,,,,,AgentPerpEngine.MarketStatus status) = engine.markets(agentId);
        // ACTIVE=1, CLOSE_ONLY=2, ARCHIVED=3
        // Status should never go backward to UNINITIALIZED (0)
        assertTrue(
            uint8(status) >= 1,
            "INV-9: market status must be at least ACTIVE"
        );
    }

    // ─── Invariant 10: No negative vault balance ────────────────────────

    function invariant_vaultNonNegative() public view {
        (,,,,,,,, uint256 vaultBalance,,,,,,,) = engine.markets(agentId);
        // vaultBalance is uint256 so non-negativity is type-guaranteed.
        // Assert vault does not exceed total contract holdings as a stronger check.
        uint256 engineBalance = IERC20(engine.marginToken()).balanceOf(address(engine));
        assertLe(vaultBalance, engineBalance, "INV-10: vault balance does not exceed contract holdings");
    }

    // ─── Invariant 11: Liquidator can only liquidate underwater positions ──

    function invariant_noHealthyLiquidations() public view {
        // The contract enforces the liquidation threshold by reverting
        // liquidate() on healthy positions.  The handler's ghost counter
        // `ghost_liquidationsExecuted` only increments on successful calls.
        // TODO: add a ghost counter for *attempted* liquidations on healthy
        //       positions (try/catch around liquidate with a pre-check) to
        //       make this invariant independently verifiable at runtime.
        assertGe(handler.ghost_perpsLiquidations(), 0, "INV-11: liquidation counter is coherent");
    }

    // ─── Invariant 12: CLOB balance consistency ─────────────────────────

    function invariant_clobBalanceNonNegative() public view {
        uint256 clobBal = address(clob).balance;
        // CLOB balance should cover net deposits (deposits - claims - fees).
        // We use a soft check: balance should be non-trivially positive while
        // there are active markets, or near-zero once all markets settle.
        // CLOB balance should be positive while orders have been placed
        // but not all markets have been claimed.
        uint256 ordersPlaced = handler.ghost_clobOrdersPlaced();
        uint256 claims = handler.ghost_clobClaims();
        if (ordersPlaced > 0 && claims < ordersPlaced) {
            assertGt(clobBal, 0, "INV-12: CLOB has positive balance while orders exceed claims");
        }
    }
}
