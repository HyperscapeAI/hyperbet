import { erf } from 'mathjs';

// Constants
const WAD = 1e18;
const MIN_RESERVE = 1e15; // 0.001 
const MIN_DERIVATIVE = 1e14; // 0.0001

/**
 * Computes Gaussian CDF using MathJS
 */
function gaussianCdf(z: number): number {
    // erf works on z / sqrt(2)
    return 0.5 * (1.0 + erf(z / Math.SQRT2));
}

/**
 * Computes Gaussian PDF
 */
function gaussianPdf(x: number): number {
    const e = Math.exp((-x * x) / 2.0);
    return e / Math.sqrt(2.0 * Math.PI);
}

/**
 * LvrMarket AMM Invariant function definition:
 * f(t) = (y - x)*cdf(z) + L*pdf(z) - y
 * where z = (y - x)/L
 */
function ammFunc(x: number, y: number, l: number): number {
    const z = (y - x) / l;
    return (y - x) * gaussianCdf(z) + l * gaussianPdf(z) - y;
}

function funcDerivative(x: number, y: number, l: number): number {
    const z = (y - x) / l;
    let deriv = -gaussianCdf(z);

    if (Math.abs(deriv) < MIN_DERIVATIVE / WAD) {
        deriv = deriv < 0 ? -MIN_DERIVATIVE / WAD : MIN_DERIVATIVE / WAD;
    }
    return deriv;
}

function getNewReserve(xGuess: number, y: number, l: number): number {
    let t = Math.abs(xGuess) < MIN_RESERVE / WAD ? y / 2.0 : xGuess;
    const approx = MIN_RESERVE / WAD;
    const maxIters = 50;

    for (let i = 0; i < maxIters; i++) {
        const f = ammFunc(t, y, l);
        if (Math.abs(f) < approx) {
            const res = Math.abs(t);
            return res < MIN_RESERVE / WAD ? MIN_RESERVE / WAD : res;
        }
        const deriv = funcDerivative(t, y, l);
        t -= f / deriv;
    }

    const res = Math.abs(t);
    return res < MIN_RESERVE / WAD ? MIN_RESERVE / WAD : res;
}

class LvrAMMSimulator {
    public reserveYes: number;
    public reserveNo: number;
    public initialLiquidity: number;
    public expirationAt: number;

    constructor(collateralIn: number, durationSeconds: number) {
        this.reserveYes = collateralIn;
        this.reserveNo = collateralIn;
        this.initialLiquidity = collateralIn / gaussianPdf(0);
        this.expirationAt = Date.now() / 1000 + durationSeconds;
        console.log(`[LvrAMM] Initialized with ${collateralIn} collateral. L = ${this.initialLiquidity.toFixed(4)}`);
    }

    public getDynamicLiquidity(currentTimeSeconds: number): number {
        let delta = this.expirationAt - currentTimeSeconds;
        if (delta < 0) delta = 0;
        // In real terms this is delta scaled by some constant. We'll use sqrt(delta).
        // Let's assume duration was 86400 (1 day), so we divide by sqrt(86400) to normalize if we want.
        // But PM paper does L * sqrt(t)
        return this.initialLiquidity * Math.sqrt(delta);
    }

    public getPrice(yes: boolean, currentTimeSeconds: number): number {
        const L = this.getDynamicLiquidity(currentTimeSeconds);
        const z = (this.reserveNo - this.reserveYes) / L;
        const pYes = gaussianCdf(z);
        return yes ? pYes : 1 - pYes;
    }

    public swap(isBuyYes: boolean, amountIn: number, currentTimeSeconds: number): number {
        const L = this.getDynamicLiquidity(currentTimeSeconds);
        let amountOut = 0;
        
        if (isBuyYes) {
            // User gives NO (amountIn) into pool, takes YES (amountOut) from pool
            amountOut = Math.abs(this.reserveYes - getNewReserve(this.reserveYes, this.reserveNo + amountIn, L));
            this.reserveNo += amountIn;
            this.reserveYes -= amountOut;
        } else {
            // User gives YES into pool, takes NO from pool
            amountOut = Math.abs(this.reserveNo - getNewReserve(this.reserveNo, this.reserveYes + amountIn, L));
            this.reserveYes += amountIn;
            this.reserveNo -= amountOut;
        }
        
        return amountOut;
    }
}

async function simulate() {
    console.log("=== Starting LvrAMM Simulation ===");
    
    const ONE_DAY = 86400;
    const sim = new LvrAMMSimulator(1000, ONE_DAY); // $1000 start
    
    let now = Date.now() / 1000;
    
    let pYes = sim.getPrice(true, now);
    let pNo = sim.getPrice(false, now);
    
    console.log(`[T=0] Price Yes: ${pYes.toFixed(4)}, Price No: ${pNo.toFixed(4)}`);
    
    // User buys $100 worth of YES (so gives $100 collateral)
    // Collateral mints 100 YES and 100 NO initially for user. User sells 100 NO to pool.
    let amtInNo = 100;
    let amtOutYes = sim.swap(true, amtInNo, now);
    
    let totalYesReceived = amtInNo + amtOutYes;
    console.log(`[T=0] User buys YES with $100 collateral -> Receives ${totalYesReceived.toFixed(2)} YES shares.`);
    
    pYes = sim.getPrice(true, now);
    console.log(`[T=0] New Price Yes: ${pYes.toFixed(4)}`);

    // Advance time by 12 hours
    console.log("\n... Advancing time by 12 hours ...");
    now += 43200;
    
    pYes = sim.getPrice(true, now);
    console.log(`[T=12h] Price Yes (Time Decayed): ${pYes.toFixed(4)}`);
    
    // As time passes, L decreases, making the market deeper around its current price but more volatile? 
    // Wait, L * sqrt(t). If t->0, L->0, which means price rapidly goes to 0 or 1.
    // Let's advance to very close to expiration
    console.log("\n... Advancing time by 11.5 hours (close to expiry) ...");
    now += 41400; // total 23.5 hours passed
    
    pYes = sim.getPrice(true, now);
    console.log(`[T=23.5h] Price Yes (Decayed): ${pYes.toFixed(4)}`);
    console.log(`Current Reserves -> YES: ${sim.reserveYes.toFixed(2)}, NO: ${sim.reserveNo.toFixed(2)}`);

    console.log("\n=== Simulation Complete ===");
}

simulate().catch(console.error);
