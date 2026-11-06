import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, drive, makeConfig } from '@ai-mafia/engine';
import type { AgentContext, Responder } from '@ai-mafia/engine';
import { RandomController } from '../src/random.ts';
import { renderTranscript } from '../src/render.ts';

const ctx: AgentContext = {
  self: { seatId: 's1', name: 'Zara', role: 'villager', persona: { id: 'x', label: 'x', description: 'x', avatarSeed: 'x' } },
  teammates: [],
  alive: ['Zara', 'Omar', 'Priya'],
  roster: [
    { seatId: 's1', name: 'Zara' },
    { seatId: 's2', name: 'Omar' },
    { seatId: 's3', name: 'Priya' },
  ],
  day: 1,
  phase: 'day',
  observations: [],
};

test('RandomController picks only from the given options', async () => {
  const a = new RandomController(1);
  for (let i = 0; i < 50; i++) {
    const r = await a.respond(ctx, { id: 'r', seatId: 's1', kind: 'choose', action: 'vote', options: ['s2', 's3'] });
    assert.ok(r.kind === 'choose' && ['s2', 's3'].includes(r.target));
  }
});

test('RandomController never accuses itself', async () => {
  const a = new RandomController(2);
  for (let i = 0; i < 50; i++) {
    const r = await a.respond(ctx, { id: 'r', seatId: 's1', kind: 'speak', channel: 'public', maxChars: 280 });
    assert.ok(r.kind === 'speak' && !r.speech.includes('Zara') && r.accuses !== 's1');
  }
});

test('RandomControllers play a full game through drive()', async () => {
  const s = createGame(makeConfig({ seed: 11 }));
  const m = new Map<string, Responder>(s.seats.map((x, i) => [x.id, new RandomController(i)]));
  const end = await drive(s, m);
  assert.equal(end.status, 'finished');
});

test('transcript uses names and never renders spectator events', () => {
  const t = renderTranscript({
    roster: ctx.roster,
    day: 1,
    observations: [
      { gameId: 'g', seq: 0, day: 1, phase: 'day', type: 'speech', visibility: { kind: 'public' }, actorSeatId: 's2', text: 'hi', createdAt: '' },
      { gameId: 'g', seq: 1, day: 1, phase: 'day', type: 'thought', visibility: { kind: 'spectator' }, actorSeatId: 's2', text: 'SECRET', createdAt: '' },
    ],
  });
  assert.match(t, /<speech from="Omar">hi<\/speech>/);
  assert.doesNotMatch(t, /SECRET/);
});
