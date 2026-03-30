// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract YesToken is ERC20{
    address immutable market;

    constructor(address _market, uint256 liquidity) ERC20("YesToken", "YES") {
        require(_market != address(0), "invalid market");
        market = _market;
        mint(market, liquidity);
    }

    function mint(address user, uint256 amount) public {
        require(msg.sender == market);
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) public {
        require(msg.sender == market);
        _burn(user, amount);
    }
}

contract NoToken is ERC20{
    address immutable market;

    constructor(address _market, uint256 liquidity) ERC20("NoToken", "NO") {
        require(_market != address(0), "invalid market");
        market = _market;
        mint(market, liquidity);
    }

    function mint(address user, uint256 amount) public {
        require(msg.sender == market);
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) public {
        require(msg.sender == market);
        _burn(user, amount);
    }
}
