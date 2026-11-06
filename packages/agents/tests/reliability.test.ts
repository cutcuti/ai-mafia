import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Limiter, ReliableProvider, TimeoutError, isRetryable, limiterFor } from '../src/reliability.js';
import type { CompletionRequest, CompletionResult, Provider } from '../src/providers/types.js';

const req: CompletionRequest = { model: 'm', system: 's', user: 'u', tool: { name: 't', description: '', schema: {} }, maxOutputTokens: 10 };
const ok: CompletionResult = { toolInput: { a: 1 }, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, raw: null };

/** Fails with the given errors in order, then succeeds. */
function flaky(errors: unknown[]): Provider & { calls: number } {
  return {
    id: 'flaky',
    calls: 0,
    async complete() {
      const e = errors[this.calls++];
      if (e) throw e;
      return ok;
    },
  };
}

const status = (s: number) => Object.assign(new Error(`HTTP ${s}`), { status: s });
const noSleep = { sleep: async () => {}, random: () => 0.5 };

test('classifies retryable errors', () => {
  for (const e of [status(429), status(500), status(503), status(408), new TimeoutError(1), Object.assign(new Error(), { name: 'APIConnectionError' })]) assert.ok(isRetryable(e));
  for (const e of [status(400), status(401), status(404), new Error('bad schema'), null]) assert.ok(!isRetryable(e));
});

test('retries 429/5xx up to 2 times and reports the retry count', async () => {
  const p = flaky([status(429), status(502)]);
  const r = await new ReliableProvider(p, noSleep).complete(req);
  assert.equal(r.retries, 2);
  assert.equal(p.calls, 3);
});

test('gives up after the retry budget and rethrows', async () => {
  const p = flaky([status(500), status(500), status(500), status(500)]);
  await assert.rejects(new ReliableProvider(p, noSleep).complete(req), /HTTP 500/);
  assert.equal(p.calls, 3);
});

test('does not retry client errors', async () => {
  const p = flaky([status(400)]);
  await assert.rejects(new ReliableProvider(p, noSleep).complete(req), /HTTP 400/);
  assert.equal(p.calls, 1);
});

test('exponential backoff with jitter', async () => {
  const delays: number[] = [];
  const p = flaky([status(429), status(429)]);
  await new ReliableProvider(p, { baseDelayMs: 100, sleep: async (ms) => void delays.push(ms), random: () => 1 }).complete(req);
  assert.deepEqual(delays, [100, 200]);
  const d2: number[] = [];
  await new ReliableProvider(flaky([status(429)]), { baseDelayMs: 100, sleep: async (ms) => void d2.push(ms), random: () => 0 }).complete(req);
  assert.deepEqual(d2, [50]);
});

test('times out a hung call, aborts it, and retries', async () => {
  let aborted = 0;
  let calls = 0;
  const hang: Provider = {
    id: 'hang',
    complete: (r) =>
      calls++ === 0
        ? new Promise((_, rej) => r.signal!.addEventListener('abort', () => (aborted++, rej(new Error('aborted')))))
        : Promise.resolve(ok),
  };
  const r = await new ReliableProvider(hang, { timeoutMs: 10, ...noSleep }).complete(req);
  assert.equal(r.retries, 1);
  assert.equal(aborted, 1);
});

test('limiter caps concurrency at max', async () => {
  const lim = new Limiter(2);
  let peak = 0;
  const slow: Provider = {
    id: 'slow',
    async complete() {
      peak = Math.max(peak, lim.inFlight);
      await new Promise((r) => setTimeout(r, 5));
      return ok;
    },
  };
  const p = new ReliableProvider(slow, { limiter: lim });
  await Promise.all(Array.from({ length: 7 }, () => p.complete(req)));
  assert.equal(peak, 2);
  assert.equal(lim.inFlight, 0);
});

test('limiterFor shares one limiter per provider id', () => {
  assert.equal(limiterFor('x'), limiterFor('x'));
  assert.notEqual(limiterFor('x'), limiterFor('y'));
});
