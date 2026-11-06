import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planGames, runBench, type BenchOptions } from '../src/runner.ts';

const now = () => new Date('2026-11-06T00:00:00.000Z');
const opts = (outDir: string, extra: Partial<BenchOptions> = {}): BenchOptions => ({
  format: 'h2h', a: 'claude-haiku', b: 'random', games: 10, preset: 'classic6', dryRun: true, outDir, now, ...extra,
});

test('rerunning the same command skips finished games and replays nothing', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  const first = await runBench(opts(out));
  const dir = join(out, first.runId);
  const mtimes = new Map(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]));
  const second = await runBench(opts(out));
  assert.equal(second.resumed, 10);
  assert.equal(second.spentUsd, 0, 'nothing re-played');
  assert.deepEqual(second.records, first.records);
  for (const f of readdirSync(dir)) assert.equal(statSync(join(dir, f)).mtimeMs, mtimes.get(f), `${f} rewritten`);
});

test('an interrupted run (budget) finishes the rest on the next invocation; results match one uninterrupted run', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  const partial = await runBench(opts(out, { concurrency: 1, budgetUsd: 0.02 }));
  assert.ok(partial.records.length > 0 && partial.records.length < 10, `ran ${partial.records.length}`);
  const rest = await runBench(opts(out));
  assert.equal(rest.resumed, partial.records.length);
  assert.equal(rest.records.length, 10);
  const clean = await runBench(opts(mkdtempSync(join(tmpdir(), 'bench-'))));
  assert.deepEqual(rest.records.map((r) => r.events), clean.records.map((r) => r.events));
});

test('extending a run (--games up) only plays the new seeds', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  const runId = 'grow';
  await runBench(opts(out, { games: 4, runId }));
  const more = await runBench(opts(out, { games: 8, runId }));
  assert.equal(more.resumed, 4);
  assert.equal(more.records.length, 8);
});

test('corrupt or partial files are replayed, not trusted', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  const first = await runBench(opts(out, { games: 4 }));
  const spec = planGames(opts(out, { games: 4 }))[0];
  writeFileSync(join(out, first.runId, `${spec.gameId}.json`), '{"schema":1,"gameId":"trunc');
  const again = await runBench(opts(out, { games: 4 }));
  assert.equal(again.resumed, 3);
  assert.equal(again.records.length, 4);
  assert.ok(!readdirSync(join(out, first.runId)).some((f) => f.endsWith('.tmp')), 'no temp files left');
});

test('reusing a run id with different settings is refused', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bench-'));
  await runBench(opts(out, { games: 2, runId: 'same' }));
  await assert.rejects(runBench(opts(out, { games: 2, runId: 'same', b: 'gpt-nano' })), /different settings/);
});
