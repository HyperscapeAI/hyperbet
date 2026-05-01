// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SkillOracle} from "./SkillOracle.sol";

contract AgentPerpEngineNative is AccessControl, ReentrancyGuard {
    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    SkillOracle public immutable oracle;

    uint256 public constant ONE = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_MAINTENANCE_MARGIN_BPS = 1_000;
    uint256 public constant DEFAULT_LIQUIDATION_REWARD_BPS = 500;
    uint256 public constant DEFAULT_MAX_ORACLE_DELAY = 2 minutes;
    uint256 public constant PARTIAL_LIQUIDATION_TARGET_MARGIN_RATIO = 2_000;
    uint256 public constant MAX_SOCIALIZED_LOSS_BPS = 50;
    uint256 public constant MAX_INSURANCE_DRAW_DIVISOR = 4;

    error InvalidAdmin();
    error InvalidOperator();
    error InvalidPauser();
    error InvalidOracle();
    error InvalidSkewScale();
    error InvalidMaxLeverage();
    error GovernanceSurfaceFrozen();
    error Underwater();
    error Undercollateralized();
    error MaxLeverageExceeded();
    error InsufficientMargin();
    error NoPosition();
    error NotLiquidatable();
    error InvalidRecipient();
    error InsufficientInsuranceFund();
    error StaleOracle();
    error UnknownOracleAgent();
    error TradingPaused();
    error MarketNotFound();
    error ArchivedMarket();
    error CloseOnlyMode();
    error SlippageExceeded(uint256 executionPrice, uint256 acceptablePrice);
    error MaxOpenInterestExceeded();
    error OraclePriceDeltaTooLarge();
    error InsufficientInsurance();
    error MarketHasOpenPositions();

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
        bool exists;
    }

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate;
        int256 cumulativeFundingRate;
        uint256 lastFundingTimestamp;
        uint256 lastOraclePrice;
        uint256 lastOracleTimestamp;
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

    mapping(bytes32 => MarketConfig) public marketConfigs;
    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    bytes32[] public marketIds;

    uint256 public immutable skewScale;
    uint256 public immutable fundingVelocity;
    uint256 public immutable maxLeverage;
    bool public tradingPaused;
    bool private _isLiquidationContext;

    event PositionOpened(
        bytes32 indexed agentId,
        address indexed trader,
        int256 sizeDelta,
        uint256 execPrice,
        int256 newSize,
        uint256 margin
    );
    event PositionClosed(bytes32 indexed agentId, address indexed trader, int256 size, uint256 execPrice, int256 pnl);
    event PositionLiquidated(
        bytes32 indexed agentId,
        address indexed trader,
        address indexed liquidator,
        int256 size,
        uint256 liquidationPrice,
        int256 equity,
        uint256 reward
    );
    event MarginWithdrawn(bytes32 indexed agentId, address indexed trader, uint256 amount);
    event InsuranceFundWithdrawn(address indexed to, uint256 amount);
    event MarketStatusUpdated(bytes32 indexed agentId, MarketStatus indexed status);
    event TradingPauseUpdated(bool paused, address indexed actor);
    event PauserUpdated(address indexed pauser, bool enabled);
    event FeeBalanceWithdrawn(bytes32 indexed agentId, uint8 indexed bucket, address indexed to, uint256 amount);
    event MarketMakerFeesRecycled(bytes32 indexed agentId, uint256 amount);
    event InsuranceFundDeposited(bytes32 indexed agentId, address indexed from, uint256 amount);

    constructor(
        SkillOracle _oracle,
        uint256 _skewScale,
        address admin,
        address marketOperator,
        address pauser
    ) {
        if (address(_oracle) == address(0)) revert InvalidOracle();
        if (_skewScale == 0) revert InvalidSkewScale();
        if (admin == address(0)) revert InvalidAdmin();
        if (marketOperator == address(0)) revert InvalidOperator();
        if (pauser == address(0)) revert InvalidPauser();

        oracle = _oracle;
        skewScale = _skewScale;
        fundingVelocity = 1e12;
        maxLeverage = 5 * ONE;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_OPERATOR_ROLE, marketOperator);
        _grantRole(PAUSER_ROLE, pauser);
    }

    receive() external payable {}

    // ── PM20 governance freeze ──

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

    // ── Frozen setters ──

    function setSkewScale(uint256) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert GovernanceSurfaceFrozen();
    }

    function setFundingVelocity(uint256) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert GovernanceSurfaceFrozen();
    }

    function setMaxLeverage(uint256) external view onlyRole(DEFAULT_ADMIN_ROLE) {
        revert GovernanceSurfaceFrozen();
    }

    // ── Market management ──

    function createMarket(bytes32 agentId) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (marketConfigs[agentId].exists) revert();
        marketConfigs[agentId] = MarketConfig({
            skewScale: skewScale,
            maxLeverage: maxLeverage,
            maintenanceMarginBps: DEFAULT_MAINTENANCE_MARGIN_BPS,
            liquidationRewardBps: DEFAULT_LIQUIDATION_REWARD_BPS,
            maxOracleDelay: DEFAULT_MAX_ORACLE_DELAY,
            maxOpenInterest: 0,
            tradeTreasuryFeeBps: 0,
            tradeMarketMakerFeeBps: 0,
            maxOraclePriceDeltaBps: 0,
            minInsuranceFund: 0,
            exists: true
        });
        markets[agentId].status = MarketStatus.ACTIVE;
        marketIds.push(agentId);
        emit MarketStatusUpdated(agentId, MarketStatus.ACTIVE);
        _syncOracle(agentId);
    }

    function setMarketStatus(bytes32 agentId, MarketStatus newStatus) external onlyRole(MARKET_OPERATOR_ROLE) {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
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

    // ── Oracle ──

    function _syncOracle(bytes32 agentId) internal returns (uint256 price) {
        MarketState storage market = markets[agentId];

        // Settlement price frozen — skip oracle fetch and funding drift
        if (market.settlementPrice != 0) {
            return market.settlementPrice;
        }

        MarketConfig memory config = marketConfigs[agentId];
        (uint256 mu,, uint256 lastUpdate) = oracle.agentSkills(agentId);
        if (lastUpdate == 0) revert UnknownOracleAgent();
        if (!_isLiquidationContext && block.timestamp - lastUpdate > config.maxOracleDelay) revert StaleOracle();

        _updateFunding(agentId);
        price = oracle.getIndexPrice(agentId);
        market.lastOraclePrice = price;
        market.lastOracleTimestamp = lastUpdate;
    }

    function _updateFunding(bytes32 agentId) internal {
        MarketState storage market = markets[agentId];
        if (market.status != MarketStatus.ACTIVE) return;

        MarketConfig memory config = marketConfigs[agentId];
        uint256 lastTimestamp = market.lastFundingTimestamp;
        if (lastTimestamp == 0) {
            market.lastFundingTimestamp = block.timestamp;
            return;
        }
        uint256 timeDelta = block.timestamp - lastTimestamp;
        if (timeDelta != 0) {
            int256 localSkew = int256(market.totalLongOI) - int256(market.totalShortOI);
            int256 fundingRateDelta =
                (localSkew * int256(fundingVelocity) * int256(timeDelta)) / int256(config.skewScale);
            market.currentFundingRate += fundingRateDelta;
            market.cumulativeFundingRate += fundingRateDelta;
            market.lastFundingTimestamp = block.timestamp;
        }
    }

    // ── Execution price ──

    function _getExecutionPrice(bytes32 agentId, int256 sizeDelta) internal view returns (uint256) {
        MarketState memory market = markets[agentId];
        MarketConfig memory config = marketConfigs[agentId];
        uint256 indexPrice = (market.settlementPrice != 0) ? market.settlementPrice : market.lastOraclePrice;
        if (indexPrice < 1) revert StaleOracle();

        int256 localSkew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 premium = ((localSkew + sizeDelta / 2) * int256(ONE)) / int256(config.skewScale);

        if (premium >= 0) {
            return indexPrice + (indexPrice * uint256(premium)) / ONE;
        }

        uint256 absPremium = uint256(-premium);
        if (absPremium >= ONE) {
            return indexPrice / 10;
        }
        return indexPrice - (indexPrice * absPremium) / ONE;
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }

    function _realizePnl(int256 existingSize, uint256 entryPrice, uint256 execPrice, uint256 closeSize)
        internal
        pure
        returns (int256)
    {
        if (existingSize == 0 || closeSize == 0 || entryPrice == 0) return 0;
        if (existingSize > 0) {
            return (int256(execPrice) - int256(entryPrice)) * int256(closeSize) / int256(ONE);
        }
        return (int256(entryPrice) - int256(execPrice)) * int256(closeSize) / int256(ONE);
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

    function _applySizeDelta(Position storage pos, int256 oldSize, uint256 oldEntryPrice, int256 sizeDelta, uint256 execPrice)
        internal
        returns (int256 realizedPnl)
    {
        if (sizeDelta == 0) return 0;

        if (oldSize == 0) {
            pos.size = sizeDelta;
            pos.entryPrice = execPrice;
            return 0;
        }

        if ((oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0)) {
            uint256 existingAbs = _abs(oldSize);
            uint256 addAbs = _abs(sizeDelta);
            pos.size = oldSize + sizeDelta;
            pos.entryPrice = ((oldEntryPrice * existingAbs) + (execPrice * addAbs)) / (existingAbs + addAbs);
            return 0;
        }

        uint256 oldAbs = _abs(oldSize);
        uint256 deltaAbs = _abs(sizeDelta);
        uint256 closeSize = oldAbs < deltaAbs ? oldAbs : deltaAbs;
        realizedPnl = _realizePnl(oldSize, oldEntryPrice, execPrice, closeSize);

        if (realizedPnl > 0) {
            pos.margin += uint256(realizedPnl);
        } else {
            uint256 loss = uint256(-realizedPnl);
            if (pos.margin < loss) revert Underwater();
            pos.margin -= loss;
        }

        pos.size = oldSize + sizeDelta;
        if (pos.size == 0) {
            pos.entryPrice = 0;
        } else if ((oldSize > 0 && pos.size > 0) || (oldSize < 0 && pos.size < 0)) {
            pos.entryPrice = oldEntryPrice;
        } else {
            pos.entryPrice = execPrice;
        }
    }

    function _collectLiquidationLoss(MarketState storage market, Position storage pos, uint256 amount) internal {
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return;

        uint256 fromMargin = amount > pos.margin ? pos.margin : amount;
        if (fromMargin != 0) {
            pos.margin -= fromMargin;
        }

        uint256 deficit = amount - fromMargin;
        // slither-disable-next-line incorrect-equality
        if (deficit == 0) return;

        uint256 fromInsurance = deficit > market.insuranceFund ? market.insuranceFund : deficit;
        if (fromInsurance != 0) {
            market.insuranceFund -= fromInsurance;
        }

        uint256 residualBadDebt = deficit - fromInsurance;
        if (residualBadDebt != 0) {
            market.badDebt += residualBadDebt;
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

    function _assertLeverage(bytes32 agentId, int256 size, uint256 margin) internal view {
        if (size == 0) return;
        if (margin == 0) revert Undercollateralized();
        MarketConfig memory config = marketConfigs[agentId];
        uint256 absSize = _abs(size);
        uint256 execPrice = _getExecutionPrice(agentId, 0);
        if (Math.mulDiv(absSize, execPrice, margin) > config.maxLeverage) revert MaxLeverageExceeded();
    }

    // ── Position management ──

    function modifyPosition(bytes32 agentId, int256 sizeDelta) external payable nonReentrant {
        _modifyPosition(agentId, sizeDelta, 0);
    }

    function modifyPositionWithAcceptablePrice(bytes32 agentId, int256 sizeDelta, uint256 acceptablePrice)
        external
        payable
        nonReentrant
    {
        _modifyPosition(agentId, sizeDelta, acceptablePrice);
    }

    function _modifyPosition(bytes32 agentId, int256 sizeDelta, uint256 acceptablePrice) internal {
        if (tradingPaused) revert TradingPaused();
        if (!marketConfigs[agentId].exists) revert MarketNotFound();

        _syncOracle(agentId);

        MarketConfig memory config = marketConfigs[agentId];
        MarketState storage market = markets[agentId];
        Position storage pos = positions[agentId][msg.sender];
        int256 oldSize = pos.size;

        _assertStatusAllowsTrade(market.status, oldSize, sizeDelta);

        // Settle funding
        if (pos.size != 0) {
            int256 rateDelta = market.cumulativeFundingRate - pos.lastCumulativeFundingRate;
            if (rateDelta != 0) {
                int256 fundingPayment = (pos.size * rateDelta) / int256(ONE);
                if (fundingPayment > 0) {
                    uint256 loss = uint256(fundingPayment);
                    if (pos.margin < loss) revert Underwater();
                    pos.margin -= loss;
                } else {
                    pos.margin += uint256(-fundingPayment);
                }
            }
        }
        pos.lastCumulativeFundingRate = market.cumulativeFundingRate;

        uint256 execPrice = _getExecutionPrice(agentId, sizeDelta);
        uint256 oldEntryPrice = pos.entryPrice;

        // Slippage protection
        if (acceptablePrice != 0 && sizeDelta != 0) {
            if (sizeDelta > 0 && execPrice > acceptablePrice) {
                revert SlippageExceeded(execPrice, acceptablePrice);
            }
            if (sizeDelta < 0 && execPrice < acceptablePrice) {
                revert SlippageExceeded(execPrice, acceptablePrice);
            }
        }

        _removeOpenInterest(market, oldSize);
        int256 realizedPnl = _applySizeDelta(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
        pos.margin += msg.value;

        // Deduct trading fees
        if (sizeDelta != 0 && (config.tradeTreasuryFeeBps + config.tradeMarketMakerFeeBps) > 0) {
            uint256 notionalDelta = Math.mulDiv(_abs(sizeDelta), execPrice, ONE);
            uint256 treasuryFee = Math.mulDiv(notionalDelta, config.tradeTreasuryFeeBps, BPS);
            uint256 mmFee = Math.mulDiv(notionalDelta, config.tradeMarketMakerFeeBps, BPS);
            uint256 totalFee = treasuryFee + mmFee;
            if (totalFee > 0) {
                if (pos.margin < totalFee) revert InsufficientMargin();
                pos.margin -= totalFee;
                market.treasuryFeeBalance += treasuryFee;
                market.marketMakerFeeBalance += mmFee;
            }
        }

        _addOpenInterest(market, pos.size);

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
                uint256 priceDelta = execPrice > prevPrice ? execPrice - prevPrice : prevPrice - execPrice;
                if (priceDelta * BPS / prevPrice > config.maxOraclePriceDeltaBps) {
                    revert OraclePriceDeltaTooLarge();
                }
            }
        }

        // Min insurance fund check
        if (config.minInsuranceFund > 0 && sizeDelta != 0) {
            bool isIncrease = oldSize == 0 || (oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0);
            if (isIncrease && market.insuranceFund < config.minInsuranceFund) {
                revert InsufficientInsurance();
            }
        }

        _assertLeverage(agentId, pos.size, pos.margin);

        // Track open positions counter
        if (oldSize == 0 && pos.size != 0) {
            market.openPositions += 1;
        }

        if (pos.size == 0 && pos.margin > 0) {
            if (oldSize != 0) {
                market.openPositions -= 1;
            }
            uint256 payout = pos.margin;
            pos.margin = 0;
            emit PositionClosed(agentId, msg.sender, oldSize, execPrice, realizedPnl);
            Address.sendValue(payable(msg.sender), payout);
        } else {
            emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
        }
    }

    function withdrawMargin(bytes32 agentId, uint256 amount) external nonReentrant {
        if (tradingPaused) revert TradingPaused();
        Position storage pos = positions[agentId][msg.sender];
        if (pos.margin < amount) revert InsufficientMargin();
        _assertLeverage(agentId, pos.size, pos.margin - amount);
        pos.margin -= amount;
        emit MarginWithdrawn(agentId, msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    // ── Liquidation with partial support ──

    function liquidate(bytes32 agentId, address trader) external nonReentrant {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        _isLiquidationContext = true;
        _syncOracle(agentId);
        _isLiquidationContext = false;

        MarketConfig memory config = marketConfigs[agentId];
        MarketState storage market = markets[agentId];
        Position storage pos = positions[agentId][trader];
        if (pos.size == 0) revert NoPosition();

        // Settle funding
        int256 rateDelta = market.cumulativeFundingRate - pos.lastCumulativeFundingRate;
        if (rateDelta != 0) {
            int256 fundingPayment = (pos.size * rateDelta) / int256(ONE);
            if (fundingPayment > 0) {
                uint256 loss = uint256(fundingPayment);
                pos.margin = pos.margin > loss ? pos.margin - loss : 0;
            } else {
                pos.margin += uint256(-fundingPayment);
            }
        }
        pos.lastCumulativeFundingRate = market.cumulativeFundingRate;

        uint256 markPrice = _getExecutionPrice(agentId, 0);
        uint256 absSize = _abs(pos.size);
        int256 pnl = _realizePnl(pos.size, pos.entryPrice, markPrice, absSize);
        int256 equity = int256(pos.margin) + pnl;
        uint256 maintenanceMargin = Math.mulDiv(
            Math.mulDiv(absSize, markPrice, ONE),
            config.maintenanceMarginBps,
            BPS
        );

        if (equity > int256(maintenanceMargin)) revert NotLiquidatable();

        // Determine partial vs full liquidation
        int256 liquidationSizeDelta = 0;
        bool isPartial = false;
        if (equity > 0 && absSize > ONE) {
            uint256 targetNotional = Math.mulDiv(uint256(equity), BPS, PARTIAL_LIQUIDATION_TARGET_MARGIN_RATIO);
            uint256 targetSize = Math.mulDiv(targetNotional, ONE, markPrice);
            if (targetSize > 0 && targetSize < absSize) {
                uint256 closeSize = absSize - targetSize;
                uint256 minClose = absSize / 10;
                if (closeSize < minClose) closeSize = minClose;
                if (closeSize < absSize) {
                    liquidationSizeDelta = pos.size > 0 ? -int256(closeSize) : int256(closeSize);
                    isPartial = true;
                }
            }
        }

        if (!isPartial) {
            liquidationSizeDelta = -pos.size;
        }

        uint256 closedSize = _abs(liquidationSizeDelta);
        uint256 liquidationPrice = _getExecutionPrice(agentId, liquidationSizeDelta);
        uint256 startingMargin = pos.margin;
        int256 realizedPnl = _realizePnl(pos.size, pos.entryPrice, liquidationPrice, closedSize);

        _removeOpenInterest(market, pos.size);

        if (realizedPnl > 0) {
            pos.margin += uint256(realizedPnl);
        } else if (realizedPnl < 0) {
            _collectLiquidationLoss(market, pos, uint256(-realizedPnl));
        }

        uint256 reward = Math.mulDiv(
            Math.mulDiv(startingMargin, config.liquidationRewardBps, BPS),
            closedSize,
            absSize
        );
        uint256 maxInsuranceDraw = market.insuranceFund / MAX_INSURANCE_DRAW_DIVISOR;
        uint256 maxReward = pos.margin + maxInsuranceDraw;
        if (reward > maxReward) reward = maxReward;

        uint256 rewardFromMargin = reward > pos.margin ? pos.margin : reward;
        pos.margin -= rewardFromMargin;

        uint256 rewardFromInsurance = reward - rewardFromMargin;
        if (rewardFromInsurance != 0) {
            market.insuranceFund -= rewardFromInsurance;
        }

        if (isPartial) {
            pos.size += liquidationSizeDelta;
            _addOpenInterest(market, pos.size);
        } else {
            uint256 remaining = pos.margin;
            pos.size = 0;
            pos.margin = 0;
            pos.entryPrice = 0;
            market.insuranceFund += remaining;
            market.openPositions -= 1;
        }

        emit PositionLiquidated(agentId, trader, msg.sender, pos.size, liquidationPrice, equity, reward);

        if (reward != 0) {
            Address.sendValue(payable(msg.sender), reward);
        }
    }

    function depositInsuranceFund(bytes32 agentId) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (msg.value == 0) return;
        MarketState storage market = markets[agentId];
        uint256 remaining = msg.value;
        if (market.badDebt != 0) {
            uint256 repaid = remaining > market.badDebt ? market.badDebt : remaining;
            market.badDebt -= repaid;
            remaining -= repaid;
        }
        if (remaining != 0) {
            market.insuranceFund += remaining;
        }
        emit InsuranceFundDeposited(agentId, msg.sender, msg.value);
    }

    function withdrawInsuranceFund(bytes32 agentId, address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (to == address(0)) revert InvalidRecipient();
        MarketState storage market = markets[agentId];
        if (market.insuranceFund < amount) revert InsufficientInsuranceFund();
        market.insuranceFund -= amount;
        Address.sendValue(to, amount);
    }

    function withdrawFeeBalance(bytes32 agentId, uint8 bucket, address payable to)
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
            Address.sendValue(to, amount);
        }
    }

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

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }
}
