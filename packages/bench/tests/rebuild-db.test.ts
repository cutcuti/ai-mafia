import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rebuildRatingsInDb, uploadRecords } from '../src/db.ts';
import { computeModelStats } from '../src/modelstats.ts';
import { computeRatings } from '../src/ratings.ts';
import { runBench } from '../src/runner.ts';
import { as, pgliteDb, supabaseLikeDb } from './pg.ts';

const out = () => mkdtempSync(join(tmpdir(), 'bench-'));

/** Compare after a JSON round trip (the DB stores stats as jsonb: NaN → null). */
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test('M3 done-when: a bench run lands in the DB and ratings populate from it', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const run = await runBench({ format: 'h2h', a: 'claude-haiku', b: 'random', games: 10, preset: 'classic6', dryRun: true, outDir: out() });
  await uploadRecords(db, run.records);

  const { games, rows, stats } = await rebuildRatingsInDb(db);
  assert.equal(games, 10);
  // identical to computing from the local files
  assert.deepEqual(rows, computeRatings(run.records));
  assert.deepEqual(json(stats), json(computeModelStats(run.records)), 'stats from DB games == stats from local files');

  const stored = await as(pg, 'anon', () => pg.query<{ model_id: string; scope: string; games: number; ordinal: number }>('select model_id, scope, games, ordinal from public.ratings order by scope, model_id'));
  assert.equal(stored.rows.length, 6, '2 models × 3 scopes, readable by anon for the leaderboard');
  for (const r of stored.rows) assert.equal(r.games, r.scope === 'overall' ? 10 : 5);
});

test('model_stats: public-readable aggregates with Wilson CIs; swapped together with ratings', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const run = await runBench({ format: 'h2h', a: 'claude-haiku', b: 'random', games: 6, preset: 'classic6', dryRun: true, outDir: out() });
  await uploadRecords(db, run.records);
  await rebuildRatingsInDb(db);
  const rows = (await as(pg, 'anon', () => pg.query<{ model_id: string; games: number; stats: Record<string, any> }>('select model_id, games, stats from public.model_stats order by model_id'))).rows;
  assert.deepEqual(rows.map((r) => r.model_id), ['claude-haiku', 'random']);
  for (const r of rows) {
    assert.equal(r.games, 6);
    assert.equal(r.stats.mafiaWin.n, 3);
    assert.ok(r.stats.mafiaWin.lo <= r.stats.mafiaWin.p && r.stats.mafiaWin.p <= r.stats.mafiaWin.hi);
    assert.ok(r.stats.costPerGame !== undefined);
  }
  await assert.rejects(as(pg, 'anon', () => pg.query('select public.replace_leaderboard($1, $2)', [[], []])), /permission denied/);
  await assert.rejects(as(pg, 'anon', () => pg.query(`insert into public.model_stats (model_id, prompt_version, preset, games, stats) values ('random','p1','x',1,'{}')`)), /permission denied/);
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
  const ns = (await as(pg, 'service_role', () => pg.query<{ n: number }>('select count(*)::int as n from public.model_stats'))).rows[0].n;
  assert.equal(ns, third.stats.length);
});
