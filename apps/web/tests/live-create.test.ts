import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameResponse, TIRED, type CreateDeps } from '../lib/live/create';
import { MemoryLiveStore } from '../lib/live/memory-store';
import { webModels } from '../lib/live/models';
import { limitsFromEnv, type SessionUser } from '../lib/live/types';
import { safeNext } from '../lib/redirect';

const user: SessionUser = { id: 'u-1', githubId: '42', login: 'protik', avatarUrl: null };
const req = (body: unknown) => new Request('http://x/api/games', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

function deps(o: Partial<CreateDeps> = {}): CreateDeps & { store: MemoryLiveStore } {
  let n = 0;
  return {
    store: new MemoryLiveStore(),
    limits: { dailyBudgetUsd: 2, maxGameCostUsd: 0.25, maxGamesPerUserPerDay: 3 },
    allowedModels: ['claude-haiku', 'gpt-nano'],
    now: () => new Date('2026-11-08T12:00:00Z'),
    randomSeed: () => 1234 + n,
    newId: () => `id-${++n}`,
    ...o,
  } as CreateDeps & { store: MemoryLiveStore };
}

test('signed-in user creates a running AI-only game with only the picked models', async () => {
  const d = deps();
  const res = await createGameResponse(d, req({ preset: 'classic6', models: ['claude-haiku', 'gpt-nano'] }), user, '1.2.3.4');
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const g = (await d.store.loadLive(id))!;
  assert.equal(g.status, 'running');
  assert.equal(g.version, 0);
  assert.equal(g.createdBy, 'u-1');
  assert.equal(g.state.seats.length, 6);
  for (const s of g.state.seats) assert.ok(s.controller.kind === 'model' && ['claude-haiku', 'gpt-nano'].includes(s.controller.modelId));
  assert.equal(g.state.config.createdAt, '2026-11-08T12:00:00.000Z');
  assert.match(g.state.id, /^live-id-/);
});

test('anonymous → 401', async () => {
  assert.equal((await createGameResponse(deps(), req({ models: ['claude-haiku'] }), null, 'ip')).status, 401);
});

test('validation: preset, 1–3 models, only allowed models, JSON body', async () => {
  const d = deps();
  assert.equal((await createGameResponse(d, req({ preset: 'mega', models: ['claude-haiku'] }), user, 'ip')).status, 400);
  assert.equal((await createGameResponse(d, req({ models: [] }), user, 'ip')).status, 400);
  assert.equal((await createGameResponse(d, req({ models: ['a', 'b', 'c', 'd'] }), user, 'ip')).status, 400);
  const pricey = await createGameResponse(d, req({ models: ['claude-opus'] }), user, 'ip');
  assert.equal(pricey.status, 400);
  assert.match((await pricey.json()).error, /claude-opus/);
  const notJson = new Request('http://x', { method: 'POST', body: 'nope' });
  assert.equal((await createGameResponse(d, notJson, user, 'ip')).status, 400);
});

test('daily budget spent → 429 "the AIs are tired" (BRD §9.5)', async () => {
  const d = deps();
  d.store.spent = 2;
  const res = await createGameResponse(d, req({ models: ['claude-haiku'] }), user, 'ip');
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.code, 'daily_budget');
  assert.equal(body.error, TIRED);
});

test('per-user daily cap: 3 games, then 429', async () => {
  const d = deps();
  for (let i = 0; i < 3; i++) assert.equal((await createGameResponse(d, req({ models: ['claude-haiku'] }), user, `ip${i}`)).status, 201);
  const res = await createGameResponse(d, req({ models: ['claude-haiku'] }), user, 'ip9');
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'user_daily');
  // someone else is unaffected
  assert.equal((await createGameResponse(d, req({ models: ['claude-haiku'] }), { ...user, id: 'u-2' }, 'ip8')).status, 201);
});

test('rate limit per IP: bursts from one address are refused', async () => {
  const d = deps({ limits: { dailyBudgetUsd: 100, maxGameCostUsd: 1, maxGamesPerUserPerDay: 1000 } });
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await createGameResponse(d, req({ models: ['claude-haiku'] }), { ...user, id: `u${i}` }, 'same-ip')).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

test('web models: only cheap, enabled models whose key is configured', () => {
  assert.deepEqual(webModels({}), []);
  const withAnthropic = webModels({ ANTHROPIC_API_KEY: 'x' }).map((m) => m.id);
  assert.ok(withAnthropic.includes('claude-haiku'));
  assert.ok(!withAnthropic.includes('claude-sonnet') && !withAnthropic.includes('claude-opus'), 'expensive models never web-allowed');
});

test('limits come from env with BRD defaults; junk values fall back', () => {
  assert.deepEqual(limitsFromEnv({}), { dailyBudgetUsd: 2, maxGameCostUsd: 0.25, maxGamesPerUserPerDay: 3, createPerUserPerHour: 5, createPerIpPerHour: 10 });
  assert.deepEqual(limitsFromEnv({ DAILY_BUDGET_USD: '0.5', MAX_GAME_COST_USD: 'lots', MAX_LIVE_GAMES_PER_USER_PER_DAY: '-1' }), {
    dailyBudgetUsd: 0.5,
    maxGameCostUsd: 0.25,
    maxGamesPerUserPerDay: 3,
    createPerUserPerHour: 5,
    createPerIpPerHour: 10,
  });
});

test('post-sign-in redirect only goes to same-site paths', () => {
  assert.equal(safeNext('/play'), '/play');
  assert.equal(safeNext('/g/123?t=4'), '/g/123?t=4');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '', null, undefined, 'javascript:alert(1)']) assert.equal(safeNext(bad), '/play', String(bad));
});
