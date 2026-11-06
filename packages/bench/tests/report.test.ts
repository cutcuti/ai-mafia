import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildReport, writeReport } from '../src/report.js';
import { runBench, type BenchOptions } from '../src/runner.js';
import { wilson } from '../src/stats.js';

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('wilson: textbook values', () => {
  // 50/100 → [0.4038, 0.5962]
  const a = wilson(50, 100);
  close(a.p, 0.5);
  close(a.lo, 0.4038);
  close(a.hi, 0.5962);
  // 0/10 → [0, 0.2775] — never a degenerate [0,0]
  const b = wilson(0, 10);
  assert.equal(b.lo, 0);
  close(b.hi, 0.2775);
  // 10/10 → [0.7225, 1]
  const c = wilson(10, 10);
  close(c.lo, 0.7225);
  assert.equal(c.hi, 1);
  assert.ok(Number.isNaN(wilson(0, 0).p));
});

test('wilson: interval narrows with n and always contains p', () => {
  for (const n of [5, 20, 100, 1000]) {
    const w = wilson(Math.round(n * 0.3), n);
    assert.ok(w.lo <= w.p && w.p <= w.hi);
  }
  assert.ok(wilson(300, 1000).hi - wilson(300, 1000).lo < wilson(3, 10).hi - wilson(3, 10).lo);
});

async function h2h(games = 20) {
  const o: BenchOptions = { format: 'h2h', a: 'claude-haiku', b: 'random', games, preset: 'classic6', dryRun: true, outDir: mkdtempSync(join(tmpdir(), 'bench-')) };
  const res = await runBench(o);
  return { o, res, report: buildReport({ runId: res.runId, options: o, records: res.records, planned: res.planned, skippedForBudget: res.skippedForBudget, generatedAt: '2026-11-06' }) };
}

test('h2h report: all sections, both directions, CIs, ratings, cost, dry-run warning', async () => {
  const { report, res } = await h2h();
  const md = report.markdown;
  for (const h of ['## Outcomes', '## Head to head', '## Win rates by role', '## Behaviour', '## Ratings', '## Cost & reliability']) assert.ok(md.includes(h), h);
  assert.match(md, /DRY RUN/);
  assert.match(md, /\| claude-haiku \| random \| \d+\.\d% \[\d+\.\d%–\d+\.\d%\] \(n=10\)/);
  assert.match(md, /\| random \| claude-haiku \|/);
  assert.match(md, /provisional \(<50\/role\)/);
  assert.match(md, /\| overall \| claude-haiku \|/);
  assert.match(md, /\$0\.\d{4}/);
  assert.match(md, new RegExp(`${res.records.length} of ${res.planned} planned games`));
  assert.ok(report.summary.length === 3);
  assert.match(report.summary[1], /ordinal/);
});

test('report is deterministic for the same games (pure)', async () => {
  const { o, res } = await h2h(8);
  const args = { runId: res.runId, options: o, records: res.records, planned: res.planned, skippedForBudget: 0, generatedAt: 'x' };
  assert.equal(buildReport(args).markdown, buildReport(args).markdown);
});

test('self-play report labels the baseline; budget skips are reported', async () => {
  const o: BenchOptions = { format: 'self', model: 'random', games: 6, preset: 'mini5', outDir: mkdtempSync(join(tmpdir(), 'bench-')), budgetUsd: 1 };
  const res = await runBench(o);
  const md = buildReport({ runId: res.runId, options: o, records: res.records, planned: 10, skippedForBudget: 4, generatedAt: 'x' }).markdown;
  assert.match(md, /self-play baseline/);
  assert.match(md, /4 skipped: budget \$1\.0000 reached/);
  assert.ok(!md.includes('## Head to head'));
});

test('writeReport writes reports/<runId>.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reports-'));
  const file = writeReport(dir, 'run-x', '# hi');
  assert.equal(file, join(dir, 'run-x.md'));
  assert.equal(readFileSync(file, 'utf8'), '# hi');
});
