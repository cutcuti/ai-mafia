import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { applyResponse, createGame, nextRequest } from '../src/state.ts';
import { makeConfig } from '../src/setup.ts';
import { canSee } from '../src/visibility.ts';
import type { RoleCounts } from '../src/types.ts';
import { play } from './helpers.ts';

test('applyResponse is idempotent: stale or unknown request ids are no-ops', () => {
  let s = createGame(makeConfig({ seed: 12 }));
  let steps = 0;
  for (let req = nextRequest(s); req; req = nextRequest(s), steps++) {
    const res =
      req.kind === 'speak'
        ? ({ kind: 'speak', thought: 't', speech: 'hi' } as const)
        : req.kind === 'notes'
          ? ({ kind: 'notes', notes: 'n' } as const)
          : ({ kind: 'choose', thought: 't', target: req.options[0] } as const);
    const next = applyResponse(s, req.id, res);
    assert.notEqual(next, s);
    assert.equal(next.version, s.version + 1);
    // double submit of the same (now stale) request: unchanged, same reference
    assert.equal(applyResponse(next, req.id, res), next);
    assert.equal(applyResponse(next, 'bogus', res), next);
    s = next;
  }
  assert.ok(steps > 10);
  assert.equal(applyResponse(s, 'anything', { kind: 'speak', thought: '', speech: 'x' }), s, 'finished game ignores input');
});

test('applyResponse and nextRequest never mutate their input', () => {
  const s = createGame(makeConfig({ seed: 3 }));
  const snapshot = structuredClone(s);
  const req = nextRequest(s)!;
  applyResponse(s, req.id, { kind: 'speak', thought: 'x', speech: 'y' });
  nextRequest(s);
  assert.deepEqual(s, snapshot);
});

test('state survives a JSON round-trip and keeps playing identically', () => {
  let a = createGame(makeConfig({ seed: 21 }));
  let b = JSON.parse(JSON.stringify(a));
  for (let req = nextRequest(a); req; req = nextRequest(a)) {
    const res = req.kind === 'speak' ? ({ kind: 'speak', thought: '', speech: 'ok' } as const) : ({ kind: 'choose', thought: '', target: '??' } as const);
    a = applyResponse(a, req.id, res);
    b = JSON.parse(JSON.stringify(applyResponse(b, req.id, res)));
  }
  assert.deepEqual(b, JSON.parse(JSON.stringify(a)));
});

/** Any table with 5–10 seats, 1 ≤ mafia < town, ≤1 detective, ≤1 doctor. */
const roleCounts: fc.Arbitrary<RoleCounts> = fc
  .record({ total: fc.integer({ min: 5, max: 10 }), detective: fc.integer({ min: 0, max: 1 }), doctor: fc.integer({ min: 0, max: 1 }), m: fc.nat() })
  .map(({ total, detective, doctor, m }) => {
    const maxMafia = Math.ceil(total / 2) - 1; // mafia < town
    const mafia = 1 + (m % maxMafia);
    return { mafia, detective, doctor, villager: total - mafia - detective - doctor };
  });

test('property: for random tables/seeds/responders, I1, I2, I7 hold and the game terminates', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 2 ** 31 - 1 }),
      roleCounts,
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 8 }),
      fc.boolean(),
      async (seed, roles, rounds, maxDays, chaos) => {
        const { result, spies } = await play(seed, { config: { roles, rounds, maxDays }, chaos });
        // termination
        assert.equal(result.status, 'finished');
        assert.ok(result.day <= maxDays);
        assert.equal(result.events.at(-1)!.type, 'game_over');
        // I7
        result.events.forEach((e, i) => assert.equal(e.seq, i));
        // I1 + I2
        for (const s of result.seats) {
          for (const { ctx } of spies.get(s.id)!.seen) {
            for (const e of ctx.observations) {
              assert.ok(canSee(s, e));
              assert.notEqual(e.visibility.kind, 'spectator');
            }
          }
        }
      },
    ),
    { numRuns: 300 },
  );
});
