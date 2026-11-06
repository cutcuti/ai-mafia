import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESETS, PRESET_NAMES, configErrors, roleErrors } from '../src/presets.ts';
import { makeConfig } from '../src/setup.ts';
import { createGame } from '../src/state.ts';
import { canSee } from '../src/visibility.ts';
import { play } from './helpers.ts';

test('preset tables match the BRD', () => {
  assert.deepEqual(PRESETS.classic6, { mafia: 2, detective: 1, doctor: 1, villager: 2 });
  assert.deepEqual(PRESETS.mini5, { mafia: 1, detective: 1, doctor: 1, villager: 2 });
  assert.deepEqual(PRESETS.big8, { mafia: 2, detective: 1, doctor: 1, villager: 4 });
  for (const p of PRESET_NAMES) assert.deepEqual(roleErrors(PRESETS[p]), []);
});

for (const preset of PRESET_NAMES) {
  test(`${preset}: 200 seeds all complete`, async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { result } = await play(seed, { config: { preset } });
      const total = Object.values(PRESETS[preset]).reduce((a, b) => a + b, 0);
      assert.equal(result.seats.length, total);
      assert.equal(result.status, 'finished');
    }
  });

  test(`${preset}: I1/I2 spy test over 100 seeds`, async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { result, spies } = await play(seed, { config: { preset }, chaos: seed % 2 === 0 });
      for (const s of result.seats) {
        for (const { ctx } of spies.get(s.id)!.seen) {
          for (const e of ctx.observations) assert.ok(canSee(s, e) && e.visibility.kind !== 'spectator', `${preset}/${seed} leak`);
          if (s.role !== 'mafia') assert.deepEqual(ctx.teammates, []);
        }
      }
    }
  });
}

test('role validation: 1 ≤ mafia < town, ≤1 detective, ≤1 doctor, 5–10 seats', () => {
  assert.equal(roleErrors({ mafia: 0, detective: 1, doctor: 1, villager: 3 }).length, 1);
  assert.equal(roleErrors({ mafia: 3, detective: 1, doctor: 1, villager: 1 }).length, 1); // 3 vs 3
  assert.ok(roleErrors({ mafia: 1, detective: 2, doctor: 1, villager: 2 }).some((e) => /detective/.test(e)));
  assert.ok(roleErrors({ mafia: 1, detective: 1, doctor: 2, villager: 2 }).some((e) => /doctor/.test(e)));
  assert.ok(roleErrors({ mafia: 1, detective: 0, doctor: 0, villager: 3 }).some((e) => /5–10/.test(e)));
  assert.ok(roleErrors({ mafia: 4, detective: 1, doctor: 1, villager: 5 }).some((e) => /5–10/.test(e)));
  assert.ok(roleErrors({ mafia: 1.5, detective: 1, doctor: 1, villager: 2 }).length > 0);
  assert.deepEqual(roleErrors({ mafia: 4, detective: 0, doctor: 0, villager: 6 }), []);
});

test('createGame rejects invalid configs instead of starting a broken game', () => {
  assert.throws(() => createGame(makeConfig({ seed: 1, roles: { mafia: 3, detective: 1, doctor: 1, villager: 1 } })), /invalid game config/);
  assert.throws(() => createGame({ ...makeConfig({ seed: 1 }), controllers: [{ kind: 'random' }] }), /controllers/);
  assert.throws(() => createGame({ ...makeConfig({ seed: 1 }), preset: 'mini5' }), /preset/);
  assert.throws(() => createGame({ ...makeConfig({ seed: 1 }), preset: 'nope' }), /unknown preset/);
  assert.throws(() => createGame({ ...makeConfig({ seed: 1 }), rounds: 0 }), /rounds/);
  assert.deepEqual(configErrors(makeConfig({ seed: 1, preset: 'big8' })), []);
  assert.equal(makeConfig({ seed: 1, roles: { mafia: 1, detective: 0, doctor: 1, villager: 4 } }).preset, 'custom');
});
