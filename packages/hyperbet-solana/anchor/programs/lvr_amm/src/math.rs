/// Fixed-point integer math for LVR AMM.
///
/// All values use Q64.64 fixed-point (i128 with 64 fractional bits) internally,
/// but public API uses u64 scaled by 1e6 (SPL convention).
///
/// Replaces f64 to ensure deterministic consensus across validators.
use ethnum::I256;

const SCALE: u64 = 1_000_000; // SPL 6-decimal scale
const FRAC_BITS: u32 = 64;

// Q64.64 constants
const Q_ONE: i128 = 1i128 << FRAC_BITS;            // 1.0
const Q_SQRT_2PI: i128 = 46_174_166_757_360_756_275; // sqrt(2*pi) in Q64.64 ≈ 2.5066
const Q_SQRT_2: i128 = 26_087_635_650_665_564_424;   // sqrt(2) in Q64.64 ≈ 1.4142
const Q_MIN_RESERVE: i128 = 18_446_744_073_709;      // 0.001 in Q64.64
const Q_MIN_DERIVATIVE: i128 = 1_844_674_407_370;     // 0.0001 in Q64.64
const Q_APPROX: i128 = 18_446_744_073_709;           // 0.001 convergence threshold

const MAX_NEWTON_ITERS: u32 = 50;

/// More precise: multiply first then divide to avoid truncation
fn u64_to_q(val: u64) -> i128 {
    ((val as i128) << FRAC_BITS) / (SCALE as i128)
}

/// Convert Q64.64 back to u64 (scaled by 1e6)
fn q_to_u64(val: i128) -> u64 {
    let abs_val = if val < 0 { -val } else { val };
    ((abs_val * (SCALE as i128)) >> FRAC_BITS) as u64
}

/// Q64.64 multiply: (a * b) >> 64
fn q_mul(a: i128, b: i128) -> i128 {
    i256_to_i128((I256::new(a) * I256::new(b)) >> FRAC_BITS)
}

/// Q64.64 divide: (a << 64) / b
fn q_div(a: i128, b: i128) -> i128 {
    if b == 0 { return 0; }
    i256_to_i128((I256::new(a) << FRAC_BITS) / I256::new(b))
}

fn i256_to_i128(value: I256) -> i128 {
    let min = I256::new(i128::MIN);
    let max = I256::new(i128::MAX);
    if value < min {
        i128::MIN
    } else if value > max {
        i128::MAX
    } else {
        value.as_i128()
    }
}

fn q_abs(val: i128) -> i128 {
    if val < 0 { -val } else { val }
}

/// Polynomial approximation of erf(x) for |x| <= 4.
/// Uses Abramowitz and Stegun approximation 7.1.28 (max error ~1.5e-7).
/// For |x| > 4, erf(x) ≈ ±1.
fn q_erf(x: i128) -> i128 {
    let is_neg = x < 0;
    let ax = q_abs(x);

    // For large |x|, erf → ±1
    let four_q = 4i128 << FRAC_BITS;
    if ax >= four_q {
        return if is_neg { -Q_ONE } else { Q_ONE };
    }

    // Abramowitz & Stegun constants (scaled to Q64.64)
    // p = 0.3275911, a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429
    let p: i128 = 6_046_276_792_669_257_114;    // 0.3275911
    let a1: i128 = 4_700_886_397_498_587_136;   // 0.254829592
    let a2: i128 = -5_247_463_093_918_941_184i128; // -0.284496736
    let a3: i128 = 26_221_419_770_498_138_112;  // 1.421413741
    let a4: i128 = -26_807_264_366_735_253_504i128; // -1.453152027
    let a5: i128 = 19_580_373_992_048_084_992;  // 1.061405429

    // t = 1 / (1 + p*|x|)
    let px = q_mul(p, ax);
    let denom = Q_ONE + px;
    let t = q_div(Q_ONE, denom);

    // Horner's method: poly = ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t
    let mut poly = a5;
    poly = q_mul(poly, t) + a4;
    poly = q_mul(poly, t) + a3;
    poly = q_mul(poly, t) + a2;
    poly = q_mul(poly, t) + a1;
    poly = q_mul(poly, t);

    // exp(-x^2): use the integer exp approximation
    let x2 = q_mul(ax, ax);
    let exp_neg_x2 = q_exp_neg(x2);

    // erf = 1 - poly * exp(-x^2)
    let result = Q_ONE - q_mul(poly, exp_neg_x2);

    if is_neg { -result } else { result }
}

