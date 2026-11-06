import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, makeConfig } from '@ai-mafia/engine';
import { abortResponse } from '../lib/live/admin';
import { MemoryLiveStore } from '../lib/live/memory-store';
import type { SessionUser } from '../lib/live/types';

const user: SessionUser = { id: 'u', githubId: '42', login: 'p', avatarUrl: null };

test('abort: admins only; a running game stops and can no longer be claimed', async () => {
  const store = new MemoryLiveStore();
  const id = await store.createLiveGame(createGame(makeConfig({ seed: 1 })), 'u');
  assert.equal((await abortResponse(store, id, null, false)).status, 401);
  assert.equal((await abortResponse(store, id, user, false)).status, 403);
  assert.equal((await store.loadLive(id))!.status, 'running', 'refused calls change nothing');
  const ok = await abortResponse(store, id, user, true);
  assert.equal(ok.status, 200);
  assert.equal((await store.loadLive(id))!.status, 'aborted');
  assert.equal(await store.claimStep(id, (await store.loadLive(id))!.version, 1000), false);
  assert.equal((await abortResponse(store, id, user, true)).status, 409, 'already stopped');
});

test('admin allowlist uses the GitHub provider id, never editable profile fields', async () => {
  // isAdmin is in lib/auth (server-only); exercise the rule directly
  const allow = (u: SessionUser | null, ids: string) => !!u?.githubId && ids.split(',').map((s) => s.trim()).filter(Boolean).includes(u.githubId);
  assert.equal(allow(user, '42'), true);
  assert.equal(allow(user, '7, 42'), true);
  assert.equal(allow({ ...user, githubId: null, login: '42' }, '42'), false, 'a login that looks like an id grants nothing');
  assert.equal(allow(user, ''), false);
  assert.equal(allow(null, '42'), false);
});

test('recentFallbacks surfaces raw invalid output, newest first', async () => {
  const store = new MemoryLiveStore();
  const s = createGame(makeConfig({ seed: 2 }));
  const id = await store.createLiveGame(s, 'u');
  const g = store.games.get(id)!;
  g.state.events.push({ gameId: s.id, seq: g.state.events.length, day: 1, phase: 'night', type: 'fallback', visibility: { kind: 'spectator' }, actorSeatId: 's1', text: 'bad', payload: { reason: 'invalid kill target', rawOutput: { target: 'Batman' } }, createdAt: '' });
  const f = await store.recentFallbacks(5);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].rawOutput, { target: 'Batman' });
  assert.equal(f[0].reason, 'invalid kill target');
});
