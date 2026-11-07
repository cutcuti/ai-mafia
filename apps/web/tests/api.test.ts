import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, createRng, drive, makeConfig, type Controller, type GameState, type Responder } from '@ai-mafia/engine';
import { eventsResponse, gameResponse, listGamesResponse } from '../lib/api';
import { FixtureStore } from '../lib/fixture-store';
import type { StoredGame } from '../lib/types';

const random = (seed: number): Responder => {
  const rng = createRng(seed);
  return {
    async respond(ctx, req) {
      if (req.kind === 'choose') return { kind: 'choose', thought: `SECRET THOUGHT ${seed}`, target: rng.pick(req.options) };
      if (req.kind === 'notes') return { kind: 'notes', notes: 'n' };
      return { kind: 'speak', thought: `SECRET THOUGHT ${seed}`, speech: `hi from ${ctx.self.name}` };
    },
  };
};

/** Play a real engine game and wrap it as a stored game. `stopAfter` leaves it unfinished. */
async function makeGame(id: string, seed: number, o: { human?: boolean; stopAfter?: number; finishedAt?: string; models?: [string, string] } = {}) {
  const probe = createGame(makeConfig({ seed }));
  const [a, b] = o.models ?? ['claude-haiku', 'gpt-nano'];
  const controllers: Controller[] = probe.seats.map((s, i) =>
    o.human && i === 0 ? { kind: 'human', userId: 'u1' } : { kind: 'model', modelId: s.role === 'mafia' ? a : b },
  );
  let state = createGame(makeConfig({ seed, gameId: id, controllers, createdAt: '2026-11-06T00:00:00.000Z' }));
  let steps = 0;
  const stop = new Error('stop');
  try {
    state = await drive(state, new Map(state.seats.map((s, i) => [s.id, random(seed + i)])), {
      onState: (s) => {
        state = s;
        if (o.stopAfter !== undefined && ++steps >= o.stopAfter) throw stop;
      },
    });
  } catch (e) {
    if (e !== stop) throw e;
  }
  const finished = state.status === 'finished';
  const game: StoredGame = {
    id,
    externalId: id,
    mode: o.human ? 'human' : 'bench',
    format: 'h2h',
    runId: 'r',
    preset: 'classic6',
    promptVersion: 'p1',
    status: finished ? 'finished' : 'running',
    outcome: finished ? state.outcome! : null,
    hasHuman: !!o.human,
    costUsd: 0,
    createdAt: '2026-11-06T00:00:00.000Z',
    finishedAt: finished ? (o.finishedAt ?? '2026-11-06T01:00:00.000Z') : null,
    config: state.config,
    seats: state.seats.map((s) => ({ seatId: s.id, name: s.name, role: s.role, personaId: s.persona.id, controller: s.controller })),
  };
  return { game, events: state.events, state: state as GameState };
}

const get = async (res: Response) => ({ status: res.status, body: await res.json(), cache: res.headers.get('cache-control') });
const url = (path: string) => new URL(`http://x${path}`);

test('public view of a finished bench game: public events only, no thoughts or night chat', async () => {
  const store = new FixtureStore();
  const { game, events } = await makeGame('g1', 3);
  store.add(game, events);
  const r = await get(await eventsResponse(store, 'g1', url('/api/games/g1/events'), {}));
  assert.equal(r.status, 200);
  assert.equal(r.body.view, 'public');
  assert.ok(r.body.events.length > 0);
  assert.ok(r.body.events.every((e: { visibility: { kind: string } }) => e.visibility.kind === 'public'));
  assert.ok(!JSON.stringify(r.body).includes('SECRET THOUGHT'), 'thought leaked in public view');
  assert.match(r.cache!, /s-maxage/, 'finished games are edge-cacheable');
});

test('spectator view of a finished bench game: everything, including thoughts', async () => {
  const store = new FixtureStore();
  const { game, events } = await makeGame('g1', 3);
  store.add(game, events);
  const r = await get(await eventsResponse(store, 'g1', url('/api/games/g1/events?view=spectator'), {}));
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, events.length);
  assert.ok(JSON.stringify(r.body).includes('SECRET THOUGHT'));
});

