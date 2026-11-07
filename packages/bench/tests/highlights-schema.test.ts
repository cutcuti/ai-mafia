import assert from 'node:assert/strict';
import { test } from 'node:test';
import { as, supabaseLikeDb } from './pg.ts';

async function setup(status: string) {
  const db = await supabaseLikeDb({ autoExpose: true });
  const svc = <T>(sql: string, params: unknown[] = []) => as(db, 'service_role', () => db.query<T>(sql, params));
  const { rows } = await svc<{ id: string }>('select public.create_live_game($1) as id', [
    {
      game: { external_id: `g-${status}`, mode: 'live', format: null, preset: 'classic6', config: {}, seed: 1, prompt_version: 'p1', state: {}, has_human: false, created_by: null },
      seats: [],
      events: [],
    },
  ]);
  await svc(`update public.games set status = $2, outcome = case when $2 = 'finished' then 'town' end where id = $1`, [rows[0].id, status]);
  return { db, svc, id: rows[0].id };
}

const row = (kind: string, seq: number | null) => ({ kind, seq, title: 't', blurb: 'b', seat_id: 's1', seat_name: 'Zara', model_id: 'claude-haiku', quote: 'q', judge_version: 'j1' });

test('save_highlights: replaces a finished game\'s awards, ranked in order', async () => {
  const { svc, id } = await setup('finished');
  await svc('select public.save_highlights($1, $2)', [id, [row('best_liar', 3), row('mvp', null)]]);
  await svc('select public.save_highlights($1, $2)', [id, [row('mvp', null)]]);
  const { rows } = await svc<{ rank: number; kind: string; model_id: string }>('select rank, kind, model_id from public.highlights where game_id = $1 order by rank', [id]);
  assert.deepEqual(rows, [{ rank: 0, kind: 'mvp', model_id: 'claude-haiku' }]);
});

test('save_highlights: refuses unfinished games (awards reveal roles)', async () => {
  const { svc, id } = await setup('running');
  await assert.rejects(svc('select public.save_highlights($1, $2)', [id, [row('mvp', null)]]), /not finished/);
});

test('save_highlights and highlights rows are not reachable by the browser roles', async () => {
  const { db, id } = await setup('finished');
  for (const role of ['anon', 'authenticated'] as const) {
    await assert.rejects(as(db, role, () => db.query('select public.save_highlights($1, $2)', [id, []])), /permission denied/);
    await assert.rejects(as(db, role, () => db.query('select * from public.highlights')), /permission denied/);
  }
});
