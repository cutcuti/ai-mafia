import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { createGame, contextFor, makeConfig, nextRequest } from '@ai-mafia/engine';
import { ClaudeController } from '../src/claude.js';

/** Fake SDK client: records the request and answers with a canned tool call. No network. */
function fakeClient(answer: (tool: Anthropic.Tool) => Record<string, unknown>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      async create(p: Anthropic.MessageCreateParamsNonStreaming) {
        calls.push(p);
        const tool = p.tools![0] as Anthropic.Tool;
        return { content: [{ type: 'tool_use', id: 't', name: tool.name, input: answer(tool) }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

test('choose: options are shown as names and the answer is mapped back to a seat id', async () => {
  const s = createGame(makeConfig({ seed: 4 }));
  // skip to the first choose request by answering speaks
  const req = nextRequest(s)!;
  const ctx = contextFor(s, req.seatId);
  const choose = { id: 'x', seatId: req.seatId, kind: 'choose' as const, action: 'kill' as const, options: ['s1', 's2'] };
  const n1 = ctx.roster.find((r) => r.seatId === 's1')!.name;
  const { client, calls } = fakeClient((tool) => ({ thought: 'hmm', target: (tool.input_schema.properties as any).target.enum[0] }));
  const res = await new ClaudeController('m', client).respond(ctx, choose);
  assert.deepEqual(res, { kind: 'choose', thought: 'hmm', target: 's1' });
  assert.equal(((calls[0].tools![0] as Anthropic.Tool).input_schema.properties as any).target.enum[0], n1);
  assert.deepEqual(calls[0].tool_choice, { type: 'tool', name: 'kill' });
});

test('choose: an unknown name maps to an invalid target (engine falls back)', async () => {
  const s = createGame(makeConfig({ seed: 4 }));
  const ctx = contextFor(s, 's1');
  const { client } = fakeClient(() => ({ thought: '', target: 'Batman' }));
  const res = await new ClaudeController('m', client).respond(ctx, { id: 'x', seatId: 's1', kind: 'choose', action: 'vote', options: ['s2'] });
  assert.ok(res.kind === 'choose' && res.target === '');
});

test('prompt never contains another seat’s private info', async () => {
  const s = createGame(makeConfig({ seed: 4 }));
  const town = s.seats.find((x) => x.role !== 'mafia')!;
  const { client, calls } = fakeClient(() => ({ thought: 't', speech: 'hi' }));
  await new ClaudeController('m', client).respond(contextFor(s, town.id), { id: 'x', seatId: town.id, kind: 'speak', channel: 'public', maxChars: 280 });
  const text = JSON.stringify(calls[0]);
  assert.doesNotMatch(text, /mafia team is/i);
  for (const o of s.seats.filter((x) => x.id !== town.id)) assert.ok(!text.includes(`You are ${o.name}.`));
});
