import { parseArgs } from 'node:util';
import { PRESET_NAMES, isPreset } from '@ai-mafia/engine';
import { getModel } from '@ai-mafia/agents';
import { supabaseFromEnv, uploadRecords, type BenchDb } from './db.ts';
import { buildReport, writeReport } from './report.ts';
import { RANDOM, defaultRunId, runBench, type BenchOptions, type Format } from './runner.ts';

const HELP = `pnpm bench -- --format <h2h|ffa|self> [options]
  h2h:  --a <model> --b <model>     A plays all mafia seats vs B on town, then swapped, same seeds
  ffa:  --models <m1,m2,...>        a random model per seat
  self: --model <model>             one model everywhere (baseline for the preset)
  --games <n>         total games (h2h: even; n/2 seeds × both directions)   [default 10]
  --preset <name>     ${PRESET_NAMES.join(' | ')}                              [default classic6]
  --seed-base <n>     first seed; runs are reproducible                       [default 1]
  --concurrency <n>   games in parallel                                       [default 4]
  --budget-usd <x>    hard spend cap: stop launching games, finish in-flight   [default none]
  --neutral           neutral personas (less variance)
  --run-id <id>       output folder name                                      [default derived from options]
  --out <dir>         games root                                              [default games]
  --reports <dir>     where reports/<runId>.md goes                           [default reports]
  --upload            upload every finished game of the run to Supabase (idempotent; needs
                      NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env)
  --dry-run           mock every model offline (no keys, no cost)
models: registry ids from packages/agents/src/models.config.ts, or "${RANDOM}"`;

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    format: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    models: { type: 'string' },
    model: { type: 'string' },
    games: { type: 'string', default: '10' },
    preset: { type: 'string', default: 'classic6' },
    'seed-base': { type: 'string', default: '1' },
    neutral: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    'budget-usd': { type: 'string' },
    'run-id': { type: 'string' },
    out: { type: 'string', default: 'games' },
    reports: { type: 'string', default: 'reports' },
    'dry-run': { type: 'boolean', default: false },
    upload: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function fail(msg: string): never {
  console.error(`error: ${msg}\n\n${HELP}`);
  process.exit(1);
}
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (!['h2h', 'ffa', 'self'].includes(values.format ?? '')) fail('--format must be h2h, ffa or self');
if (!isPreset(values.preset!)) fail(`unknown preset "${values.preset}"`);

const opts: BenchOptions = {
  format: values.format as Format,
  a: values.a,
  b: values.b,
  model: values.model,
  models: values.models?.split(',').map((s) => s.trim()),
  games: Number(values.games),
  preset: values.preset,
  seedBase: Number(values['seed-base']),
  personaMode: values.neutral ? 'neutral' : 'default',
  outDir: values.out,
  dryRun: values['dry-run'],
  logRaw: true, // BRD §7.7: raw request/response kept in bench mode
  concurrency: Number(values.concurrency),
  ...(values['budget-usd'] !== undefined ? { budgetUsd: Number(values['budget-usd']) } : {}),
  onGame: (r, done, total, spent) => {
    const cap = opts.budgetUsd !== undefined ? ` of $${opts.budgetUsd}` : '';
    process.stdout.write(`\r  ${done}/${total} games · $${spent.toFixed(4)}${cap} · last: ${r.outcome}   `);
  },
};
if (opts.budgetUsd !== undefined && !(opts.budgetUsd >= 0)) fail('--budget-usd must be a number ≥ 0');
opts.runId = values['run-id'] ?? defaultRunId(opts);

// fail fast on missing keys
const KEY_FOR = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', google: 'GOOGLE_API_KEY' } as const;
const ids = [opts.a, opts.b, opts.model, ...(opts.models ?? [])].filter((x): x is string => !!x && x !== RANDOM);
try {
  if (!opts.dryRun) {
    const missing = [...new Set(ids.map((id) => KEY_FOR[getModel(id).provider]))].filter((k) => !process.env[k]);
    if (missing.length) fail(`missing ${missing.join(', ')}: add to .env, or use --dry-run`);
  }
} catch (e) {
  fail((e as Error).message);
}

let db: BenchDb | undefined;
if (values.upload) {
  try {
    db = supabaseFromEnv();
  } catch (e) {
    fail((e as Error).message);
  }
}

let result;
try {
  result = await runBench(opts);
} catch (e) {
  fail((e as Error).message);
}
process.stdout.write('\n');
if (result.skippedForBudget) console.log(`budget reached: ${result.skippedForBudget} of ${result.planned} games not launched`);
const report = buildReport({
  runId: result.runId,
  options: opts,
  records: result.records,
  planned: result.planned,
  skippedForBudget: result.skippedForBudget,
  resumed: result.resumed,
  generatedAt: new Date().toISOString(),
});
if (result.resumed) console.log(`resumed: ${result.resumed} games already on disk were kept; this invocation spent $${result.spentUsd.toFixed(4)}`);
const file = writeReport(values.reports!, result.runId, report.markdown);
console.log(`\nrun ${result.runId}`);
for (const line of report.summary) console.log(line);
console.log(`\ngames  → ${opts.outDir}/${result.runId}/`);
console.log(`report → ${file}`);

if (db) {
  const up = await uploadRecords(db, result.records, (done, total) => process.stdout.write(`\r  uploading ${done}/${total}   `));
  process.stdout.write('\n');
  console.log(`uploaded ${up.uploaded}/${result.records.length} games to Supabase${up.failed.length ? ` — ${up.failed.length} failed:` : ''}`);
  for (const f of up.failed) console.error(`  ${f.gameId}: ${f.error}`);
  if (up.failed.length) process.exit(2);
}
