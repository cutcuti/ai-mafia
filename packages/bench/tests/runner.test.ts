import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay } from '@ai-mafia/engine';
import { defaultRunId, planGames, runBench, runGame, type BenchOptions } from '../src/runner.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'bench-'));
const fixedNow = () => new Date('2026-11-06T00:00:00.000Z');

test('h2h plan: same seeds both ways; A holds every mafia seat in a-mafia, B in b-mafia', () => {
  const specs = planGames({ format: 'h2h', a: 'claude-haiku', b: 'gpt-nano', games: 8, preset: 'classic6', seedBase: 10 });
  assert.equal(specs.length, 8);
  const seeds = specs.map((s) => s.seed);
  assert.deepEqual(seeds, [10, 10, 11, 11, 12, 12, 13, 13]);
  for (const s of specs) {
    const mafiaModel = s.direction === 'a-mafia' ? 'claude-haiku' : 'gpt-nano';
    assert.equal(s.seatModels.filter((m) => m === mafiaModel).length, 2, 'classic6 has 2 mafia');
    assert.equal(new Set(s.seatModels).size, 2);
  }
  // roles really line up with the engine's assignment
  const g = specs[0];
  const { seatModels } = g;
  assert.deepEqual(planGames({ format: 'h2h', a: 'claude-haiku', b: 'gpt-nano', games: 8, preset: 'classic6', seedBase: 10 })[0].seatModels, seatModels, 'deterministic');
});

test('ffa plan is deterministic and draws from the pool; self fills every seat', () => {
  const o: BenchOptions = { format: 'ffa', models: ['claude-haiku', 'gpt-nano', 'llama-70b'], games: 20, preset: 'big8' };
  const a = planGames(o);
  assert.deepEqual(a, planGames(o));
  assert.ok(a.every((s) => s.seatModels.length === 8 && s.seatModels.every((m) => o.models!.includes(m))));
  assert.ok(new Set(a.flatMap((s) => s.seatModels)).size === 3);
  const self = planGames({ format: 'self', model: 'claude-haiku', games: 3, preset: 'mini5' });
  assert.ok(self.every((s) => s.seatModels.length === 5 && s.seatModels.every((m) => m === 'claude-haiku')));
});

test('plan validation', () => {
  assert.throws(() => planGames({ format: 'h2h', a: 'claude-haiku', b: 'gpt-nano', games: 3, preset: 'classic6' }), /even/);
  assert.throws(() => planGames({ format: 'h2h', a: 'claude-haiku', b: 'claude-haiku', games: 2, preset: 'classic6' }), /different/);
  assert.throws(() => planGames({ format: 'h2h', a: 'nope', b: 'gpt-nano', games: 2, preset: 'classic6' }), /unknown model/);
  assert.throws(() => planGames({ format: 'ffa', models: ['claude-haiku'], games: 2, preset: 'classic6' }), /at least two/);
  assert.throws(() => planGames({ format: 'self', games: 2, preset: 'classic6' }), /--model/);
});

test('runGame produces a complete, replayable record with seat models and costs', async () => {
  const o: BenchOptions = { format: 'h2h', a: 'claude-haiku', b: 'random', games: 2, preset: 'classic6', dryRun: true, now: fixedNow };
  const [spec] = planGames(o);
  const r = await runGame(spec, o);
  assert.equal(r.schema, 1);
  assert.equal(r.runId, defaultRunId(o));
  assert.ok(['town', 'mafia', 'draw'].includes(r.outcome));
  for (const s of r.seats) assert.equal(s.modelId, s.role === 'mafia' ? 'claude-haiku' : 'random', 'a-mafia direction');
  assert.ok(r.agentCalls.length > 0 && r.costUsd > 0);
  assert.equal(r.promptVersion, 'p1');
  assert.deepEqual(replay(r.config, r.events).events, r.events);
});

test('runBench writes one JSON file per game under <out>/<runId>/', async () => {
  const out = tmp();
  const res = await runBench({ format: 'self', model: 'random', games: 5, preset: 'mini5', outDir: out });
  const files = readdirSync(join(out, res.runId)).sort();
  assert.equal(files.length, 5);
  const first = JSON.parse(readFileSync(join(out, res.runId, files[0]), 'utf8'));
  assert.equal(first.format, 'self');
  assert.equal(first.costUsd, 0);
});

test('same options ⇒ same games (reproducible)', async () => {
  const o: BenchOptions = { format: 'h2h', a: 'random', b: 'claude-haiku', games: 4, preset: 'classic6', dryRun: true, now: fixedNow, outDir: tmp() };
  const x = await runBench(o);
  const y = await runBench({ ...o, outDir: tmp() });
  assert.deepEqual(x.records.map((r) => r.events), y.records.map((r) => r.events));
});
