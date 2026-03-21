// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../contracts/lvr_amm/Router.sol";
import "../contracts/lvr_amm/LvrMarket.sol";
import "../contracts/lvr_amm/MockUSD.sol";
import "../contracts/DuelOutcomeOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "../contracts/lvr_amm/lib/Math.sol";

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
            true,
            DURATION,
            collateralIn
        );

        assertEq(router.getMarketCount(), 1);
        (address marketAddr, bytes32 id) = router.getMarketAtIndex(0);

        (address mkt, uint256 liq, string memory title, ,) = router.getMarketMetadata(id);

        assertEq(mkt, marketAddr);
        assertEq(title, "Will BTC hit 100k?");
        assertTrue(liq > 0);

        assertEq(mUSD.balanceOf(marketAddr), collateralIn);

        vm.stopPrank();
    }

    function test_BuyYes() public {
        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, collateralIn);

        (address marketAddr, ) = router.getMarketAtIndex(0);
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
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, collateralIn);

        (address marketAddr, ) = router.getMarketAtIndex(0);
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

    function test_CallbackFromNonMarket() public {
        vm.prank(user1);
        vm.expectRevert(Router.MarketNotAllowed.selector);
        router.marketBuyCallback(100, abi.encode(address(mUSD), user1));
    }

    function test_CreateRequiresMarketOperatorRole() public {
        vm.startPrank(user1);
        vm.expectRevert();
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, 100 * 10**18);
        vm.stopPrank();
    }

    function test_SlippageProtection() public {
        uint256 collateralIn = 100 * 10**18;

        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, collateralIn);
        (address marketAddr, ) = router.getMarketAtIndex(0);

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
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, collateralIn);
        (address marketAddr, ) = router.getMarketAtIndex(0);
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
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);

        vm.expectRevert(bytes("Invalid Market State"));
        router.settleMarket(marketAddr);
    }

    function test_RedeemCollateralPaysWinningSide() public {
        // Use static market to avoid ZScoreOutOfBounds from dynamic liquidity scaling
        vm.prank(admin);
        router.create("Test Market", "Desc", "Src", TEST_DUEL_KEY, false, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(user1);
        router.buyYes(marketAddr, 5 * 10**18, 0);
        vm.prank(user2);
        router.buyNo(marketAddr, 5 * 10**18, 0);

        uint256 user1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        uint256 user2No = IERC20(address(market.noToken())).balanceOf(user2);

        vm.warp(block.timestamp + DURATION);
        vm.prank(admin);
        market.adminResolve(1);

        vm.startPrank(user1);
        IERC20(address(market.yesToken())).approve(address(router), user1Yes);
        IERC20(address(market.noToken())).approve(address(router), user1Yes); // approve NO token too (callback transfers both)
        vm.stopPrank();

        vm.startPrank(user2);
        IERC20(address(market.yesToken())).approve(address(router), user2No);
        IERC20(address(market.noToken())).approve(address(router), user2No);
        vm.stopPrank();

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
        router.create("Zero Duration", "Desc", "Src", keccak256("zero-dur"), true, 0, 100 * 10**18);
        vm.stopPrank();
    }

    function test_GetPriceAfterDeadline() public {
        vm.prank(admin);
        router.create("Expiring Market", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);
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
        (address marketAddr, ) = router.getMarketAtIndex(0);
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

    function test_AdminSlashesBondOnWrongProposal() public {
        vm.prank(admin);
        router.create("Bond Slash Test", "Desc", "Src", TEST_DUEL_KEY, true, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + DURATION);

        // user1 proposes outcome=0 (needs bond)
        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        // user2 disputes
        vm.prank(user2);
        router.dispute(marketAddr);

        // Admin resolves with outcome=1 (proposer was WRONG)
        uint256 treasuryBefore = mUSD.balanceOf(treasury);
        uint256 proposerBefore = mUSD.balanceOf(user1);
        vm.prank(admin);
        market.adminResolve(1);

        assertEq(mUSD.balanceOf(treasury), treasuryBefore + bond, "Bond should go to treasury (slashed)");
        assertEq(mUSD.balanceOf(user1), proposerBefore, "Proposer should not get bond back");
    }

    function test_AdminReturnsBondOnCorrectProposal() public {
        vm.prank(admin);
        router.create("Bond Return Test", "Desc", "Src", SECOND_DUEL_KEY, true, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + DURATION);

        // user1 proposes outcome=0
        uint256 bond = market.bondValue();
        vm.prank(user1);
        mUSD.approve(address(router), bond);
        vm.prank(user1);
        router.proposerOutcome(marketAddr, 0);

        // user2 disputes
        vm.prank(user2);
        router.dispute(marketAddr);

        // Admin resolves with outcome=0 (proposer was RIGHT)
        uint256 proposerBefore = mUSD.balanceOf(user1);
        vm.prank(admin);
        market.adminResolve(0);

        assertEq(mUSD.balanceOf(user1), proposerBefore + bond, "Proposer should get bond back");
    }

    function test_RedeemCollateralRefundsCancelledMarkets() public {
        // Use static market to avoid ZScoreOutOfBounds from dynamic liquidity scaling
        vm.prank(admin);
        router.create("Cancelled Market", "Desc", "Src", SECOND_DUEL_KEY, false, DURATION, 100 * 10**18);
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(user1);
        router.buyYes(marketAddr, 5 * 10**18, 0);
        vm.prank(user2);
        router.buyNo(marketAddr, 5 * 10**18, 0);

        uint256 user1Yes = IERC20(address(market.yesToken())).balanceOf(user1);
        uint256 user2No = IERC20(address(market.noToken())).balanceOf(user2);

        vm.warp(block.timestamp + DURATION);
        vm.prank(admin);
        market.adminResolve(2);

        vm.startPrank(user1);
        IERC20(address(market.yesToken())).approve(address(router), user1Yes);
        IERC20(address(market.noToken())).approve(address(router), user1Yes);
        vm.stopPrank();

        vm.startPrank(user2);
        IERC20(address(market.yesToken())).approve(address(router), user2No);
        IERC20(address(market.noToken())).approve(address(router), user2No);
        vm.stopPrank();

        uint256 user1Before = mUSD.balanceOf(user1);
        uint256 user2Before = mUSD.balanceOf(user2);

        vm.prank(user1);
        router.redeem(marketAddr, user1Yes, 0);
        vm.prank(user2);
        router.redeem(marketAddr, 0, user2No);

        assertEq(mUSD.balanceOf(user1), user1Before + user1Yes, "YES holder should be refunded on cancellation");
        assertEq(mUSD.balanceOf(user2), user2Before + user2No, "NO holder should be refunded on cancellation");
    }
}
