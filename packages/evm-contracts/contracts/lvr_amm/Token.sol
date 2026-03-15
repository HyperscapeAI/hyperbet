// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract YesToken is ERC20{
    error InvalidMarket();
    error OnlyMarket();

    address immutable market;

    constructor(address _market, uint256 liquidity) ERC20("YesToken", "YES") {
        if (_market == address(0)) revert InvalidMarket();
        market = _market;
        _mint(market, liquidity);
    }

    function mint(address user, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _burn(user, amount);
    }
}

contract NoToken is ERC20{
    error InvalidMarket();
    error OnlyMarket();

    address immutable market;

    constructor(address _market, uint256 liquidity) ERC20("NoToken", "NO") {
        if (_market == address(0)) revert InvalidMarket();
        market = _market;
        _mint(market, liquidity);
    }

    function mint(address user, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) external {
        if (msg.sender != market) revert OnlyMarket();
        _burn(user, amount);
    }
}
