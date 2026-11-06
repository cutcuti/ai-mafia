import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkWinner, tally, createGame, nextRequest, contextFor } from '../src/state.js';
import { makeConfig } from '../src/setup.js';
import { canSee } from '../src/visibility.js';
import { play } from './helpers.js';

test('200 random games all finish with a valid winner', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { result } = await play(seed);
    assert.equal(result.status, 'finished');
    assert.ok(['town', 'mafia', 'draw'].includes(result.outcome!));
    if (result.outcome !== 'draw') assert.equal(checkWinner(result.seats), result.outcome);
    assert.equal(nextRequest(result), null);
    const last = result.events.at(-1)!;
    assert.equal(last.type, 'game_over');
  }
});

test('I1/I2: no agent ever receives an event it should not see', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const { result, spies } = await play(seed);
    for (const s of result.seats) {
      for (const { ctx } of spies.get(s.id)!.seen) {
        for (const e of ctx.observations) {
          assert.ok(canSee(s, e), `${s.id} (${s.role}) leaked event: ${JSON.stringify(e)}`);
          assert.notEqual(e.visibility.kind, 'spectator', 'private thoughts leaked to a player');
        }
        if (s.role !== 'mafia') assert.deepEqual(ctx.teammates, [], 'town player learned mafia teammates');
        assert.equal(ctx.self.seatId, s.id);
      }
    }
  }
});

test('dead players never act and are never asked', async () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { result, spies } = await play(seed);
    for (const e of result.events) {
      if ((e.type !== 'death' && e.type !== 'eliminated') || !e.targetSeatId) continue;
      const id = e.targetSeatId;
      const acted = result.events.some((x) => x.actorSeatId === id && x.seq > e.seq);
      assert.ok(!acted, `${id} acted after dying`);
      assert.ok(spies.get(id)!.seen.every(({ ctx }) => ctx.observations.every((o) => o.seq < e.seq)));
    }
  }
});

test('I7: seq is gapless from 0 and every event carries the game id', async () => {
  const { result } = await play(9);
  result.events.forEach((e, i) => {
    assert.equal(e.seq, i);
    assert.equal(e.gameId, result.id);
  });
});

test('thoughts are spectator-only and point back at their action event', async () => {
  const { result } = await play(5);
  const thoughts = result.events.filter((e) => e.type === 'thought');
  assert.ok(thoughts.length > 0);
  for (const t of thoughts) {
    assert.equal(t.visibility.kind, 'spectator');
    const target = result.events[t.replyToSeq!];
    assert.equal(target.actorSeatId, t.actorSeatId);
    assert.equal(target.type, t.payload?.forType);
  }
});

test('I5: garbage, throwing and null responses fall back and never crash', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const { result } = await play(seed, { chaos: true });
    assert.equal(result.status, 'finished');
    for (const e of result.events.filter((x) => x.type === 'speech' || x.type === 'mafia_chat')) {
      assert.ok(e.text.length > 0 && e.text.length <= 280);
    }
  }
  const { result } = await play(3, { chaos: true });
  assert.ok(result.events.some((e) => e.type === 'fallback' && e.visibility.kind === 'spectator'));
});

test('setup: public roster, private roles, mafia team reveal', () => {
  const s = createGame(makeConfig({ seed: 1 }));
  assert.equal(s.events[0].type, 'game_start');
  const reveals = s.events.filter((e) => e.type === 'role_reveal');
  assert.equal(reveals.length, 6);
  for (const r of reveals) assert.equal(r.visibility.kind, 'seat');
  const team = s.events.find((e) => e.type === 'team_reveal')!;
  assert.deepEqual(team.visibility, { kind: 'team', team: 'mafia' });
  assert.equal(s.seats.filter((x) => x.role === 'mafia').length, 2);
  // game opens at Night 1 asking a mafia member to speak on the mafia channel
  const req = nextRequest(s)!;
  assert.equal(s.day, 1);
  assert.equal(s.phase, 'night');
  assert.equal(req.kind, 'speak');
  assert.ok(req.kind === 'speak' && req.channel === 'mafia');
  assert.equal(s.seats.find((x) => x.id === req.seatId)!.role, 'mafia');
  assert.equal(req.id, `${s.id}:${s.events.length}:${req.seatId}:speak`);
  const ctx = contextFor(s, req.seatId);
  assert.equal(ctx.teammates.length, 1);
});

test('win conditions', () => {
  const mk = (role: 'mafia' | 'villager' | 'doctor', alive = true) => ({ role, alive });
  assert.equal(checkWinner([mk('mafia', false), mk('villager')]), 'town');
  assert.equal(checkWinner([mk('mafia'), mk('villager')]), 'mafia');
  assert.equal(checkWinner([mk('mafia'), mk('villager'), mk('doctor')]), null);
});

test('tally: plurality wins, ties return null', () => {
  assert.equal(tally(['a', 'a', 'b']), 'a');
  assert.equal(tally(['a', 'b']), null);
  assert.equal(tally([]), null);
});
