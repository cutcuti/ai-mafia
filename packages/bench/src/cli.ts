import { parseArgs } from 'node:util';
import { PRESET_NAMES, isPreset } from '@ai-mafia/engine';
import { getModel } from '@ai-mafia/agents';
import { RANDOM, defaultRunId, runBench, type BenchOptions, type Format } from './runner.js';

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
    'dry-run': { type: 'boolean', default: false },
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

let result;
try {
  result = await runBench(opts);
} catch (e) {
  fail((e as Error).message);
}
process.stdout.write('\n');
if (result.skippedForBudget) console.log(`budget reached: ${result.skippedForBudget} of ${result.planned} games not launched`);
const tally = { town: 0, mafia: 0, draw: 0 };
for (const r of result.records) tally[r.outcome]++;
const cost = result.spentUsd;
console.log(`run ${result.runId}: ${result.records.length} games · town ${tally.town} · mafia ${tally.mafia} · draw ${tally.draw} · $${cost.toFixed(4)}${opts.dryRun ? ' (simulated)' : ''}`);
console.log(`games → ${opts.outDir}/${result.runId}/`);
