use libm::{erf, exp, fabs, sqrt};

/// WAD unit size (1e18)
pub const WAD: f64 = 1_000_000_000_000_000_000.0;
pub const MIN_RESERVE: f64 = 0.001; // 1e15 in WAD
pub const MIN_DERIVATIVE: f64 = 0.0001; // 1e14 in WAD

/// Computes the Gaussian CDF for a standard normal distribution.
pub fn gaussian_cdf(z: f64) -> f64 {
    0.5 * (1.0 + erf(z / std::f64::consts::SQRT_2))
}

/// Computes the Gaussian PDF for a standard normal distribution.
pub fn gaussian_pdf(x: f64) -> f64 {
    let e = exp(-x * x / 2.0);
    e / sqrt(2.0 * std::f64::consts::PI)
}

/// LvrMarket AMM Invariant function definition:
/// f(t) = (y - x)*cdf(z) + L*pdf(z) - y
/// where z = (y - x)/L
pub fn amm_func(x: f64, y: f64, l: f64) -> f64 {
    let z = (y - x) / l;
    (y - x) * gaussian_cdf(z) + l * gaussian_pdf(z) - y
}

/// Derivative of the invariant function w.r.t x
pub fn func_derivative(x: f64, y: f64, l: f64) -> f64 {
    let z = (y - x) / l;
    let mut deriv = -gaussian_cdf(z);
    
    // Apply floor to derivative to prevent division by zero in Newton-Raphson
    if fabs(deriv) < MIN_DERIVATIVE {
        deriv = if deriv < 0.0 { -MIN_DERIVATIVE } else { MIN_DERIVATIVE };
    }
    deriv
}

/// Use Newton-Raphson to find the new reserve (x) corresponding to a modified y.
pub fn get_new_reserve(x_guess: f64, y: f64, l: f64) -> f64 {
    let mut t = if fabs(x_guess) < MIN_RESERVE {
        y / 2.0 // Better initial guess
    } else {
        x_guess
    };

    let approx = 0.001; // 1e15 in WAD
    let max_iters = 50;

    for _ in 0..max_iters {
        let f = amm_func(t, y, l);
        if fabs(f) < approx {
            let res = fabs(t);
            return if res < MIN_RESERVE { MIN_RESERVE } else { res };
        }
        let deriv = func_derivative(t, y, l);
        t -= f / deriv;
    }

    let res = fabs(t);
    if res < MIN_RESERVE { MIN_RESERVE } else { res }
}

pub fn get_swap_amount(
    yes_to_no: bool,
    current_reserve_yes: u64,
    current_reserve_no: u64,
    initial_liquidity: u64,
    amount_in: u64,
) -> u64 {
    let mut ry = (current_reserve_yes as f64) / 1e9;
    let mut rn = (current_reserve_no as f64) / 1e9;
    let l_float = (initial_liquidity as f64) / 1e9;
    let amt_in = (amount_in as f64) / 1e9;

    if ry < MIN_RESERVE { ry = MIN_RESERVE; }
    if rn < MIN_RESERVE { rn = MIN_RESERVE; }

    let amount_out = if yes_to_no {
        fabs(rn - get_new_reserve(rn, ry + amt_in, l_float))
    } else {
        fabs(ry - get_new_reserve(ry, rn + amt_in, l_float))
    };

    (amount_out * 1e9) as u64
}

pub fn calc_price(x: u64, y: u64, l: u64) -> u64 {
    let rx = (x as f64) / 1e9;
    let ry = (y as f64) / 1e9;
    let l_f = (l as f64) / 1e9;

    let z = (ry - rx) / l_f;
    let price = gaussian_cdf(z);
    
    // Scale price to 1_000_000 basis points for frontends
    (price * 1_000_000.0) as u64
}

pub fn calc_liquidity(liquidity: u64, deadline: i64, current_time: i64) -> u64 {
    let mut delta_time = deadline - current_time;
    if delta_time < 0 {
        delta_time = 0;
    }

    // Match the Solidity implementation:
    //   sqrtDeltaTimeWad = sqrt(deltaTime) * 1e9
    //   liquidity = mulWad(liquidity, sqrtDeltaTimeWad)
    // Which is equivalent to liquidity * sqrt(deltaTime) / 1e9.
    let decayed = ((liquidity as f64) * sqrt(delta_time as f64) / 1e9) as u64;

    // The Solidity version multiplies against a WAD-scaled time term.
    // Using raw unix-second deltas on Solana collapses liquidity to near-zero
    // and makes the pool unusable after a single fill, so keep the initial
    // liquidity as the floor until the timebase is normalized end to end.
    liquidity.max(decayed)
}

pub fn calc_initial_liquidity(amount: u64) -> u64 {
    let a_f = (amount as f64) / 1e9;
    let l = a_f / gaussian_pdf(0.0);
    (l * 1e9) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_cdf() {
        let z = 0.0;
        let p = gaussian_cdf(z);
        // CDF(0) should be 0.5
        assert!((p - 0.5).abs() < 1e-9);

        let z2 = 1.96;
        let p2 = gaussian_cdf(z2);
        // CDF(1.96) is approximately 0.975
        assert!((p2 - 0.975).abs() < 1e-3);
    }

    #[test]
    fn test_calc_price() {
        // Equal reserves means z=0, price should be 0.5
        let price = calc_price(1_000_000_000, 1_000_000_000, 1_000_000_000);
        // Price is scaled by 1,000,000
        assert_eq!(price, 500_000);
    }

    #[test]
    fn test_get_swap_amount() {
        // Match the live program's 9-decimal lamport-style scale.
        let amt_out = get_swap_amount(
            true,
            1_000_000_000,
            1_000_000_000,
            1_000_000_000,
            100_000_000,
        );
        assert!(amt_out > 0);
    }
}
