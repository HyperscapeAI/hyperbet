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
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyKnownMarket(address market) {
        require(isKnownMarket[market], "Unknown market");
        _;
    }

    modifier onlyKnownMarketSender() {
        require(isKnownMarket[msg.sender], "Unknown market");
        _;
    }

    constructor(address _mUSD, address _treasury, uint256 _feeBps){
        require(_mUSD != address(0), "Invalid collateral");
        require(_treasury != address(0), "Invalid treasury");
        require(_feeBps <= MAX_FEE_BPS, "Invalid fee bps");
        mUSD = IERC20(_mUSD);
        owner = msg.sender;
        treasury = _treasury;
        feeBps = _feeBps;
    }

    function setFeeConfig(address _treasury, uint256 _feeBps) public onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        require(_feeBps <= MAX_FEE_BPS, "Invalid fee bps");
        treasury = _treasury;
        feeBps = _feeBps;
    }
    function create(
        string memory title, 
        string memory description,
        string memory resolutionSource,
        bool isDynamic, 
        uint256 duration, 
        uint256 collateralIn
    ) public {
        // A new market is deployed
        bytes32 marketId = keccak256(abi.encodePacked(title, msg.sender, block.timestamp));
        require(!markets[marketId].initialized, "Market Already Exists");

        LvrMarket market = new LvrMarket(address(this), isDynamic, duration, address(mUSD), msg.sender, treasury, feeBps);
        
        // Transfer USD token to market contract
        mUSD.safeTransferFrom(msg.sender, address(market), collateralIn);
        uint256 liquidity = market.initializeLiquidity(collateralIn);

        markets[marketId] = MarketInfo({
            market: address(market),
            liquidity: liquidity,
            initialized: true,
            metadata: MarketMetadata({
                title: title,
                description: description,
                resolutionSource: resolutionSource
            })
        });

        isKnownMarket[address(market)] = true;
        allMarkets.push(address(market));
        allMarketIds.push(marketId);
        
        emit MarketCreated(
            marketId, 
            address(market), 
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
        require(index < allMarkets.length, "Index out of bounds");
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
        require(info.initialized, "Market does not exist");
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

    function buyYes(address market, uint256 collateralIn) public onlyKnownMarket(market) {
        // Takes mUSD from user
        // Mints Yes + No token
        // Sells No token to AMM
        // Sends corresponding Yes token to User

        LvrMarket(market).buy(true, collateralIn, msg.sender);
    }

    function buyNo(address market, uint256 collateralIn) public onlyKnownMarket(market) {
        LvrMarket(market).buy(false, collateralIn, msg.sender);
    }

    function sellYes(address market, uint256 tokenIn) public onlyKnownMarket(market) {
        // Takes yesToken from the user
        // Sells Yes token to AMM
        // Sends corresponding No token to User
        LvrMarket(market).sell(true, tokenIn, msg.sender);
    }

    function sellNo(address market, uint256 tokenIn) public onlyKnownMarket(market) {
        LvrMarket(market).sell(false, tokenIn, msg.sender);
    }

    function proposerOutcome(address market, uint256 _outcome) public onlyKnownMarket(market) {
        LvrMarket(market).proposeOutcome(_outcome, msg.sender);
    }

    function dispute(address market) public onlyKnownMarket(market) {
        LvrMarket(market).dispute();
    }

    function settleMarket(address market) public onlyKnownMarket(market) {
        LvrMarket(market).settleMarket();
    }

    function redeem(address market, uint256 amountYes, uint256 amountNo) public onlyKnownMarket(market) {
        LvrMarket(market).redeemCollateralWithToken(amountYes, amountNo, msg.sender);
    }

    // Callbacks

    function marketBuyCallback(uint256 collateralIn, bytes calldata data)
        external
        override
        onlyKnownMarketSender
    {
        (address collateral, address buyer) = abi.decode(data, (address, address));

        // msg.sender is the Market Contract which calls the callback
        IERC20(collateral).safeTransferFrom(buyer, msg.sender, collateralIn);
    }

    function marketSellCallback(uint256 tokenIn, bytes calldata data)
        external
        override
        onlyKnownMarketSender
    {
        (address tokenToSell, address seller) = abi.decode(data, (address, address));

        IERC20(tokenToSell).safeTransferFrom(seller, msg.sender, tokenIn);
    }

    function marketRedeemCallback(uint256 amountYes, uint256 amountNo, bytes calldata data)
        external
        override
        onlyKnownMarketSender
    {
        (address yesToken, address noToken, address redeemer) = abi.decode(data, (address, address, address));

        IERC20(yesToken).safeTransferFrom(redeemer, msg.sender, amountYes);
        IERC20(noToken).safeTransferFrom(redeemer, msg.sender, amountNo);
    }

    function marketBondCallback(uint256 bond, bytes calldata data)
        external
        override
        onlyKnownMarketSender
    {
        (address collateral, address proposer) = abi.decode(data, (address, address));

        IERC20(collateral).safeTransferFrom(proposer, msg.sender, bond);
    }
}
