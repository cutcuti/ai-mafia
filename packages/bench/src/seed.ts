import { parseArgs } from 'node:util';
import { getModel } from '@ai-mafia/agents';
import { rebuildRatingsInDb, supabaseFromEnv, uploadRecords, type BenchDb } from './db.js';
import { RANDOM, runBench, type BenchOptions, type BenchResult } from './runner.js';

export interface SeedOptions {
  model: string;
  games: number;
  dryRun?: boolean;
  outDir?: string;
  seedBase?: number;
}

/** Play a few demo games (self-play, run id "demo"), upload them, and refresh ratings. */
export async function seedDemo(db: BenchDb, o: SeedOptions): Promise<{ run: BenchResult; uploaded: number; ratingRows: number }> {
  const opts: BenchOptions = {
    format: 'self',
    model: o.model,
    games: o.games,
    preset: 'classic6',
    seedBase: o.seedBase ?? 1,
    runId: o.dryRun ? 'demo-dry' : 'demo',
    outDir: o.outDir ?? 'games',
    dryRun: o.dryRun,
    logRaw: true,
  };
  const run = await runBench(opts);
  const up = await uploadRecords(db, run.records);
  if (up.failed.length) throw new Error(`seed upload failed: ${up.failed.map((f) => `${f.gameId}: ${f.error}`).join('; ')}`);
  const { rows } = await rebuildRatingsInDb(db);
  return { run, uploaded: up.uploaded, ratingRows: rows.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      model: { type: 'string', default: 'claude-haiku' },
      games: { type: 'string', default: '3' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const fail = (m: string): never => {
    console.error(`error: ${m}\nusage: pnpm db:seed [-- --model claude-haiku --games 3 --dry-run]`);
    process.exit(1);
  };
  const model = values.model!;
  const dryRun = values['dry-run']!;
  if (model !== RANDOM && !dryRun) {
    const key = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', google: 'GOOGLE_API_KEY' }[getModel(model).provider];
    if (!process.env[key]) fail(`missing ${key} for real demo games (or pass --dry-run for mocked ones)`);
  }
  let db: BenchDb;
  try {
    db = supabaseFromEnv();
  } catch (e) {
    fail((e as Error).message);
  }
  const res = await seedDemo(db!, { model, games: Number(values.games), dryRun });
  const cost = res.run.records.reduce((a, r) => a + r.costUsd, 0);
  console.log(`seeded ${res.uploaded} demo games (${model}${dryRun ? ', mocked' : ''}, $${cost.toFixed(4)}) · ${res.ratingRows} rating rows`);
}
