import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, createRng, drive, makeConfig, viewerCanSee, type Responder } from '@ai-mafia/engine';
import { beatDelayMs, buildTimeline, indexForSeq, isLikelyLie, markers, stateAt } from '../lib/timeline';

async function game(seed: number) {
  const s = createGame(makeConfig({ seed }));
  const rng = createRng(seed);
  const r: Responder = {
    async respond(ctx, req) {
      if (req.kind === 'choose') return { kind: 'choose', thought: 'because reasons', target: rng.pick(req.options) };
      if (req.kind === 'notes') return { kind: 'notes', notes: 'n' };
      const other = ctx.roster.find((x) => x.seatId !== ctx.self.seatId && ctx.alive.includes(x.name))!;
      return { kind: 'speak', thought: 'scheming', speech: 'hello', accuses: other.seatId, claimRole: rng.next() < 0.3 ? 'doctor' : undefined };
    },
  };
  return drive(s, new Map(s.seats.map((x) => [x.id, r])));
}

test('public timeline has no secrets and no thoughts; spectator timeline attaches every thought to its beat', async () => {
  const end = await game(4);
  const pub = buildTimeline(end.events.filter((e) => viewerCanSee({ kind: 'public' }, e)));
  assert.ok(pub.every((b) => !b.secret && !b.thought));
  const spec = buildTimeline(end.events);
  assert.ok(spec.some((b) => b.secret && b.kind === 'mafia_chat'));
  const thoughts = end.events.filter((e) => e.type === 'thought').length;
  assert.equal(spec.filter((b) => b.thought).length, thoughts);
  for (const b of spec) if (b.thought) assert.equal(b.thought.replyToSeq, b.event.seq);
});

test('stateAt tracks phase, deaths, revealed roles, votes and the final outcome', async () => {
  const end = await game(7);
  const beats = buildTimeline(end.events);
  const ids = end.seats.map((s) => s.id);
  const start = stateAt(beats, ids, 0);
  assert.equal(start.alive.size, 6);
  assert.equal(start.revealed.size, 0);
  const fin = stateAt(beats, ids, beats.length);
  assert.equal(fin.phase, 'end');
  assert.equal(fin.outcome, end.outcome);
  assert.equal(fin.revealed.size, 6);
  assert.deepEqual([...fin.alive].sort(), end.seats.filter((s) => s.alive).map((s) => s.id).sort());
  // midway through a vote, votes accumulate
  const firstVote = beats.findIndex((b) => b.kind === 'vote');
  assert.equal(stateAt(beats, ids, firstVote + 2).votes.length, 2);
  // a death reveals exactly that role before game over
  const d = beats.findIndex((b) => b.kind === 'death');
  if (d >= 0) {
    const mid = stateAt(beats, ids, d + 1);
    assert.equal(mid.revealed.get(beats[d].event.targetSeatId!), end.seats.find((s) => s.id === beats[d].event.targetSeatId)!.role);
    assert.equal(mid.revealed.size, stateAt(beats, ids, d).revealed.size + 1);
  }
});

test('markers, deep links and pacing', async () => {
  const end = await game(5);
  const beats = buildTimeline(end.events);
  const m = markers(beats);
  assert.equal(m[0].kind, 'night');
  assert.ok(m.some((x) => x.kind === 'day') && m.some((x) => x.kind === 'vote'));
  const seq = beats[10].event.seq;
  assert.equal(indexForSeq(beats, seq), 11);
  assert.equal(indexForSeq(beats, 99999), beats.length);
  const speech = beats.find((b) => b.kind === 'speech')!;
  assert.equal(beatDelayMs(speech, 2), beatDelayMs(speech, 1) / 2);
  assert.equal(beatDelayMs(speech, Infinity), 0);
});

test('lie heuristic flags mafia fake claims and mafia accusing town only', async () => {
  const end = await game(9);
  const roles = new Map(end.seats.map((s) => [s.id, s.role]));
  const beats = buildTimeline(end.events);
  for (const b of beats.filter((x) => x.kind === 'speech')) {
    const actorRole = roles.get(b.event.actorSeatId!);
    if (actorRole !== 'mafia') assert.equal(isLikelyLie(b, roles), false);
  }
  assert.ok(beats.some((b) => isLikelyLie(b, roles)), 'some mafia lie expected in a random game');
});
