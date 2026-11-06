import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replay } from '../src/replay.js';
import { contextFor } from '../src/state.js';
import { canSee } from '../src/visibility.js';
import { play } from './helpers.js';

test('notes mode off under the default budget for a normal 6-player game', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { result } = await play(seed);
    assert.ok(!result.events.some((e) => e.type === 'notes'), `seed ${seed}`);
  }
});

test('tiny budget: every living seat writes ≤150-word, seat-private notes at each day end', async () => {
  let sawTruncation = false;
  for (let seed = 1; seed <= 50; seed++) {
    const { result, spies } = await play(seed, { config: { notesBudgetTokens: 50 } });
    const notes = result.events.filter((e) => e.type === 'notes');
    const days = new Set(result.events.filter((e) => e.type === 'vote').map((e) => e.day));
    // notes are due at every day end that the game survives (a night follows the vote)
    const survivedDays = result.events.filter((e) => e.type === 'phase' && e.phase === 'night' && e.day >= 2).length;
    if (survivedDays > 0) assert.ok(notes.length > 0, `seed ${seed}: no notes`);
    for (const n of notes) {
      assert.deepEqual(n.visibility, { kind: 'seat', seatId: n.actorSeatId });
      assert.ok(n.text.split(' ').length <= 150);
      assert.ok(days.has(n.day));
      if (n.payload?.truncated) sawTruncation = true;
      // nobody else ever receives them
      for (const s of result.seats.filter((x) => x.id !== n.actorSeatId)) {
        for (const { ctx } of spies.get(s.id)!.seen) assert.ok(!ctx.observations.some((o) => o.seq === n.seq));
      }
    }
    // after their first note, seats are handed their latest notes in context
    for (const s of result.seats) {
      const mine = notes.filter((n) => n.actorSeatId === s.id);
      if (!mine.length) continue;
      const after = spies.get(s.id)!.seen.filter(({ req }) => Number(req.id.split(':')[1]) > mine[0].seq);
      for (const { ctx } of after) {
        const latest = mine.filter((n) => ctx.observations.some((o) => o.seq === n.seq)).at(-1)!;
        assert.equal(ctx.notes, latest.text);
      }
      for (const e of contextFor(result, s.id).observations) assert.ok(canSee(s, e));
    }
  }
  assert.ok(sawTruncation, 'some notes should have been cut to 150 words');
});

test('notes games replay exactly (incl. truncated notes)', async () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { config, result } = await play(seed, { config: { notesBudgetTokens: 50 }, chaos: seed % 2 === 0 });
    assert.deepEqual(replay(config, result.events), result, `seed ${seed}`);
  }
});

test('budget 0 disables notes entirely', async () => {
  const { result } = await play(4, { config: { notesBudgetTokens: 0 } });
  assert.ok(!result.events.some((e) => e.type === 'notes'));
});
