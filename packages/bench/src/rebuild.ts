import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { computeRatings, loadRecords } from './ratings.js';

/** pnpm ratings:rebuild — recompute all ratings from stored games (idempotent). M3 adds writing them to the DB. */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    games: { type: 'string', default: 'games' },
    out: { type: 'string', default: 'ratings.json' },
  },
});

const records = loadRecords(values.games!);
const rows = computeRatings(records);
writeFileSync(values.out!, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`${records.length} games → ${rows.length} rating rows → ${values.out}`);
for (const r of rows) {
  console.log(`  ${r.promptVersion} ${r.preset.padEnd(8)} ${r.scope.padEnd(8)} ${r.modelId.padEnd(16)} ordinal ${r.ordinal.toFixed(2).padStart(7)}  μ ${r.mu.toFixed(2)} ± ${r.sigma.toFixed(2)}  (${r.games} games)`);
}
