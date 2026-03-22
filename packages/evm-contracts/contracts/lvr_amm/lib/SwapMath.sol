// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.19;

import {Math} from "./Math.sol";
import {Gaussian} from "./Gaussian.sol";
import {FixedPointMathLib} from "lib/solady/src/utils/FixedPointMathLib.sol";

library SwapMath {
    int256 constant APPROX = 1e15;
    int256 constant MAX_ITERS = 50;
    int256 constant MIN_RESERVE = 1e15;
    int256 constant MIN_DERIVATIVE = 1e14;
    int256 constant MAX_Z_SCORE = 38e18; // |z| > 38 WAD → beyond f64 precision, clamp to boundary

    error ZScoreOutOfBounds();
    error NewtonNotConverged();

    function ammFunc(int256 x, int256 y, int256 l) internal pure returns(int256) {
        int256 z = FixedPointMathLib.sDivWad((y-x), l);
        return FixedPointMathLib.sMulWad((y-x) ,Gaussian.cdf(z)) 
        +  FixedPointMathLib.sMulWad(l, Gaussian.pdf(z)) 
        - y;
        // Provides the value of the invariant function when input values are x, y and initial liquidity is l
    }

    function funcDerivative(int256 x, int256 y, int256 l) internal pure returns(int256) {
        int256 z = FixedPointMathLib.sDivWad((y-x), l);
        int256 deriv = -Gaussian.cdf(z);
        // Apply floor to prevent division by near-zero
        if (abs(deriv) < MIN_DERIVATIVE) {
            return deriv < 0 ? -MIN_DERIVATIVE : MIN_DERIVATIVE;
        }
        return deriv;
    }

    function getNewReserve(int256 x, int256 y, int256 l) internal pure returns (int256) { // x is the token reserve to calculate
        // Better initial guess: use x if reasonable, otherwise use half of y
        int256 t = x;
        if (abs(x) < MIN_RESERVE) {
            t = y / 2; // Start from a better guess when reserve is too low
        }

        for(int256 i = 0; i < MAX_ITERS; i++){
            int256 f = ammFunc(t, y, l);
            if(abs(f) < APPROX){
                // Ensure result is at least MIN_RESERVE to prevent future issues
                int256 result = abs(t);
                return result < MIN_RESERVE ? MIN_RESERVE : result;
            }
            int256 deriv = funcDerivative(t, y, l);
            t = t - FixedPointMathLib.sDivWad(f, deriv);
        }

        revert NewtonNotConverged();
    }

    function abs(int256 f) internal pure returns(int256) {
        return (f > 0 ? f : -f);
    }

// inputs ->
// Current Reserve of Yes token
// Current Reserve of No token 
// Amount of token No to swap for token Yes || Amount of token Yes to swap for token No
// Initial liquidity of the market
// Invariant function
// f(t) = (a + t) * Gaussian.cdf((a + t) / liquidity) + liquidity * Gaussian.pdf((a + t) / liquidity) - y

    function getSwapAmount(bool yesToNo, int256 currentReserveYes, int256 currentReserveNo, uint256 initialLiquidity, int256 amountIn) external pure returns(uint256){
        int256 reserveYes = currentReserveYes < MIN_RESERVE ? MIN_RESERVE : currentReserveYes;
        int256 reserveNo = currentReserveNo < MIN_RESERVE ? MIN_RESERVE : currentReserveNo;

        // Validate z-score at entry: if reserves are too divergent relative to liquidity, reject
        int256 l = int256(initialLiquidity);
        if (l > 0) {
            int256 z = FixedPointMathLib.sDivWad((reserveNo - reserveYes), l);
            if (abs(z) > MAX_Z_SCORE) revert ZScoreOutOfBounds();
        }
        
        if(yesToNo){
            return uint256(abs(reserveNo - getNewReserve(reserveNo, reserveYes + amountIn, int256(initialLiquidity))));
        }
        return uint256(abs(reserveYes - getNewReserve(reserveYes, reserveNo + amountIn, int256(initialLiquidity))));
    }

}
