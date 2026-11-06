import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEAT_COLORS, hash, seatColor } from '../lib/theme';

test('every seat of a 10-player table gets a distinct colour', () => {
  const colors = Array.from({ length: 10 }, (_, i) => seatColor(`s${i + 1}`));
  assert.equal(new Set(colors).size, 10);
  assert.equal(seatColor('s11'), SEAT_COLORS[0]);
});

test('avatar hash is deterministic', () => {
  assert.equal(hash('zara'), hash('zara'));
  assert.notEqual(hash('zara'), hash('omar'));
});
