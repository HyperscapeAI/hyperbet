// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/lvr_amm/Router.sol";
import "../contracts/lvr_amm/LvrMarket.sol";
import "../contracts/lvr_amm/MockUSD.sol";
import "../contracts/DuelOutcomeOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapMath} from "../contracts/lvr_amm/lib/SwapMath.sol";

contract LvrMarketTest is Test {
    Router public router;
    MockUSD public mUSD;
    DuelOutcomeOracle public oracle;
    address public admin = address(1);
    address public treasury = address(4);
    address public user1 = address(2);
    address public user2 = address(3);
    bytes32 public constant TEST_DUEL_KEY = keccak256("test-duel-key");
    bytes32 public constant SECOND_DUEL_KEY = keccak256("second-duel-key");

    uint256 public constant INITIAL_BALANCE = 10000 * 10**18;
    uint256 public constant DURATION = 1 days;
    uint256 public constant FEE_BPS = 50; // 0.5%

    function setUp() public {
        vm.startPrank(admin);

        mUSD = new MockUSD();
        oracle = new DuelOutcomeOracle(admin, admin, admin, admin, admin, 1 hours);
        router = new Router(address(mUSD), address(oracle), treasury, FEE_BPS, admin);

        mUSD.mint(admin, INITIAL_BALANCE);
        mUSD.mint(user1, INITIAL_BALANCE);
        mUSD.mint(user2, INITIAL_BALANCE);

        vm.stopPrank();

        vm.prank(admin);
        mUSD.approve(address(router), type(uint256).max);

        vm.prank(user1);
        mUSD.approve(address(router), type(uint256).max);

        vm.prank(user2);
        mUSD.approve(address(router), type(uint256).max);
    }

    function test_CreateMarket() public {
        vm.startPrank(admin);

        uint256 collateralIn = 100 * 10**18;

        router.create(
            "Will BTC hit 100k?",
            "Market for BTC price event",
            "coingecko",
            TEST_DUEL_KEY,
            false,
            DURATION,
            collateralIn
        );

        address[] memory markets = router.getAllMarkets();
        assertEq(markets.length, 1);
        address marketAddr = markets[0];

        assertEq(mUSD.balanceOf(marketAddr), collateralIn);

        vm.stopPrank();
    }

    function test_DynamicMarketsDisabled() public {
        vm.startPrank(admin);
        vm.expectRevert(Router.DynamicMarketsDisabled.selector);
        router.create(
            "Dynamic Market",
            "Disabled until dynamic liquidity is safe",
            "coingecko",
            TEST_DUEL_KEY,
            true,
            DURATION,
            100 * 10**18
        );
        vm.stopPrank();
    }

    function test_BuyYes() public {
        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, collateralIn);

        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        uint256 buyAmount = 10 * 10**18;

        vm.warp(block.timestamp + 1 hours);

        vm.startPrank(user1);
        router.buyYes(marketAddr, buyAmount, 0); // minAmountOut = 0 for basic test

        uint256 userYesBalance = market.yesToken().balanceOf(user1);
        assertTrue(userYesBalance > 0, "User should receive YES tokens");

        vm.stopPrank();
    }

    function test_Fuzz_BuyNo(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 10**17, 50 * 10**18);

        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, collateralIn);

        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.startPrank(user2);
        router.buyNo(marketAddr, buyAmount, 0);

        uint256 userNoBalance = market.noToken().balanceOf(user2);
        assertTrue(userNoBalance > 0, "User should receive NO tokens");

        vm.stopPrank();
    }

    // === Exploit regression tests ===

    function test_UnauthorizedSetFeeConfig() public {
        vm.prank(user1);
        vm.expectRevert();
        router.setFeeConfig(user1, 500);
    }

    function test_FeeTooHigh() public {
        vm.prank(admin);
        vm.expectRevert(Router.FeeTooHigh.selector);
        router.setFeeConfig(treasury, 1001); // > 10%
    }

    function test_AdminCanSetFeeConfig() public {
        vm.prank(admin);
        router.setFeeConfig(treasury, 100);
        assertEq(router.feeBps(), 100);
    }

    function test_FreezeConfigBlocksFurtherFeeChanges() public {
        vm.prank(admin);
        router.freezeConfig();

        assertTrue(router.configFrozen(), "config should be frozen");

        vm.prank(admin);
        vm.expectRevert(Router.ConfigFrozen.selector);
        router.setFeeConfig(treasury, 100);
    }

    function test_CreateUsesFrozenFeeSnapshot() public {
        vm.prank(admin);
        router.setFeeConfig(treasury, 100);

        vm.prank(admin);
        router.freezeConfig();

        vm.prank(admin);
        router.create("Frozen Config", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);

        address marketAddr = _lastMarketAddress();
        LvrMarket market = LvrMarket(marketAddr);

        assertEq(market.feeBps(), 100, "market should inherit frozen router fee config");
        assertEq(market.treasuryAddress(), treasury, "market should inherit frozen router treasury");
    }

    function test_CallbackFromNonMarket() public {
        vm.prank(user1);
        vm.expectRevert(Router.MarketNotAllowed.selector);
        router.marketBuyCallback(100, abi.encode(address(mUSD), user1));
    }

    function test_CreateRequiresMarketOperatorRole() public {
        vm.startPrank(user1);
        vm.expectRevert();
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        vm.stopPrank();
    }

    function test_SlippageProtection() public {
        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, collateralIn);
        address marketAddr = _marketAt(0);

        vm.warp(block.timestamp + 1 hours);

        // Expect revert with impossibly high minAmountOut
        vm.startPrank(user1);
        vm.expectRevert(Router.SlippageExceeded.selector);
        router.buyYes(marketAddr, 10 * 10**18, type(uint256).max);

        vm.stopPrank();
    }

    function test_PriceReadExecutionParity() public {
        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, collateralIn);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        // At creation, with equal reserves, price should be ~0.5
        uint256 priceYes = market.getPriceYes();
        uint256 priceNo = market.getPriceNo();

        // Complement pricing: priceYes + priceNo == 1e18
        assertEq(priceYes + priceNo, 1e18, "Complement pricing violated");

        // At equal reserves, price should be around 0.5e18
        assertApproxEqAbs(priceYes, 0.5e18, 0.01e18, "Initial price should be ~0.5");
    }

    function test_SettleMarketRequiresPendingState() public {
        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);

        vm.expectRevert(bytes("Invalid Market State"));
        router.settleMarket(marketAddr);
    }

    function test_ManualSettlementCannotResolveWithoutOracleResult() public {
        bytes32 duelKey = keccak256("manual-settle-no-oracle-result");

        vm.prank(admin);
        router.create("Manual Oracle Gate", "Desc", "Src", duelKey, false, DURATION, 100 * 10**18);
        address marketAddr = _lastMarketAddress();
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + DURATION);

        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        vm.warp(block.timestamp + 5 minutes + 1);

        vm.expectRevert(bytes("Oracle duel not resolved"));
        router.settleMarket(marketAddr);

        (LvrMarket.MarketState currentState,,,,,,,) = market.getMarketDetails();
        assertEq(uint256(currentState), uint256(LvrMarket.MarketState.PENDING), "market should stay pending");
    }

    function test_SettleMarketUsesOracleOutcomeAfterManualProposal() public {
        bytes32 duelKey = keccak256("manual-settle-oracle-authority");
        _setupOracleDuel(duelKey);

        vm.prank(admin);
        router.create("Manual Oracle Override", "Desc", "Src", duelKey, false, DURATION, 100 * 10**18);
        address marketAddr = _lastMarketAddress();
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + DURATION);

        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.B);

        uint256 treasuryBefore = mUSD.balanceOf(treasury);
        uint256 proposerBefore = mUSD.balanceOf(user1);
        router.settleMarket(marketAddr);

        (LvrMarket.MarketState currentState,, uint256 mktOutcome,,,,,) = market.getMarketDetails();
        assertEq(uint256(currentState), uint256(LvrMarket.MarketState.RESOLVED));
        assertEq(mktOutcome, 1, "manual settlement must use the oracle outcome");
        assertEq(mUSD.balanceOf(treasury), treasuryBefore + bond, "wrong proposer bond should be slashed");
        assertEq(mUSD.balanceOf(user1), proposerBefore, "wrong proposer should not receive bond");
    }

    function test_RedeemCollateralPaysWinningSide() public {
        bytes32 duelKey = keccak256("redeem-winning-side");
        _setupOracleDuel(duelKey);

        (address marketAddr, LvrMarket market) = _createAndTradeStaticMarket(duelKey);
        uint256 user1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        uint256 user2No = IERC20(address(market.noToken())).balanceOf(user2);

        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.B);
        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        _approveRedeemTokens(market, user1, user1Yes, 0);
        _approveRedeemTokens(market, user2, 0, user2No);

        uint256 user1Before = mUSD.balanceOf(user1);
        uint256 user2Before = mUSD.balanceOf(user2);

        vm.prank(user1);
        router.redeem(marketAddr, user1Yes, 0);
        vm.prank(user2);
        router.redeem(marketAddr, 0, user2No);

        assertEq(mUSD.balanceOf(user1), user1Before, "YES holder should not be paid when NO wins");
        assertEq(mUSD.balanceOf(user2), user2Before + user2No, "NO holder should be paid 1:1");
    }

    function test_ZeroDurationReverts() public {
        vm.startPrank(admin);
        vm.expectRevert(bytes("Duration must be positive"));
        router.create("Zero Duration", "Desc", "Src", keccak256("zero-dur"), false, 0, 100 * 10**18);
        vm.stopPrank();
    }

    function test_GetPriceAfterDeadline() public {
        vm.prank(admin);
        router.create("Expiring Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        // Warp past deadline
        vm.warp(block.timestamp + DURATION + 1);

        // Should return ~0.5e18, not revert
        uint256 priceYes = market.getPriceYes();
        uint256 priceNo = market.getPriceNo();
        assertEq(priceYes, 0.5e18, "Price should be neutral after deadline");
        assertEq(priceYes + priceNo, 1e18, "Complement should hold");
    }

    function test_SellFeeBurnsSolvency() public {
        // Use static market (not dynamic) to avoid liquidity scaling issues with ZScoreOutOfBounds
        vm.prank(admin);
        router.create("Solvency Test", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        // Buy a small amount of YES tokens
        vm.startPrank(user1);
        router.buyYes(marketAddr, 5 * 10**18, 0);
        uint256 yesBalance = IERC20(address(market.yesToken())).balanceOf(user1);
        assertTrue(yesBalance > 0, "Should have YES tokens");

        // Approve and sell a portion
        IERC20(address(market.yesToken())).approve(address(router), yesBalance);
        router.sellYes(marketAddr, yesBalance / 4, 0);
        vm.stopPrank();

        // Solvency invariant: outstanding tokens <= 2 * collateral
        uint256 totalYes = market.yesToken().totalSupply();
        uint256 totalNo = market.noToken().totalSupply();
        uint256 collateral = mUSD.balanceOf(marketAddr);
        assertTrue(totalYes + totalNo <= 2 * collateral, "Solvency violated: tokens exceed collateral");
    }

    function test_AdminResolveSelectorRemoved() public {
        vm.prank(admin);
        router.create("Bond Slash Test", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        (bool success, ) = marketAddr.call(abi.encodeWithSignature("adminResolve(uint256)", 1));
        assertFalse(success, "adminResolve should not remain callable");
    }

    function test_SettleFromOracle_ReturnsBondOnCorrectProposal() public {
        bytes32 duelKey = keccak256("oracle-bond-return");
        _setupOracleDuel(duelKey);

        vm.prank(admin);
        router.create("Bond Return Test", "Desc", "Src", duelKey, false, DURATION, 100 * 10**18);
        address marketAddr = _lastMarketAddress();
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + DURATION);

        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.A);

        uint256 proposerBefore = mUSD.balanceOf(user1);
        router.settleFromOracle(marketAddr);

        assertEq(mUSD.balanceOf(user1), proposerBefore + bond, "Proposer should get bond back");
    }

    function test_RedeemCollateralRefundsCancelledMarkets() public {
        bytes32 duelKey = keccak256("cancelled-market");
        _setupOracleDuel(duelKey);

        (address marketAddr, LvrMarket market) = _createAndTradeStaticMarket(duelKey);
        uint256 user1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        uint256 user2No = IERC20(address(market.noToken())).balanceOf(user2);

        vm.prank(admin);
        oracle.cancelDuel(duelKey, "cancelled-uri");

        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        _approveRedeemTokens(market, user1, user1Yes, 0);
        _approveRedeemTokens(market, user2, 0, user2No);

        uint256 user1Before = mUSD.balanceOf(user1);
        uint256 user2Before = mUSD.balanceOf(user2);

        vm.prank(user1);
        router.redeem(marketAddr, user1Yes, 0);
        vm.prank(user2);
        router.redeem(marketAddr, 0, user2No);

        // Cancellation pays each token at 0.5 to maintain solvency
        assertEq(mUSD.balanceOf(user1), user1Before + user1Yes / 2, "YES holder should be refunded at 0.5 on cancellation");
        assertEq(mUSD.balanceOf(user2), user2Before + user2No / 2, "NO holder should be refunded at 0.5 on cancellation");
    }

    // ============ Phase 3: settleFromOracle tests ============

    function _createAndTradeStaticMarket(bytes32 duelKey) internal returns (address marketAddr, LvrMarket market) {
        vm.prank(admin);
        router.create("Oracle Test", "Desc", "Src", duelKey, false, DURATION, 100 * 10**18);
        marketAddr = _lastMarketAddress();
        market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(user1);
        router.buyYes(marketAddr, 5 * 10**18, 0);
        vm.prank(user2);
        router.buyNo(marketAddr, 5 * 10**18, 0);
    }

    function _approveRedeemTokens(LvrMarket market, address holder, uint256 yesAmount, uint256 noAmount) internal {
        vm.startPrank(holder);
        IERC20(address(market.yesToken())).approve(address(router), yesAmount);
        IERC20(address(market.noToken())).approve(address(router), noAmount);
        vm.stopPrank();
    }

    function _setupOracleDuel(bytes32 duelKey) internal {
        // Set betting window in the past so LOCKED status is accepted
        uint64 pastOpen = 1;
        uint64 pastClose = 2;
        uint64 duelStart = 2;

        vm.warp(10); // Ensure block.timestamp > betCloseTs

        vm.startPrank(admin);
        oracle.upsertDuel(
            duelKey,
            keccak256("participantA"),
            keccak256("participantB"),
            pastOpen,
            pastClose,
            duelStart,
            "test-uri",
            DuelOutcomeOracle.DuelStatus.LOCKED
        );
        vm.stopPrank();
    }

    function _proposeAndFinalizeOracle(bytes32 duelKey, DuelOutcomeOracle.Side winner) internal {
        bytes32 resultHash = keccak256("result");
        bytes32 replayHash = keccak256("replay");

        vm.prank(admin);
        oracle.proposeResult(duelKey, winner, 42, replayHash, resultHash, uint64(block.timestamp), "result-uri");

        // Wait for dispute window to pass
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(admin);
        oracle.finalizeResult(duelKey, "final-uri");
    }

    function test_SettleFromOracle_SideAWins() public {
        bytes32 duelKey = keccak256("oracle-test-a");
        _setupOracleDuel(duelKey);

        (address marketAddr, LvrMarket market) = _createAndTradeStaticMarket(duelKey);

        // Resolve oracle: Side A wins → outcome 0 (Yes)
        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.A);

        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        (LvrMarket.MarketState currentState,,uint256 mktOutcome,,,,,) = market.getMarketDetails();
        assertEq(uint256(currentState), uint256(LvrMarket.MarketState.RESOLVED));
        assertEq(mktOutcome, 0, "Outcome should be 0 (Yes) when Side A wins");
    }

    function test_SettleFromOracle_SideBWins() public {
        bytes32 duelKey = keccak256("oracle-test-b");
        _setupOracleDuel(duelKey);

        (address marketAddr, LvrMarket market) = _createAndTradeStaticMarket(duelKey);

        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.B);

        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        (,,uint256 mktOutcome,,,,,) = market.getMarketDetails();
        assertEq(mktOutcome, 1, "Outcome should be 1 (No) when Side B wins");
    }

    function test_SettleFromOracle_CancelledDuel() public {
        bytes32 duelKey = keccak256("oracle-test-cancel");
        _setupOracleDuel(duelKey);

        (address marketAddr, LvrMarket market) = _createAndTradeStaticMarket(duelKey);

        // Cancel the duel instead of resolving
        vm.prank(admin);
        oracle.cancelDuel(duelKey, "cancelled-uri");

        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        (,,uint256 mktOutcome,,,,,) = market.getMarketDetails();
        assertEq(mktOutcome, 2, "Outcome should be 2 (cancelled) when duel is cancelled");
    }

    function test_SettleFromOracle_SlashesBondOnWrongProposal() public {
        bytes32 duelKey = keccak256("oracle-bond-slash");
        _setupOracleDuel(duelKey);

        (address marketAddr, ) = _createAndTradeStaticMarket(duelKey);

        // user1 proposes outcome=0 on the market
        vm.warp(block.timestamp + DURATION);
        LvrMarket market = LvrMarket(marketAddr);
        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        // Oracle resolves Side B (outcome=1) — proposer was wrong
        _proposeAndFinalizeOracle(duelKey, DuelOutcomeOracle.Side.B);

        uint256 treasuryBefore = mUSD.balanceOf(treasury);
        router.settleFromOracle(marketAddr);

        assertEq(mUSD.balanceOf(treasury), treasuryBefore + bond, "Bond should be slashed to treasury");
    }

    // ============ Phase 3: Slippage and Z-score tests ============

    function test_SlippageProtection_BuyNo() public {
        vm.prank(admin);
        router.create("Slippage No", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(user1);
        vm.expectRevert(Router.SlippageExceeded.selector);
        router.buyNo(marketAddr, 10 * 10**18, type(uint256).max);
    }

    function test_SlippageProtection_SellYes() public {
        vm.prank(admin);
        router.create("Slippage Sell", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        // Buy YES first so we have tokens to sell
        vm.startPrank(user1);
        router.buyYes(marketAddr, 10 * 10**18, 0);
        uint256 yesBalance = IERC20(address(market.yesToken())).balanceOf(user1);
        IERC20(address(market.yesToken())).approve(address(router), yesBalance);

        vm.expectRevert(Router.SlippageExceeded.selector);
        router.sellYes(marketAddr, yesBalance / 2, type(uint256).max);
        vm.stopPrank();
    }

    function test_SlippageProtection_SellNo() public {
        vm.prank(admin);
        router.create("Slippage SellNo", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        vm.startPrank(user1);
        router.buyNo(marketAddr, 10 * 10**18, 0);
        uint256 noBalance = IERC20(address(market.noToken())).balanceOf(user1);
        IERC20(address(market.noToken())).approve(address(router), noBalance);

        vm.expectRevert(Router.SlippageExceeded.selector);
        router.sellNo(marketAddr, noBalance / 2, type(uint256).max);
        vm.stopPrank();
    }

    function test_BuyAfterDeadlineReverts() public {
        vm.prank(admin);
        router.create("Expired", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(user1);
        vm.expectRevert(bytes("Market Expired"));
        router.buyYes(marketAddr, 10 * 10**18, 0);
    }

    // ============ Phase 3: Invariant / Property tests ============

    function test_CancellationSolvency() public {
        // Verify outcome==2 never pays more than available collateral
        bytes32 duelKey = keccak256("solvency-cancel");
        _setupOracleDuel(duelKey);

        vm.prank(admin);
        router.create("Solvency Cancel", "Desc", "Src", duelKey, false, DURATION, 100 * 10**18);
        address marketAddr = _lastMarketAddress();
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        // Both users buy different sides
        vm.prank(user1);
        router.buyYes(marketAddr, 20 * 10**18, 0);
        vm.prank(user2);
        router.buyNo(marketAddr, 20 * 10**18, 0);

        // user1 also sells some YES to get NO tokens (holds both)
        uint256 user1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        vm.startPrank(user1);
        IERC20(address(market.yesToken())).approve(address(router), user1Yes);
        router.sellYes(marketAddr, user1Yes / 2, 0);
        vm.stopPrank();

        vm.prank(admin);
        oracle.cancelDuel(duelKey, "cancelled-uri");

        vm.warp(block.timestamp + DURATION);
        router.settleFromOracle(marketAddr);

        // Capture balances
        uint256 u1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        uint256 u1No = IERC20(address(market.noToken())).balanceOf(user1);
        uint256 u2Yes = IERC20(address(market.yesToken())).balanceOf(user2);
        uint256 u2No = IERC20(address(market.noToken())).balanceOf(user2);

        uint256 totalPayoutNeeded = (u1Yes + u1No) / 2 + (u2Yes + u2No) / 2;
        uint256 collateral = mUSD.balanceOf(marketAddr);

        assertTrue(collateral >= totalPayoutNeeded, "Collateral must cover all cancellation payouts");

        // Actually redeem and verify no revert
        vm.startPrank(user1);
        IERC20(address(market.yesToken())).approve(address(router), u1Yes);
        IERC20(address(market.noToken())).approve(address(router), u1No);
        router.redeem(marketAddr, u1Yes, u1No);
        vm.stopPrank();

        vm.startPrank(user2);
        IERC20(address(market.yesToken())).approve(address(router), u2Yes);
        IERC20(address(market.noToken())).approve(address(router), u2No);
        router.redeem(marketAddr, u2Yes, u2No);
        vm.stopPrank();
    }

    function test_Fuzz_SolvencyInvariant(uint256 buyAmount1, uint256 buyAmount2) public {
        buyAmount1 = bound(buyAmount1, 1 * 10**18, 40 * 10**18);
        buyAmount2 = bound(buyAmount2, 1 * 10**18, 40 * 10**18);

        vm.prank(admin);
        router.create("Fuzz Solvency", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(user1);
        router.buyYes(marketAddr, buyAmount1, 0);
        vm.prank(user2);
        router.buyNo(marketAddr, buyAmount2, 0);

        // Solvency: collateral >= max(yesSupply, noSupply)
        uint256 totalYes = market.yesToken().totalSupply();
        uint256 totalNo = market.noToken().totalSupply();
        uint256 collateral = mUSD.balanceOf(marketAddr);
        uint256 maxSupply = totalYes > totalNo ? totalYes : totalNo;
        assertTrue(collateral >= maxSupply, "Solvency: collateral must cover max token supply");
    }

    function test_Fuzz_NoFreeMoney(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 1 * 10**18, 30 * 10**18);

        vm.prank(admin);
        router.create("No Free Money", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        address marketAddr = _marketAt(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        uint256 balanceBefore = mUSD.balanceOf(user1);

        // Buy YES
        vm.startPrank(user1);
        router.buyYes(marketAddr, buyAmount, 0);

        uint256 yesBalance = IERC20(address(market.yesToken())).balanceOf(user1);
        IERC20(address(market.yesToken())).approve(address(router), yesBalance);

        // Immediately sell all YES back
        router.sellYes(marketAddr, yesBalance, 0);
        vm.stopPrank();

        uint256 balanceAfter = mUSD.balanceOf(user1);
        // User should NOT profit from round trip (fees + slippage make it unprofitable)
        assertTrue(balanceAfter <= balanceBefore, "Round-trip should not generate profit");
    }

    function test_NewtonNotConverged_Reverts() public {
        // SwapMath.getSwapAmount should revert (not return garbage) when Newton-Raphson fails
        // We trigger this by pushing reserves to extreme values relative to liquidity
        // Using direct library call to test edge case
        vm.expectRevert(SwapMath.ZScoreOutOfBounds.selector);
        SwapMath.getSwapAmount(true, 1, int256(1e36), 1, int256(1e30));
    }

    function _marketAt(uint256 index) internal view returns (address) {
        return router.getAllMarkets()[index];
    }

    function _lastMarketAddress() internal view returns (address) {
        address[] memory markets = router.getAllMarkets();
        return markets[markets.length - 1];
    }
}
