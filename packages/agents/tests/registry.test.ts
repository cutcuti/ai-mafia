import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, drive, makeConfig } from '@ai-mafia/engine';
import type { Responder } from '@ai-mafia/engine';
import { createModelController } from '../src/factory.js';
import { MODELS } from '../src/models.config.js';
import { MockProvider } from '../src/providers/mock.js';
import { CostMeter, costUsd, getModel, parseRequestId, registryErrors, type AgentCall } from '../src/registry.js';

const answer = (r: { tool: { name: string; schema: any } }) =>
  r.tool.name === 'speak' ? { thought: 't', speech: 'hi' } : { thought: 't', target: r.tool.schema.properties.target.enum[0] };

test('registry is valid: unique ids, every enabled model priced', () => {
  assert.deepEqual(registryErrors(), []);
  assert.ok(MODELS.filter((m) => m.enabled).length >= 4, 'BRD G2 wants ≥4 models');
  assert.ok(new Set(MODELS.filter((m) => m.enabled).map((m) => m.provider)).size >= 2);
  assert.deepEqual(registryErrors([{ ...MODELS[0], pricing: { inputPerMTok: 0, outputPerMTok: 0 } }]), [`${MODELS[0].id}: enabled but unpriced`]);
});

test('Claude models that reject forced tools are flagged auto', () => {
  for (const id of ['claude-sonnet', 'claude-opus']) assert.equal(getModel(id).toolChoice, 'auto');
  assert.notEqual(getModel('claude-haiku').toolChoice, 'auto');
});

test('cost = tokens × per-MTok price', () => {
  assert.equal(costUsd({ pricing: { inputPerMTok: 2, outputPerMTok: 10 } }, { inputTokens: 1_000_000, outputTokens: 100_000 }), 3);
  assert.ok(Math.abs(costUsd(getModel('claude-haiku'), { inputTokens: 2000, outputTokens: 100 }) - 0.00025) < 1e-12);
});

test('getModel rejects unknown and disabled ids', () => {
  assert.throws(() => getModel('nope'), /unknown model/);
  assert.throws(() => getModel('x', [{ ...MODELS[0], id: 'x', enabled: false }]), /disabled/);
});

test('parseRequestId reads engine request ids', () => {
  assert.deepEqual(parseRequestId('game-7:42:s3:choose'), { gameId: 'game-7', seq: 42, seatId: 's3' });
});

test('every call is logged with tokens, cost, retries and the fallback flag', async () => {
  const calls: AgentCall[] = [];
  const mock = new MockProvider(answer, { inputTokens: 1000, outputTokens: 50 });
  const ctrl = createModelController('claude-sonnet', { onCall: (c) => calls.push(c), makeProvider: () => mock });
  const s = createGame(makeConfig({ seed: 1 }));
  await drive(s, new Map<string, Responder>(s.seats.map((x) => [x.id, ctrl])));
  assert.ok(calls.length > 10);
  const c = calls[0];
  assert.equal(c.modelId, 'claude-sonnet');
  assert.equal(c.promptVersion, 'p1');
  assert.equal(c.gameId, 'game-1');
  assert.ok(Math.abs(c.costUsd - (1000 * 2 + 50 * 10) / 1e6) < 1e-12);
  assert.equal(c.retries, 0);
  assert.equal(c.fallback, false);
  assert.equal(c.raw, undefined, 'raw is opt-in');
  assert.equal(mock.calls[0].toolChoice, 'auto');
  assert.equal(mock.calls[0].effort, 'low');
});

test('fallback flag set when the model never produces a valid answer; raw kept when asked', async () => {
  const calls: AgentCall[] = [];
  const ctrl = createModelController('gpt-nano', { onCall: (c) => calls.push(c), logRaw: true, makeProvider: () => new MockProvider('garbage') });
  const s = createGame(makeConfig({ seed: 1 }));
  const end = await drive(s, new Map<string, Responder>(s.seats.map((x) => [x.id, ctrl])));
  assert.equal(end.status, 'finished');
  assert.ok(calls.some((c) => c.fallback));
  assert.ok(calls.every((c) => c.raw !== undefined));
  // two attempts per request: the first is not a fallback, the last is
  assert.equal(calls.filter((c) => c.fallback).length * 2, calls.length);
});

test('CostMeter totals per model', () => {
  const m = new CostMeter();
  const base = { gameId: 'g', seq: 0, seatId: 's1', promptVersion: 'p1', latencyMs: 10, retries: 0, fallback: false };
  m.add({ ...base, modelId: 'a', inputTokens: 10, outputTokens: 1, costUsd: 0.5 });
  m.add({ ...base, modelId: 'a', inputTokens: 5, outputTokens: 1, costUsd: 0.25, fallback: true });
  m.add({ ...base, modelId: 'b', inputTokens: 1, outputTokens: 1, costUsd: 1 });
  assert.equal(m.totalUsd, 1.75);
  assert.deepEqual({ ...m.byModel().get('a'), latencies: undefined }, { calls: 2, inputTokens: 15, outputTokens: 2, costUsd: 0.75, fallbacks: 1, latencies: undefined });
});