test('I8 spectator lock: a live game with a human seat refuses spectator view to everyone until it ends', async () => {
  const store = new FixtureStore();
  const live = await makeGame('live', 5, { human: true, stopAfter: 0 });
  store.add(live.game, live.events);
  for (const caller of [{}, { userId: 'u1' }, { userId: 'someone-else' }]) {
    const r = await get(await eventsResponse(store, 'live', url('/api/games/live/events?view=spectator'), caller));
    assert.equal(r.status, 403, JSON.stringify(caller));
    const m = await get(await gameResponse(store, 'live', url('/api/games/live?view=spectator'), caller));
    assert.equal(m.status, 403);
  }
  // public view still works and leaks nothing
  const pub = await get(await eventsResponse(store, 'live', url('/api/games/live/events'), {}));
  assert.equal(pub.status, 200);
  assert.ok(!JSON.stringify(pub.body).includes('SECRET THOUGHT'));
  assert.equal(pub.cache, 'private, no-store');
});

test('spectator view of an unfinished AI-only game is allowed (no human seat to protect)', async () => {
  const store = new FixtureStore();
  const g = await makeGame('ai-live', 6, { stopAfter: 5 });
  store.add(g.game, g.events);
  assert.equal(g.game.status, 'running');
  const r = await get(await eventsResponse(store, 'ai-live', url('/api/games/ai-live/events?view=spectator'), {}));
  assert.equal(r.status, 200);
});

test('seat view: only that seat’s human gets it, and gets exactly what the engine lets that seat see', async () => {
  const store = new FixtureStore();
  const live = await makeGame('live', 5, { human: true, stopAfter: 10 });
  store.add(live.game, live.events);
  assert.equal((await eventsResponse(store, 'live', url('/api/games/live/events?view=seat'), {})).status, 403);
  assert.equal((await eventsResponse(store, 'live', url('/api/games/live/events?view=seat'), { userId: 'intruder' })).status, 403);
  const r = await get(await eventsResponse(store, 'live', url('/api/games/live/events?view=seat'), { userId: 'u1' }));
  assert.equal(r.status, 200);
  const me = live.game.seats[0];
  for (const e of r.body.events) {
    assert.notEqual(e.visibility.kind, 'spectator');
    if (e.visibility.kind === 'seat') assert.equal(e.visibility.seatId, me.seatId);
    if (e.visibility.kind === 'team') assert.equal(me.role, 'mafia');
  }
  assert.equal(r.cache, 'private, no-store');
});

test('meta: roles and per-seat models hidden while a game runs (models would reveal teams), shown when finished', async () => {
  const store = new FixtureStore();
  const live = await makeGame('live', 7, { human: true, stopAfter: 3 });
  const done = await makeGame('done', 7);
  store.add(live.game, live.events);
  store.add(done.game, done.events);
  const l = await get(await gameResponse(store, 'live', url('/api/games/live'), {}));
  assert.ok(l.body.seats.every((s: Record<string, unknown>) => s.role === undefined && s.modelId === undefined));
  assert.deepEqual(l.body.models, ['claude-haiku', 'gpt-nano', 'human']);
  assert.equal(l.body.outcome, null);
  assert.equal(l.body.spectatorAvailable, false);
  // the human sees only their own role
  const own = await get(await gameResponse(store, 'live', url('/api/games/live?view=seat'), { userId: 'u1' }));
  assert.equal(own.body.seats.filter((s: Record<string, unknown>) => s.role !== undefined).length, 1);
  const d = await get(await gameResponse(store, 'done', url('/api/games/done'), {}));
  assert.ok(d.body.seats.every((s: Record<string, unknown>) => s.role && s.modelId));
  assert.ok(d.body.outcome);
});

