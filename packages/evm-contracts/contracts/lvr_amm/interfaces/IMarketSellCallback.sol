// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IMarketSellCallback {
    function marketSellCallback(uint256 tokenIn, address tokenToSell, address seller) external;
}
