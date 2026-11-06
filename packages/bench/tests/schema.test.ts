import assert from 'node:assert/strict';
import { test } from 'node:test';
import { as, supabaseLikeDb } from './pg.js';

const minimalGame = (externalId: string, seqs = [0, 1]) => ({
  models: [{ id: 'random', provider: 'none', model: 'random', display_name: 'Random', pricing: { inputPerMTok: 0, outputPerMTok: 0 }, enabled: true }],
  game: {
    external_id: externalId, mode: 'bench', format: 'self', run_id: 'r', preset: 'classic6', config: {}, seed: 1,
    prompt_version: 'p1', status: 'finished', outcome: 'town', has_human: false, cost_usd: 0,
    created_at: '2026-11-06T00:00:00Z', finished_at: '2026-11-06T00:01:00Z',
  },
  seats: [{ seat_id: 's1', name: 'Zara', role: 'mafia', persona_id: 'online', controller: { kind: 'random' } }],
  events: seqs.map((seq) => ({
    seq, day: 0, phase: 'setup', type: seq === 0 ? 'game_start' : 'thought', visibility: seq === 0 ? { kind: 'public' } : { kind: 'spectator' },
    text: seq === 0 ? 'hello' : 'SECRET THOUGHT', created_at: '2026-11-06T00:00:00Z',
  })),
  agent_calls: [{ seq: 1, seat_id: 's1', model_id: 'random', prompt_version: 'p1', input_tokens: 1, output_tokens: 1, cost_usd: 0, latency_ms: 1, retries: 0, fallback: false }],
});

test('migrations apply cleanly and create every §9.2 table', async () => {
  const db = await supabaseLikeDb();
  const { rows } = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
  assert.deepEqual(rows.map((r) => r.table_name), ['agent_calls', 'events', 'games', 'highlights', 'models', 'ratings', 'seats']);
});

test('upload_game inserts game, seats, events and agent calls in one call', async () => {
  const db = await supabaseLikeDb();
  const { rows } = await as(db, 'service_role', () => db.query<{ id: string }>('select public.upload_game($1) as id', [minimalGame('g1')]));
  assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
  const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
  assert.deepEqual([await count('games'), await count('seats'), await count('events'), await count('agent_calls'), await count('models')], [1, 1, 2, 1, 1]);
});

test('upload_game is idempotent on external_id (resumable uploads)', async () => {
  const db = await supabaseLikeDb();
  const a = await as(db, 'service_role', () => db.query<{ id: string }>('select public.upload_game($1) as id', [minimalGame('g1')]));
  const b = await as(db, 'service_role', () => db.query<{ id: string }>('select public.upload_game($1) as id', [minimalGame('g1')]));
  assert.equal(a.rows[0].id, b.rows[0].id);
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.events')).rows[0].n, 2);
});

test('I7: gaps or duplicates in seq are rejected and nothing is written (atomic)', async () => {
  const db = await supabaseLikeDb();
  for (const seqs of [[0, 2], [1, 2], [0, 0], []]) {
    await assert.rejects(as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame(`bad-${seqs.join('-')}`, seqs)])));
  }
  for (const t of ['games', 'seats', 'events', 'agent_calls']) {
    assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n, 0, `${t} not rolled back`);
  }
});

test('a failure midway (bad agent_call model) rolls back the whole game', async () => {
  const db = await supabaseLikeDb();
  const g = minimalGame('g-fk');
  g.agent_calls[0].model_id = 'no-such-model';
  await assert.rejects(as(db, 'service_role', () => db.query('select public.upload_game($1)', [g])));
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.games')).rows[0].n, 0);
});

test('I3 / RLS: anon and signed-in clients cannot read events, seats, games or agent calls', async () => {
  const db = await supabaseLikeDb();
  await as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame('g1')]));
  for (const role of ['anon', 'authenticated'] as const) {
    for (const t of ['events', 'seats', 'games', 'agent_calls', 'highlights']) {
      await assert.rejects(as(db, role, () => db.query(`select * from public.${t}`)), /permission denied/, `${role} read ${t}`);
    }
    // and they can't write anything
    await assert.rejects(as(db, role, () => db.query(`insert into public.models (id, provider, model, display_name, pricing) values ('x','x','x','x','{}')`)), /permission denied/);
  }
});

test('defence in depth: even if table grants were restored by mistake, RLS still returns nothing', async () => {
  const db = await supabaseLikeDb();
  await as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame('g1')]));
  await db.exec('grant select on public.events, public.seats, public.games to anon');
  for (const t of ['events', 'seats', 'games']) {
    assert.equal((await as(db, 'anon', () => db.query(`select * from public.${t}`))).rows.length, 0, `${t} visible through a stray grant`);
  }
});

test('I2 at rest: the spectator thought is stored but unreachable for clients', async () => {
  const db = await supabaseLikeDb();
  await as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame('g1')]));
  const svc = await as(db, 'service_role', () => db.query<{ text: string }>(`select text from public.events where type = 'thought'`));
  assert.equal(svc.rows[0].text, 'SECRET THOUGHT');
  await assert.rejects(as(db, 'anon', () => db.query(`select text from public.events`)));
});

test('models and ratings are publicly readable; write RPCs are service-role only', async () => {
  const db = await supabaseLikeDb();
  await as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame('g1')]));
  await as(db, 'service_role', () =>
    db.query('select public.replace_ratings($1)', [[{ model_id: 'random', scope: 'overall', prompt_version: 'p1', preset: 'classic6', mu: 25, sigma: 8, ordinal: 1, games: 1 }]]),
  );
  for (const role of ['anon', 'authenticated'] as const) {
    assert.equal((await as(db, role, () => db.query('select * from public.models'))).rows.length, 1);
    assert.equal((await as(db, role, () => db.query('select * from public.ratings'))).rows.length, 1);
    await assert.rejects(as(db, role, () => db.query('select public.upload_game($1)', [minimalGame('evil')])), /permission denied/);
    await assert.rejects(as(db, role, () => db.query('select public.replace_ratings($1)', [[]])), /permission denied/);
  }
});

test('replace_ratings swaps the table atomically (rebuild is idempotent)', async () => {
  const db = await supabaseLikeDb();
  await as(db, 'service_role', () => db.query('select public.upload_game($1)', [minimalGame('g1')]));
  const row = (ordinal: number) => ({ model_id: 'random', scope: 'overall', prompt_version: 'p1', preset: 'classic6', mu: 25, sigma: 8, ordinal, games: 1 });
  await as(db, 'service_role', () => db.query('select public.replace_ratings($1)', [[row(1)]]));
  await as(db, 'service_role', () => db.query('select public.replace_ratings($1)', [[row(2)]]));
  const { rows } = await db.query<{ ordinal: number }>('select ordinal from public.ratings');
  assert.deepEqual(rows.map((r) => r.ordinal), [2]);
});