test('after=seq returns only newer events; bad input is rejected', async () => {
  const store = new FixtureStore();
  const { game, events } = await makeGame('g1', 3);
  store.add(game, events);
  const r = await get(await eventsResponse(store, 'g1', url('/api/games/g1/events?view=spectator&after=20'), {}));
  assert.ok(r.body.events.every((e: { seq: number }) => e.seq > 20));
  assert.equal(r.body.events[0].seq, 21);
  assert.equal((await eventsResponse(store, 'g1', url('/api/games/g1/events?after=abc'), {})).status, 400);
  assert.equal((await eventsResponse(store, 'g1', url('/api/games/g1/events?view=god'), {})).status, 400);
  assert.equal((await eventsResponse(store, 'nope', url('/api/games/nope/events'), {})).status, 404);
  assert.equal((await gameResponse(store, 'nope', url('/api/games/nope'), {})).status, 404);
});

test('list: finished games only, newest first, cursor pagination, model filter', async () => {
  const store = new FixtureStore();
  for (let i = 0; i < 5; i++) {
    const g = await makeGame(`g${i}`, 10 + i, { finishedAt: `2026-11-0${i + 1}T00:00:00.000Z`, models: i % 2 ? ['llama-70b', 'gpt-nano'] : undefined });
    store.add(g.game, g.events);
  }
  const live = await makeGame('live', 5, { human: true, stopAfter: 1 });
  store.add(live.game, live.events);
  const p1 = await get(await listGamesResponse(store, url('/api/games?limit=2')));
  assert.deepEqual(p1.body.games.map((g: { id: string }) => g.id), ['g4', 'g3']);
  const p2 = await get(await listGamesResponse(store, url(`/api/games?limit=2&cursor=${p1.body.nextCursor}`)));
  assert.deepEqual(p2.body.games.map((g: { id: string }) => g.id), ['g2', 'g1']);
  const p3 = await get(await listGamesResponse(store, url(`/api/games?limit=2&cursor=${p2.body.nextCursor}`)));
  assert.deepEqual(p3.body.games.map((g: { id: string }) => g.id), ['g0']);
  assert.equal(p3.body.nextCursor, undefined);
  const llama = await get(await listGamesResponse(store, url('/api/games?model=llama-70b')));
  assert.deepEqual(llama.body.games.map((g: { id: string }) => g.id), ['g3', 'g1']);
  assert.ok(!JSON.stringify(p1.body).includes('"role"'), 'cards never carry roles');
  assert.equal((await listGamesResponse(store, url('/api/games?cursor=yesterday'))).status, 400);
});

test('M8 share cards: public info only — no hidden roles, models or awards before the end; no thought/mafia-chat cards', async () => {
  const { ogGame, ogMoment } = await import('../lib/og');
  const { fixtureHighlights } = await import('../lib/fixture-store');
  const store = new FixtureStore();
  const live = await makeGame('live', 4, { stopAfter: 14 });
  store.add(live.game, live.events, fixtureHighlights({ ...live.game, status: 'finished' }, live.events)); // awards present but game unfinished
  assert.equal(live.game.status, 'running');
  const g = (await ogGame(store, 'live'))!;
  assert.equal(g.outcome, null);
  assert.ok(g.players.every((p) => p.mafia === null && p.model === null));
  assert.equal(g.award, null);
  const hidden = live.events.filter((e) => e.visibility.kind !== 'public');
  assert.ok(hidden.length > 0);
  for (const e of hidden) assert.equal(await ogMoment(store, 'live', e.seq), null, `${e.type} must not get a card`);
  const speech = live.events.find((e) => e.type === 'speech')!;
  const m = (await ogMoment(store, 'live', speech.seq))!;
  assert.equal(m.text, speech.text);
  assert.equal(m.model, null);
  assert.ok(!JSON.stringify(m).includes('SECRET THOUGHT'));

  const done = await makeGame('done', 5);
  store.add(done.game, done.events, fixtureHighlights(done.game, done.events));
  const d = (await ogGame(store, 'done'))!;
  assert.ok(d.outcome);
  assert.equal(d.players.filter((p) => p.mafia).length, 2);
  assert.ok(d.award);
  assert.equal(await ogMoment(store, 'done', 99999), null);
  assert.equal(await ogGame(store, 'nope'), null);
});
