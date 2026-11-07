import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, drive, makeConfig, type Responder } from '@ai-mafia/engine';
import { judgeGame, judgeTranscript, validateAwards, type JudgeSeat } from '../src/judge.ts';
import { getModel } from '../src/registry.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { RandomController } from '../src/random.ts';

async function finished() {
  const s = createGame(makeConfig({ seed: 12 }));
  const end = await drive(s, new Map<string, Responder>(s.seats.map((x, i) => [x.id, new RandomController(i)])));
  const seats: JudgeSeat[] = end.seats.map((x) => ({ id: x.id, name: x.name, role: x.role }));
  return { events: end.events, seats };
}

test('transcript: roles, numbered lines, thoughts included, speech escaped', async () => {
  const { events, seats } = await finished();
  const t = judgeTranscript(events, seats);
  assert.match(t, /true roles: .*\(mafia\)/);
  assert.match(t, /\[#\d+\] .* privately thinks:/);
  assert.ok(!t.includes('<speech from'), 'own format');
});

test('validation keeps only awards that match the game', async () => {
  const { events, seats } = await finished();
  const mafia = seats.find((s) => s.role === 'mafia')!;
  const town = seats.find((s) => s.role !== 'mafia')!;
  const speech = events.find((e) => e.type === 'speech' && e.actorSeatId === mafia.id)!;
  const awards = validateAwards(
    {
      awards: [
        { kind: 'mvp', player: town.name, seq: null, title: 'Carried', blurb: 'did it all' },
        { kind: 'best_liar', player: mafia.name.toUpperCase(), seq: speech.seq, title: 'Oscar-worthy', blurb: 'lied a lot' },
        { kind: 'best_liar', player: mafia.name, seq: speech.seq, title: 'dup', blurb: 'dup' }, // duplicate kind
        { kind: 'sharpest_read', player: mafia.name, seq: speech.seq, title: 'x', blurb: 'mafia cannot win this' },
        { kind: 'biggest_fumble', player: 'Batman', seq: 1, title: 'x', blurb: 'unknown player' },
        { kind: 'biggest_fumble', player: town.name, seq: 99999, title: 'x', blurb: 'unknown seq' },
      ],
    },
    events,
    seats,
  );
  assert.deepEqual(awards.map((a) => a.kind), ['best_liar', 'mvp']);
  assert.equal(awards[0].seatId, mafia.id);
  assert.deepEqual(validateAwards('garbage', events, seats), []);
  assert.deepEqual(validateAwards({ awards: [{ kind: 'best_liar' }] }, events, seats), []);
});

test('judgeGame: one call, costed; failures mean no awards, never a throw', async () => {
  const { events, seats } = await finished();
  const mafia = seats.find((s) => s.role === 'mafia')!;
  const seq = events.find((e) => e.type === 'speech' && e.actorSeatId === mafia.id)!.seq;
  const ok = await judgeGame(new MockProvider({ awards: [{ kind: 'best_liar', player: mafia.name, seq, title: 'Snake', blurb: 'sss' }] }), getModel('claude-haiku'), events, seats);
  assert.equal(ok.awards.length, 1);
  assert.ok(ok.costUsd > 0);
  const boom = await judgeGame({ id: 'x', complete: async () => { throw new Error('down'); } }, getModel('claude-haiku'), events, seats);
  assert.deepEqual(boom.awards, []);
  assert.equal(boom.error, 'down');
});
