// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/lvr_amm/Router.sol";
import "../contracts/lvr_amm/LvrMarket.sol";
import "../contracts/lvr_amm/MockUSD.sol";

contract LvrMarketTest is Test {
    Router public router;
    MockUSD public mUSD;
    address public admin = address(1);
    address public treasury = address(4);
    address public user1 = address(2);
    address public user2 = address(3);
    
    uint256 public constant INITIAL_BALANCE = 10000 * 10**18;
    uint256 public constant DURATION = 1 days;

    function setUp() public {
        vm.startPrank(admin);
        
        // Deploy Mock USD
        mUSD = new MockUSD();
        
        // Deploy Router
        router = new Router(address(mUSD), treasury, 0);
        
        // Setup users
        mUSD.mint(user1, INITIAL_BALANCE);
        mUSD.mint(user2, INITIAL_BALANCE);
        
        vm.stopPrank();
        
        // Approve router for users
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
            true, // isDynamic
            DURATION,
            collateralIn
        );
        
        assertEq(router.getMarketCount(), 1);
        (address marketAddr, bytes32 id) = router.getMarketAtIndex(0);
        
        (address mkt, uint256 liq, string memory title, ,) = router.getMarketMetadata(id);
        
        assertEq(mkt, marketAddr);
        assertEq(title, "Will BTC hit 100k?");
        assertTrue(liq > 0);
        
        // Check market balances
        assertEq(mUSD.balanceOf(marketAddr), collateralIn);
        
        vm.stopPrank();
    }
    
    function test_BuyYes() public {
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;
        
        router.create(
            "Test Market",
            "Desc",
            "Src",
            true,
            DURATION,
            collateralIn
        );
        
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);
        
        uint256 buyAmount = 10 * 10**18;
        
        // Advance time a little to test dynamic liquidity
        vm.warp(block.timestamp + 1 hours);
        
        router.buyYes(marketAddr, buyAmount);
        
        uint256 userYesBalance = market.yesToken().balanceOf(user1);
        assertTrue(userYesBalance > buyAmount, "User should receive YES tokens");
        
        vm.stopPrank();
    }

    function test_Fuzz_BuyNo(uint256 buyAmount) public {
        // Bound to reasonable amounts
        buyAmount = bound(buyAmount, 10**17, 50 * 10**18);
        
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;
        
        router.create(
            "Test Market",
            "Desc",
            "Src",
            true,
            DURATION,
            collateralIn
        );
        
        (address marketAddr, ) = router.getMarketAtIndex(0);
        LvrMarket market = LvrMarket(marketAddr);
        
        // We use user2 to buy
        vm.stopPrank();
        
        vm.startPrank(user2);
        router.buyNo(marketAddr, buyAmount);
        
        uint256 userNoBalance = market.noToken().balanceOf(user2);
        assertTrue(userNoBalance > buyAmount, "User should receive NO tokens");
        
        vm.stopPrank();
    }

    function test_OnlyOwnerCanSetFeeConfig() public {
        vm.prank(user1);
        vm.expectRevert(Router.OnlyOwner.selector);
        router.setFeeConfig(user1, 100);

        vm.prank(admin);
        router.setFeeConfig(user2, 100);

        assertEq(router.treasury(), user2);
        assertEq(router.feeBps(), 100);
    }

    function test_RejectsInvalidFeeConfig() public {
        vm.startPrank(admin);
        vm.expectRevert(Router.InvalidFeeBps.selector);
        new Router(address(mUSD), treasury, 10_001);
        vm.expectRevert(Router.InvalidFeeBps.selector);
        router.setFeeConfig(treasury, 10_001);
        vm.stopPrank();
    }

    function test_CallbacksRejectUnknownMarkets() public {
        vm.prank(user1);
        vm.expectRevert(Router.UnknownMarket.selector);
        router.marketBuyCallback(1 ether, user1);
    }

    function test_SettleRequiresPendingOutcome() public {
        vm.startPrank(user1);
        uint256 collateralIn = 100 * 10**18;

        router.create(
            "Test Market",
            "Desc",
            "Src",
            true,
            DURATION,
            collateralIn
        );

        (address marketAddr, ) = router.getMarketAtIndex(0);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(LvrMarket.InvalidMarketState.selector);
        router.settleMarket(marketAddr);
    }
}
