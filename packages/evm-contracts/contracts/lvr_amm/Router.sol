// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LvrMarket} from "./LvrMarket.sol";
import {IMarketBuyCallback} from "./interfaces/IMarketBuyCallback.sol";
import {IMarketSellCallback} from "./interfaces/IMarketSellCallback.sol";
import {IMarketRedeemCallback} from "./interfaces/IMarketRedeemCallback.sol";   
import {IMarketBondCallback} from "./interfaces/IMarketBondCallback.sol";

contract Router is IMarketBuyCallback, IMarketSellCallback, IMarketRedeemCallback, IMarketBondCallback{
    using SafeERC20 for IERC20;

    uint256 private constant MAX_FEE_BPS = 10_000;

    error InvalidCollateral();
    error InvalidTreasury();
    error InvalidFeeBps();
    error OnlyOwner();
    error UnknownMarket();
    error MarketAlreadyExists();
    error IndexOutOfBounds();
    error MarketDoesNotExist();

    // Enhanced event with full metadata for frontend indexing
    event MarketCreated(
        bytes32 indexed marketId, 
        address indexed market,
        address indexed creator,
        string title,
        string description,
        string resolutionSource,
        uint256 deadline,
        uint256 liquidity
    );

    struct MarketMetadata {
        string title;
        string description;
        string resolutionSource;
    }

    struct MarketInfo {
        address market;
        uint256 liquidity;
        bool initialized;
        MarketMetadata metadata;
    }

    mapping(bytes32 marketId => MarketInfo info) public markets;
    mapping(address market => bool) public isKnownMarket;
    address[] public allMarkets; // Array for enumeration
    bytes32[] public allMarketIds; // Corresponding market IDs
    IERC20 public immutable mUSD; // Collateral Token
    address public immutable owner;
    address public treasury;     // Protocol Treasury
    uint256 public feeBps;       // Global Swap Fee Bps

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyKnownMarket(address market) {
        if (!isKnownMarket[market]) revert UnknownMarket();
        _;
    }

    modifier onlyKnownMarketSender() {
        if (!isKnownMarket[msg.sender]) revert UnknownMarket();
        _;
    }

    constructor(address _mUSD, address _treasury, uint256 _feeBps){
        if (_mUSD == address(0)) revert InvalidCollateral();
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        mUSD = IERC20(_mUSD);
        owner = msg.sender;
        treasury = _treasury;
        feeBps = _feeBps;
    }

    function setFeeConfig(address _treasury, uint256 _feeBps) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        treasury = _treasury;
        feeBps = _feeBps;
    }

    function create(
        string calldata title, 
        string calldata description,
        string calldata resolutionSource,
        bool isDynamic, 
        uint256 duration, 
        uint256 collateralIn
    ) external {
        // A new market is deployed
        bytes32 marketId = keccak256(abi.encodePacked(title, msg.sender, block.timestamp));
        MarketInfo storage info = markets[marketId];
        if (info.initialized) revert MarketAlreadyExists();

        LvrMarket market = new LvrMarket(address(this), isDynamic, duration, address(mUSD), msg.sender, treasury, feeBps);
        address marketAddress = address(market);
        
        // Transfer USD token to market contract
        mUSD.safeTransferFrom(msg.sender, marketAddress, collateralIn);
        uint256 liquidity = market.initializeLiquidity(collateralIn);

        info.market = marketAddress;
        info.liquidity = liquidity;
        info.initialized = true;
        info.metadata.title = title;
        info.metadata.description = description;
        info.metadata.resolutionSource = resolutionSource;

        isKnownMarket[marketAddress] = true;
        allMarkets.push(marketAddress);
        allMarketIds.push(marketId);
        
        emit MarketCreated(
            marketId, 
            marketAddress, 
            msg.sender,
            title,
            description,
            resolutionSource,
            block.timestamp + duration,
            liquidity
        );
    }

    // View functions for frontend enumeration
    function getMarketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function getMarketAtIndex(uint256 index) external view returns (address market, bytes32 marketId) {
        if (index >= allMarkets.length) revert IndexOutOfBounds();
        return (allMarkets[index], allMarketIds[index]);
    }

    function getMarketMetadata(bytes32 marketId) external view returns (
        address market,
        uint256 liquidity,
        string memory title,
        string memory description,
        string memory resolutionSource
    ) {
        MarketInfo storage info = markets[marketId];
        if (!info.initialized) revert MarketDoesNotExist();
        return (
            info.market,
            info.liquidity,
            info.metadata.title,
            info.metadata.description,
            info.metadata.resolutionSource
        );
    }

    function getAllMarkets() external view returns (address[] memory) {
        return allMarkets;
    }

    function buyYes(address market, uint256 collateralIn) external onlyKnownMarket(market) {
        // Takes mUSD from user
        // Mints Yes + No token
        // Sells No token to AMM
        // Sends corresponding Yes token to User

        LvrMarket(market).buy(true, collateralIn, msg.sender);
    }

    function buyNo(address market, uint256 collateralIn) external onlyKnownMarket(market) {
        LvrMarket(market).buy(false, collateralIn, msg.sender);
    }

    function sellYes(address market, uint256 tokenIn) external onlyKnownMarket(market) {
        // Takes yesToken from the user
        // Sells Yes token to AMM
        // Sends corresponding No token to User
        LvrMarket(market).sell(true, tokenIn, msg.sender);
    }

    function sellNo(address market, uint256 tokenIn) external onlyKnownMarket(market) {
        LvrMarket(market).sell(false, tokenIn, msg.sender);
    }

    function proposerOutcome(address market, uint256 _outcome) external onlyKnownMarket(market) {
        LvrMarket(market).proposeOutcome(_outcome, msg.sender);
    }

    function dispute(address market) external onlyKnownMarket(market) {
        LvrMarket(market).dispute();
    }

    function settleMarket(address market) external onlyKnownMarket(market) {
        LvrMarket(market).settleMarket();
    }

    function redeem(address market, uint256 amountYes, uint256 amountNo) external onlyKnownMarket(market) {
        LvrMarket(market).redeemCollateralWithToken(amountYes, amountNo, msg.sender);
    }

    // Callbacks

    function marketBuyCallback(uint256 collateralIn, address buyer)
        external
        override
        onlyKnownMarketSender
    {
        // msg.sender is the Market Contract which calls the callback
        mUSD.safeTransferFrom(buyer, msg.sender, collateralIn);
    }

    function marketSellCallback(uint256 tokenIn, address tokenToSell, address seller)
        external
        override
        onlyKnownMarketSender
    {
        IERC20(tokenToSell).safeTransferFrom(seller, msg.sender, tokenIn);
    }

    function marketRedeemCallback(
        uint256 amountYes,
        uint256 amountNo,
        address yesToken,
        address noToken,
        address redeemer
    )
        external
        override
        onlyKnownMarketSender
    {
        IERC20(yesToken).safeTransferFrom(redeemer, msg.sender, amountYes);
        IERC20(noToken).safeTransferFrom(redeemer, msg.sender, amountNo);
    }

    function marketBondCallback(uint256 bond, address proposer)
        external
        override
        onlyKnownMarketSender
    {
        mUSD.safeTransferFrom(proposer, msg.sender, bond);
    }
}
