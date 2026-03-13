import type { AgentRating } from "./trueskill";

export const INDEX_BASE = 100;
export const INDEX_STEP = 5;
export const MIN_INDEX = 80;
export const MAX_INDEX = 120;
const MAX_Z_SCORE = 4;

export function modelMarketIdFromCharacterId(characterId: string): number {
  const namespaced = `hyperscape:model:${characterId.trim().toLowerCase()}`;
  let hash = 0xcbf29ce484222325n;
  const fnvPrime = 0x100000001b3n;
  const maxSafeMarketId = 0x1fffffffffffffn;

  for (let index = 0; index < namespaced.length; index += 1) {
    hash ^= BigInt(namespaced.charCodeAt(index));
    hash = (hash * fnvPrime) & 0xffffffffffffffffn;
  }

  const normalized = hash & maxSafeMarketId;
  return Number(normalized === 0n ? 1n : normalized);
}

export function conservativeSkill(rating: AgentRating): number {
  return rating.mu - 3 * rating.sigma;
}

export function calculateSyntheticSpotIndex(
  rating: AgentRating,
  population: readonly AgentRating[],
): number {
  const sample = population.length > 0 ? population : [rating];
  const conservativeScores = sample.map(conservativeSkill);
  const mean =
    conservativeScores.reduce((total, score) => total + score, 0) /
    conservativeScores.length;
  const variance =
    conservativeScores.reduce((total, score) => {
      const delta = score - mean;
      return total + delta * delta;
    }, 0) / conservativeScores.length;
  const stdDev = Math.sqrt(variance);
  const rawZScore =
    stdDev > Number.EPSILON ? (conservativeSkill(rating) - mean) / stdDev : 0;
  const zScore = Math.max(-MAX_Z_SCORE, Math.min(MAX_Z_SCORE, rawZScore));
  const syntheticIndex = Math.min(
    MAX_INDEX,
    Math.max(MIN_INDEX, INDEX_BASE + zScore * INDEX_STEP),
  );
  return Math.round(syntheticIndex * 100) / 100;
}
