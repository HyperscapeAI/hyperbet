/**
 * TypeScript port of the LVR AMM Gaussian-CDF bonding curve math.
 *
 * Mirrors packages/hyperbet-solana/anchor/programs/lvr_amm/src/math.rs.
 * Uses bigint Q64.64 fixed-point internally for deterministic results,
 * but public API accepts/returns number or bigint in u64 1e6-scaled form.
 */

const SCALE = 1_000_000n;
const FRAC_BITS = 64n;

// Q64.64 constants
const Q_ONE = 1n << FRAC_BITS; // 1.0
const Q_HALF = 1n << (FRAC_BITS - 1n); // 0.5
const Q_SQRT_2PI = 46_174_166_757_360_756_275n; // sqrt(2*pi)
const Q_SQRT_2 = 26_087_635_650_665_564_424n; // sqrt(2)
const Q_MIN_RESERVE = 18_446_744_073_709n; // 0.001
const Q_MIN_DERIVATIVE = 1_844_674_407_370n; // 0.0001
const Q_APPROX = 18_446_744_073_709n; // 0.001 convergence threshold

const MAX_NEWTON_ITERS = 50;

// --- Q64.64 arithmetic ---

function u64ToQ(val: bigint): bigint {
  return (val << FRAC_BITS) / SCALE;
}

function qToU64(val: bigint): bigint {
  const abs = val < 0n ? -val : val;
  return (abs * SCALE) >> FRAC_BITS;
}

function qMul(a: bigint, b: bigint): bigint {
  // JS bigint has no overflow — exact Q64.64 multiply
  return (a * b) >> FRAC_BITS;
}

function qDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Q64.64 division by zero");
  return (a << FRAC_BITS) / b;
}

function qAbs(val: bigint): bigint {
  return val < 0n ? -val : val;
}

// --- Approximations ---

/**
 * Approximate exp(-x) for x >= 0 using Taylor expansion + repeated squaring.
 * exp(-x) = exp(-x/16)^16, where exp(-small) ≈ 1 - x + x²/2 - x³/6
 */
function qExpNeg(x: bigint): bigint {
  if (x <= 0n) return Q_ONE;

  const tenQ = 10n << FRAC_BITS;
  if (x >= tenQ) return 0n;

  const smallX = x >> 4n; // x/16
  const x2 = qMul(smallX, smallX);
  const x3 = qMul(x2, smallX);
  const halfX2 = x2 >> 1n;
  const sixthX3 = qDiv(x3, 6n << FRAC_BITS);

  let result = Q_ONE - smallX + halfX2 - sixthX3;
  if (result < 0n) result = 0n;

  // Square 4 times: exp(-x/16)^16 = exp(-x)
  for (let i = 0; i < 4; i++) {
    result = qMul(result, result);
    if (result < 0n) result = 0n;
  }

  return result;
}

/**
 * Polynomial approximation of erf(x) using Abramowitz & Stegun 7.1.28.
 * Max error ~1.5e-7. For |x| > 4, erf(x) ≈ ±1.
 */
function qErf(x: bigint): bigint {
  const isNeg = x < 0n;
  const ax = qAbs(x);

  const fourQ = 4n << FRAC_BITS;
  if (ax >= fourQ) {
    return isNeg ? -Q_ONE : Q_ONE;
  }

  // Abramowitz & Stegun constants in Q64.64
  const p = 6_046_276_792_669_257_114n; // 0.3275911
  const a1 = 4_700_886_397_498_587_136n; // 0.254829592
  const a2 = -5_247_463_093_918_941_184n; // -0.284496736
  const a3 = 26_221_419_770_498_138_112n; // 1.421413741
  const a4 = -26_807_264_366_735_253_504n; // -1.453152027
  const a5 = 19_580_373_992_048_084_992n; // 1.061405429

  // t = 1 / (1 + p*|x|)
  const px = qMul(p, ax);
  const denom = Q_ONE + px;
  const t = qDiv(Q_ONE, denom);

  // Horner's method: poly = ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t
  let poly = a5;
  poly = qMul(poly, t) + a4;
  poly = qMul(poly, t) + a3;
  poly = qMul(poly, t) + a2;
  poly = qMul(poly, t) + a1;
  poly = qMul(poly, t);

  const x2 = qMul(ax, ax);
  const expNegX2 = qExpNeg(x2);

  // erf = 1 - poly * exp(-x²)
  const result = Q_ONE - qMul(poly, expNegX2);
  return isNeg ? -result : result;
}

/** Gaussian CDF: Φ(z) = 0.5 * (1 + erf(z / sqrt(2))) */
function gaussianCdfQ(z: bigint): bigint {
  const zOverSqrt2 = qDiv(z, Q_SQRT_2);
  const erfVal = qErf(zOverSqrt2);
  return (Q_ONE + erfVal) >> 1n;
}

/** Gaussian PDF: φ(z) = exp(-z²/2) / sqrt(2π) */
function gaussianPdfQ(z: bigint): bigint {
  const z2 = qMul(z, z);
  const halfZ2 = z2 >> 1n;
  const expVal = qExpNeg(halfZ2);
  return qDiv(expVal, Q_SQRT_2PI);
}

/** AMM invariant: f(x, y, L) = (y-x)*Φ(z) + L*φ(z) - y, where z = (y-x)/L */
function ammFuncQ(x: bigint, y: bigint, l: bigint): bigint {
  const diff = y - x;
  const z = qDiv(diff, l);
  const cdf = gaussianCdfQ(z);
  const pdf = gaussianPdfQ(z);
  return qMul(diff, cdf) + qMul(l, pdf) - y;
}

