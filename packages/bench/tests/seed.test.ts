import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MODELS } from '@ai-mafia/agents';
import { seedDemo } from '../src/seed.ts';
import { SEED_PATH, seedSql } from '../src/seedsql.ts';
import { as, pgliteDb, supabaseLikeDb } from './pg.ts';

test('supabase/seed.sql is up to date with the model registry (run `pnpm db:gen-seed` if this fails)', () => {
  assert.equal(readFileSync(SEED_PATH, 'utf8'), seedSql());
});

test('seed.sql applies and loads every registry model plus the random baseline', async () => {
  const pg = await supabaseLikeDb();
  await pg.exec(seedSql());
  await pg.exec(seedSql()); // re-runnable
  const { rows } = await as(pg, 'anon', () => pg.query<{ id: string }>('select id from public.models order by id'));
  assert.deepEqual(rows.map((r) => r.id), ['random', ...MODELS.map((m) => m.id)].sort());
});

test('db:seed uploads demo games (self-play → no ratings)', async () => {
  const pg = await supabaseLikeDb();
  const res = await seedDemo(pgliteDb(pg), { model: 'claude-haiku', games: 3, dryRun: true, outDir: mkdtempSync(join(tmpdir(), 'seed-')) });
  assert.equal(res.uploaded, 3);
  assert.equal(res.ratingRows, 0, 'demo games are self-play: baselines, never ratings');
  const games = await as(pg, 'service_role', () => pg.query<{ run_id: string; n: number }>(`select run_id, count(*)::int as n from public.games group by run_id`));
  assert.deepEqual(games.rows, [{ run_id: 'demo-dry', n: 3 }]);
});
