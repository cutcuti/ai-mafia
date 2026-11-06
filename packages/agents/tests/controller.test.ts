import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, contextFor, drive, makeConfig, nextRequest } from '@ai-mafia/engine';
import type { Responder } from '@ai-mafia/engine';
import { ModelController } from '../src/controller.js';
import { MockProvider } from '../src/providers/mock.js';
import { RandomController } from '../src/random.js';

test('ModelController sends names in the tool enum and maps the answer back to a seat id', async () => {
  const s = createGame(makeConfig({ seed: 4 }));
  const ctx = contextFor(s, 's1');
  const p = new MockProvider((req) => ({ thought: 'hmm', target: (req.tool.schema as any).properties.target.enum[1] }));
  const res = await new ModelController(p, { model: 'm' }).respond(ctx, { id: 'x', seatId: 's1', kind: 'choose', action: 'vote', options: ['s2', 's3'] });
  assert.deepEqual(res, { kind: 'choose', thought: 'hmm', target: 's3' });
  const names = (p.calls[0].tool.schema as any).properties.target.enum;
  assert.deepEqual(names, ['s2', 's3'].map((id) => s.seats.find((x) => x.id === id)!.name));
  assert.equal(p.calls[0].tool.name, 'vote');
});

test('ModelController speak returns thought + speech', async () => {
  const s = createGame(makeConfig({ seed: 4 }));
  const req = nextRequest(s)!;
  const p = new MockProvider({ thought: 'plan', speech: 'kill Omar?' });
  const res = await new ModelController(p, { model: 'm' }).respond(contextFor(s, req.seatId), req);
  assert.deepEqual(res, { kind: 'speak', thought: 'plan', speech: 'kill Omar?' });
});

test('a full game with mock-model seats and random seats completes', async () => {
  const s = createGame(makeConfig({ seed: 9 }));
  const m = new Map<string, Responder>(
    s.seats.map((x, i) => [
      x.id,
      i % 2 ? new RandomController(i) : new ModelController(new MockProvider((r) => (r.tool.name === 'speak' ? { thought: 't', speech: 'sus' } : { thought: 't', target: (r.tool.schema as any).properties.target.enum[0] })), { model: 'm' }),
    ]),
  );
  const end = await drive(s, m);
  assert.equal(end.status, 'finished');
});
