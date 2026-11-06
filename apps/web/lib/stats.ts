/** Wilson score interval, 95% (mirrors packages/bench/src/stats.ts; both are tested against textbook values). */
export interface Interval {
  p: number;
  lo: number;
  hi: number;
  n: number;
}

export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN, n: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n };
}

/** Games per team role before a model leaves "provisional" (BRD §8.5). */
export const MIN_GAMES_PER_ROLE = 50;
