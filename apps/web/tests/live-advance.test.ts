import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng, viewerCanSee, type GameState, type Responder } from '@ai-mafia/engine';
import type { AgentCall } from '@ai-mafia/agents';
import { advanceResponse, waitingOn, type AdvanceDeps } from '../lib/live/advance';
import { createGameResponse } from '../lib/live/create';
import { MemoryLiveStore } from '../lib/live/memory-store';
import type { Limits, SessionUser } from '../lib/live/types';

const user: SessionUser = { id: 'u-1', githubId: '42', login: 'p', avatarUrl: null };
const limits: Limits = { dailyBudgetUsd: 100, maxGameCostUsd: 100, maxGamesPerUserPerDay: 100 };

/** Random play that reports a fixed cost per call, like a real controller would. */
function randomModel(costPerCall = 0.0001, delayMs = 0) {
  let calls = 0;
  const make = (modelId: string, onCall: (c: AgentCall) => void): Responder => {
    const rng = createRng(1000 + calls);
    return {
      async respond(ctx, req) {
        calls++;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        onCall({ gameId: 'g', seq: 0, seatId: req.seatId, modelId, promptVersion: 'p1', inputTokens: 100, outputTokens: 10, costUsd: costPerCall, latencyMs: delayMs, retries: 0, fallback: false });
        if (req.kind === 'choose') return { kind: 'choose', thought: 'SECRET THOUGHT', target: rng.pick(req.options) };
        if (req.kind === 'notes') return { kind: 'notes', notes: 'n' };
        return { kind: 'speak', thought: 'SECRET THOUGHT', speech: `hi from ${ctx.self.name}` };
      },
    };
  };
  return { make, count: () => calls };
}

async function newGame(store: MemoryLiveStore) {
  const res = await createGameResponse(
    { store, limits, allowedModels: ['claude-haiku'], now: () => new Date('2026-11-08T00:00:00Z'), randomSeed: () => 77, newId: () => 'x' },
    new Request('http://x', { method: 'POST', body: JSON.stringify({ models: ['claude-haiku'] }) }),
    user,
    'ip',
  );
  return (await res.json()).id as string;
}

const post = async (deps: AdvanceDeps, id: string, q = '', ip = 'ip') => {
  const r = await advanceResponse(deps, id, new URL(`http://x/api/games/${id}/advance${q}`), {}, ip);
  return { status: r.status, body: await r.json() };
};

test('a live game advances one step per call to the end; public responses never carry thoughts', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const model = randomModel();
  const pings: number[] = [];
  const deps: AdvanceDeps = { store, limits, makeResponder: model.make, notify: async (_g, seq) => void pings.push(seq) };
  let lastSeq = -1;
  let steps = 0;
  for (;;) {
    const r = await post(deps, id, `?after=${lastSeq}`);
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('SECRET THOUGHT'));
    for (const e of r.body.events) {
      assert.equal(e.visibility.kind, 'public');
      assert.ok(e.seq > lastSeq);
    }
    if (r.body.events.length) lastSeq = r.body.events.at(-1).seq;
    assert.equal(r.body.stepped, true, 'every call on a running game performs one step');
    steps++;
    if (r.body.status === 'finished') break;
    assert.ok(steps < 500, 'game must terminate');
  }
  const g = (await store.loadLive(id))!;
  assert.equal(g.status, 'finished');
  assert.equal(g.version, steps);
  assert.equal(model.count(), steps, 'exactly one model call per step');
  g.state.events.forEach((e, i) => assert.equal(e.seq, i));
  assert.deepEqual(pings, [...pings].sort((a, b) => a - b));
  assert.ok(Math.abs(g.costUsd - steps * 0.0001) < 1e-9, 'cost accumulates from agent calls');
  // finished: further calls are harmless no-ops
  const again = await post(deps, id);
  assert.equal(again.body.status, 'finished');
  assert.equal(model.count(), steps);
});

