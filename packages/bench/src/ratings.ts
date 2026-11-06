import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ordinal, rate, rating, type Rating } from 'openskill';
import type { GameRecord } from './runner.ts';

export type Scope = 'overall' | 'as_mafia' | 'as_town';
export const SCOPES: readonly Scope[] = ['overall', 'as_mafia', 'as_town'];

/** Mirrors the `ratings` table (BRD §9.2). */
export interface RatingRow {
  modelId: string;
  scope: Scope;
  promptVersion: string;
  preset: string;
  mu: number;
  sigma: number;
  ordinal: number; // μ − 3σ, used for ranking
  games: number;
}

type RatedGame = Pick<GameRecord, 'gameId' | 'seats' | 'outcome' | 'promptVersion' | 'preset'>;

/** Rank array for [mafia, town]: lower is better; a draw is a tie. */
const ranks = (o: GameRecord['outcome']) => (o === 'mafia' ? [1, 2] : o === 'town' ? [2, 1] : [1, 1]);

class Pool {
  private readonly r = new Map<string, Rating>();
  readonly games = new Map<string, number>();
  get(id: string) {
    let x = this.r.get(id);
    if (!x) this.r.set(id, (x = rating()));
    return x;
  }
  /** A model may fill several slots (or both teams in ffa): average its updated slots. */
  apply(slots: { id: string; next: Rating }[]) {
    const acc = new Map<string, { mu: number; sigma: number; n: number }>();
    for (const { id, next } of slots) {
      const a = acc.get(id) ?? { mu: 0, sigma: 0, n: 0 };
      acc.set(id, { mu: a.mu + next.mu, sigma: a.sigma + next.sigma, n: a.n + 1 });
    }
    for (const [id, a] of acc) {
      this.r.set(id, { mu: a.mu / a.n, sigma: a.sigma / a.n });
      this.games.set(id, (this.games.get(id) ?? 0) + 1);
    }
  }
  entries() {
    return [...this.r.entries()];
  }
}

/** Rate one game as mafia-team vs town-team, drawing each team's ratings from the given pools. */
function rateGame(g: RatedGame, mafiaPool: Pool, townPool: Pool) {
  const mafia = g.seats.filter((s) => s.role === 'mafia').map((s) => s.modelId);
  const town = g.seats.filter((s) => s.role !== 'mafia').map((s) => s.modelId);
  if (!mafia.length || !town.length) return;
  const [nm, nt] = rate([mafia.map((id) => mafiaPool.get(id)), town.map((id) => townPool.get(id))], { rank: ranks(g.outcome) });
  const mSlots = mafia.map((id, i) => ({ id, next: nm[i] }));
  const tSlots = town.map((id, i) => ({ id, next: nt[i] }));
  if (mafiaPool === townPool) mafiaPool.apply([...mSlots, ...tSlots]);
  else {
    mafiaPool.apply(mSlots);
    townPool.apply(tSlots);
  }
}

/**
 * Recompute every rating from scratch (BRD §8.4) — never mutated incrementally.
 * Grouped by (promptVersion, preset); games processed in gameId order so the result is independent of input order.
 */
/**
 * Self-play (one model in every seat) measures the table's structural mafia edge, not skill: the same model
 * wins and loses each game. It's excluded from ratings and leaderboard stats and used only as a baseline.
 */
export const isSelfPlay = (g: { seats: readonly { modelId: string }[] }) => g.seats.length > 0 && g.seats.every((s) => s.modelId === g.seats[0].modelId);

export function computeRatings(games: readonly RatedGame[]): RatingRow[] {
  const groups = new Map<string, RatedGame[]>();
  for (const g of games) {
    if (isSelfPlay(g)) continue;
    const k = `${g.promptVersion}\u0000${g.preset}`;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const rows: RatingRow[] = [];
  for (const [k, gs] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [promptVersion, preset] = k.split('\u0000');
    const overall = new Pool();
    const asMafia = new Pool();
    const asTown = new Pool();
    for (const g of [...gs].sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0))) {
      rateGame(g, overall, overall);
      rateGame(g, asMafia, asTown);
    }
    for (const [scope, pool] of [['overall', overall], ['as_mafia', asMafia], ['as_town', asTown]] as const) {
      for (const [modelId, r] of pool.entries()) {
        rows.push({ modelId, scope, promptVersion, preset, mu: r.mu, sigma: r.sigma, ordinal: ordinal(r), games: pool.games.get(modelId) ?? 0 });
      }
    }
  }
  return rows.sort((a, b) => a.promptVersion.localeCompare(b.promptVersion) || a.preset.localeCompare(b.preset) || a.scope.localeCompare(b.scope) || b.ordinal - a.ordinal);
}

/** Every bench GameRecord under `dir` (recursively). Single CLI games (no schema) are ignored. */
export function loadRecords(dir: string): GameRecord[] {
  const out: GameRecord[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...loadRecords(p));
    else if (name.endsWith('.json')) {
      try {
        const r = JSON.parse(readFileSync(p, 'utf8'));
        if (r?.schema === 1 && r.gameId && Array.isArray(r.seats)) out.push(r as GameRecord);
      } catch {
        // partial / foreign file: skip
      }
    }
  }
  return out;
}
