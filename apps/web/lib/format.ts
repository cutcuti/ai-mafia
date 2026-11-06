import type { Interval } from './stats';

const ok = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

export const pct = (x: number | null | undefined, digits = 0) => (ok(x) ? `${(x * 100).toFixed(digits)}%` : '—');
export const num = (x: number | null | undefined, digits = 1) => (ok(x) ? x.toFixed(digits) : '—');
export const usd = (x: number | null | undefined) => (ok(x) ? (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`) : '—');
export const ms = (x: number | null | undefined) => (ok(x) ? (x >= 1000 ? `${(x / 1000).toFixed(1)}s` : `${Math.round(x)}ms`) : '—');

/** "62% (41–79%)" — or a dash when there are no games. */
export const ci = (i: Interval | null | undefined) => (i && i.n > 0 && ok(i.p) ? `${pct(i.p)} (${pct(i.lo)}–${pct(i.hi)})` : '—');
