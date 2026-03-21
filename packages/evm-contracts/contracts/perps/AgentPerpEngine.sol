// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SkillOracle} from "./SkillOracle.sol";

contract AgentPerpEngine is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant ONE = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_MAX_LEVERAGE = 5 * ONE;
    uint256 public constant DEFAULT_MAINTENANCE_MARGIN_BPS = 1_000;
    uint256 public constant DEFAULT_LIQUIDATION_REWARD_BPS = 500;
    uint256 public constant DEFAULT_MAX_ORACLE_DELAY = 2 minutes;
    uint256 public constant PARTIAL_LIQUIDATION_TARGET_MARGIN_RATIO = 2_000; // 20% = 2x maintenance (10%)
    uint256 public constant MAX_SOCIALIZED_LOSS_BPS = 50; // 0.5% cap per position

    SkillOracle public immutable oracle;
    IERC20 public immutable marginToken;

    enum MarketStatus {
        UNINITIALIZED,
        ACTIVE,
        CLOSE_ONLY,
        ARCHIVED
    }

    struct MarketConfig {
        uint256 skewScale;
        uint256 maxLeverage;
        uint256 maintenanceMarginBps;
        uint256 liquidationRewardBps;
        uint256 maxOracleDelay;
        uint256 maxOpenInterest;
        uint256 tradeTreasuryFeeBps;
        uint256 tradeMarketMakerFeeBps;
        uint256 maxOraclePriceDeltaBps;
        uint256 minInsuranceFund;
        uint256 minPositionSize;
        bool exists;
    }

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate;
        int256 cumulativeFundingRate;
        uint256 lastFundingTimestamp;
        uint256 lastOraclePrice;
        int256 lastConservativeSkill;
        uint256 lastOracleTimestamp;
        uint256 vaultBalance;
        uint256 insuranceFund;
        uint256 badDebt;
        uint256 settlementPrice;
        uint256 treasuryFeeBalance;
        uint256 marketMakerFeeBalance;
        uint256 openPositions;
        MarketStatus status;
    }

    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
        int256 lastCumulativeFundingRate;
    }

    struct PositionHealth {
        uint256 markPrice;
        uint256 notional;
        int256 unrealizedPnl;
        int256 equity;
        uint256 maintenanceMargin;
        bool liquidatable;
    }

    error InvalidAdmin();
    error InvalidOperator();
    error InvalidPauser();
    error InvalidOracle();
    error InvalidMarginToken();
    error InvalidSkewScale();
    error InvalidMaxLeverage();
    error InvalidMaintenanceMargin();
    error InvalidLiquidationReward();
    error InvalidOracleDelay();
    error GovernanceSurfaceFrozen();
    error MarketAlreadyExists();
    error MarketNotFound();
    error MarketNotTradable();
    error UnknownOracleAgent();
    error StaleOracle();
    error InvalidSizeDelta();
    error CloseOnlyMode();
    error ArchivedMarket();
    error Underwater();
    error Undercollateralized();
    error MaxLeverageExceeded();
    error InsufficientMargin();
    error NoPosition();
    error NotLiquidatable();
    error PositionTooSmall();
    error InvalidRecipient();
    error InsufficientInsuranceFund();
    error InsufficientMarketLiquidity();
    error TradingPaused();
    error MarketCreationPaused();
    error SlippageExceeded(uint256 executionPrice, uint256 acceptablePrice);
    error MaxOpenInterestExceeded();
    error OraclePriceDeltaTooLarge();
    error InvalidFeeConfig();
    error InsufficientInsurance();
    error MarketHasOpenPositions();

    mapping(bytes32 => MarketConfig) public marketConfigs;
    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    bytes32[] public marketIds;

    uint256 public immutable fundingVelocity;
    uint256 public immutable defaultSkewScale;
    bool public tradingPaused;
    bool public marketCreationPaused;
    bool private _isLiquidationContext;

    event MarketCreated(
        bytes32 indexed agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    );
    event MarketConfigUpdated(
        bytes32 indexed agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    );
    event MarketStatusUpdated(bytes32 indexed agentId, MarketStatus indexed status);
    event OracleSynced(
        bytes32 indexed agentId,
        uint256 price,
        int256 conservativeSkill,
        uint256 oracleTimestamp,
        int256 cumulativeFundingRate
    );
    event PositionModified(
        bytes32 indexed agentId,
        address indexed trader,
        int256 sizeDelta,
        int256 newSize,
        uint256 executionPrice,
        int256 marginDelta,
        int256 realizedPnl,
        int256 fundingPayment,
        uint256 marginAfter
    );
    event PositionClosed(
        bytes32 indexed agentId,
        address indexed trader,
        uint256 executionPrice,
        int256 realizedPnl,
        int256 fundingPayment,
        uint256 payout
    );
    event MarginWithdrawn(bytes32 indexed agentId, address indexed trader, uint256 amount, uint256 marginAfter);
    event PositionLiquidated(
        bytes32 indexed agentId,
        address indexed trader,
        address indexed liquidator,
        uint256 liquidationPrice,
        int256 realizedPnl,
        int256 fundingPayment,
        int256 equity,
        uint256 reward,
        uint256 vaultBalance,
        uint256 insuranceFund,
        uint256 badDebt
    );
    event InsuranceFundDeposited(bytes32 indexed agentId, address indexed from, uint256 amount, uint256 insuranceFund);
    event InsuranceFundWithdrawn(bytes32 indexed agentId, address indexed to, uint256 amount, uint256 insuranceFund);
    event FundingVelocityUpdated(uint256 newFundingVelocity);
    event DefaultSkewScaleUpdated(uint256 newDefaultSkewScale);
    event TradingPauseUpdated(bool paused, address indexed actor);
    event MarketCreationPauseUpdated(bool paused, address indexed actor);
    event PauserUpdated(address indexed pauser, bool enabled);
    event FeeBalanceWithdrawn(bytes32 indexed agentId, uint8 indexed bucket, address indexed to, uint256 amount);
    event MarketMakerFeesRecycled(bytes32 indexed agentId, uint256 amount);

    constructor(
        SkillOracle _oracle,
        IERC20 _marginToken,
        uint256 _defaultSkewScale,
        address admin,
        address marketOperator,
        address pauser
    ) {
        if (address(_oracle) == address(0)) revert InvalidOracle();
        if (address(_marginToken) == address(0)) revert InvalidMarginToken();
        if (_defaultSkewScale == 0) revert InvalidSkewScale();
        if (admin == address(0)) revert InvalidAdmin();
        if (marketOperator == address(0)) revert InvalidOperator();
        if (pauser == address(0)) revert InvalidPauser();

        oracle = _oracle;
        marginToken = _marginToken;
        defaultSkewScale = _defaultSkewScale;
        fundingVelocity = 1e12;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_OPERATOR_ROLE, marketOperator);
        _grantRole(PAUSER_ROLE, pauser);
    }

    // ── PM20 governance freeze: block inherited AccessControl role mutations ──

    function grantRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override onlyRole(getRoleAdmin(role)) {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        if (role != PAUSER_ROLE) revert GovernanceSurfaceFrozen();
        super.renounceRole(role, callerConfirmation);
    }

    function setPauser(address pauser, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pauser == address(0)) revert InvalidPauser();
        if (enabled) {
            _grantRole(PAUSER_ROLE, pauser);
        } else {
            _revokeRole(PAUSER_ROLE, pauser);
        }
        emit PauserUpdated(pauser, enabled);
    }

    function setTradingPaused(bool paused) external onlyRole(PAUSER_ROLE) {
        tradingPaused = paused;
        emit TradingPauseUpdated(paused, msg.sender);
    }

    function setMarketCreationPaused(bool paused) external onlyRole(PAUSER_ROLE) {
        marketCreationPaused = paused;
        emit MarketCreationPauseUpdated(paused, msg.sender);
    }

    // ── Frozen setters ──

    function setFundingVelocity(uint256) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert GovernanceSurfaceFrozen();
    }

    function setDefaultSkewScale(uint256) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert GovernanceSurfaceFrozen();
    }

    function updateMarketConfig(bytes32, uint256, uint256, uint256, uint256, uint256)
        external
        view
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        revert GovernanceSurfaceFrozen();
    }

    // ── Views ──

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    function getExecutionPrice(bytes32 agentId, int256 sizeDelta) external view returns (uint256) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        return _getExecutionPrice(markets[agentId], config, sizeDelta);
    }

    function getMarkPrice(bytes32 agentId) external view returns (uint256) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        return _markPrice(markets[agentId], config);
    }

    function getPositionHealth(bytes32 agentId, address trader) external view returns (PositionHealth memory) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        MarketState memory market = markets[agentId];
        Position memory position = positions[agentId][trader];
        (, int256 previewCumulativeFundingRate) = _previewFundingState(market, config);
        uint256 markPrice = _markPrice(market, config);
        uint256 notional = _notional(position.size, markPrice);
        int256 unrealizedPnl = _realizePnl(position.size, position.entryPrice, markPrice, _abs(position.size));
        int256 fundingPayment = 0;
        if (position.size != 0) {
            fundingPayment =
                (position.size * (previewCumulativeFundingRate - position.lastCumulativeFundingRate)) / int256(ONE);
        }
        int256 equity = int256(position.margin) + unrealizedPnl - fundingPayment;
        uint256 maintenanceMargin = _maintenanceMargin(_abs(position.size), markPrice, config.maintenanceMarginBps);
        return PositionHealth({
            markPrice: markPrice,
            notional: notional,
            unrealizedPnl: unrealizedPnl,
            equity: equity,
            maintenanceMargin: maintenanceMargin,
            liquidatable: position.size != 0 && equity <= int256(maintenanceMargin)
        });
    }

    // ── Market management ──

    function createMarket(bytes32 agentId) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (marketCreationPaused) revert MarketCreationPaused();
        _createMarket(
            agentId,
            defaultSkewScale,
            DEFAULT_MAX_LEVERAGE,
            DEFAULT_MAINTENANCE_MARGIN_BPS,
            DEFAULT_LIQUIDATION_REWARD_BPS,
            DEFAULT_MAX_ORACLE_DELAY,
            0, // maxOpenInterest (0 = unlimited)
            0, // tradeTreasuryFeeBps
            0, // tradeMarketMakerFeeBps
            0, // maxOraclePriceDeltaBps (0 = disabled)
            0  // minInsuranceFund (0 = disabled)
        );
    }

    function createMarket(
        bytes32 agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay,
        uint256 maxOpenInterest,
        uint256 tradeTreasuryFeeBps,
        uint256 tradeMarketMakerFeeBps
    ) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (marketCreationPaused) revert MarketCreationPaused();
        _createMarket(agentId, skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay, maxOpenInterest, tradeTreasuryFeeBps, tradeMarketMakerFeeBps, 0, 0);
    }

    function setMarketStatus(bytes32 agentId, MarketStatus newStatus) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (newStatus == MarketStatus.UNINITIALIZED) revert MarketNotTradable();
        MarketState storage market = markets[agentId];
        if (newStatus == MarketStatus.ARCHIVED) {
            if (market.openPositions > 0) revert MarketHasOpenPositions();
        }
        market.status = newStatus;
        if (newStatus == MarketStatus.CLOSE_ONLY && market.settlementPrice == 0) {
            market.settlementPrice = market.lastOraclePrice;
        }
        emit MarketStatusUpdated(agentId, newStatus);
    }

    // ── Oracle sync ──

    function syncOracle(bytes32 agentId) external returns (uint256 price) {
        return _syncOracle(agentId);
    }

    // ── Position management ──

    function modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta) external nonReentrant {
        _modifyPosition(agentId, marginDelta, sizeDelta, 0);
    }

    function modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta, uint256 acceptablePrice) external nonReentrant {
        _modifyPosition(agentId, marginDelta, sizeDelta, acceptablePrice);
    }

    function _modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta, uint256 acceptablePrice) internal {
        if (tradingPaused) revert TradingPaused();
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][msg.sender];

        _syncOracle(agentId);
        int256 fundingPayment = _settleFunding(position, market, false);

        int256 oldSize = position.size;
        uint256 oldEntryPrice = position.entryPrice;

        _assertStatusAllowsTrade(market.status, oldSize, sizeDelta);

        uint256 executionPrice = _getExecutionPrice(market, config, sizeDelta);

        // Slippage protection
        if (acceptablePrice != 0 && sizeDelta != 0) {
            if (sizeDelta > 0 && executionPrice > acceptablePrice) {
                revert SlippageExceeded(executionPrice, acceptablePrice);
            }
            if (sizeDelta < 0 && executionPrice < acceptablePrice) {
                revert SlippageExceeded(executionPrice, acceptablePrice);
            }
        }

        if (marginDelta > 0) {
            marginToken.safeTransferFrom(msg.sender, address(this), uint256(marginDelta));
        }

        _removeOpenInterest(market, oldSize);
        int256 realizedPnl = _applySizeDelta(market, position, oldSize, oldEntryPrice, sizeDelta, executionPrice);
        _applyMarginDelta(position, marginDelta, msg.sender);

        // Deduct trading fees from margin after margin delta applied
        if (sizeDelta != 0 && (config.tradeTreasuryFeeBps + config.tradeMarketMakerFeeBps) > 0) {
            uint256 notionalDelta = Math.mulDiv(_abs(sizeDelta), executionPrice, ONE);
            uint256 treasuryFee = Math.mulDiv(notionalDelta, config.tradeTreasuryFeeBps, BPS);
            uint256 mmFee = Math.mulDiv(notionalDelta, config.tradeMarketMakerFeeBps, BPS);
            uint256 totalFee = treasuryFee + mmFee;
            if (totalFee > 0) {
                if (position.margin < totalFee) revert InsufficientMargin();
                position.margin -= totalFee;
                market.treasuryFeeBalance += treasuryFee;
                market.marketMakerFeeBalance += mmFee;
            }
        }

        _addOpenInterest(market, position.size);

        // H-4: Enforce minimum position size to prevent dust positions
        if (position.size != 0 && _abs(position.size) < config.minPositionSize) revert PositionTooSmall();

        // OI cap check
        if (config.maxOpenInterest > 0 && sizeDelta != 0) {
            if (market.totalLongOI > config.maxOpenInterest || market.totalShortOI > config.maxOpenInterest) {
                revert MaxOpenInterestExceeded();
            }
        }

        // Oracle price step validation
        if (config.maxOraclePriceDeltaBps > 0 && sizeDelta != 0) {
            uint256 prevPrice = market.lastOraclePrice;
            if (prevPrice > 0) {
                uint256 priceDelta = executionPrice > prevPrice ? executionPrice - prevPrice : prevPrice - executionPrice;
                if (priceDelta * BPS / prevPrice > config.maxOraclePriceDeltaBps) {
                    revert OraclePriceDeltaTooLarge();
                }
            }
        }

        // Min insurance fund check — block new/increased positions when insurance is too low
        if (config.minInsuranceFund > 0 && sizeDelta != 0) {
            bool isIncrease = oldSize == 0 || (oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0);
            if (isIncrease && market.insuranceFund < config.minInsuranceFund) {
                revert InsufficientInsurance();
            }
        }

        // Track open positions counter
        if (oldSize == 0 && position.size != 0) {
            market.openPositions += 1;
        }

        if (position.size == 0) {
            if (oldSize != 0) {
                market.openPositions -= 1;
            }
            uint256 payout = position.margin;
            position.margin = 0;
            position.entryPrice = 0;
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
            emit PositionClosed(agentId, msg.sender, executionPrice, realizedPnl, fundingPayment, payout);
            if (payout != 0) {
                marginToken.safeTransfer(msg.sender, payout);
            }
            return;
        }

        _assertPositionHealthy(position, _markPrice(market, config), config);
        position.lastCumulativeFundingRate = market.cumulativeFundingRate;

        emit PositionModified(
            agentId,
            msg.sender,
            sizeDelta,
            position.size,
            executionPrice,
            marginDelta,
            realizedPnl,
            fundingPayment,
            position.margin
        );
    }

    function withdrawMargin(bytes32 agentId, uint256 amount) external nonReentrant {
        if (tradingPaused) revert TradingPaused();
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][msg.sender];

        _syncOracle(agentId);
        _settleFunding(position, market, false);

        if (position.margin < amount) revert InsufficientMargin();
        position.margin -= amount;

        if (position.size != 0) {
            _assertPositionHealthy(position, _markPrice(market, config), config);
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
        }

        emit MarginWithdrawn(agentId, msg.sender, amount, position.margin);
        marginToken.safeTransfer(msg.sender, amount);
    }

    // ── Liquidation with partial support ──

    function liquidate(bytes32 agentId, address trader) external nonReentrant {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][trader];
        if (position.size == 0) revert NoPosition();

        _isLiquidationContext = true;
        _syncOracle(agentId);
        _isLiquidationContext = false;
        int256 fundingPayment = _settleFunding(position, market, true);

        uint256 markPrice = _markPrice(market, config);
        uint256 absSize = _abs(position.size);
        int256 unrealizedPnl = _realizePnl(position.size, position.entryPrice, markPrice, absSize);
        int256 equity = int256(position.margin) + unrealizedPnl;
        uint256 maintenanceMargin = _maintenanceMargin(absSize, markPrice, config.maintenanceMarginBps);

        if (equity > int256(maintenanceMargin)) revert NotLiquidatable();

        // Determine liquidation size: partial if equity > 0 and position large enough
        int256 liquidationSizeDelta = 0;
        bool isPartial = false;
        if (equity > 0 && absSize > ONE) {
            // Close enough to restore 2x maintenance margin ratio
            uint256 targetMarginBps = PARTIAL_LIQUIDATION_TARGET_MARGIN_RATIO;
            // Target: equity_after / notional_after >= targetMarginBps / BPS
            // Solve for size to close: close the minimum to restore health
            uint256 targetNotional = Math.mulDiv(uint256(equity), BPS, targetMarginBps);
            uint256 targetSize = Math.mulDiv(targetNotional, ONE, markPrice);
            if (targetSize > 0 && targetSize < absSize) {
                uint256 closeSize = absSize - targetSize;
                // Minimum close of 10% of position
                uint256 minClose = absSize / 10;
                if (closeSize < minClose) closeSize = minClose;
                if (closeSize < absSize) {
                    liquidationSizeDelta = position.size > 0 ? -int256(closeSize) : int256(closeSize);
                    isPartial = true;
                }
            }
        }

        // Full liquidation if partial not viable
        if (!isPartial) {
            liquidationSizeDelta = -position.size;
        }

        uint256 liquidationPrice = _getExecutionPrice(market, config, liquidationSizeDelta);
        uint256 closedSize = _abs(liquidationSizeDelta);
        int256 realizedPnl = _realizePnl(position.size, position.entryPrice, liquidationPrice, closedSize);

        if (realizedPnl > 0) {
            _creditMarginFromPool(market, position, uint256(realizedPnl));
        } else if (realizedPnl < 0) {
            _collectTraderLoss(market, position, uint256(-realizedPnl), true);
        }

        _removeOpenInterest(market, position.size);

        // Reward: proportional to closed fraction, based on POST-PnL margin (not pre-PnL)
        uint256 reward = Math.mulDiv(
            Math.mulDiv(position.margin, config.liquidationRewardBps, BPS),
            closedSize,
            absSize
        );
        // Cap reward at position margin only — insurance is for bad debt, not liquidator rewards
        if (reward > position.margin) reward = position.margin;
        position.margin -= reward;

        if (isPartial) {
            // Update position for partial close
            position.size += liquidationSizeDelta;
            // Update entry price for remaining position (weighted average)
            if (position.size != 0) {
                uint256 newAbsSize = _abs(position.size);
                // newEntry = (oldEntry * oldAbs - liquidationPrice * closedSize) / newAbsSize
                // Cap closedNotional at oldNotional to prevent entry price from going to 0
                // (which would artificially inflate equity and block subsequent liquidations)
                uint256 oldNotionalAtEntry = Math.mulDiv(position.entryPrice, absSize, ONE);
                uint256 closedNotionalAtExit = Math.mulDiv(liquidationPrice, closedSize, ONE);
                if (closedNotionalAtExit > oldNotionalAtEntry) {
                    closedNotionalAtExit = oldNotionalAtEntry;
                }
                position.entryPrice = Math.mulDiv(oldNotionalAtEntry - closedNotionalAtExit, ONE, newAbsSize);
            }
            _addOpenInterest(market, position.size);
        } else {
            // Full liquidation — insurance waterfall for remaining margin
            uint256 seizedMargin = position.margin;
            position.size = 0;
            position.margin = 0;
            position.entryPrice = 0;
            market.openPositions -= 1;

            if (seizedMargin > 0) {
                // Cap socialized loss per position (use seizedMargin as basis since position is fully closed)
                uint256 maxSocLoss = Math.mulDiv(seizedMargin, MAX_SOCIALIZED_LOSS_BPS, BPS);
                uint256 toInsurance = seizedMargin > maxSocLoss ? maxSocLoss : seizedMargin;
                market.insuranceFund += toInsurance;
                uint256 toVault = seizedMargin - toInsurance;
                if (toVault > 0) {
                    market.vaultBalance += toVault;
                }
            }
        }

        position.lastCumulativeFundingRate = market.cumulativeFundingRate;

        emit PositionLiquidated(
            agentId,
            trader,
            msg.sender,
            liquidationPrice,
            realizedPnl,
            fundingPayment,
            equity,
            reward,
            market.vaultBalance,
            market.insuranceFund,
            market.badDebt
        );

        if (reward != 0) {
            marginToken.safeTransfer(msg.sender, reward);
        }
    }

    // ── Insurance fund ──

    function depositInsuranceFund(bytes32 agentId, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (amount == 0) return;
        marginToken.safeTransferFrom(msg.sender, address(this), amount);
        MarketState storage market = markets[agentId];
        uint256 remaining = amount;
        if (market.badDebt != 0) {
            uint256 repaidBadDebt = remaining > market.badDebt ? market.badDebt : remaining;
            market.badDebt -= repaidBadDebt;
            market.vaultBalance += repaidBadDebt;
            remaining -= repaidBadDebt;
        }
        if (remaining != 0) {
            market.insuranceFund += remaining;
        }
        emit InsuranceFundDeposited(agentId, msg.sender, amount, market.insuranceFund);
    }

    function withdrawInsuranceFund(bytes32 agentId, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (to == address(0)) revert InvalidRecipient();
        MarketState storage market = markets[agentId];
        if (market.insuranceFund < amount) revert InsufficientInsuranceFund();
        market.insuranceFund -= amount;
        emit InsuranceFundWithdrawn(agentId, to, amount, market.insuranceFund);
        marginToken.safeTransfer(to, amount);
    }

    // ── Fee management ──

    /// @notice Withdraw accumulated fee balance. Bucket 0 = treasury, 1 = market maker.
    function withdrawFeeBalance(bytes32 agentId, uint8 bucket, address to)
        external
        onlyRole(MARKET_OPERATOR_ROLE)
        nonReentrant
    {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (to == address(0)) revert InvalidRecipient();
        MarketState storage market = markets[agentId];
        uint256 amount;
        if (bucket == 0) {
            amount = market.treasuryFeeBalance;
            market.treasuryFeeBalance = 0;
        } else {
            amount = market.marketMakerFeeBalance;
            market.marketMakerFeeBalance = 0;
        }
        if (amount > 0) {
            emit FeeBalanceWithdrawn(agentId, bucket, to, amount);
            marginToken.safeTransfer(to, amount);
        }
    }

    /// @notice Recycle market maker fees into insurance fund.
    function recycleMmFees(bytes32 agentId) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        MarketState storage market = markets[agentId];
        uint256 amount = market.marketMakerFeeBalance;
        if (amount > 0) {
            market.marketMakerFeeBalance = 0;
            market.insuranceFund += amount;
            emit MarketMakerFeesRecycled(agentId, amount);
        }
    }

    // ── Internal: market creation ──

    function _createMarket(
        bytes32 agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay,
        uint256 maxOpenInterest,
        uint256 tradeTreasuryFeeBps,
        uint256 tradeMarketMakerFeeBps,
        uint256 maxOraclePriceDeltaBps,
        uint256 minInsuranceFund
    ) internal {
        if (marketConfigs[agentId].exists) revert MarketAlreadyExists();
        _validateConfig(skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
        if (tradeTreasuryFeeBps + tradeMarketMakerFeeBps >= BPS) revert InvalidFeeConfig();

        marketConfigs[agentId] = MarketConfig({
            skewScale: skewScale,
            maxLeverage: maxLeverage,
            maintenanceMarginBps: maintenanceMarginBps,
            liquidationRewardBps: liquidationRewardBps,
            maxOracleDelay: maxOracleDelay,
            maxOpenInterest: maxOpenInterest,
            tradeTreasuryFeeBps: tradeTreasuryFeeBps,
            tradeMarketMakerFeeBps: tradeMarketMakerFeeBps,
            maxOraclePriceDeltaBps: maxOraclePriceDeltaBps,
            minInsuranceFund: minInsuranceFund,
            minPositionSize: 1e18,
            exists: true
        });

        markets[agentId].status = MarketStatus.ACTIVE;
        marketIds.push(agentId);

        emit MarketCreated(agentId, skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
        emit MarketStatusUpdated(agentId, MarketStatus.ACTIVE);

        _syncOracle(agentId);
    }

    function _validateConfig(
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    ) internal pure {
        if (skewScale == 0) revert InvalidSkewScale();
        if (maxLeverage == 0) revert InvalidMaxLeverage();
        if (maintenanceMarginBps == 0 || maintenanceMarginBps >= BPS) revert InvalidMaintenanceMargin();
        if (liquidationRewardBps == 0 || liquidationRewardBps >= BPS) revert InvalidLiquidationReward();
        if (maxOracleDelay == 0) revert InvalidOracleDelay();
    }

    function _requireMarket(bytes32 agentId) internal view returns (MarketConfig memory config) {
        config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
    }

    // ── Internal: oracle ──

    function _syncOracle(bytes32 agentId) internal returns (uint256 price) {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];

        (uint256 mu, uint256 sigma, uint256 lastUpdate) = oracle.agentSkills(agentId);
        if (lastUpdate == 0) revert UnknownOracleAgent();
        if (!_isLiquidationContext && block.timestamp - lastUpdate > config.maxOracleDelay) revert StaleOracle();

        _accrueFunding(market, config);

        int256 conservativeSkill = int256(mu) - int256(3 * sigma);
        price = oracle.getIndexPrice(agentId);
        market.lastOraclePrice = price;
        market.lastConservativeSkill = conservativeSkill;
        market.lastOracleTimestamp = lastUpdate;

        emit OracleSynced(agentId, price, conservativeSkill, lastUpdate, market.cumulativeFundingRate);
    }

    // ── Internal: funding ──

    function _accrueFunding(MarketState storage market, MarketConfig memory config) internal {
        uint256 lastTimestamp = market.lastFundingTimestamp;
        if (lastTimestamp == 0) {
            market.lastFundingTimestamp = block.timestamp;
            return;
        }

        if (block.timestamp <= lastTimestamp) return;
        uint256 timeDelta = block.timestamp - lastTimestamp;
        if (timeDelta < 1) return;

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 fundingRateDelta =
            _mulDivSigned(skew, int256(fundingVelocity) * int256(timeDelta), int256(config.skewScale));

        market.currentFundingRate += fundingRateDelta;
        market.cumulativeFundingRate += fundingRateDelta;
        market.lastFundingTimestamp = block.timestamp;
    }

    function _previewFundingState(MarketState memory market, MarketConfig memory config)
        internal
        view
        returns (int256 previewCurrentFundingRate, int256 previewCumulativeFundingRate)
    {
        previewCurrentFundingRate = market.currentFundingRate;
        previewCumulativeFundingRate = market.cumulativeFundingRate;

        uint256 lastTimestamp = market.lastFundingTimestamp;
        if (lastTimestamp == 0 || block.timestamp <= lastTimestamp) {
            return (previewCurrentFundingRate, previewCumulativeFundingRate);
        }

        uint256 timeDelta = block.timestamp - lastTimestamp;
        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 fundingRateDelta =
            _mulDivSigned(skew, int256(fundingVelocity) * int256(timeDelta), int256(config.skewScale));

        previewCurrentFundingRate += fundingRateDelta;
        previewCumulativeFundingRate += fundingRateDelta;
    }

    function _settleFunding(Position storage position, MarketState storage market, bool useInsuranceBackstop)
        internal
        returns (int256 fundingPayment)
    {
        if (position.size == 0) {
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
            return 0;
        }

        int256 rateDelta = market.cumulativeFundingRate - position.lastCumulativeFundingRate;
        if (rateDelta == 0) return 0;

        fundingPayment = (position.size * rateDelta) / int256(ONE);
        if (fundingPayment > 0) {
            _collectTraderLoss(market, position, uint256(fundingPayment), useInsuranceBackstop);
        } else {
            _creditMarginFromPool(market, position, uint256(-fundingPayment));
        }

        position.lastCumulativeFundingRate = market.cumulativeFundingRate;
    }

    // ── Internal: position math ──

    function _applySizeDelta(
        MarketState storage market,
        Position storage position,
        int256 oldSize,
        uint256 oldEntryPrice,
        int256 sizeDelta,
        uint256 executionPrice
    ) internal returns (int256 realizedPnl) {
        if (sizeDelta == 0) return 0;

        if (oldSize == 0) {
            position.size = sizeDelta;
            position.entryPrice = executionPrice;
            return 0;
        }

        if ((oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0)) {
            uint256 existingAbs = _abs(oldSize);
            uint256 addAbs = _abs(sizeDelta);
            position.size = oldSize + sizeDelta;
            position.entryPrice = ((oldEntryPrice * existingAbs) + (executionPrice * addAbs)) / (existingAbs + addAbs);
            return 0;
        }

        uint256 oldAbs = _abs(oldSize);
        uint256 deltaAbs = _abs(sizeDelta);
        uint256 closeSize = oldAbs < deltaAbs ? oldAbs : deltaAbs;
        realizedPnl = _realizePnl(oldSize, oldEntryPrice, executionPrice, closeSize);

        if (realizedPnl > 0) {
            _creditMarginFromPool(market, position, uint256(realizedPnl));
        } else if (realizedPnl < 0) {
            _collectTraderLoss(market, position, uint256(-realizedPnl), false);
        }

        position.size = oldSize + sizeDelta;
        if (position.size == 0) {
            position.entryPrice = 0;
        } else if ((oldSize > 0 && position.size > 0) || (oldSize < 0 && position.size < 0)) {
            position.entryPrice = oldEntryPrice;
        } else {
            position.entryPrice = executionPrice;
        }
    }

    function _applyMarginDelta(Position storage position, int256 marginDelta, address trader) internal {
        if (marginDelta < 0) {
            uint256 withdrawAmount = uint256(-marginDelta);
            if (position.margin < withdrawAmount) revert InsufficientMargin();
            position.margin -= withdrawAmount;
            marginToken.safeTransfer(trader, withdrawAmount);
        } else if (marginDelta > 0) {
            position.margin += uint256(marginDelta);
        }
    }

    // ── Internal: margin pool ──

    function _creditMarginFromPool(MarketState storage market, Position storage position, uint256 profit) internal {
        if (profit == 0) return;
        uint256 fromVault = profit > market.vaultBalance ? market.vaultBalance : profit;
        uint256 remaining = profit - fromVault;
        if (remaining > 0) {
            // During CLOSE_ONLY settlement, allow insurance as last resort to avoid deadlock.
            // In ACTIVE markets, vault must fully cover trader profits.
            if (market.status != MarketStatus.CLOSE_ONLY) revert InsufficientMarketLiquidity();
            if (remaining > market.insuranceFund) revert InsufficientMarketLiquidity();
            market.insuranceFund -= remaining;
        }
        market.vaultBalance -= fromVault;
        position.margin += profit;
    }

    function _collectTraderLoss(
        MarketState storage market,
        Position storage position,
        uint256 amount,
        bool allowBadDebt
    ) internal {
        if (amount == 0) return;
        if (!allowBadDebt && amount > position.margin) revert Underwater();

        uint256 fromMargin = amount > position.margin ? position.margin : amount;
        if (fromMargin != 0) {
            position.margin -= fromMargin;
            market.vaultBalance += fromMargin;
        }

        uint256 deficit = amount - fromMargin;
        if (deficit == 0) return;
        if (!allowBadDebt) revert Underwater();

        uint256 fromInsurance = deficit > market.insuranceFund ? market.insuranceFund : deficit;
        if (fromInsurance != 0) {
            market.insuranceFund -= fromInsurance;
            market.vaultBalance += fromInsurance;
        }

        uint256 residualBadDebt = deficit - fromInsurance;
        if (residualBadDebt != 0) {
            market.badDebt += residualBadDebt;
        }
    }

    // ── Internal: health checks ──

    function _assertPositionHealthy(Position memory position, uint256 markPrice, MarketConfig memory config)
        internal
        pure
    {
        if (position.size == 0) return;
        if (position.margin == 0) revert Undercollateralized();

        uint256 notional = _notional(position.size, markPrice);
        int256 unrealizedPnl = _realizePnl(position.size, position.entryPrice, markPrice, _abs(position.size));
        int256 equity = int256(position.margin) + unrealizedPnl;
        if (equity <= 0) revert Underwater();

        if (Math.mulDiv(notional, ONE, uint256(equity)) > config.maxLeverage) {
            revert MaxLeverageExceeded();
        }
    }

    function _assertStatusAllowsTrade(MarketStatus status, int256 oldSize, int256 sizeDelta) internal pure {
        if (sizeDelta == 0) return;
        if (status == MarketStatus.ACTIVE) return;
        if (status == MarketStatus.UNINITIALIZED) revert MarketNotFound();
        if (status == MarketStatus.ARCHIVED) revert ArchivedMarket();

        if (oldSize == 0) revert CloseOnlyMode();

        int256 newSize = oldSize + sizeDelta;
        if (newSize == 0) return;
        if ((oldSize > 0 && newSize > 0 && newSize < oldSize) || (oldSize < 0 && newSize < 0 && newSize > oldSize)) {
            return;
        }
        revert CloseOnlyMode();
    }

    // ── Internal: pure math ──

    function _maintenanceMargin(uint256 absSize, uint256 price, uint256 maintenanceMarginBps)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(Math.mulDiv(absSize, price, ONE), maintenanceMarginBps, BPS);
    }

    function _mulDivSigned(int256 a, int256 b, int256 denominator) internal pure returns (int256) {
        bool negative = (a < 0) != (b < 0);
        uint256 absA = uint256(a < 0 ? -a : a);
        uint256 absB = uint256(b < 0 ? -b : b);
        uint256 absDenominator = uint256(denominator < 0 ? -denominator : denominator);
        uint256 quotient = Math.mulDiv(absA, absB, absDenominator);
        return negative ? -int256(quotient) : int256(quotient);
    }

    function _markPrice(MarketState memory market, MarketConfig memory config) internal pure returns (uint256) {
        return _getExecutionPrice(market, config, 0);
    }

    function _getExecutionPrice(MarketState memory market, MarketConfig memory config, int256 sizeDelta)
        internal
        pure
        returns (uint256)
    {
        // Use frozen settlement price when market is in CLOSE_ONLY or ARCHIVED
        uint256 indexPrice = (market.settlementPrice != 0) ? market.settlementPrice : market.lastOraclePrice;
        if (indexPrice == 0) revert StaleOracle();

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(config.skewScale);

        if (premium >= 0) {
            return indexPrice + Math.mulDiv(indexPrice, uint256(premium), ONE);
        }

        uint256 absPremium = uint256(-premium);
        if (absPremium >= ONE) {
            return indexPrice / 10;
        }
        return indexPrice - Math.mulDiv(indexPrice, absPremium, ONE);
    }

    function _removeOpenInterest(MarketState storage market, int256 size) internal {
        if (size > 0) {
            market.totalLongOI -= uint256(size);
        } else if (size < 0) {
            market.totalShortOI -= uint256(-size);
        }
    }

    function _addOpenInterest(MarketState storage market, int256 size) internal {
        if (size > 0) {
            market.totalLongOI += uint256(size);
        } else if (size < 0) {
            market.totalShortOI += uint256(-size);
        }
    }

    function _realizePnl(int256 existingSize, uint256 entryPrice, uint256 executionPrice, uint256 closeSize)
        internal
        pure
        returns (int256)
    {
        if (existingSize == 0 || closeSize == 0 || entryPrice == 0) return 0;
        if (existingSize > 0) {
            return (int256(executionPrice) - int256(entryPrice)) * int256(closeSize) / int256(ONE);
        }
        return (int256(entryPrice) - int256(executionPrice)) * int256(closeSize) / int256(ONE);
    }

    function _notional(int256 size, uint256 price) internal pure returns (uint256) {
        if (size == 0 || price == 0) return 0;
        return Math.mulDiv(_abs(size), price, ONE);
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }
}
