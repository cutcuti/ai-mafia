import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSee, viewerCanSee } from '../src/visibility.ts';
import { play } from './helpers.ts';

test('viewer filter: public sees only public events, spectator sees all, seat matches the agent filter', async () => {
  const { result } = await play(4);
  const pub = result.events.filter((e) => viewerCanSee({ kind: 'public' }, e));
  assert.ok(pub.length > 0 && pub.every((e) => e.visibility.kind === 'public'));
  assert.ok(!pub.some((e) => e.type === 'thought' || e.type === 'mafia_chat' || e.type === 'role_reveal'));
  assert.equal(result.events.filter((e) => viewerCanSee({ kind: 'spectator' }, e)).length, result.events.length);
  for (const s of result.seats) {
    for (const e of result.events) assert.equal(viewerCanSee({ kind: 'seat', seat: s }, e), canSee(s, e));
  }
});
