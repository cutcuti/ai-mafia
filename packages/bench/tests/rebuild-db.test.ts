import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rebuildRatingsInDb, uploadRecords } from '../src/db.ts';
import { computeRatings } from '../src/ratings.ts';
import { runBench } from '../src/runner.ts';
import { as, pgliteDb, supabaseLikeDb } from './pg.ts';

const out = () => mkdtempSync(join(tmpdir(), 'bench-'));

test('M3 done-when: a bench run lands in the DB and ratings populate from it', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const run = await runBench({ format: 'h2h', a: 'claude-haiku', b: 'random', games: 10, preset: 'classic6', dryRun: true, outDir: out() });
  await uploadRecords(db, run.records);

  const { games, rows } = await rebuildRatingsInDb(db);
  assert.equal(games, 10);
  // identical to computing from the local files
  assert.deepEqual(rows, computeRatings(run.records));

  const stored = await as(pg, 'anon', () => pg.query<{ model_id: string; scope: string; games: number; ordinal: number }>('select model_id, scope, games, ordinal from public.ratings order by scope, model_id'));
  assert.equal(stored.rows.length, 6, '2 models × 3 scopes, readable by anon for the leaderboard');
  for (const r of stored.rows) assert.equal(r.games, r.scope === 'overall' ? 10 : 5);
});

test('rebuild is idempotent and reflects newly uploaded games', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const a = await runBench({ format: 'self', model: 'random', games: 4, preset: 'classic6', outDir: out() });
  await uploadRecords(db, a.records);
  const first = await rebuildRatingsInDb(db);
  const again = await rebuildRatingsInDb(db);
  assert.deepEqual(again.rows, first.rows);

  const b = await runBench({ format: 'h2h', a: 'random', b: 'claude-haiku', games: 4, preset: 'classic6', dryRun: true, outDir: out() });
  await uploadRecords(db, b.records);
  const third = await rebuildRatingsInDb(db);
  assert.equal(third.games, 8);
  assert.deepEqual(third.rows, computeRatings([...a.records, ...b.records]));
  const n = (await as(pg, 'service_role', () => pg.query<{ n: number }>('select count(*)::int as n from public.ratings'))).rows[0].n;
  assert.equal(n, third.rows.length, 'old rows replaced, not appended');
});
