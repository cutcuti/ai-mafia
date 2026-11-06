import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rebuildRatingsInDb, supabaseFromEnv } from './db.ts';
import { computeModelStats, type LeaderboardSnapshot } from './modelstats.ts';
import { computeRatings, loadRecords } from './ratings.ts';

/**
 * pnpm ratings:rebuild            — from local games/ → leaderboard.json (ratings + per-model stats)
 * pnpm ratings:rebuild -- --db    — from every finished game in Supabase → ratings + model_stats tables (and leaderboard.json)
 * Always recomputed from scratch, so it's idempotent (BRD §8.4).
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    db: { type: 'boolean', default: false },
    games: { type: 'string', default: 'games' },
    out: { type: 'string', default: 'leaderboard.json' },
  },
});

let snap: LeaderboardSnapshot;
let source: string;
if (values.db) {
  let db;
  try {
    db = supabaseFromEnv();
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
  const res = await rebuildRatingsInDb(db);
  snap = { generatedAt: new Date().toISOString(), games: res.games, ratings: res.rows, stats: res.stats };
  source = `${res.games} games in Supabase → ratings + model_stats tables`;
} else {
  const records = loadRecords(values.games!);
  snap = { generatedAt: new Date().toISOString(), games: records.length, ratings: computeRatings(records), stats: computeModelStats(records) };
  source = `${records.length} local games`;
}
writeFileSync(values.out!, `${JSON.stringify(snap, null, 2)}\n`);
console.log(`${source} → ${snap.ratings.length} rating rows, ${snap.stats.length} stats rows (also written to ${values.out})`);
for (const r of snap.ratings) {
  console.log(`  ${r.promptVersion} ${r.preset.padEnd(8)} ${r.scope.padEnd(8)} ${r.modelId.padEnd(16)} ordinal ${r.ordinal.toFixed(2).padStart(7)}  μ ${r.mu.toFixed(2)} ± ${r.sigma.toFixed(2)}  (${r.games} games)`);
}
