import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { replay, type GameConfig } from '@ai-mafia/engine';
import { rowToEvent, supabaseDb, toUploadPayload, uploadRecords, type BenchDb } from '../src/db.ts';
import { runBench } from '../src/runner.ts';
import { as, pgliteDb, supabaseLikeDb } from './pg.ts';

const now = () => new Date('2026-11-06T09:00:00.000Z');
const bench = (games = 4) =>
  runBench({ format: 'h2h', a: 'claude-haiku', b: 'random', games, preset: 'classic6', dryRun: true, logRaw: true, outDir: mkdtempSync(join(tmpdir(), 'bench-')), now });

test('toUploadPayload maps a record to the upload_game rows', async () => {
  const { records } = await bench(2);
  const r = records[0];
  const p = toUploadPayload(r);
  assert.equal(p.game.external_id, r.gameId);
  assert.equal(p.game.mode, 'bench');
  assert.equal(p.game.status, 'finished');
  assert.equal(p.events.length, r.events.length);
  assert.deepEqual(p.models.map((m) => m.id).sort(), ['claude-haiku', 'random']);
  assert.ok(p.seats.every((s) => s.persona_id && s.persona_id !== 'unknown'));
  assert.deepEqual(p.seats.map((s) => s.controller), r.config.controllers);
  assert.ok(p.agent_calls.every((c) => c.raw !== undefined), 'raw kept in bench mode');
  assert.equal(p.events.find((e) => e.type === 'thought')!.actor_seat_id !== null, true);
});

test('bench → upload → read back → replay reproduces every game exactly', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const { records } = await bench(4);
  const sum = await uploadRecords(db, records);
  assert.deepEqual(sum, { uploaded: 4, failed: [] });

  for (const r of records) {
    const rows = await as(pg, 'service_role', async () => {
      const g = (await pg.query<{ id: string; config: GameConfig }>('select id, config from public.games where external_id = $1', [r.gameId])).rows[0];
      const ev = (await pg.query<Record<string, unknown>>('select * from public.events where game_id = $1 order by seq', [g.id])).rows;
      return { config: g.config, events: ev.map((x) => rowToEvent(g.config.gameId, x)) };
    });
    assert.deepEqual(rows.events, r.events, `${r.gameId} events changed in storage`);
    assert.deepEqual(replay(rows.config, rows.events).events, r.events);
  }
  const calls = (await as(pg, 'service_role', () => pg.query<{ n: number }>('select count(*)::int as n from public.agent_calls'))).rows[0].n;
  assert.equal(calls, records.reduce((a, r) => a + r.agentCalls.length, 0));
});

test('re-uploading a run is a no-op (idempotent, resumable)', async () => {
  const pg = await supabaseLikeDb();
  const db = pgliteDb(pg);
  const { records } = await bench(4);
  await uploadRecords(db, records.slice(0, 2));
  await uploadRecords(db, records); // resume: first two already there
  const n = (await as(pg, 'service_role', () => pg.query<{ n: number }>('select count(*)::int as n from public.games'))).rows[0].n;
  assert.equal(n, 4);
});

test('one failing game is reported and does not stop the others', async () => {
  const { records } = await bench(4);
  let calls = 0;
  const flaky: BenchDb = {
    uploadGame: async () => {
      if (calls++ === 1) throw new Error('boom');
      return 'id';
    },
    fetchRatedGames: async () => [],
    replaceRatings: async () => 0,
    fetchStatsGames: async () => [],
    replaceLeaderboard: async () => {},
  };
  const sum = await uploadRecords(flaky, records);
  assert.equal(sum.uploaded, 3);
  assert.deepEqual(sum.failed, [{ gameId: records[1].gameId, error: 'boom' }]);
});

test('Supabase client: upload_game goes to the RPC endpoint with the service key and the payload as p', async () => {
  const seen: { url: string; body: string; headers: Headers }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input instanceof Request ? input.url : input), body: String(init?.body ?? ''), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify('11111111-1111-1111-1111-111111111111'), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  const client = createClient('https://example.supabase.co', 'service-key-test', { auth: { persistSession: false }, global: { fetch } });
  const { records } = await bench(2);
  const id = await supabaseDb(client).uploadGame(toUploadPayload(records[0]));
  assert.equal(id, '11111111-1111-1111-1111-111111111111');
  assert.equal(seen[0].url, 'https://example.supabase.co/rest/v1/rpc/upload_game');
  assert.equal(seen[0].headers.get('apikey'), 'service-key-test');
  assert.equal(JSON.parse(seen[0].body).p.game.external_id, records[0].gameId);
});

test('Supabase client: RPC errors surface as thrown errors', async () => {
  const fetch = (async () =>
    new Response(JSON.stringify({ message: 'upload_game: event seq must be gapless', code: '22023' }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
  const client = createClient('https://example.supabase.co', 'k', { auth: { persistSession: false }, global: { fetch } });
  const { records } = await bench(2);
  await assert.rejects(supabaseDb(client).uploadGame(toUploadPayload(records[0])), /gapless/);
});