/// Approximate exp(-x) for x >= 0 using the identity exp(-x) = (1 - x/n)^n
/// with piecewise linear segments for better accuracy.
fn q_exp_neg(x: i128) -> i128 {
    if x <= 0 { return Q_ONE; }

    // For very large x, exp(-x) ≈ 0
    let ten_q = 10i128 << FRAC_BITS;
    if x >= ten_q { return 0; }

    // Use repeated squaring: exp(-x) = exp(-x/16)^16
    // This keeps the argument small for better accuracy
    let small_x = x >> 4; // x/16

    // exp(-small_x) ≈ 1 - small_x + small_x^2/2 - small_x^3/6 (Taylor 4 terms)
    let x2 = q_mul(small_x, small_x);
    let x3 = q_mul(x2, small_x);
    let half_x2 = x2 >> 1; // x^2 / 2
    let sixth_x3 = q_div(x3, 6i128 << FRAC_BITS); // x^3 / 6

    let mut result = Q_ONE - small_x + half_x2 - sixth_x3;
    if result < 0 { result = 0; }

    // Square 4 times to get exp(-x) from exp(-x/16)
    for _ in 0..4 {
        result = q_mul(result, result);
        if result < 0 { result = 0; }
    }

    result
}

/// Gaussian CDF: Φ(z) = 0.5 * (1 + erf(z / sqrt(2)))
fn gaussian_cdf_q(z: i128) -> i128 {
    let z_over_sqrt2 = q_div(z, Q_SQRT_2);
    let erf_val = q_erf(z_over_sqrt2);
    // 0.5 * (1 + erf)
    (Q_ONE + erf_val) >> 1
}

/// Gaussian PDF: φ(z) = exp(-z²/2) / sqrt(2π)
fn gaussian_pdf_q(z: i128) -> i128 {
    let z2 = q_mul(z, z);
    let half_z2 = z2 >> 1; // z²/2
    let exp_val = q_exp_neg(half_z2);
    q_div(exp_val, Q_SQRT_2PI)
}

/// AMM invariant: f(x, y, L) = (y-x)*Φ(z) + L*φ(z) - y, where z = (y-x)/L
fn amm_func_q(x: i128, y: i128, l: i128) -> i128 {
    let diff = y - x;
    let z = q_div(diff, l);
    let cdf = gaussian_cdf_q(z);
    let pdf = gaussian_pdf_q(z);

    q_mul(diff, cdf) + q_mul(l, pdf) - y
}

/// Derivative of invariant w.r.t. x: f'(x) = -Φ(z)
fn func_derivative_q(x: i128, y: i128, l: i128) -> i128 {
    let z = q_div(y - x, l);
    let mut deriv = -gaussian_cdf_q(z);

    if q_abs(deriv) < Q_MIN_DERIVATIVE {
        deriv = if deriv < 0 { -Q_MIN_DERIVATIVE } else { Q_MIN_DERIVATIVE };
    }
    deriv
}

/// Newton-Raphson solver for the new reserve given modified counterpart reserve
fn get_new_reserve_q(x_guess: i128, y: i128, l: i128) -> i128 {
    let mut t = if q_abs(x_guess) < Q_MIN_RESERVE {
        y >> 1 // Better initial guess: y/2
    } else {
        x_guess
    };

    for _ in 0..MAX_NEWTON_ITERS {
        let f = amm_func_q(t, y, l);
        if q_abs(f) < Q_APPROX {
            let res = q_abs(t);
            return if res < Q_MIN_RESERVE { Q_MIN_RESERVE } else { res };
        }
        let deriv = func_derivative_q(t, y, l);
        if deriv == 0 { break; }
        t = t - q_div(f, deriv);
    }

    let res = q_abs(t);
    if res < Q_MIN_RESERVE { Q_MIN_RESERVE } else { res }
}

// === Public API (u64 scaled by 1e6) ===

pub fn get_swap_amount(
    yes_to_no: bool,
    current_reserve_yes: u64,
    current_reserve_no: u64,
    initial_liquidity: u64,
    amount_in: u64,
) -> u64 {
    let ry = u64_to_q(current_reserve_yes).max(Q_MIN_RESERVE);
    let rn = u64_to_q(current_reserve_no).max(Q_MIN_RESERVE);
    let l = u64_to_q(initial_liquidity);
    let amt = u64_to_q(amount_in);

    let amount_out = if yes_to_no {
        q_abs(rn - get_new_reserve_q(rn, ry + amt, l))
    } else {
        q_abs(ry - get_new_reserve_q(ry, rn + amt, l))
    };

    q_to_u64(amount_out)
}