/** Derivative of invariant w.r.t. x: f'(x) = -Φ(z) */
function funcDerivativeQ(x: bigint, y: bigint, l: bigint): bigint {
  const z = qDiv(y - x, l);
  let deriv = -gaussianCdfQ(z);
  if (qAbs(deriv) < Q_MIN_DERIVATIVE) {
    deriv = deriv < 0n ? -Q_MIN_DERIVATIVE : Q_MIN_DERIVATIVE;
  }
  return deriv;
}

/** Newton-Raphson solver for new reserve given modified counterpart */
function getNewReserveQ(xGuess: bigint, y: bigint, l: bigint): bigint {
  let t = qAbs(xGuess) < Q_MIN_RESERVE ? y >> 1n : xGuess;

  for (let i = 0; i < MAX_NEWTON_ITERS; i++) {
    const f = ammFuncQ(t, y, l);
    if (qAbs(f) < Q_APPROX) {
      const res = qAbs(t);
      return res < Q_MIN_RESERVE ? Q_MIN_RESERVE : res;
    }
    const deriv = funcDerivativeQ(t, y, l);
    if (deriv === 0n) break;
    t = t - qDiv(f, deriv);
  }

  const res = qAbs(t);
  return res < Q_MIN_RESERVE ? Q_MIN_RESERVE : res;
}

// === Public API (u64 scaled by 1e6) ===

/**
 * Compute swap output amount.
 * @param yesToNo - true: selling YES for NO, false: selling NO for YES
 * @param currentReserveYes - YES reserve (u64, 1e6-scaled)
 * @param currentReserveNo - NO reserve (u64, 1e6-scaled)
 * @param initialLiquidity - liquidity parameter (u64, 1e6-scaled)
 * @param amountIn - input amount (u64, 1e6-scaled)
 * @returns output amount (u64, 1e6-scaled)
 */
export function getSwapAmount(
  yesToNo: boolean,
  currentReserveYes: bigint,
  currentReserveNo: bigint,
  initialLiquidity: bigint,
  amountIn: bigint,
): bigint {
  const ry = bigintMax(u64ToQ(currentReserveYes), Q_MIN_RESERVE);
  const rn = bigintMax(u64ToQ(currentReserveNo), Q_MIN_RESERVE);
  const l = u64ToQ(initialLiquidity);
  const amt = u64ToQ(amountIn);

  const amountOut = yesToNo
    ? qAbs(rn - getNewReserveQ(rn, ry + amt, l))
    : qAbs(ry - getNewReserveQ(ry, rn + amt, l));

  return qToU64(amountOut);
}

/**
 * Calculate YES price as probability [0, 1_000_000].
 * Uses Gaussian CDF: price = Φ((reserveNo - reserveYes) / liquidity)
 * @returns price scaled by 1e6 (500_000 = 50%)
 */
export function calcPrice(x: bigint, y: bigint, l: bigint): bigint {
  const rx = u64ToQ(x);
  const ry = u64ToQ(y);
  const lq = u64ToQ(l);

  if (lq === 0n) return 500_000n; // default 50%

  const z = qDiv(ry - rx, lq);
  const price = gaussianCdfQ(z);
  return (price * 1_000_000n) >> FRAC_BITS;
}

/**
 * Calculate time-decayed dynamic liquidity.
 * L_new = L * sqrt(deadline - currentTime) / SCALE
 */
export function calcDynamicLiquidity(
  liquidity: bigint,
  deadline: bigint,
  currentTime: bigint,
): bigint {
  const deltaTime = deadline - currentTime;
  if (deltaTime <= 0n) return 0n;

  const sqrtDt = integerSqrt(deltaTime < 0n ? 0n : deltaTime);
  return (liquidity * sqrtDt) / SCALE;
}

/**
 * Calculate initial liquidity from collateral amount.
 * L = amount * sqrt(2π) ≈ amount * 2.506628
 */
export function calcInitialLiquidity(amount: bigint): bigint {
  return (amount * 2_506_628n) / 1_000_000n;
}

/** Integer square root using Newton's method. */
function integerSqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  if (n === 1n) return 1n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function bigintMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

// === Convenience wrappers (number-based) ===

/**
 * Calculate AMM YES price as a probability in [0, 1].
 * Convenience wrapper that accepts/returns plain numbers.
 */
export function calcAmmPrice(
  reserveYes: bigint,
  reserveNo: bigint,
  liquidity: bigint,
): number {
  const raw = calcPrice(reserveYes, reserveNo, liquidity);
  return Number(raw) / 1_000_000;
}

/**
 * Estimate slippage for a buy/sell operation.
 * Returns the effective price after slippage as a number in [0, 1].
 */
export function estimateSlippage(
  yesToNo: boolean,
  reserveYes: bigint,
  reserveNo: bigint,
  liquidity: bigint,
  amountIn: bigint,
): { amountOut: bigint; effectivePrice: number } {
  const amountOut = getSwapAmount(
    yesToNo,
    reserveYes,
    reserveNo,
    liquidity,
    amountIn,
  );
  const effectivePrice =
    amountIn > 0n ? Number(amountOut) / Number(amountIn) : 0;
  return { amountOut, effectivePrice };
}
