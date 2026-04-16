export interface AgentRating {
  mu: number; // perceived skill
  sigma: number; // uncertainty
  gamesPlayed: number;
}

const INITIAL_MU = 1000.0;
const INITIAL_SIGMA = 300.0;
const MIN_SIGMA = 50.0;

export function createInitialRating(): AgentRating {
  return {
    mu: INITIAL_MU,
    sigma: INITIAL_SIGMA,
    gamesPlayed: 0,
  };
}

/** Simplified Glicko/Elo with explicit uncertainty tracking. */
export function updateRatings(
  winner: AgentRating,
  loser: AgentRating,
): { winner: AgentRating; loser: AgentRating } {
  const Q = Math.log(10) / 400;

  const g = (sigma: number) =>
    1.0 / Math.sqrt(1.0 + (3.0 * Q * Q * sigma * sigma) / (Math.PI * Math.PI));

  const expectedWin =
    1.0 /
    (1.0 + Math.pow(10.0, (-g(loser.sigma) * (winner.mu - loser.mu)) / 400.0));
  const expectedLoss =
    1.0 /
    (1.0 + Math.pow(10.0, (-g(winner.sigma) * (loser.mu - winner.mu)) / 400.0));

  // K scales with uncertainty -- high sigma learns faster.
  const kWinner = Math.max(32, winner.sigma * 0.5);
  const kLoser = Math.max(32, loser.sigma * 0.5);

  const newWinnerMu = winner.mu + kWinner * (1.0 - expectedWin);
  const newLoserMu = loser.mu + kLoser * (0.0 - expectedLoss);

  const decayFactor = 0.95;
  const newWinnerSigma = Math.max(MIN_SIGMA, winner.sigma * decayFactor);
  const newLoserSigma = Math.max(MIN_SIGMA, loser.sigma * decayFactor);

  return {
    winner: {
      mu: newWinnerMu,
      sigma: newWinnerSigma,
      gamesPlayed: winner.gamesPlayed + 1,
    },
    loser: {
      mu: newLoserMu,
      sigma: newLoserSigma,
      gamesPlayed: loser.gamesPlayed + 1,
    },
  };
}

/** Spot index = max(1.0, (mu - 3*sigma) / 10). Penalizes uncertainty. */
export function calculateSpotIndex(rating: AgentRating): number {
  const riskAdjustedSkill = rating.mu - 3.0 * rating.sigma;
  let price = Math.max(1.0, riskAdjustedSkill / 10.0);
  return Math.round(price * 100) / 100;
}
