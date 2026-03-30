export type Fighter = "A" | "B";

export type FightResult = {
  seed: bigint;
  winner: Fighter;
  replayHash: Uint8Array;
};

function seededRandom(seed: bigint): () => number {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const out = Number(state & 0xffff_ffffn);
    return Math.abs(out) / 0xffff_ffff;
  };
}

export function simulateFight(seed: bigint): FightResult {
  const rand = seededRandom(seed);
  let hpA = 10;
  let hpB = 10;

  const replay = new Uint8Array(32);

  for (let round = 0; round < 128 && hpA > 0 && hpB > 0; round += 1) {
    for (const defender of ["B", "A"] as const) {
      if (hpA <= 0 || hpB <= 0) break;
      const hit = rand() > 0.35;
      const damage = hit ? (rand() > 0.8 ? 2 : 1) : 0;

      if (defender === "A") hpA = Math.max(0, hpA - damage);
      else hpB = Math.max(0, hpB - damage);

      replay[(round + damage) % 32] ^= (hit ? 17 : 31) + damage;
    }
  }

  return {
    seed,
    winner: hpA > 0 ? "A" : "B",
    replayHash: replay,
  };
}
