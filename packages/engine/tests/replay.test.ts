import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { createGame } from '../src/state.js';
import { drive } from '../src/drive.js';
import { replay } from '../src/replay.js';
import { makeConfig } from '../src/setup.js';
import type { GameState } from '../src/types.js';
import { play, randomResponder } from './helpers.js';

test('I4: same config + seed + responses ⇒ identical event log', async () => {
  for (let seed = 1; seed <= 50; seed++) {
    const a = await play(seed);
    const b = await play(seed);
    assert.deepEqual(a.result, b.result);
  }
  const x = await play(1);
  const y = await play(2);
  assert.notDeepEqual(x.result.events, y.result.events);
});

test('replay(config, events) reconstructs the final state exactly', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { config, result } = await play(seed);
    assert.deepEqual(replay(config, result.events), result, `seed ${seed}`);
  }
});

test('replay handles fallbacks, truncation, throws and garbage (chaos responders)', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { config, result } = await play(seed, { chaos: true });
    assert.deepEqual(replay(config, result.events), result, `seed ${seed}`);
  }
});

test('replay of a partial log reproduces every intermediate state', async () => {
  const config = makeConfig({ seed: 77 });
  const start = createGame(config);
  const states: GameState[] = [];
  await drive(start, new Map(start.seats.map((s, i) => [s.id, randomResponder(i)])), { onState: (s) => void states.push(s) });
  for (const s of states) assert.deepEqual(replay(config, s.events), s);
});

test('replay ignores object key order (logs read back from jsonb storage)', async () => {
  const { config, result } = await play(13);
  const reorder = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
  const shuffled = result.events.map((e) => reorder(e)) as typeof result.events;
  assert.notEqual(JSON.stringify(shuffled[5]), JSON.stringify(result.events[5]));
  assert.deepEqual(replay(config, shuffled), result);
});

test('replay rejects a tampered log', async () => {
  const { config, result } = await play(8);
  const tampered = structuredClone(result.events);
  const vote = tampered.find((e) => e.type === 'vote')!;
  vote.text = 'Someone votes for someone else.';
  assert.throws(() => replay(config, tampered), /divergence/);
  assert.throws(() => replay(config, [...result.events, result.events[0]]), /trailing/);
});

test('I4: engine source never touches Math.random, Date.now or IO', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /Math\.random|Date\.now|new Date\(|from 'node:|require\(/, `${f} is impure`);
  }
});
