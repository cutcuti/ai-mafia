import assert from 'node:assert/strict';
import { test } from 'node:test';
import { as, supabaseLikeDb } from './pg.ts';

const ev = (seq: number) => ({ seq, day: 0, phase: 'setup', type: 'game_start', visibility: { kind: 'public' }, text: `e${seq}`, created_at: '2026-11-08T00:00:00Z' });

async function setup() {
  const db = await supabaseLikeDb({ autoExpose: false });
  await db.exec(`insert into public.models (id, provider, model, display_name, pricing) values ('claude-haiku','anthropic','m','Haiku','{}')`);
  const svc = <T>(sql: string, params: unknown[] = []) => as(db, 'service_role', () => db.query<T>(sql, params));
  const { rows } = await svc<{ id: string }>('select public.create_live_game($1) as id', [
    {
      game: { external_id: 'live-1', mode: 'live', format: null, preset: 'classic6', config: {}, seed: 1, prompt_version: 'p1', state: { v: 0 }, has_human: false, created_by: null },
      seats: [{ seat_id: 's1', name: 'Zara', role: 'mafia', persona_id: 'x', controller: { kind: 'model', modelId: 'claude-haiku' } }],
      events: [ev(0), ev(1)],
    },
  ]);
  return { db, svc, id: rows[0].id };
}

test('create_live_game: running, version 0, seats and setup events stored', async () => {
  const { svc, id } = await setup();
  const g = (await svc<{ status: string; version: number; mode: string }>('select status, version, mode from public.games where id = $1', [id])).rows[0];
  assert.deepEqual(g, { status: 'running', version: 0, mode: 'live' });
  assert.equal((await svc<{ n: number }>('select count(*)::int n from public.events where game_id = $1', [id])).rows[0].n, 2);
});

test('claim_step: only one holder at a time, only at the current version', async () => {
  const { svc, id } = await setup();
  const claim = async (v: number) => (await svc<{ ok: boolean }>('select public.claim_step($1, $2, 30000) as ok', [id, v])).rows[0].ok;
  assert.equal(await claim(0), true);
  assert.equal(await claim(0), false, 'second claimer refused while the lease is held');
  assert.equal(await claim(5), false, 'stale version refused');
  await svc(`update public.games set step_lease_until = now() - interval '1 second' where id = $1`, [id]);
  assert.equal(await claim(0), true, 'expired lease can be retaken');
});

test('commit_step: compare-and-swap on version, appends events, releases the lease', async () => {
  const { svc, id } = await setup();
  await svc('select public.claim_step($1, 0, 30000)', [id]);
  const p = (events: unknown[], extra = {}) => ({ state: { v: 1 }, status: 'running', outcome: null, cost_usd: 0.002, events, agent_calls: [{ seq: 2, seat_id: 's1', model_id: 'claude-haiku', prompt_version: 'p1', input_tokens: 10, output_tokens: 2, cost_usd: 0.002, latency_ms: 900, retries: 0, fallback: false }], ...extra });
  assert.equal((await svc<{ ok: boolean }>('select public.commit_step($1, 0, $2) as ok', [id, p([ev(2), ev(3)])])).rows[0].ok, true);
  const g = (await svc<{ version: number; lease: string | null; cost: string }>('select version, step_lease_until as lease, cost_usd::text as cost from public.games where id = $1', [id])).rows[0];
  assert.equal(g.version, 1);
  assert.equal(g.lease, null);
  assert.equal(Number(g.cost), 0.002);
  // a racing request that read version 0 loses, and writes nothing
  assert.equal((await svc<{ ok: boolean }>('select public.commit_step($1, 0, $2) as ok', [id, p([ev(4)])])).rows[0].ok, false);
  assert.equal((await svc<{ n: number }>('select count(*)::int n from public.events where game_id = $1', [id])).rows[0].n, 4);
});

