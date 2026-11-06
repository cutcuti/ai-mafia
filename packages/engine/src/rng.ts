/**
 * Seeded RNG (mulberry32). Its entire internal state is one uint32, so it can be
 * stored in GameState and resumed exactly — required for serverless stepping and replay.
 */
export interface Rng {
  /** Float in [0, 1). Advances the state. */
  next(): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  /** Current internal state (uint32). `createRng(rng.state)` continues the same sequence. */
  readonly state: number;
}

export function createRng(state: number): Rng {
  let a = state >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('rng.pick on empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    get state() {
      return a;
    },
  };
}

/** Seed → RNG. Same seed, same sequence. */
export const makeRng = (seed: number): Rng => createRng(seed);
