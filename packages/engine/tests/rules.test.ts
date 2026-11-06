import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyResponse, createGame, nextRequest } from '../src/state.ts';
import { makeConfig } from '../src/setup.ts';
import type { GameState, InputRequest } from '../src/types.ts';
import { play } from './helpers.ts';

/** Drive a game, choosing via `pick`; records every request seen. */
function run(seed: number, pick: (s: GameState, req: Extract<InputRequest, { kind: 'choose' }>) => string, maxDays?: number) {
  let s = createGame(makeConfig({ seed, maxDays }));
  const reqs: InputRequest[] = [];
  for (let req = nextRequest(s); req; req = nextRequest(s)) {
    reqs.push(req);
    s =
      req.kind === 'speak'
        ? applyResponse(s, req.id, { kind: 'speak', thought: '', speech: 'hello' })
        : req.kind === 'notes'
          ? applyResponse(s, req.id, { kind: 'notes', notes: 'n' })
          : applyResponse(s, req.id, { kind: 'choose', thought: '', target: pick(s, req) });
  }
  return { s, reqs };
}

test('doctor is never offered last night’s save', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { result, spies } = await play(seed);
    const doctor = result.seats.find((x) => x.role === 'doctor')!;
    let last: string | undefined;
    for (const { req } of spies.get(doctor.id)!.seen) {
      if (req.kind !== 'choose' || req.action !== 'save') continue;
      if (last) assert.ok(!req.options.includes(last), `seed ${seed}: doctor offered ${last} twice in a row`);
      const e = result.events.find((x) => x.type === 'save' && x.seq >= Number(req.id.split(':')[1]))!;
      last = e.targetSeatId;
    }
  }
});

test('doctor may save self (just not twice running)', () => {
  const { s } = run(2, (st, req) => {
    const me = req.seatId;
    return req.action === 'save' && req.options.includes(me) ? me : req.options[0];
  });
  const saves = s.events.filter((e) => e.type === 'save');
  for (let i = 1; i < saves.length; i++) assert.notEqual(saves[i].targetSeatId, saves[i - 1].targetSeatId);
  assert.ok(saves.some((e) => e.targetSeatId === e.actorSeatId));
});

test('detective never re-investigates while fresh targets exist', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { result, spies } = await play(seed);
    const det = result.seats.find((x) => x.role === 'detective')!;
    const checked: string[] = [];
    for (const { req, ctx } of spies.get(det.id)!.seen) {
      if (req.kind !== 'choose' || req.action !== 'investigate') continue;
      const aliveOthers = ctx.roster.filter((r) => r.seatId !== det.id && ctx.alive.includes(r.name)).map((r) => r.seatId);
      const fresh = aliveOthers.filter((id) => !checked.includes(id));
      assert.deepEqual([...req.options].sort(), (fresh.length ? fresh : aliveOthers).sort(), `seed ${seed}`);
      const e = result.events.find((x) => x.type === 'investigate_result' && x.seq >= Number(req.id.split(':')[1]))!;
      checked.push(e.targetSeatId!);
    }
  }
});

test('detective options exclude already-investigated seats, then reopen once all are checked', () => {
  const { reqs, s } = run(3, (_st, req) => req.options[0], 20);
  const inv = reqs.filter((r): r is Extract<InputRequest, { kind: 'choose' }> => r.kind === 'choose' && r.action === 'investigate');
  const checked: string[] = [];
  for (const r of inv) {
    const fresh = r.options.filter((o) => !checked.includes(o));
    assert.ok(fresh.length === r.options.length || fresh.length === 0, 'mixed old and new options');
    checked.push(r.options[0]);
  }
  assert.ok(s.memory.investigated.length === inv.length);
});

test('draw after maxDays with no winner', () => {
  // town-safe play: mafia always kill the doctor-saved player? simpler: everyone votes randomly but ties are forced
  // by making each voter vote for a distinct seat → always tied → nobody eliminated; doctor always saves the kill target.
  const { s } = run(
    5,
    (st, req) => {
      if (req.action === 'vote') {
        const voters = st.events.filter((e) => e.type === 'vote' && e.day === st.day).length;
        return req.options[voters % req.options.length];
      }
      if (req.action === 'save') {
        const kill = st.events.filter((e) => e.type === 'kill_vote' && e.day === st.day)[0]?.targetSeatId;
        return kill && req.options.includes(kill) ? kill : req.options[0];
      }
      if (req.action === 'kill') {
        // kill a different town member each night so the no-consecutive-save rule doesn't bite
        const tonight = st.events.filter((e) => e.type === 'kill_vote' && e.day === st.day)[0]?.targetSeatId;
        return tonight ?? req.options[st.day % req.options.length];
      }
      return req.options[0];
    },
    3,
  );
  assert.equal(s.status, 'finished');
  if (s.outcome === 'draw') {
    assert.equal(s.day, 3);
    assert.equal(s.events.at(-1)!.payload!.outcome, 'draw');
  } else {
    assert.fail(`expected draw, got ${s.outcome} on day ${s.day}`);
  }
});

test('default maxDays is 8 and no game runs past it', async () => {
  assert.equal(makeConfig({ seed: 1 }).maxDays, 8);
  for (let seed = 1; seed <= 200; seed++) {
    const { result } = await play(seed);
    assert.ok(result.day <= 8);
  }
});
