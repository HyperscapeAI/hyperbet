// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./DuelOutcomeOracle.sol";

contract GoldClob is AccessControl, ReentrancyGuard {
    using Address for address payable;

    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");

    uint8 public constant MARKET_KIND_DUEL_WINNER = 0;
    uint8 private constant BUY_SIDE = 1;
    uint8 private constant SELL_SIDE = 2;
    uint16 private constant MAX_PRICE = 1000;
    uint256 private constant PRICE_BITMAP_WORDS = 4;
    uint256 public constant MAX_FEE_BPS = 10_000;

    DuelOutcomeOracle public duelOracle;
    address public treasury;
    address public marketMaker;
    uint256 public tradeTreasuryFeeBps;
    uint256 public tradeMarketMakerFeeBps;
    uint256 public winningsMarketMakerFeeBps;

    error InvalidAdmin();
    error InvalidOperator();
    error InvalidOracle();
    error InvalidTreasury();
    error InvalidMarketMaker();
    error TreasuryFeeTooHigh();
    error MarketMakerFeeTooHigh();
    error TotalTradeFeeTooHigh();
    error WinningsFeeTooHigh();
    error InvalidMarketKind();
    error MarketExists();
    error DuelNotMarketable();
    error MarketMissing();
    error InvalidSide();
    error InvalidPrice();
    error InvalidAmountShape();
    error MarketNotOpen();
    error BettingClosed();
    error NotMaker();
    error OrderInactive();
    error AlreadyFilled();
    error NothingToClaim();
    error MarketNotSettled();
    error InsufficientNativeValue();
    error CostTooLow();

    enum MarketStatus {
        NULL,
        OPEN,
        LOCKED,
        RESOLVED,
        CANCELLED
    }

    enum Side {
        NONE,
        A,
        B
    }

    struct Market {
        bool exists;
        bytes32 duelKey;
        MarketStatus status;
        Side winner;
        uint64 nextOrderId;
        uint16 bestBid;
        uint16 bestAsk;
        uint128 totalAShares;
        uint128 totalBShares;
    }

    struct Order {
        uint64 id;
        uint8 side;
        uint16 price;
        address maker;
        uint128 amount;
        uint128 filled;
        uint64 prevOrderId;
        uint64 nextOrderId;
        bool active;
    }

    struct Position {
        uint128 aShares;
        uint128 bShares;
        uint128 aStake;
        uint128 bStake;
    }

    struct PriceLevel {
        uint64 headOrderId;
        uint64 tailOrderId;
        uint128 totalOpen;
    }

    struct MatchProgress {
        uint128 remainingAmount;
        uint16 boundaryPrice;
        uint8 matchesCount;
        uint256 totalImprovement;
    }

    mapping(bytes32 => Market) private markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    mapping(bytes32 => mapping(uint64 => Order)) public orders;
    mapping(bytes32 => mapping(uint8 => mapping(uint16 => PriceLevel))) private priceLevels;
    mapping(bytes32 => mapping(uint8 => uint256[PRICE_BITMAP_WORDS])) private priceBitmaps;

    event MarketCreated(bytes32 indexed duelKey, bytes32 indexed marketKey, uint8 marketKind);
    event MarketSynced(bytes32 indexed duelKey, bytes32 indexed marketKey, MarketStatus status, Side winner);
    event OrderPlaced(
        bytes32 indexed marketKey,
        uint64 indexed orderId,
        address indexed maker,
        uint8 side,
        uint16 price,
        uint256 amount
    );
    event OrderMatched(
        bytes32 indexed marketKey,
        uint64 makerOrderId,
        uint64 takerOrderId,
        uint256 matchedAmount,
        uint16 price
    );
    event OrderCancelled(bytes32 indexed marketKey, uint64 indexed orderId);
    event FeeConfigUpdated(
        uint256 tradeTreasuryFeeBps,
        uint256 tradeMarketMakerFeeBps,
        uint256 winningsMarketMakerFeeBps
    );
    event TreasuryUpdated(address treasury);
    event MarketMakerUpdated(address marketMaker);
    event OracleUpdated(address oracle);

    constructor(
        address admin,
        address marketOperator,
        address oracle,
        address treasury_,
        address marketMaker_
    ) {
        if (admin == address(0)) revert InvalidAdmin();
        if (marketOperator == address(0)) revert InvalidOperator();
        if (oracle == address(0)) revert InvalidOracle();
        if (treasury_ == address(0)) revert InvalidTreasury();
        if (marketMaker_ == address(0)) revert InvalidMarketMaker();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_OPERATOR_ROLE, marketOperator);

        duelOracle = DuelOutcomeOracle(oracle);
        treasury = treasury_;
        marketMaker = marketMaker_;
        _setFeeConfig(100, 100, 200);
    }

    function marketKey(bytes32 duelKey, uint8 marketKind) public pure returns (bytes32) {
        return keccak256(abi.encode(duelKey, marketKind));
    }

    function getMarket(bytes32 duelKey, uint8 marketKind) external view returns (Market memory) {
        return markets[marketKey(duelKey, marketKind)];
    }

    function getPriceLevel(
        bytes32 duelKey,
        uint8 marketKind,
        uint8 side,
        uint16 price
    ) external view returns (uint64 headOrderId, uint64 tailOrderId, uint128 totalOpen) {
        PriceLevel storage level = priceLevels[marketKey(duelKey, marketKind)][side][price];
        return (level.headOrderId, level.tailOrderId, level.totalOpen);
    }

    function setOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oracle == address(0)) revert InvalidOracle();
        duelOracle = DuelOutcomeOracle(oracle);
        emit OracleUpdated(oracle);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert InvalidTreasury();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setMarketMaker(address marketMaker_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (marketMaker_ == address(0)) revert InvalidMarketMaker();
        marketMaker = marketMaker_;
        emit MarketMakerUpdated(marketMaker_);
    }

    function setFeeConfig(
        uint256 tradeTreasuryFeeBps_,
        uint256 tradeMarketMakerFeeBps_,
        uint256 winningsMarketMakerFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tradeTreasuryFeeBps_ > MAX_FEE_BPS) revert TreasuryFeeTooHigh();
        if (tradeMarketMakerFeeBps_ > MAX_FEE_BPS) revert MarketMakerFeeTooHigh();
        if (tradeTreasuryFeeBps_ + tradeMarketMakerFeeBps_ > MAX_FEE_BPS) revert TotalTradeFeeTooHigh();
        if (winningsMarketMakerFeeBps_ > MAX_FEE_BPS) revert WinningsFeeTooHigh();

        tradeTreasuryFeeBps = tradeTreasuryFeeBps_;
        tradeMarketMakerFeeBps = tradeMarketMakerFeeBps_;
        winningsMarketMakerFeeBps = winningsMarketMakerFeeBps_;

        emit FeeConfigUpdated(
            tradeTreasuryFeeBps_,
            tradeMarketMakerFeeBps_,
            winningsMarketMakerFeeBps_
        );
    }

    function feeBps() external view returns (uint256) {
        return tradeTreasuryFeeBps + tradeMarketMakerFeeBps;
    }

    function createMarketForDuel(bytes32 duelKey, uint8 marketKind)
        external
        onlyRole(MARKET_OPERATOR_ROLE)
        returns (bytes32 key)
    {
        if (marketKind != MARKET_KIND_DUEL_WINNER) revert InvalidMarketKind();
        key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        if (market.exists) revert MarketExists();

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        if (
            duel.status != DuelOutcomeOracle.DuelStatus.BETTING_OPEN
                && duel.status != DuelOutcomeOracle.DuelStatus.LOCKED
        ) revert DuelNotMarketable();

        market.exists = true;
        market.duelKey = duelKey;
        market.status = _mapDuelStatus(duel.status);
        market.nextOrderId = 1;
        market.bestAsk = MAX_PRICE;

        emit MarketCreated(duelKey, key, marketKind);
    }

    function syncMarketFromOracle(bytes32 duelKey, uint8 marketKind) public returns (MarketStatus) {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        if (!market.exists) revert MarketMissing();

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        return _syncMarketFromOracle(duelKey, key, market, duel);
    }

    function placeOrder(
        bytes32 duelKey,
        uint8 marketKind,
        uint8 side,
        uint16 price,
        uint128 amount
    ) external payable nonReentrant {
        if (side != BUY_SIDE && side != SELL_SIDE) revert InvalidSide();
        if (price == 0 || price >= MAX_PRICE) revert InvalidPrice();
        if (amount == 0 || amount % MAX_PRICE != 0) revert InvalidAmountShape();

        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        if (!market.exists) revert MarketMissing();
        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        if (_syncMarketFromOracle(duelKey, key, market, duel) != MarketStatus.OPEN) revert MarketNotOpen();
        if (block.timestamp >= duel.betCloseTs) revert BettingClosed();

        uint64 takerOrderId = market.nextOrderId;
        market.nextOrderId += 1;

        (uint256 tradeTreasuryFee, uint256 tradeMarketMakerFee, uint256 excess) =
            _quoteOrder(side, price, amount, msg.value);

        MatchProgress memory progress = side == BUY_SIDE
            ? _matchBuyOrder(key, market, price, amount, takerOrderId)
            : _matchSellOrder(key, market, price, amount, takerOrderId);

        if (progress.remainingAmount > 0) {
            _restOrder(key, market, side, price, uint128(progress.remainingAmount), takerOrderId);
        } else {
            orders[key][takerOrderId] = Order({
                id: takerOrderId,
                side: side,
                price: price,
                maker: msg.sender,
                amount: amount,
                filled: amount,
                prevOrderId: 0,
                nextOrderId: 0,
                active: false
            });
        }

        if (tradeTreasuryFee > 0) payable(treasury).sendValue(tradeTreasuryFee);
        if (tradeMarketMakerFee > 0) payable(marketMaker).sendValue(tradeMarketMakerFee);
        uint256 traderRefund = progress.totalImprovement + excess;
        if (traderRefund > 0) payable(msg.sender).sendValue(traderRefund);
    }

    function cancelOrder(bytes32 duelKey, uint8 marketKind, uint64 orderId) external nonReentrant {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        if (!market.exists) revert MarketMissing();

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        _syncMarketFromOracle(duelKey, key, market, duel);

        Order storage order = orders[key][orderId];
        if (order.maker != msg.sender) revert NotMaker();
        if (!order.active) revert OrderInactive();
        if (order.filled >= order.amount) revert AlreadyFilled();

        uint128 remaining = order.amount - order.filled;
        PriceLevel storage level = priceLevels[key][order.side][order.price];

        _unlinkOrder(key, market, level, order, remaining);

        uint256 refund = _quoteCost(order.side, order.price, remaining);
        order.filled = order.amount;
        order.active = false;
        order.prevOrderId = 0;
        order.nextOrderId = 0;

        if (refund > 0) payable(msg.sender).sendValue(refund);

        emit OrderCancelled(key, orderId);
    }

    function claim(bytes32 duelKey, uint8 marketKind) external nonReentrant {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        if (!market.exists) revert MarketMissing();

        MarketStatus status = syncMarketFromOracle(duelKey, marketKind);
        Position storage position = positions[key][msg.sender];
        bool hasPosition = position.aShares > 0 || position.bShares > 0 || position.aStake > 0 || position.bStake > 0;
        require(hasPosition, "nothing to claim");

        uint256 payout = 0;
        if (status == MarketStatus.RESOLVED) {
            uint256 winningShares = market.winner == Side.A ? position.aShares : position.bShares;
            _clearPosition(position);
            if (winningShares > 0) {
                uint256 fee = (winningShares * winningsMarketMakerFeeBps) / MAX_FEE_BPS;
                payout = winningShares - fee;
                if (fee > 0) payable(marketMaker).sendValue(fee);
            }
        } else if (status == MarketStatus.CANCELLED) {
            payout = uint256(position.aStake) + uint256(position.bStake);
            _clearPosition(position);
        } else {
            revert MarketNotSettled();
        }

        payable(msg.sender).sendValue(payout);
    }

    function _clearPosition(Position storage position) internal {
        position.aShares = 0;
        position.bShares = 0;
        position.aStake = 0;
        position.bStake = 0;
    }

    function _setFeeConfig(
        uint256 tradeTreasuryFeeBps_,
        uint256 tradeMarketMakerFeeBps_,
        uint256 winningsMarketMakerFeeBps_
    ) internal {
        if (tradeTreasuryFeeBps_ > MAX_FEE_BPS) revert TreasuryFeeTooHigh();
        if (tradeMarketMakerFeeBps_ > MAX_FEE_BPS) revert MarketMakerFeeTooHigh();
        if (tradeTreasuryFeeBps_ + tradeMarketMakerFeeBps_ > MAX_FEE_BPS) revert TotalTradeFeeTooHigh();
        if (winningsMarketMakerFeeBps_ > MAX_FEE_BPS) revert WinningsFeeTooHigh();

        tradeTreasuryFeeBps = tradeTreasuryFeeBps_;
        tradeMarketMakerFeeBps = tradeMarketMakerFeeBps_;
        winningsMarketMakerFeeBps = winningsMarketMakerFeeBps_;

        emit FeeConfigUpdated(
            tradeTreasuryFeeBps_,
            tradeMarketMakerFeeBps_,
            winningsMarketMakerFeeBps_
        );
    }

    function _quoteOrder(uint8 side, uint16 price, uint128 amount, uint256 value)
        internal
        view
        returns (uint256 tradeTreasuryFee, uint256 tradeMarketMakerFee, uint256 excess)
    {
        uint256 cost = _quoteCost(side, price, amount);
        tradeTreasuryFee = (cost * tradeTreasuryFeeBps) / MAX_FEE_BPS;
        tradeMarketMakerFee = (cost * tradeMarketMakerFeeBps) / MAX_FEE_BPS;
        uint256 totalRequired = cost + tradeTreasuryFee + tradeMarketMakerFee;
        if (value < totalRequired) revert InsufficientNativeValue();
        excess = value - totalRequired;
    }

    function _quoteCost(uint8 side, uint16 price, uint128 amount) internal pure returns (uint256) {
        uint256 priceComponent = side == BUY_SIDE ? price : MAX_PRICE - price;
        uint256 quoteValue = uint256(amount) * priceComponent;
        uint256 cost = quoteValue / MAX_PRICE;
        if (cost == 0) revert CostTooLow();
        return cost;
    }

    function _fillStakes(uint16 price, uint128 amount) internal pure returns (uint128 bidStake, uint128 askStake) {
        bidStake = uint128(_quoteCost(BUY_SIDE, price, amount));
        askStake = amount - bidStake;
    }

    function _matchBuyOrder(
        bytes32 key,
        Market storage market,
        uint16 limitPrice,
        uint128 amount,
        uint64 takerOrderId
    ) internal returns (MatchProgress memory progress) {
        progress.remainingAmount = amount;
        progress.boundaryPrice = market.bestAsk;

        while (
            progress.remainingAmount > 0
                && progress.boundaryPrice <= limitPrice
                && progress.boundaryPrice < MAX_PRICE
                && progress.matchesCount < 100
        ) {
            PriceLevel storage level = priceLevels[key][SELL_SIDE][progress.boundaryPrice];
            if (level.headOrderId == 0 || level.totalOpen == 0) {
                _deactivatePrice(key, market, SELL_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestAsk;
                progress.matchesCount += 1;
                continue;
            }

            Order storage makerOrder = orders[key][level.headOrderId];
            uint128 makerRemaining = makerOrder.amount - makerOrder.filled;
            if (!makerOrder.active || makerRemaining == 0) {
                _popHead(key, market, SELL_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestAsk;
                progress.matchesCount += 1;
                continue;
            }

            uint128 fillAmount = makerRemaining < progress.remainingAmount
                ? makerRemaining
                : progress.remainingAmount;

            makerOrder.filled += fillAmount;
            progress.remainingAmount -= fillAmount;
            level.totalOpen -= fillAmount;

            Position storage makerPosition = positions[key][makerOrder.maker];
            Position storage takerPosition = positions[key][msg.sender];
            (uint128 bidStake, uint128 askStake) = _fillStakes(progress.boundaryPrice, fillAmount);
            makerPosition.bShares += fillAmount;
            makerPosition.bStake += askStake;
            takerPosition.aShares += fillAmount;
            takerPosition.aStake += bidStake;
            market.totalAShares += fillAmount;
            market.totalBShares += fillAmount;

            if (limitPrice > progress.boundaryPrice) {
                progress.totalImprovement +=
                    (uint256(fillAmount) * (limitPrice - progress.boundaryPrice)) / MAX_PRICE;
            }

            emit OrderMatched(key, makerOrder.id, takerOrderId, fillAmount, progress.boundaryPrice);

            if (makerOrder.filled == makerOrder.amount) {
                _popHead(key, market, SELL_SIDE, progress.boundaryPrice);
            }

            progress.boundaryPrice = market.bestAsk;
            progress.matchesCount += 1;
        }
    }

    function _matchSellOrder(
        bytes32 key,
        Market storage market,
        uint16 limitPrice,
        uint128 amount,
        uint64 takerOrderId
    ) internal returns (MatchProgress memory progress) {
        progress.remainingAmount = amount;
        progress.boundaryPrice = market.bestBid;

        while (
            progress.remainingAmount > 0
                && progress.boundaryPrice >= limitPrice
                && progress.boundaryPrice > 0
                && progress.matchesCount < 100
        ) {
            PriceLevel storage level = priceLevels[key][BUY_SIDE][progress.boundaryPrice];
            if (level.headOrderId == 0 || level.totalOpen == 0) {
                _deactivatePrice(key, market, BUY_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestBid;
                progress.matchesCount += 1;
                continue;
            }

            Order storage makerOrder = orders[key][level.headOrderId];
            uint128 makerRemaining = makerOrder.amount - makerOrder.filled;
            if (!makerOrder.active || makerRemaining == 0) {
                _popHead(key, market, BUY_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestBid;
                progress.matchesCount += 1;
                continue;
            }

            uint128 fillAmount = makerRemaining < progress.remainingAmount
                ? makerRemaining
                : progress.remainingAmount;

            makerOrder.filled += fillAmount;
            progress.remainingAmount -= fillAmount;
            level.totalOpen -= fillAmount;

            Position storage makerPosition = positions[key][makerOrder.maker];
            Position storage takerPosition = positions[key][msg.sender];
            (uint128 bidStake, uint128 askStake) = _fillStakes(progress.boundaryPrice, fillAmount);
            makerPosition.aShares += fillAmount;
            makerPosition.aStake += bidStake;
            takerPosition.bShares += fillAmount;
            takerPosition.bStake += askStake;
            market.totalAShares += fillAmount;
            market.totalBShares += fillAmount;

            if (progress.boundaryPrice > limitPrice) {
                progress.totalImprovement +=
                    (uint256(fillAmount) * (progress.boundaryPrice - limitPrice)) / MAX_PRICE;
            }

            emit OrderMatched(key, makerOrder.id, takerOrderId, fillAmount, progress.boundaryPrice);

            if (makerOrder.filled == makerOrder.amount) {
                _popHead(key, market, BUY_SIDE, progress.boundaryPrice);
            }

            progress.boundaryPrice = market.bestBid;
            progress.matchesCount += 1;
        }
    }

    function _restOrder(
        bytes32 key,
        Market storage market,
        uint8 side,
        uint16 price,
        uint128 amount,
        uint64 orderId
    ) internal {
        Order storage newOrder = orders[key][orderId];
        PriceLevel storage level = priceLevels[key][side][price];

        newOrder.id = orderId;
        newOrder.side = side;
        newOrder.price = price;
        newOrder.maker = msg.sender;
        newOrder.amount = amount;
        newOrder.prevOrderId = level.tailOrderId;
        newOrder.active = true;

        if (level.tailOrderId != 0) {
            orders[key][level.tailOrderId].nextOrderId = orderId;
        } else {
            level.headOrderId = orderId;
        }
        level.tailOrderId = orderId;
        level.totalOpen += amount;

        _activatePrice(key, market, side, price);
        emit OrderPlaced(key, orderId, msg.sender, side, price, amount);
    }

    function _popHead(bytes32 key, Market storage market, uint8 side, uint16 price) internal {
        PriceLevel storage level = priceLevels[key][side][price];
        Order storage head = orders[key][level.headOrderId];

        level.headOrderId = head.nextOrderId;
        if (level.headOrderId == 0) {
            level.tailOrderId = 0;
            level.totalOpen = 0;
            _deactivatePrice(key, market, side, price);
        }

        head.active = false;
        head.prevOrderId = 0;
        head.nextOrderId = 0;
    }

    function _unlinkOrder(
        bytes32 key,
        Market storage market,
        PriceLevel storage level,
        Order storage order,
        uint128 remaining
    ) internal {
        if (order.prevOrderId == 0) {
            level.headOrderId = order.nextOrderId;
        } else {
            orders[key][order.prevOrderId].nextOrderId = order.nextOrderId;
        }

        if (order.nextOrderId == 0) {
            level.tailOrderId = order.prevOrderId;
        } else {
            orders[key][order.nextOrderId].prevOrderId = order.prevOrderId;
        }

        level.totalOpen -= remaining;
        if (level.headOrderId == 0 || level.totalOpen == 0) {
            level.headOrderId = 0;
            level.tailOrderId = 0;
            level.totalOpen = 0;
            _deactivatePrice(key, market, order.side, order.price);
        } else {
            _refreshBestPrices(key, market);
        }
    }

    function _activatePrice(bytes32 key, Market storage market, uint8 side, uint16 price) internal {
        uint256 wordIndex = uint256(price) / 256;
        uint256 bitIndex = uint256(price) % 256;
        priceBitmaps[key][side][wordIndex] |= uint256(1) << bitIndex;

        if (side == BUY_SIDE) {
            if (price > market.bestBid) market.bestBid = price;
        } else if (price < market.bestAsk) {
            market.bestAsk = price;
        }
    }

    function _deactivatePrice(bytes32 key, Market storage market, uint8 side, uint16 price) internal {
        delete priceLevels[key][side][price];
        uint256 wordIndex = uint256(price) / 256;
        uint256 bitIndex = uint256(price) % 256;
        priceBitmaps[key][side][wordIndex] &= ~(uint256(1) << bitIndex);

        if (side == BUY_SIDE) {
            if (market.bestBid == price) market.bestBid = _highestSetPrice(key, BUY_SIDE);
            return;
        }

        if (market.bestAsk == price) {
            uint16 nextBestAsk = _lowestSetPrice(key, SELL_SIDE);
            market.bestAsk = nextBestAsk == 0 ? MAX_PRICE : nextBestAsk;
        }
    }

    function _refreshBestPrices(bytes32 key, Market storage market) internal {
        market.bestBid = _highestSetPrice(key, BUY_SIDE);
        uint16 bestAsk = _lowestSetPrice(key, SELL_SIDE);
        market.bestAsk = bestAsk == 0 ? MAX_PRICE : bestAsk;
    }

    function _syncMarketFromOracle(
        bytes32 duelKey,
        bytes32 key,
        Market storage market,
        DuelOutcomeOracle.DuelState memory duel
    ) internal returns (MarketStatus) {
        market.status = _mapDuelStatus(duel.status);
        if (duel.status == DuelOutcomeOracle.DuelStatus.RESOLVED) {
            market.winner = _mapWinner(duel.winner);
        } else if (duel.status == DuelOutcomeOracle.DuelStatus.CANCELLED) {
            market.winner = Side.NONE;
        }

        emit MarketSynced(duelKey, key, market.status, market.winner);
        return market.status;
    }

    function _highestSetPrice(bytes32 key, uint8 side) internal view returns (uint16) {
        uint256[PRICE_BITMAP_WORDS] storage bitmap = priceBitmaps[key][side];

        for (uint256 wordIndex = PRICE_BITMAP_WORDS; wordIndex > 0; ) {
            unchecked { wordIndex -= 1; }
            uint256 word = bitmap[wordIndex];
            if (word == 0) continue;

            uint256 price = (wordIndex * 256) + Math.log2(word);
            if (price < MAX_PRICE) return uint16(price);
        }

        return 0;
    }

    function _lowestSetPrice(bytes32 key, uint8 side) internal view returns (uint16) {
        uint256[PRICE_BITMAP_WORDS] storage bitmap = priceBitmaps[key][side];

        for (uint256 wordIndex = 0; wordIndex < PRICE_BITMAP_WORDS; wordIndex++) {
            uint256 word = bitmap[wordIndex];
            if (word == 0) continue;

            uint256 isolatedBit = word & (~word + 1);
            uint256 price = (wordIndex * 256) + Math.log2(isolatedBit);
            if (price > 0 && price < MAX_PRICE) return uint16(price);
        }

        return 0;
    }

    function _mapDuelStatus(DuelOutcomeOracle.DuelStatus status) internal pure returns (MarketStatus) {
        if (status == DuelOutcomeOracle.DuelStatus.BETTING_OPEN) return MarketStatus.OPEN;
        if (status == DuelOutcomeOracle.DuelStatus.LOCKED) return MarketStatus.LOCKED;
        if (status == DuelOutcomeOracle.DuelStatus.RESOLVED) return MarketStatus.RESOLVED;
        if (status == DuelOutcomeOracle.DuelStatus.CANCELLED) return MarketStatus.CANCELLED;
        return MarketStatus.NULL;
    }

    function _mapWinner(DuelOutcomeOracle.Side winner) internal pure returns (Side) {
        if (winner == DuelOutcomeOracle.Side.A) return Side.A;
        if (winner == DuelOutcomeOracle.Side.B) return Side.B;
        return Side.NONE;
    }

    receive() external payable {}
}
