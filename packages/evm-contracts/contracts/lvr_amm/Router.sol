// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DuelOutcomeOracle} from "../DuelOutcomeOracle.sol";
import {LvrMarket} from "./LvrMarket.sol";
import {IMarketBuyCallback} from "./interfaces/IMarketBuyCallback.sol";
import {IMarketSellCallback} from "./interfaces/IMarketSellCallback.sol";
import {IMarketRedeemCallback} from "./interfaces/IMarketRedeemCallback.sol";
import {IMarketBondCallback} from "./interfaces/IMarketBondCallback.sol";

contract Router is AccessControl, ReentrancyGuard, IMarketBuyCallback, IMarketSellCallback, IMarketRedeemCallback, IMarketBondCallback{
    using SafeERC20 for IERC20;

    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");

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
    address[] public allMarkets; // Array for enumeration
    bytes32[] public allMarketIds; // Corresponding market IDs
    uint256 public constant MAX_FEE_BPS = 1000; // 10% cap

    IERC20 public immutable mUSD; // Collateral Token
    DuelOutcomeOracle public immutable duelOracle;
    address public treasury;     // Protocol Treasury
    uint256 public feeBps;       // Global Swap Fee Bps

    mapping(address => bool) public allowedMarkets; // Market allowlist for callbacks

    error FeeTooHigh();
    error MarketNotAllowed();
    error SlippageExceeded();

    event FeeConfigUpdated(address indexed treasury, uint256 feeBps);

    constructor(address _mUSD, address _oracle, address _treasury, uint256 _feeBps, address admin){
        require(_mUSD != address(0), "invalid mUSD");
        require(_oracle != address(0), "invalid oracle");
        require(_treasury != address(0) || _feeBps == 0, "invalid treasury");
        require(admin != address(0), "invalid admin");
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        mUSD = IERC20(_mUSD);
        duelOracle = DuelOutcomeOracle(_oracle);
        treasury = _treasury;
        feeBps = _feeBps;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_OPERATOR_ROLE, admin);
    }

    modifier onlyAllowedMarket() {
        if (!allowedMarkets[msg.sender]) revert MarketNotAllowed();
        _;
    }

    function setFeeConfig(address _treasury, uint256 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = _treasury;
        feeBps = _feeBps;
        emit FeeConfigUpdated(_treasury, _feeBps);
    }
    function create(
        string memory title, 
        string memory description,
        string memory resolutionSource,
        bytes32 duelKey,
        bool isDynamic, 
        uint256 duration, 
        uint256 collateralIn
    ) public onlyRole(MARKET_OPERATOR_ROLE) {
        // A new market is deployed
        bytes32 marketId = keccak256(abi.encode(title, msg.sender, block.timestamp));
        require(!markets[marketId].initialized, "Market Already Exists");

        LvrMarket market =
            new LvrMarket(address(this), duelKey, address(duelOracle), isDynamic, duration, address(mUSD), msg.sender, treasury, feeBps);

        // Transfer USD token to market contract
        mUSD.safeTransferFrom(msg.sender, address(market), collateralIn);
        uint256 liquidity = market.initializeLiquidity(collateralIn);

        // Add to allowlist AFTER successful initialization to prevent callbacks to uninitialized markets
        allowedMarkets[address(market)] = true;

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

    function buyYes(address market, uint256 collateralIn, uint256 minAmountOut) external nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        uint256 amountOut = LvrMarket(market).buy(true, collateralIn, msg.sender);
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    function buyNo(address market, uint256 collateralIn, uint256 minAmountOut) external nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        uint256 amountOut = LvrMarket(market).buy(false, collateralIn, msg.sender);
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    function sellYes(address market, uint256 tokenIn, uint256 minAmountOut) external nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        uint256 amountOut = LvrMarket(market).sell(true, tokenIn, msg.sender);
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    function sellNo(address market, uint256 tokenIn, uint256 minAmountOut) external nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        uint256 amountOut = LvrMarket(market).sell(false, tokenIn, msg.sender);
        if (amountOut < minAmountOut) revert SlippageExceeded();
    }

    function proposerOutcome(address market, uint256 _outcome) public nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        LvrMarket(market).proposeOutcome(_outcome, msg.sender);
    }

    function dispute(address market) public nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        LvrMarket(market).dispute();
    }

    function settleMarket(address market) public nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        LvrMarket(market).settleMarket();
    }

    function settleFromOracle(address market) public nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        LvrMarket(market).settleFromOracle();
    }

    function redeem(address market, uint256 amountYes, uint256 amountNo) public nonReentrant {
        if (!allowedMarkets[market]) revert MarketNotAllowed();
        LvrMarket(market).redeemCollateralWithToken(amountYes, amountNo, msg.sender);
    }

    // Callbacks — only callable by allowlisted markets

    function marketBuyCallback(uint256 collateralIn, bytes calldata data) external override onlyAllowedMarket {
        (address collateral, address buyer) = abi.decode(data, (address, address));
        IERC20(collateral).safeTransferFrom(buyer, msg.sender, collateralIn);
    }

    function marketSellCallback(uint256 tokenIn, bytes calldata data) external override onlyAllowedMarket {
        (address tokenToSell, address seller) = abi.decode(data, (address, address));
        IERC20(tokenToSell).safeTransferFrom(seller, msg.sender, tokenIn);
    }

    function marketRedeemCallback(uint256 amountYes, uint256 amountNo, bytes calldata data) external override onlyAllowedMarket {
        (address yesToken, address noToken, address redeemer) = abi.decode(data, (address, address, address));
        IERC20(yesToken).safeTransferFrom(redeemer, msg.sender, amountYes);
        IERC20(noToken).safeTransferFrom(redeemer, msg.sender, amountNo);
    }

    function marketBondCallback(uint256 bond, bytes calldata data) external override onlyAllowedMarket {
        (address collateral, address proposer) = abi.decode(data, (address, address));
        IERC20(collateral).safeTransferFrom(proposer, msg.sender, bond);
    }
}
