// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../contracts/lvr_amm/Router.sol";
import "../contracts/lvr_amm/LvrMarket.sol";
import "../contracts/lvr_amm/MockUSD.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "../contracts/lvr_amm/lib/Math.sol";

contract LvrMarketTest is Test {
    Router public router;
    MockUSD public mUSD;
    address public admin = address(1);
    address public treasury = address(4);
    address public user1 = address(2);
    address public user2 = address(3);

    uint256 public constant INITIAL_BALANCE = 10000 * 10**18;
    uint256 public constant DURATION = 1 days;
    uint256 public constant FEE_BPS = 50; // 0.5%

    function setUp() public {
        vm.startPrank(admin);

        mUSD = new MockUSD();
        router = new Router(address(mUSD), treasury, FEE_BPS, admin);

        mUSD.mint(user1, INITIAL_BALANCE);
        mUSD.mint(user2, INITIAL_BALANCE);

        vm.stopPrank();

        vm.prank(user1);
        mUSD.approve(address(router), type(uint256).max);

        vm.prank(user2);
        mUSD.approve(address(router), type(uint256).max);
    }

    function test_CreateMarket() public {
        vm.startPrank(user1);

        uint256 collateralIn = 100 * 10**18;

        router.create(
            "Will BTC hit 100k?",
            "Market for BTC price event",
            "coingecko",
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
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;

        router.create("Test Market", "Desc", "Src", true, DURATION, collateralIn);

        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        uint256 buyAmount = 10 * 10**18;

        vm.warp(block.timestamp + 1 hours);

        router.buyYes(marketAddr, buyAmount, 0); // minAmountOut = 0 for basic test

        uint256 userYesBalance = market.yesToken().balanceOf(user1);
        assertTrue(userYesBalance > 0, "User should receive YES tokens");

        vm.stopPrank();
    }

    function test_Fuzz_BuyNo(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 10**17, 50 * 10**18);

        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;

        router.create("Test Market", "Desc", "Src", true, DURATION, collateralIn);

        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        vm.stopPrank();

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

    function test_SlippageProtection() public {
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;

        router.create("Test Market", "Desc", "Src", true, DURATION, collateralIn);
        (address marketAddr, ) = router.getMarketAtIndex(0);

        vm.warp(block.timestamp + 1 hours);

        // Expect revert with impossibly high minAmountOut
        vm.expectRevert(Router.SlippageExceeded.selector);
        router.buyYes(marketAddr, 10 * 10**18, type(uint256).max);

        vm.stopPrank();
    }

    function test_PriceReadExecutionParity() public {
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;

        router.create("Test Market", "Desc", "Src", true, DURATION, collateralIn);
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);

        // At creation, with equal reserves, price should be ~0.5
        uint256 priceYes = market.getPriceYes();
        uint256 priceNo = market.getPriceNo();

        // Complement pricing: priceYes + priceNo == 1e18
        assertEq(priceYes + priceNo, 1e18, "Complement pricing violated");

        // At equal reserves, price should be around 0.5e18
        assertApproxEqAbs(priceYes, 0.5e18, 0.01e18, "Initial price should be ~0.5");

        vm.stopPrank();
    }
}
