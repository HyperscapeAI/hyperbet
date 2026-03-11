export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  nextSigned(): number {
    return this.next() * 2 - 1;
  }
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
