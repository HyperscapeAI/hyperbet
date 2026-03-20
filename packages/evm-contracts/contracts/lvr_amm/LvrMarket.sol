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
import {DuelOutcomeOracle} from "../DuelOutcomeOracle.sol";

contract LvrMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

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
        uint256 indexed timestamp,
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

    address public immutable adminAddress;
    address public immutable routerAddress;
    address public immutable collateralToken;
    uint256 private liquidity;

    bool private liquidityInitialized;
    bool public immutable isDynamic;
    uint256 private immutable deadline;
    address public immutable treasuryAddress;
    uint256 public immutable feeBps;

    constructor(
        address router_,
        bool marketType_,
        uint256 duration,
        address collateral_,
        address admin_,
        address treasury_,
        uint256 feeBps_
    ) {
        require(router_ != address(0), "invalid router");
        require(collateral_ != address(0), "invalid collateral");
        require(admin_ != address(0), "invalid admin");
        require(treasury_ != address(0) || feeBps_ == 0, "invalid treasury");

        routerAddress = router_;
        isDynamic = marketType_;
        collateralToken = collateral_;
        adminAddress = admin_;
        treasuryAddress = treasury_;
        feeBps = feeBps_;

        deadline = block.timestamp + duration;
        state = MarketState.OPEN;
    }

    modifier isRouter() {
        require(msg.sender == routerAddress, "Invalid Caller Address");
        _;
    }

    // Trusted router callback transfers the proposer bond into this market before state advances.
    // slither-disable-next-line reentrancy-balance,reentrancy-no-eth,reentrancy-benign
    function proposeOutcome(uint256 outcomeValue, address proposerAddress) external isRouter nonReentrant {
        require(state == MarketState.OPEN, "Market Not Open");
        require(block.timestamp >= deadline, "Market not finished");
        require(outcomeValue == 0 || outcomeValue == 1, "Invalid outcome");
        require(proposerAddress != address(0), "invalid proposer");
        // Make a bond with the proposer to keep as collateral incase of false outcome
        IERC20 collateral = IERC20(collateralToken);
        uint256 balanceBefore = collateral.balanceOf(address(this));
        bytes memory data = abi.encode(collateralToken, proposerAddress);
        IMarketBondCallback(msg.sender).marketBondCallback(BOND_VALUE, data);
        require(collateral.balanceOf(address(this)) >= balanceBefore + BOND_VALUE);

        outcome = outcomeValue;
        state = MarketState.PENDING;
        resolutionTimestamp = block.timestamp + DISPUTE_WINDOW;
        proposer = proposerAddress;

        emit OutcomeProposed(outcomeValue, proposerAddress, resolutionTimestamp);
    }

    function dispute() external isRouter nonReentrant {
        require(state == MarketState.PENDING, "Challenge Window Not opened");
        // Break the bond 
        state = MarketState.DISPUTED;
        // set the market outcome through creator/resolver voting/admin
        
        emit MarketDisputed();
    }

    function settleMarket() external isRouter nonReentrant {
        require(block.timestamp >= resolutionTimestamp, "Challenge Window Open");
        // Return bond to proposer with Reward collected through market fees
        state = MarketState.RESOLVED;
        IERC20(collateralToken).safeTransfer(proposer, BOND_VALUE); // Add fees and then reward the proposer

        emit MarketSettled(outcome, proposer, BOND_VALUE);
    }

    function adminResolve(uint256 outcomeValue) external nonReentrant {
        require(msg.sender == adminAddress, "Only Admin can call this method");
        require(block.timestamp >= deadline, "Market not finished");
        require(outcomeValue == 0 || outcomeValue == 1, "Invalid outcome");
        require(state == MarketState.DISPUTED || state == MarketState.OPEN, "Invalid Market State");

        outcome = outcomeValue;
        state = MarketState.RESOLVED;

        // If proposer is intialized then return the bond
        if (proposer != address(0)) {
            IERC20(collateralToken).safeTransfer(proposer, BOND_VALUE);
        }

        emit MarketResolvedByAdmin(outcomeValue, msg.sender);
    }

    function settleFromOracle(address oracle, bytes32 duelKey) external isRouter nonReentrant {
        require(state == MarketState.OPEN || state == MarketState.PENDING || state == MarketState.DISPUTED, "Invalid Market State");

        DuelOutcomeOracle.DuelState memory duel = DuelOutcomeOracle(oracle).getDuel(duelKey);
        require(
            duel.status == DuelOutcomeOracle.DuelStatus.RESOLVED || duel.status == DuelOutcomeOracle.DuelStatus.CANCELLED,
            "Oracle duel not resolved"
        );

        if (duel.status == DuelOutcomeOracle.DuelStatus.CANCELLED) {
            // Cancelled duels resolve as draw — outcome doesn't matter, both tokens redeemable 1:1
            outcome = 2; // sentinel: no winner
        } else {
            // Side.A (1) → outcome 0 (YES wins), Side.B (2) → outcome 1 (NO wins)
            require(duel.winner == DuelOutcomeOracle.Side.A || duel.winner == DuelOutcomeOracle.Side.B, "Invalid winner");
            outcome = duel.winner == DuelOutcomeOracle.Side.A ? 0 : 1;
        }

        state = MarketState.RESOLVED;
        if (proposer != address(0)) {
            IERC20(collateralToken).safeTransfer(proposer, BOND_VALUE);
        }
        emit MarketSettled(outcome, msg.sender, 0);
    }

    function redeemCollateralWithToken(
        uint256 amountYesIn,
        uint256 amountNoIn,
        address redeemer
    ) external isRouter nonReentrant {
        require(state == MarketState.RESOLVED, "Market Not Resolved");

        bytes memory data = abi.encode(address(yesToken), address(noToken), redeemer);
        IMarketRedeemCallback(msg.sender).marketRedeemCallback(amountYesIn, amountNoIn, data);

        if(amountYesIn > 0) yesToken.burn(address(this), amountYesIn);
        if(amountNoIn > 0) noToken.burn(address(this), amountNoIn);

        uint256 payout = 0;
        if (outcome == 1) {
            payout = amountYesIn;
            IERC20(collateralToken).safeTransfer(redeemer, amountYesIn);
        } else {
            payout = amountNoIn;
            IERC20(collateralToken).safeTransfer(redeemer, amountNoIn);
        }

        emit CollateralRedeemed(redeemer, amountYesIn, amountNoIn, payout);
    }

    function initializeLiquidity(uint256 collateralIn) external isRouter nonReentrant returns(uint256){
        require(!liquidityInitialized, "Liquidity already Initialized");
        yesToken = new YesToken(address(this), collateralIn);
        noToken = new NoToken(address(this), collateralIn);
        liquidity = Math.calcInitialLiquidity(collateralIn);
        liquidityInitialized = true;
        
        emit MarketInitialized(liquidity, collateralIn, block.timestamp);
        return liquidity;
    }

    // Trusted router callback settles collateral into the market; nonReentrant + balance delta gate reentry.
    // slither-disable-next-line reentrancy-balance
    function buy(bool isBuyYes, uint256 amountIn, address buyer) public isRouter nonReentrant returns (uint256) {
        require(state == MarketState.OPEN, "Market Not Open");

        uint256 feeAmount = (amountIn * feeBps) / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        uint256 amountOut = _swap(!isBuyYes, int256(amountInAfterFee));

        IERC20 collateral = IERC20(collateralToken);
        bytes memory data = abi.encode(collateralToken, buyer);

        uint256 balanceBefore = collateral.balanceOf(address(this));
        IMarketBuyCallback(msg.sender).marketBuyCallback(amountIn, data);
        require(collateral.balanceOf(address(this)) >= balanceBefore + amountIn);

        if (feeAmount > 0 && treasuryAddress != address(0)) {
            collateral.safeTransfer(treasuryAddress, feeAmount);
        }

        yesToken.mint(address(this), amountInAfterFee);
        noToken.mint(address(this), amountInAfterFee);

        uint256 totalOut = amountInAfterFee + amountOut;
        if (isBuyYes) {
            IERC20(address(yesToken)).safeTransfer(buyer, totalOut);
        } else {
            IERC20(address(noToken)).safeTransfer(buyer, totalOut);
        }

        emit MarketBuy(buyer, isBuyYes, amountIn, amountOut);
        _emitPriceSnapshot();
        return totalOut;
    }

    // Trusted router callback settles input shares into the market; nonReentrant + balance delta gate reentry.
    // slither-disable-next-line reentrancy-balance
    function sell(bool isSellYes, uint256 amountIn, address seller) public isRouter nonReentrant returns (uint256) {
        require(state == MarketState.OPEN, "Market Not Open");

        address tokenIn = isSellYes ? address(yesToken) : address(noToken);
        uint256 feeAmount = (amountIn * feeBps) / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        uint256 amountOut = _swap(isSellYes, int256(amountInAfterFee));

        IERC20 inputToken = IERC20(tokenIn);
        uint256 tokenBalanceBefore = inputToken.balanceOf(address(this));
        bytes memory data = abi.encode(tokenIn, seller);
        IMarketSellCallback(msg.sender).marketSellCallback(amountIn, data);
        require(inputToken.balanceOf(address(this)) >= tokenBalanceBefore + amountIn);

        if (feeAmount > 0 && treasuryAddress != address(0)) {
            inputToken.safeTransfer(treasuryAddress, feeAmount);
        }

        if (isSellYes) {
            IERC20(address(noToken)).safeTransfer(seller, amountOut);
        } else {
            IERC20(address(yesToken)).safeTransfer(seller, amountOut);
        }

        emit MarketSell(seller, isSellYes, amountIn, amountOut);
        _emitPriceSnapshot();
        return amountOut;
    }

    function _swap(bool yesToNo, int256 amountIn) internal view returns(uint256){
        require(block.timestamp < deadline, "Market Expired");
        uint256 liq = isDynamic ? Math.calcLiquidity(liquidity, deadline, block.timestamp) : liquidity;

        int256 currentReserveYes = int256(IERC20(address(yesToken)).balanceOf(address(this)));
        int256 currentReserveNo = int256(IERC20(address(noToken)).balanceOf(address(this)));
        uint256 amountOut = SwapMath.getSwapAmount(yesToNo, currentReserveYes, currentReserveNo, liq, amountIn);
        return amountOut;
    }

    function getUserBalance(address user) public view returns(uint256) {
        return IERC20(address(yesToken)).balanceOf(user);
    }

    function getToken(bool tokenYes) public view returns(address) {
        return tokenYes ? address(yesToken) : address(noToken);
    }

    function getPriceYes() public view returns(uint256) {
        uint256 liq = isDynamic ? Math.calcLiquidity(liquidity, deadline, block.timestamp) : liquidity;
        return Math.calcPrice(yesToken.balanceOf(address(this)), noToken.balanceOf(address(this)), liq);
    }

    function getPriceNo() public view returns(uint256) {
        return 1e18 - getPriceYes(); // Prices sum to 1.0 (1e18 in WAD)
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
        return (
            state,
            deadline,
            outcome,
            liquidity,
            yesToken.balanceOf(address(this)),
            noToken.balanceOf(address(this)),
            getPriceYes(),
            getPriceNo()
        );
    }

    function _emitPriceSnapshot() internal {
        emit PriceSnapshot(
            block.timestamp,
            getPriceYes(),
            getPriceNo(),
            yesToken.balanceOf(address(this)),
            noToken.balanceOf(address(this))
        );
    }
}