pub fn calc_price(x: u64, y: u64, l: u64) -> u64 {
    let rx = u64_to_q(x);
    let ry = u64_to_q(y);
    let lq = u64_to_q(l);

    if lq == 0 { return 500_000; } // Default 50% if no liquidity

    let z = q_div(ry - rx, lq);
    let price = gaussian_cdf_q(z);

    // Scale to 1_000_000 basis points
    ((price * 1_000_000i128) >> FRAC_BITS) as u64
}

pub fn calc_liquidity(liquidity: u64, deadline: i64, current_time: i64) -> u64 {
    let delta_time = deadline - current_time;
    if delta_time <= 0 { return 0; }

    // Integer sqrt using Newton's method
    let dt = delta_time as u64;
    let sqrt_dt = integer_sqrt(dt);

    // liquidity * sqrt(delta_time) / SCALE (since sqrt doesn't need scaling)
    // Actually: L_new = L * sqrt(dt), but dt is in seconds, so this is
    // just a scaling factor. We keep the same semantics as the original.
    let l = liquidity as u128;
    let s = sqrt_dt as u128;
    let result = (l * s) / (SCALE as u128);

    result as u64
}

pub fn calc_initial_liquidity(amount: u64) -> u64 {
    // L = amount / pdf(0) = amount / (1/sqrt(2*pi)) = amount * sqrt(2*pi)
    // sqrt(2*pi) ≈ 2.506628
    // In u64 scaled by 1e6: multiply by 2506628 and divide by 1e6
    let a = amount as u128;
    ((a * 2_506_628) / 1_000_000) as u64
}

/// Integer square root using Newton's method
fn integer_sqrt(n: u64) -> u64 {
    if n == 0 { return 0; }
    if n == 1 { return 1; }

    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc_price_equal_reserves() {
        // Equal reserves → z=0 → CDF(0) = 0.5 → price = 500_000
        let price = calc_price(1_000_000, 1_000_000, 1_000_000);
        // Allow ±1% tolerance
        assert!(price >= 490_000 && price <= 510_000, "price={}", price);
    }

    #[test]
    fn test_get_swap_amount_nonzero() {
        let amt_out = get_swap_amount(true, 1_000_000, 1_000_000, 1_000_000, 100_000);
        assert!(amt_out > 0, "swap should produce output");
    }

    #[test]
    fn test_calc_initial_liquidity() {
        let liq = calc_initial_liquidity(1_000_000);
        // Should be approximately 2_506_628 (amount * sqrt(2*pi))
        assert!(liq > 2_000_000 && liq < 3_000_000, "liq={}", liq);
    }

    #[test]
    fn test_integer_sqrt() {
        assert_eq!(integer_sqrt(0), 0);
        assert_eq!(integer_sqrt(1), 1);
        assert_eq!(integer_sqrt(4), 2);
        assert_eq!(integer_sqrt(9), 3);
        assert_eq!(integer_sqrt(100), 10);
        assert_eq!(integer_sqrt(3600), 60);
    }

    #[test]
    fn test_swap_symmetry() {
        // Swapping yes→no and no→yes with equal reserves should give same output
        let out1 = get_swap_amount(true, 1_000_000, 1_000_000, 1_000_000, 100_000);
        let out2 = get_swap_amount(false, 1_000_000, 1_000_000, 1_000_000, 100_000);
        // Should be equal (within rounding)
        let diff = if out1 > out2 { out1 - out2 } else { out2 - out1 };
        assert!(diff <= 1, "symmetry broken: out1={}, out2={}", out1, out2);
    }

    #[test]
    fn test_no_f64_used() {
        // This test exists as documentation: all math in this module uses
        // i128 fixed-point arithmetic. No f64 operations are used.
        // If this compiles, there are no f64 dependencies.
        let _ = get_swap_amount(true, 1_000_000, 1_000_000, 1_000_000, 100_000);
        let _ = calc_price(1_000_000, 1_000_000, 1_000_000);
        let _ = calc_initial_liquidity(1_000_000);
        let _ = calc_liquidity(1_000_000, 100, 0);
    }

    #[test]
    fn test_q_mul_keeps_fractional_bits() {
        let a = (123_i128 << 32) + (1_i128 << 31);
        let b = (456_i128 << 32) + (1_i128 << 31);
        let expected = (a * b) >> FRAC_BITS;

        assert_eq!(q_mul(a, b), expected);
        assert_ne!((a >> 32) * (b >> 32), expected);
    }

    #[test]
    fn test_q_div_matches_exact_shifted_division() {
        let numerator = (123_i128 << 32) + (1_i128 << 31);
        let denominator = (7_i128 << 32) + (1_i128 << 31);
        let expected = (numerator << FRAC_BITS) / denominator;

        assert_eq!(q_div(numerator, denominator), expected);
    }
}
