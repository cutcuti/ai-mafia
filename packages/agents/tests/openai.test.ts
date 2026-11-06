import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OpenAICompatProvider, OPENROUTER_BASE_URL, openrouterProvider, type OpenAILike } from '../src/providers/openai.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/openai-tool-call.json', import.meta.url), 'utf8'));
const tool = { name: 'speak', description: 'say it', schema: { type: 'object', properties: { thought: { type: 'string' } } } };
const base = { model: 'gpt-mini', system: 'S', user: 'U', tool, maxOutputTokens: 300 };

function fake(response: unknown) {
  const calls: { body: any; opts: any }[] = [];
  const client: OpenAILike = {
    chat: { completions: { create: (async (body: unknown, opts: unknown) => (calls.push({ body, opts }), response)) as any } },
  };
  return { client, calls };
}

test('tool mode: forces the function and parses its JSON arguments', async () => {
  const { client, calls } = fake(fixture);
  const r = await new OpenAICompatProvider({ id: 'openai', client }).complete(base);
  assert.deepEqual(r.toolInput, { thought: 'Kai is pushing too hard.', speech: 'Kai, why so loud about Noor?', accuses: 'Kai' });
  assert.deepEqual(r.usage, { inputTokens: 1520, outputTokens: 37 });
  const b = calls[0].body;
  assert.deepEqual(b.tool_choice, { type: 'function', function: { name: 'speak' } });
  assert.equal(b.tools[0].function.parameters, tool.schema);
  assert.deepEqual(b.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  assert.equal(b.max_completion_tokens, 300);
});

test('json mode: schema goes in the system prompt, JSON content is parsed (fences tolerated)', async () => {
  const { client, calls } = fake({ choices: [{ message: { role: 'assistant', content: '```json\n{"thought":"t","speech":"hi"}\n```' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
  const r = await new OpenAICompatProvider({ id: 'openrouter', client, toolMode: 'json', maxTokensParam: 'max_tokens' }).complete(base);
  assert.deepEqual(r.toolInput, { thought: 't', speech: 'hi' });
  const b = calls[0].body;
  assert.deepEqual(b.response_format, { type: 'json_object' });
  assert.equal(b.tools, undefined);
  assert.match(b.messages[0].content, /JSON Schema/);
  assert.equal(b.max_tokens, 300);
});

test('malformed arguments / no choices → undefined toolInput, never a throw', async () => {
  const bad = structuredClone(fixture);
  bad.choices[0].message.tool_calls[0].function.arguments = '{not json';
  for (const res of [bad, { choices: [] }, {}]) {
    const { client } = fake(res);
    const r = await new OpenAICompatProvider({ id: 'openai', client }).complete(base);
    assert.equal(r.toolInput, undefined);
  }
});

test('openrouter preset points at the OpenRouter base URL', () => {
  const p = openrouterProvider({ apiKey: 'test-key' });
  assert.equal(p.id, 'openrouter');
  assert.equal(OPENROUTER_BASE_URL, 'https://openrouter.ai/api/v1');
});
