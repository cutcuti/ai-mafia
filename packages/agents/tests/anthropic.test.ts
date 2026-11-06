import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { createGame, contextFor, makeConfig } from '@ai-mafia/engine';
import { ModelController } from '../src/controller.ts';
import { AnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/anthropic-tool-use.json', import.meta.url), 'utf8'));

function fake(response: unknown) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; opts: unknown }[] = [];
  const client = {
    messages: {
      async create(body: Anthropic.MessageCreateParamsNonStreaming, opts: unknown) {
        calls.push({ body, opts });
        return response;
      },
    },
  } as unknown as AnthropicLike;
  return { client, calls };
}

const tool = { name: 'vote', description: 'd', schema: { type: 'object', properties: {} } };

test('forces the tool, passes system/user, and returns tool input + usage + latency', async () => {
  const { client, calls } = fake(fixture);
  const ctrl = new AbortController();
  const r = await new AnthropicProvider(client).complete({ model: 'claude-haiku-5-5', system: 'S', user: 'U', tool, maxOutputTokens: 300, signal: ctrl.signal });
  assert.deepEqual(r.toolInput, { thought: 'Omar flipped his story twice. Voting him.', target: 'Omar' });
  assert.deepEqual(r.usage, { inputTokens: 1834, outputTokens: 41 });
  assert.ok(r.latencyMs >= 0);
  const { body, opts } = calls[0];
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'vote' });
  assert.equal(body.system, 'S');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'U' }]);
  assert.equal(body.max_tokens, 300);
  assert.equal((opts as { signal: AbortSignal }).signal, ctrl.signal);
});

test('auto mode (models that reject forced tools): tool_choice auto, instruction added, effort passed', async () => {
  const { client, calls } = fake({ ...fixture, content: [{ type: 'thinking', thinking: '', signature: 'x' }, ...fixture.content] });
  const r = await new AnthropicProvider(client).complete({ model: 'claude-sonnet-5-5', system: 'S', user: 'U', tool, maxOutputTokens: 4000, toolChoice: 'auto', effort: 'low' });
  assert.equal((r.toolInput as { target: string }).target, 'Omar', 'tool_use found after a thinking block');
  const body = calls[0].body as Anthropic.MessageCreateParamsNonStreaming & { output_config?: unknown };
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.match(String(body.system), /calling the "vote" tool/);
  assert.deepEqual(body.output_config, { effort: 'low' });
});

test('no tool_use block → undefined toolInput (controller validates and repairs)', async () => {
  const { client } = fake({ ...fixture, content: [{ type: 'text', text: 'I refuse to lie.' }] });
  const r = await new AnthropicProvider(client).complete({ model: 'm', system: 'S', user: 'U', tool, maxOutputTokens: 300 });
  assert.equal(r.toolInput, undefined);
});

test('end to end with ModelController: fixture name maps to a seat id', async () => {
  let seed = 1;
  while (!createGame(makeConfig({ seed })).seats.some((x) => x.name === 'Omar')) seed++;
  const s = createGame(makeConfig({ seed }));
  const omar = s.seats.find((x) => x.name === 'Omar')!;
  const me = s.seats.find((x) => x.id !== omar.id)!;
  const { client } = fake(fixture);
  const res = await new ModelController(new AnthropicProvider(client), { model: 'claude-haiku-5-5' }).respond(contextFor(s, me.id), {
    id: 'x',
    seatId: me.id,
    kind: 'choose',
    action: 'vote',
    options: [omar.id],
  });
  assert.deepEqual(res, { kind: 'choose', thought: 'Omar flipped his story twice. Voting him.', target: omar.id });
});
