import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEUTRAL_PERSONA, PERSONAS, makeConfig } from '../src/setup.ts';
import { createGame } from '../src/state.ts';

test('persona pool: ≥10, unique ids, every seat of a 10-seat table distinct', () => {
  assert.ok(PERSONAS.length >= 10);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, PERSONAS.length);
  const s = createGame(makeConfig({ seed: 1, roles: { mafia: 3, detective: 1, doctor: 1, villager: 5 } }));
  assert.equal(new Set(s.seats.map((x) => x.persona.id)).size, 10);
});

test('neutral mode: same plain persona everywhere, same names and roles as default for a seed', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const a = createGame(makeConfig({ seed }));
    const b = createGame(makeConfig({ seed, personaMode: 'neutral' }));
    assert.deepEqual(b.seats.map((x) => [x.name, x.role]), a.seats.map((x) => [x.name, x.role]));
    for (const x of b.seats) {
      assert.equal(x.persona.description, NEUTRAL_PERSONA.description);
      assert.equal(x.persona.avatarSeed, x.name, 'avatars stay distinct');
    }
  }
});

test('unknown personaMode is rejected', () => {
  assert.throws(() => createGame({ ...makeConfig({ seed: 1 }), personaMode: 'spicy' as 'neutral' }), /personaMode/);
});