test('commit_step: I7 — events must continue the seq exactly, or the whole step rolls back', async () => {
  const { svc, id } = await setup();
  await assert.rejects(svc('select public.commit_step($1, 0, $2)', [id, { state: {}, status: 'running', events: [ev(5)] }]), /continue at seq 2/);
  const g = (await svc<{ version: number }>('select version from public.games where id = $1', [id])).rows[0];
  assert.equal(g.version, 0, 'version not bumped on failure');
});

test('finishing stamps finished_at; abort_game stops a running game', async () => {
  const { svc, id } = await setup();
  await svc('select public.commit_step($1, 0, $2)', [id, { state: {}, status: 'finished', outcome: 'town', events: [] }]);
  const g = (await svc<{ status: string; finished: string | null }>('select status, finished_at as finished from public.games where id = $1', [id])).rows[0];
  assert.equal(g.status, 'finished');
  assert.ok(g.finished);
  assert.equal((await svc<{ ok: boolean }>('select public.abort_game($1) as ok', [id])).rows[0].ok, false, 'cannot abort a finished game');
  const other = await setup();
  assert.equal((await other.svc<{ ok: boolean }>('select public.abort_game($1) as ok', [other.id])).rows[0].ok, true);
  assert.equal((await other.svc<{ ok: boolean }>('select public.claim_step($1, 1, 1000) as ok', [other.id])).rows[0].ok, false, 'aborted games never advance');
});

test('take_token: bucket of N, then refused until it refills', async () => {
  const { svc, db } = await setup();
  const take = async () => (await svc<{ ok: boolean }>(`select public.take_token('ip:1', 3, 0.0001) as ok`)).rows[0].ok;
  assert.deepEqual([await take(), await take(), await take(), await take()], [true, true, true, false]);
  await as(db, 'service_role', () => db.query(`update public.rate_limits set updated_at = now() - interval '10 hours' where key = 'ip:1'`));
  assert.equal(await take(), true, 'refilled');
});

test('live_spend_today sums only live/human games', async () => {
  const { svc, id } = await setup();
  await svc('select public.commit_step($1, 0, $2)', [id, { state: {}, status: 'running', cost_usd: 0.01, events: [], agent_calls: [{ seq: 2, seat_id: 's1', model_id: 'claude-haiku', prompt_version: 'p1', input_tokens: 1, output_tokens: 1, cost_usd: 0.01, latency_ms: 1, retries: 0, fallback: false }] }]);
  await svc(`select public.upload_game($1)`, [
    {
      models: [],
      game: { external_id: 'bench-1', mode: 'bench', format: 'self', run_id: 'r', preset: 'classic6', config: {}, seed: 1, prompt_version: 'p1', status: 'finished', outcome: 'town', has_human: false, cost_usd: 5, created_at: '2026-11-08T00:00:00Z', finished_at: '2026-11-08T00:01:00Z' },
      seats: [],
      events: [ev(0)],
      agent_calls: [{ seq: 0, seat_id: 's1', model_id: 'claude-haiku', prompt_version: 'p1', input_tokens: 1, output_tokens: 1, cost_usd: 5, latency_ms: 1, retries: 0, fallback: false }],
    },
  ]);
  const spent = (await svc<{ s: string }>('select public.live_spend_today()::text as s')).rows[0].s;
  assert.equal(Number(spent), 0.01, 'bench spend never counts against the web budget');
});

test('browsers can call none of the live functions or read the rate-limit table', async () => {
  const { db, id } = await setup();
  for (const sql of [
    `select public.claim_step('${id}', 0, 1000)`,
    `select public.commit_step('${id}', 0, '{}'::jsonb)`,
    `select public.abort_game('${id}')`,
    `select public.take_token('x', 1, 1)`,
    `select public.live_spend_today()`,
    `select public.create_live_game('{}'::jsonb)`,
    `select * from public.rate_limits`,
  ]) {
    for (const role of ['anon', 'authenticated'] as const) await assert.rejects(as(db, role, () => db.query(sql)), /permission denied/, `${role}: ${sql}`);
  }
});
