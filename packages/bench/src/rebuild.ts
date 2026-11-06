import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rebuildRatingsInDb, supabaseFromEnv } from './db.js';
import { computeRatings, loadRecords, type RatingRow } from './ratings.js';

/**
 * pnpm ratings:rebuild            — from local games/ → ratings.json
 * pnpm ratings:rebuild -- --db    — from every finished game in Supabase → the ratings table (and ratings.json)
 * Always recomputed from scratch, so it's idempotent (BRD §8.4).
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    db: { type: 'boolean', default: false },
    games: { type: 'string', default: 'games' },
    out: { type: 'string', default: 'ratings.json' },
  },
});

let rows: RatingRow[];
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
  rows = res.rows;
  source = `${res.games} games in Supabase → ratings table`;
} else {
  const records = loadRecords(values.games!);
  rows = computeRatings(records);
  source = `${records.length} local games`;
}
writeFileSync(values.out!, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`${source} → ${rows.length} rating rows (also written to ${values.out})`);
for (const r of rows) {
  console.log(`  ${r.promptVersion} ${r.preset.padEnd(8)} ${r.scope.padEnd(8)} ${r.modelId.padEnd(16)} ordinal ${r.ordinal.toFixed(2).padStart(7)}  μ ${r.mu.toFixed(2)} ± ${r.sigma.toFixed(2)}  (${r.games} games)`);
}
