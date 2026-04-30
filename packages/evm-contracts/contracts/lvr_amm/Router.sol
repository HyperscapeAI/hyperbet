// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DuelOutcomeOracle} from "../DuelOutcomeOracle.sol";
import {LvrMarket} from "./LvrMarket.sol";
import {IMarketBuyCallback} from "./interfaces/IMarketBuyCallback.sol";
import {IMarketSellCallback} from "./interfaces/IMarketSellCallback.sol";
import {IMarketRedeemCallback} from "./interfaces/IMarketRedeemCallback.sol";
import {IMarketBondCallback} from "./interfaces/IMarketBondCallback.sol";

contract Router is ReentrancyGuard, IMarketBuyCallback, IMarketSellCallback, IMarketRedeemCallback, IMarketBondCallback {
    using SafeERC20 for IERC20;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
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

    address[] private allMarkets;
    uint256 public constant MAX_FEE_BPS = 1000; // 10% cap

    IERC20 public immutable mUSD; // Collateral Token
    DuelOutcomeOracle public immutable duelOracle;
    address private immutable adminAddress;
    address public treasury;     // Protocol Treasury
    uint256 public feeBps;       // Global Swap Fee Bps
    bool public configFrozen;

    mapping(address => bool) private allowedMarkets;
    mapping(bytes32 => bool) private knownMarketIds;

    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);
    error InvalidMUsd();
    error InvalidOracle();
    error InvalidTreasury();
    error InvalidAdmin();
    error FeeTooHigh();
    error MarketAlreadyExists();
    error MarketNotAllowed();
    error SlippageExceeded();
    error ConfigFrozen();
    error DynamicMarketsDisabled();

    event FeeConfigUpdated(address indexed treasury, uint256 feeBps);
    event FeeConfigFrozen(address indexed admin);

    constructor(address _mUSD, address _oracle, address _treasury, uint256 _feeBps, address admin) {
        if (_mUSD == address(0)) revert InvalidMUsd();
        if (_oracle == address(0)) revert InvalidOracle();
        if (_treasury == address(0) && _feeBps != 0) revert InvalidTreasury();
        if (admin == address(0)) revert InvalidAdmin();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        mUSD = IERC20(_mUSD);
        duelOracle = DuelOutcomeOracle(_oracle);
        adminAddress = admin;
        treasury = _treasury;
        feeBps = _feeBps;
    }

    modifier onlyAllowedMarket() {
        if (!allowedMarkets[msg.sender]) revert MarketNotAllowed();
        _;
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        if (account != adminAddress) {
            return false;
        }
        return role == DEFAULT_ADMIN_ROLE || role == MARKET_OPERATOR_ROLE;
    }

    function _checkRole(bytes32 role) private view {
        if (!hasRole(role, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, role);
        }
    }

    function setFeeConfig(address _treasury, uint256 _feeBps) external {
        _checkRole(DEFAULT_ADMIN_ROLE);
        if (configFrozen) revert ConfigFrozen();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (_treasury == address(0) && _feeBps != 0) revert InvalidTreasury();
        treasury = _treasury;
        feeBps = _feeBps;
        emit FeeConfigUpdated(_treasury, _feeBps);
    }

    function freezeConfig() external {
        _checkRole(DEFAULT_ADMIN_ROLE);
        if (configFrozen) revert ConfigFrozen();
        configFrozen = true;
        emit FeeConfigFrozen(msg.sender);
    }

    function create(
        string memory title, 
        string memory description,
        string memory resolutionSource,
        bytes32 duelKey,
        bool isDynamic, 
        uint256 duration, 
        uint256 collateralIn
    ) public {
        _checkRole(MARKET_OPERATOR_ROLE);
        if (isDynamic) revert DynamicMarketsDisabled();
        bytes32 marketId = keccak256(abi.encode(title, msg.sender, block.timestamp));
        if (knownMarketIds[marketId]) revert MarketAlreadyExists();

        LvrMarket market =
            new LvrMarket(address(this), duelKey, address(duelOracle), isDynamic, duration, address(mUSD), treasury, feeBps);

        // Transfer USD token to market contract
        mUSD.safeTransferFrom(msg.sender, address(market), collateralIn);
        uint256 liquidity = market.initializeLiquidity(collateralIn);

        // Add to allowlist AFTER successful initialization to prevent callbacks to uninitialized markets
        allowedMarkets[address(market)] = true;
        knownMarketIds[marketId] = true;

        allMarkets.push(address(market));
        
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
