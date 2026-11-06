import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Responder } from '@ai-mafia/engine';
import { RandomController } from '@ai-mafia/agents';
import type { AgentCall } from '@ai-mafia/agents';
import { runBench, type BenchOptions } from '../src/runner.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'bench-'));

/** Random play that reports a fixed cost per call and yields to the event loop (so games really interleave). */
function costly(costPerCall: number, track?: { live: Set<string>; peak: number }) {
  return (modelId: string, seat: number, seed: number, onCall: (c: AgentCall) => void): Responder => {
    const inner = new RandomController(seed * 1000 + seat);
    return {
      async respond(ctx, req) {
        const g = req.id.split(':')[0];
        track?.live.add(g);
        if (track) track.peak = Math.max(track.peak, track.live.size);
        await new Promise((r) => setTimeout(r, 0));
        onCall({ gameId: g, seq: 0, seatId: req.seatId, modelId, promptVersion: 'p1', inputTokens: 1, outputTokens: 1, costUsd: costPerCall, latencyMs: 0, retries: 0, fallback: false });
        return inner.respond(ctx, req);
      },
    };
  };
}

const base: BenchOptions = { format: 'self', model: 'random', games: 12, preset: 'classic6' };

test('runs games in parallel up to the concurrency limit', async () => {
  const track = { live: new Set<string>(), peak: 0 };
  const res = await runBench({ ...base, outDir: tmp(), concurrency: 3, makeResponder: costly(0, track), onGame: (r) => void track.live.delete(r.gameId) });
  assert.equal(res.records.length, 12);
  assert.ok(track.peak >= 2 && track.peak <= 3, `peak ${track.peak}`);
});

test('parallel results are identical to sequential (games are independent)', async () => {
  const now = () => new Date('2026-11-06T00:00:00.000Z');
  const seq = await runBench({ ...base, outDir: tmp(), concurrency: 1, now });
  const par = await runBench({ ...base, outDir: tmp(), concurrency: 6, now });
  assert.deepEqual(par.records.map((r) => r.events), seq.records.map((r) => r.events));
});

test('hard budget: stops launching, finishes in-flight games, never far over budget', async () => {
  const out = tmp();
  const costPerCall = 0.001;
  const res = await runBench({ ...base, games: 40, outDir: out, concurrency: 4, budgetUsd: 0.2, makeResponder: costly(costPerCall) });
  assert.ok(res.records.length > 0 && res.records.length < 40, `ran ${res.records.length}`);
  assert.equal(res.skippedForBudget, 40 - res.records.length);
  // every launched game finished and was written
  assert.equal(readdirSync(join(out, res.runId)).length, res.records.length);
  for (const r of res.records) assert.ok(['town', 'mafia', 'draw'].includes(r.outcome));
  // overshoot is bounded by the games in flight when the stop triggered
  const maxGame = Math.max(...res.records.map((r) => r.costUsd));
  assert.ok(res.spentUsd <= 0.2 + 4 * maxGame, `spent ${res.spentUsd}`);
  assert.ok(Math.abs(res.spentUsd - res.records.reduce((a, r) => a + r.costUsd, 0)) < 1e-9);
});

test('budget guard holds from the very first wave (registry-price prior), even with high concurrency', async () => {
  // dry-run haiku vs sonnet: real registry prices, mocked calls
  const o: BenchOptions = { format: 'h2h', a: 'claude-haiku', b: 'claude-sonnet', games: 40, preset: 'classic6', dryRun: true, concurrency: 8, outDir: tmp() };
  const unlimited = await runBench({ ...o, games: 4, outDir: tmp() });
  const perGame = unlimited.spentUsd / 4;
  const budget = perGame * 5.5;
  const res = await runBench({ ...o, budgetUsd: budget });
  assert.ok(res.records.length >= 3 && res.records.length <= 6, `ran ${res.records.length}`);
  assert.ok(res.spentUsd <= budget * 1.25, `spent ${res.spentUsd} of ${budget}`);
});

test('estimateGameCostUsd: random seats are free, priced seats scale with registry prices', async () => {
  const { estimateGameCostUsd } = await import('../src/runner.ts');
  assert.equal(estimateGameCostUsd({ gameId: 'g', seed: 1, format: 'self', preset: 'classic6', seatModels: Array(6).fill('random') }), 0);
  const haiku = estimateGameCostUsd({ gameId: 'g', seed: 1, format: 'self', preset: 'classic6', seatModels: Array(6).fill('claude-haiku') });
  const sonnet = estimateGameCostUsd({ gameId: 'g', seed: 1, format: 'self', preset: 'classic6', seatModels: Array(6).fill('claude-sonnet') });
  assert.ok(haiku > 0 && Math.abs(sonnet / haiku - 20) < 1e-9);
});

test('a pessimistic prior never blocks the run: one probe game measures real cost, then the rest fit', async () => {
  // registry prior for sonnet is far above the dry-run's mocked usage
  const o: BenchOptions = { format: 'self', model: 'claude-sonnet', games: 10, preset: 'classic6', dryRun: true, concurrency: 4, outDir: tmp() };
  const one = await runBench({ ...o, games: 1, outDir: tmp() });
  const res = await runBench({ ...o, budgetUsd: one.spentUsd * 20 });
  assert.equal(res.records.length, 10);
});

test('budget smaller than one game: only the probe runs', async () => {
  // sequential so the fake costs (attached to free "random" seats) are seen before the next launch
  const res = await runBench({ ...base, outDir: tmp(), budgetUsd: 0.001, concurrency: 1, makeResponder: costly(0.01) });
  assert.equal(res.records.length, 1);
  assert.equal(res.skippedForBudget, 11);
});

test('zero budget runs nothing', async () => {
  const res = await runBench({ ...base, outDir: tmp(), budgetUsd: 0, makeResponder: costly(0.01) });
  // spent (0) ≥ budget (0) → stop before the first launch
  assert.equal(res.records.length, 0);
  assert.equal(res.skippedForBudget, 12);
});
