import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng, makeRng } from '../src/rng.ts';

test('same seed → same sequence', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('state is a uint32 and resuming from it continues the exact sequence', () => {
  const a = makeRng(7);
  for (let i = 0; i < 13; i++) a.next();
  const saved = JSON.parse(JSON.stringify({ s: a.state })).s as number;
  assert.ok(Number.isInteger(saved) && saved >= 0 && saved <= 0xffffffff);
  const b = createRng(saved);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('shuffle is a permutation; pick stays in range; pick on empty throws', () => {
  const r = makeRng(3);
  const xs = [1, 2, 3, 4, 5, 6];
  assert.deepEqual([...r.shuffle(xs)].sort(), xs);
  for (let i = 0; i < 50; i++) assert.ok(xs.includes(r.pick(xs)));
  assert.throws(() => r.pick([]));
});
