import { computeMetrics, summarize, type MetricGame, type MetricSummary } from './metrics.ts';
import { isSelfPlay, type RatingRow } from './ratings.ts';
import type { GameRecord } from './runner.ts';
import { wilson, type Interval } from './stats.ts';

/** Per-model aggregate stats for one (prompt version, preset) — mirrors the `model_stats` table. */
export interface ModelStatsRow {
  modelId: string;
  promptVersion: string;
  preset: string;
  games: number;
  stats: MetricSummary & { mafiaWin: Interval; townWin: Interval };
}

export type StatsGame = MetricGame & Pick<GameRecord, 'promptVersion' | 'preset'>;

/** All §8.3 metrics + Wilson CIs per model, grouped like ratings (prompt version × preset). Pure. */
export function computeModelStats(games: readonly StatsGame[]): ModelStatsRow[] {
  const groups = new Map<string, StatsGame[]>();
  for (const g of games) {
    if (isSelfPlay(g)) continue; // baseline only, never a model's record
    const k = `${g.promptVersion}\u0000${g.preset}`;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const rows: ModelStatsRow[] = [];
  for (const [k, gs] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [promptVersion, preset] = k.split('\u0000');
    for (const [modelId, m] of [...computeMetrics(gs)].sort(([a], [b]) => (a < b ? -1 : 1))) {
      rows.push({
        modelId,
        promptVersion,
        preset,
        games: m.games,
        stats: { ...summarize(m), mafiaWin: wilson(m.mafia.wins, m.mafia.games), townWin: wilson(m.town.wins, m.town.games) },
      });
    }
  }
  return rows;
}

/** Everything the leaderboard shows, as one snapshot (DB tables or leaderboard.json). */
export interface LeaderboardSnapshot {
  generatedAt: string;
  games: number;
  ratings: RatingRow[];
  stats: ModelStatsRow[];
}

/** JSON-safe: NaN → null (JSON.stringify does this; we make it explicit for the DB payload). */
export const statsToRow = (r: ModelStatsRow) => ({
  model_id: r.modelId,
  prompt_version: r.promptVersion,
  preset: r.preset,
  games: r.games,
  stats: JSON.parse(JSON.stringify(r.stats)),
});
