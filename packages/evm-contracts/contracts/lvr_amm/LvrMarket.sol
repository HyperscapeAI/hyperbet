// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {YesToken, NoToken} from "./Token.sol";
import {SwapMath} from "./lib/SwapMath.sol";
import {Math} from "./lib/Math.sol";
import {IMarketBuyCallback} from "./interfaces/IMarketBuyCallback.sol";
import {IMarketSellCallback} from "./interfaces/IMarketSellCallback.sol";
import {IMarketRedeemCallback} from "./interfaces/IMarketRedeemCallback.sol";
import {IMarketBondCallback} from "./interfaces/IMarketBondCallback.sol";

contract LvrMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_FEE_BPS = 10_000;
    uint256 private constant PRICE_SCALE = 1e18;

    error InvalidRouter();
    error InvalidCollateral();
    error InvalidAdmin();
    error InvalidTreasury();
    error InvalidFeeBps();
    error InvalidCaller();
    error MarketNotOpen();
    error MarketNotFinished();
    error InvalidOutcome();
    error InvalidProposer();
    error ChallengeWindowNotOpened();
    error ChallengeWindowOpen();
    error InvalidMarketState();
    error MarketNotResolved();
    error LiquidityAlreadyInitialized();
    error MarketExpired();

    event MarketInitialized(uint256 liquidity, uint256 collateralIn, uint256 timestamp);
    
    event OutcomeProposed(uint256 outcome, address indexed proposer, uint256 resolutionTimestamp);
    event MarketDisputed();
    event MarketSettled(uint256 outcome, address indexed proposer, uint256 bondReturned);
    event MarketResolvedByAdmin(uint256 outcome, address indexed admin);
    
    event MarketBuy(address indexed buyer, bool isBuyYes, uint256 amountIn, uint256 amountOut);
    event MarketSell(address indexed seller, bool isSellYes, uint256 amountIn, uint256 amountOut);
    event CollateralRedeemed(address indexed redeemer, uint256 amountYes, uint256 amountNo, uint256 payout);

    // Price snapshot for frontend charting - emitted on every trade
    event PriceSnapshot(
        uint256 timestamp,
        uint256 priceYes,
        uint256 priceNo,
        uint256 reserveYes,
        uint256 reserveNo
    );

    enum MarketState {
        OPEN,
        CLOSED,
        PENDING,
        DISPUTED,
        RESOLVED
    }

    uint256 constant DISPUTE_WINDOW = 5 minutes; // 5 mins
    uint256 constant BOND_VALUE = 50;
    MarketState public state;
    uint256 private resolutionTimestamp;
    uint256 private outcome;
    address private proposer = address(0);

    YesToken public yesToken;
    NoToken public noToken;

    address public immutable i_admin;
    address public immutable i_router;
    address public immutable i_collateral;
    bool public immutable isDynamic;
    uint256 private liquidity;

    bool private liquidityInitialized;
    uint256 private immutable deadline;
    address public immutable i_treasury;
    uint256 public immutable feeBps;

    constructor(address _router, bool _type, uint256 duration, address _collateral, address admin, address treasury, uint256 _feeBps){
        if (_router == address(0)) revert InvalidRouter();
        if (_collateral == address(0)) revert InvalidCollateral();
        if (admin == address(0)) revert InvalidAdmin();
        if (treasury == address(0)) revert InvalidTreasury();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        i_router = _router;
        isDynamic = _type;
        i_collateral = _collateral;
        i_admin = admin;
        i_treasury = treasury;
        feeBps = _feeBps;

        deadline = block.timestamp + duration;
        state = MarketState.OPEN;
    }

    modifier isRouter() {
        if (msg.sender != i_router) revert InvalidCaller();
        _;
    }

    function proposeOutcome(uint256 _outcome, address _proposer) external isRouter nonReentrant {
        if (state != MarketState.OPEN) revert MarketNotOpen();
        if (block.timestamp < deadline) revert MarketNotFinished();
        if (_outcome > 1) revert InvalidOutcome();
        if (_proposer == address(0)) revert InvalidProposer();
        // Make a bond with the proposer to keep as collateral incase of false outcome
        IERC20 collateral = IERC20(i_collateral);
        uint256 balanceBefore = collateral.balanceOf(address(this));

        outcome = _outcome;
        state = MarketState.PENDING;
        resolutionTimestamp = block.timestamp + DISPUTE_WINDOW;
        proposer = _proposer;

        IMarketBondCallback(msg.sender).marketBondCallback(BOND_VALUE, _proposer);
        require(collateral.balanceOf(address(this)) >= balanceBefore + BOND_VALUE);

        emit OutcomeProposed(_outcome, _proposer, resolutionTimestamp);
    }

    function dispute() external isRouter{
        if (state != MarketState.PENDING) revert ChallengeWindowNotOpened();
        // Break the bond 
        state = MarketState.DISPUTED;
        // set the market outcome through creator/resolver voting/admin
        
        emit MarketDisputed();
    }

    function settleMarket() external isRouter nonReentrant {
        if (state != MarketState.PENDING) revert InvalidMarketState();
        if (block.timestamp < resolutionTimestamp) revert ChallengeWindowOpen();
        address payoutRecipient = proposer;
        uint256 resolvedOutcome = outcome;
        state = MarketState.RESOLVED;
        // Return bond to proposer with Reward collected through market fees
        IERC20(i_collateral).safeTransfer(payoutRecipient, BOND_VALUE);

        emit MarketSettled(resolvedOutcome, payoutRecipient, BOND_VALUE);
    }

    function adminResolve(uint256 _outcome) external nonReentrant {
        if (msg.sender != i_admin) revert InvalidCaller();
        if (block.timestamp < deadline) revert MarketNotFinished();
        if (_outcome > 1) revert InvalidOutcome();
        if (state != MarketState.DISPUTED && state != MarketState.OPEN) revert InvalidMarketState();

        address payoutRecipient = proposer;
        // If proposer is intialized then return the bond
        outcome = _outcome;
        state = MarketState.RESOLVED;
        if (payoutRecipient != address(0)) {
            IERC20(i_collateral).safeTransfer(payoutRecipient, BOND_VALUE);
        }

        emit MarketResolvedByAdmin(_outcome, msg.sender);
    }

    function redeemCollateralWithToken(uint256 amountYesIn, uint256 amountNoIn, address redeemer)
        external
        isRouter
        nonReentrant
    {
        if (state != MarketState.RESOLVED) revert MarketNotResolved();

        YesToken yes = yesToken;
        NoToken no = noToken;
        IMarketRedeemCallback(msg.sender).marketRedeemCallback(
            amountYesIn,
            amountNoIn,
            address(yes),
            address(no),
            redeemer
        );

        if(amountYesIn > 0) yes.burn(address(this), amountYesIn);
        if(amountNoIn > 0) no.burn(address(this), amountNoIn);

        uint256 payout = 0;
        if(outcome == 1) {
            payout = amountYesIn;
            IERC20(i_collateral).safeTransfer(redeemer, amountYesIn);
        }else {
            payout = amountNoIn;
            IERC20(i_collateral).safeTransfer(redeemer, amountNoIn);
        }

        emit CollateralRedeemed(redeemer, amountYesIn, amountNoIn, payout);
    }

    function initializeLiquidity(uint256 collateralIn) external isRouter returns(uint256){
        if (liquidityInitialized) revert LiquidityAlreadyInitialized();
        yesToken = new YesToken(address(this), collateralIn);
        noToken = new NoToken(address(this), collateralIn);
        liquidity = Math.calcInitialLiquidity(collateralIn);
        liquidityInitialized = true;
        
        emit MarketInitialized(liquidity, collateralIn, block.timestamp);
        return liquidity;
    }

    function buy(bool isBuyYes, uint256 amountIn, address buyer) external isRouter nonReentrant {
        if (state != MarketState.OPEN) revert MarketNotOpen();
        IERC20 collateral = IERC20(i_collateral);
        YesToken yes = yesToken;
        NoToken no = noToken;

        uint256 feeAmount;
        uint256 amountInAfterFee;
        unchecked {
            feeAmount = (amountIn * feeBps) / 10000;
            amountInAfterFee = amountIn - feeAmount;
        }

        // Calculates amount of tokens to give after
        uint256 amountOut = _swap(!isBuyYes, int256(amountInAfterFee));

        uint256 balanceBefore = collateral.balanceOf(address(this));

        // Call the callback function in the router contract which transfers collateral from user to market
        IMarketBuyCallback(msg.sender).marketBuyCallback(amountIn, buyer);
        // Collateral is transferred to the Market

        require(collateral.balanceOf(address(this)) >= balanceBefore + amountIn);

        if (feeAmount > 0) {
            collateral.safeTransfer(i_treasury, feeAmount);
        }

        // Mints yes and no tokens
        yes.mint(address(this), amountInAfterFee);
        no.mint(address(this), amountInAfterFee);

        // returns yes tokens to the user
        unchecked {
            if(isBuyYes){
                IERC20(address(yes)).safeTransfer(buyer, amountInAfterFee + amountOut);
            }else{
                IERC20(address(no)).safeTransfer(buyer, amountInAfterFee + amountOut);
            }
        }

        emit MarketBuy(buyer, isBuyYes, amountIn, amountOut);
        _emitPriceSnapshot();
    }

    function sell(bool isSellYes, uint256 amountIn, address seller) external isRouter nonReentrant {
        if (state != MarketState.OPEN) revert MarketNotOpen();

        YesToken yes = yesToken;
        NoToken no = noToken;
        address tokenIn = isSellYes ? address(yes) : address(no);
        uint256 feeAmount;
        uint256 amountInAfterFee;
        unchecked {
            feeAmount = (amountIn * feeBps) / 10000;
            amountInAfterFee = amountIn - feeAmount;
        }

        uint256 amountOut = _swap(isSellYes, int256(amountInAfterFee));

        uint256 tokenBalanceBefore = IERC20(tokenIn).balanceOf(address(this));

        IMarketSellCallback(msg.sender).marketSellCallback(amountIn, tokenIn, seller);

        require(IERC20(tokenIn).balanceOf(address(this)) >= tokenBalanceBefore + amountIn);

        if (feeAmount > 0) {
            IERC20(tokenIn).safeTransfer(i_treasury, feeAmount);
        }

        if(isSellYes){
            IERC20(address(no)).safeTransfer(seller, amountOut);
        }else{
            IERC20(address(yes)).safeTransfer(seller, amountOut);
        }

        emit MarketSell(seller, isSellYes, amountIn, amountOut);
        _emitPriceSnapshot();
    }

    function _swap(bool yesToNo, int256 amountIn) internal view returns(uint256){
        if (block.timestamp >= deadline) revert MarketExpired();
        uint256 liq = isDynamic ? Math.calcLiquidity(liquidity, deadline, block.timestamp) : liquidity;

        (uint256 reserveYes, uint256 reserveNo) = _getReserves();
        int256 currentReserveYes = int256(reserveYes);
        int256 currentReserveNo = int256(reserveNo);
        uint256 amountOut = SwapMath.getSwapAmount(yesToNo, currentReserveYes, currentReserveNo, liq, amountIn);
        return amountOut;
    }

    function getUserBalance(address user) external view returns(uint256) {
        return IERC20(address(yesToken)).balanceOf(user);
    }

    function getToken(bool tokenYes) external view returns(address) {
        return tokenYes ? address(yesToken) : address(noToken);
    }

    function getPriceYes() public view returns(uint256) {
        (uint256 reserveYes, uint256 reserveNo) = _getReserves();
        return _getPriceYes(reserveYes, reserveNo);
    }

    function getPriceNo() public view returns(uint256) {
        (uint256 reserveYes, uint256 reserveNo) = _getReserves();
        return PRICE_SCALE - _getPriceYes(reserveYes, reserveNo); // Prices sum to 1.0 (1e18 in WAD)
    }

    function getMarketDetails() external view returns (
        MarketState currentState,
        uint256 marketDeadline,
        uint256 marketOutcome,
        uint256 marketLiquidity,
        uint256 reserveYes,
        uint256 reserveNo,
        uint256 priceYes,
        uint256 priceNo
    ) {
        (uint256 reserveYesValue, uint256 reserveNoValue) = _getReserves();
        uint256 priceYesValue = _getPriceYes(reserveYesValue, reserveNoValue);
        return (
            state,
            deadline,
            outcome,
            liquidity,
            reserveYesValue,
            reserveNoValue,
            priceYesValue,
            PRICE_SCALE - priceYesValue
        );
    }

    function _emitPriceSnapshot() internal {
        (uint256 reserveYes, uint256 reserveNo) = _getReserves();
        uint256 priceYes = _getPriceYes(reserveYes, reserveNo);
        emit PriceSnapshot(
            block.timestamp,
            priceYes,
            PRICE_SCALE - priceYes,
            reserveYes,
            reserveNo
        );
    }

    function _getPriceYes(uint256 reserveYes, uint256 reserveNo) internal view returns (uint256) {
        return Math.calcPrice(reserveYes, reserveNo, liquidity);
    }

    function _getReserves() internal view returns (uint256 reserveYes, uint256 reserveNo) {
        reserveYes = yesToken.balanceOf(address(this));
        reserveNo = noToken.balanceOf(address(this));
    }
}
