import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextFor, createGame, drive, makeConfig, nextRequest } from '@ai-mafia/engine';
import type { InputRequest, Responder } from '@ai-mafia/engine';
import { ModelController } from '../src/controller.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { toolFor } from '../src/tools.ts';

const s = createGame(makeConfig({ seed: 4 }));
const ctx = contextFor(s, 's1');
const nameOf = (id: string) => s.seats.find((x) => x.id === id)!.name;
const speakReq: InputRequest = { id: 'x', seatId: 's1', kind: 'speak', channel: 'public', maxChars: 280 };
const voteReq: InputRequest = { id: 'x', seatId: 's1', kind: 'choose', action: 'vote', options: ['s2', 's3'] };

test('speak tool: accuses lists alive names except self; claimRole lists roles', () => {
  const props = (toolFor(ctx, speakReq).spec.schema as any).properties;
  assert.deepEqual(props.accuses.enum, ctx.alive.filter((n) => n !== ctx.self.name));
  assert.deepEqual(props.claimRole.enum, ['mafia', 'detective', 'doctor', 'villager']);
});

test('speak parse: maps accuses name → seat id, keeps claimRole', () => {
  const r = toolFor(ctx, speakReq).parse({ thought: 't', speech: 'I am the doc', accuses: nameOf('s2'), claimRole: 'doctor' });
  assert.deepEqual(r, { ok: true, response: { kind: 'speak', thought: 't', speech: 'I am the doc', accuses: 's2', claimRole: 'doctor' } });
});

test('speak parse: bad optional fields are dropped, not fatal', () => {
  const r = toolFor(ctx, speakReq).parse({ thought: 't', speech: 'hi', accuses: ctx.self.name, claimRole: 'wizard' });
  assert.deepEqual(r, { ok: true, response: { kind: 'speak', thought: 't', speech: 'hi' } });
});

test('parse rejects garbage with a readable error', () => {
  for (const junk of [null, 'hello', 42, [], {}, { thought: 1, speech: 'x' }, { thought: 't', speech: '   ' }]) {
    const r = toolFor(ctx, speakReq).parse(junk);
    assert.equal(r.ok, false, JSON.stringify(junk));
  }
  const r = toolFor(ctx, voteReq).parse({ thought: 't', target: 'Batman' });
  assert.ok(!r.ok && /target/.test(r.error));
});

test('one repair retry: invalid then valid → valid answer, error fed back', async () => {
  const p = new MockProvider((_r, n) => (n === 1 ? { thought: 't', target: 'Batman' } : { thought: 't2', target: nameOf('s3') }));
  const res = await new ModelController(p, { model: 'm' }).respond(ctx, voteReq);
  assert.deepEqual(res, { kind: 'choose', thought: 't2', target: 's3' });
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].user, /previous answer was invalid/);
});

test('still invalid after the repair retry → empty answer for the engine to fall back on', async () => {
  const p = new MockProvider({ thought: 'lol', target: 'Batman' });
  const res = await new ModelController(p, { model: 'm' }).respond(ctx, voteReq);
  assert.deepEqual(res, { kind: 'choose', thought: 'lol', target: '' });
  assert.equal(p.calls.length, 2);
});

test('I5: a game where every model answer is garbage still finishes, with fallbacks logged', async () => {
  const garbage = [null, 'not json', { speech: 42 }, { target: 'nobody' }, [], { thought: 't', speech: '' }];
  for (let seed = 1; seed <= 20; seed++) {
    const g = createGame(makeConfig({ seed }));
    const m = new Map<string, Responder>(g.seats.map((x, i) => [x.id, new ModelController(new MockProvider((_r, n) => garbage[(n + i) % garbage.length]), { model: 'm' })]));
    const end = await drive(g, m);
    assert.equal(end.status, 'finished');
    assert.ok(end.events.some((e) => e.type === 'fallback'));
  }
});

test('first request of a real game produces a valid tool for the mafia channel', () => {
  const req = nextRequest(s)!;
  const spec = toolFor(contextFor(s, req.seatId), req).spec;
  assert.equal(spec.name, 'speak');
  assert.match((spec.schema as any).properties.accuses.description, /kill/);
});