test('concurrent viewers: the step lease means the model is called once, the other gets "busy"', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const model = randomModel(0.0001, 30);
  const deps: AdvanceDeps = { store, limits, makeResponder: model.make };
  const [a, b] = await Promise.all([post(deps, id, '', 'ip-a'), post(deps, id, '', 'ip-b')]);
  assert.deepEqual([a.body.status, b.body.status].sort(), ['busy', 'running']);
  assert.equal(model.count(), 1);
  assert.equal((await store.loadLive(id))!.version, 1);
});

test('a lost compare-and-swap writes nothing and reports busy', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const model = randomModel();
  const deps: AdvanceDeps = { store, limits, makeResponder: model.make };
  const before = (await store.loadLive(id))!.state.events.length;
  const real = store.commitStep.bind(store);
  store.commitStep = async (gid, v, c) => {
    store.games.get(gid)!.version++; // someone else committed in between
    return real(gid, v, c);
  };
  const r = await post(deps, id);
  assert.equal(r.body.status, 'busy');
  assert.equal((await store.loadLive(id))!.state.events.length, before, 'losing writer appended nothing');
  assert.equal(r.body.stepped, undefined);
});

test('per-game cost cap: once a game has spent the cap it is aborted, not advanced', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const model = randomModel(0.1);
  const deps: AdvanceDeps = { store, limits: { ...limits, maxGameCostUsd: 0.25 }, makeResponder: model.make };
  const statuses: string[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await post(deps, id)).body.status);
  assert.deepEqual(statuses, ['running', 'running', 'running', 'aborted', 'aborted']);
  assert.equal(model.count(), 3, 'no model call after the cap');
  assert.equal((await store.loadLive(id))!.status, 'aborted');
});

test('a crashing model becomes an engine fallback; the game keeps going', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const deps: AdvanceDeps = { store, limits, makeResponder: () => ({ respond: async () => { throw new Error('provider down'); } }) };
  const r = await post(deps, id, '?view=spectator');
  assert.equal(r.body.status, 'running');
  assert.ok(r.body.events.some((e: { type: string }) => e.type === 'fallback'));
});

test('typing indicator never names a seat at night (it would reveal its role)', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const deps: AdvanceDeps = { store, limits, makeResponder: randomModel().make };
  let seen = 0;
  for (let i = 0; i < 200; i++) {
    const g = (await store.loadLive(id))!;
    const w = waitingOn(g.state as GameState);
    if (g.state.phase === 'night') assert.ok(w === null || w.kind === 'night', JSON.stringify(w));
    if (w && 'seatId' in w) {
      seen++;
      assert.ok(['day', 'vote'].includes(g.state.phase));
    }
    const r = await post(deps, id);
    if (r.body.status !== 'running') break;
  }
  assert.ok(seen > 0);
});

test('views, errors and rate limits', async () => {
  const store = new MemoryLiveStore();
  const id = await newGame(store);
  const deps: AdvanceDeps = { store, limits, makeResponder: randomModel().make };
  const spec = await post(deps, id, '?view=spectator');
  assert.equal(spec.status, 200, 'AI-only live games may be spectated');
  const g = (await store.loadLive(id))!;
  for (const e of spec.body.events) assert.ok(viewerCanSee({ kind: 'spectator' }, e));
  assert.equal(spec.body.events.length, g.state.events.length);
  assert.equal((await post(deps, id, '?view=seat')).status, 403);
  assert.equal((await post(deps, id, '?after=x')).status, 400);
  assert.equal((await post(deps, '00000000-0000-4000-8000-999999999999')).status, 404);
  store.games.get(id)!.mode = 'bench';
  assert.equal((await post(deps, id)).status, 409);
  const flood = new MemoryLiveStore();
  const fid = await newGame(flood);
  const fdeps: AdvanceDeps = { store: flood, limits, makeResponder: randomModel().make };
  const codes: number[] = [];
  for (let i = 0; i < 62; i++) codes.push((await advanceResponse(fdeps, fid, new URL('http://x'), {}, 'one-ip')).status);
  assert.ok(codes.includes(429));
});
