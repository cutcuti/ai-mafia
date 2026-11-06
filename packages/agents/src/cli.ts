import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PRESETS, PRESET_NAMES, createGame, drive, isPreset, makeConfig, totalSeats } from '@ai-mafia/engine';
import type { Controller, GameEvent, GameState, Responder } from '@ai-mafia/engine';
import { dryRunProvider } from './dryrun.js';
import { createModelController } from './factory.js';
import { MODELS } from './models.config.js';
import { PROMPT_VERSION } from './prompts.js';
import { RandomController } from './random.js';
import { CostMeter, getModel } from './registry.js';

const HELP = `pnpm game -- [options]
  --agents <list>     one id for every seat, or a comma list per seat: random | ${MODELS.filter((m) => m.enabled)
    .map((m) => m.id)
    .join(' | ')}
                      ("claude" = claude-haiku). e.g. --agents claude-haiku,gpt-nano,llama-70b,random,random,claude-sonnet
  --preset <name>     ${PRESET_NAMES.join(' | ')} (default classic6)
  --seed <n>          reproducible game (default: random)
  --thoughts          spectator mode: show private thoughts and hidden events
  --neutral           neutral personas (benchmark mode)
  --rounds <n>        discussion rounds per day (default 2)
  --notes-budget <n>  token budget before notes mode (default 12000, 0 = off)
  --dry-run           mock every model offline (no keys, no cost) to check wiring and the cost report
  --out <dir>         where to save the replay JSON (default games/)`;

const { values } = parseArgs({
  // `pnpm game -- --x` forwards the literal `--`; drop it so flags still parse.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    agents: { type: 'string', default: 'random' },
    seed: { type: 'string', default: String(Date.now() % 100000) },
    thoughts: { type: 'boolean', default: false },
    preset: { type: 'string', default: 'classic6' },
    rounds: { type: 'string', default: '2' },
    neutral: { type: 'boolean', default: false },
    'notes-budget': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string', default: 'games' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(`error: ${msg}\n\n${HELP}`);
  process.exit(1);
}

const dryRun = values['dry-run']!;
const seed = Number(values.seed);
if (!isPreset(values.preset!)) fail(`unknown preset "${values.preset}"`);
const preset = values.preset;
const seats = totalSeats(PRESETS[preset]);
const alias = (k: string) => (k.trim() === 'claude' ? 'claude-haiku' : k.trim());
const seatKinds = (values.agents!.includes(',') ? values.agents!.split(',') : Array<string>(seats).fill(values.agents!)).map(alias);
if (seatKinds.length !== seats) fail(`--agents lists ${seatKinds.length} seats but ${preset} has ${seats}`);
for (const k of seatKinds) {
  if (k === 'random') continue;
  try {
    getModel(k);
  } catch (e) {
    fail((e as Error).message);
  }
}

// Keys are read server-side from .env; fail before the game starts rather than mid-game.
const KEY_FOR = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', google: 'GOOGLE_API_KEY' } as const;
if (!dryRun) {
  const needed = new Set(seatKinds.filter((k) => k !== 'random').map((k) => KEY_FOR[getModel(k).provider]));
  const missing = [...needed].filter((v) => !process.env[v]);
  if (missing.length) fail(`missing ${missing.join(', ')}: add to .env, or use --dry-run`);
}

const controllers: Controller[] = seatKinds.map((k) => (k === 'random' ? { kind: 'random' } : { kind: 'model', modelId: k }));
const config = makeConfig({
  seed,
  preset,
  controllers,
  rounds: Number(values.rounds),
  personaMode: values.neutral ? 'neutral' : 'default',
  ...(values['notes-budget'] !== undefined ? { notesBudgetTokens: Number(values['notes-budget']) } : {}),
  createdAt: new Date().toISOString(),
});
let state = createGame(config);

const meter = new CostMeter();
const logRaw = process.env.LOG_RAW === '1';
const responders = new Map<string, Responder>(
  state.seats.map((s, i) => [
    s.id,
    s.controller.kind === 'model'
      ? createModelController(s.controller.modelId, {
          onCall: meter.add,
          logRaw,
          ...(dryRun ? { makeProvider: (spec) => dryRunProvider(spec, seed * 1000 + i) } : {}),
        })
      : new RandomController(seed * 1000 + i),
  ]),
);

const c = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
const name = (id?: string) => state.seats.find((s) => s.id === id)?.name ?? '?';
function print(e: GameEvent) {
  const v = e.visibility.kind;
  if (v === 'spectator' && !values.thoughts) return;
  if (v === 'seat' || v === 'team') {
    if (!values.thoughts) return; // hidden info is spectator-only in the CLI too
    const who = e.type === 'mafia_chat' ? `(mafia chat) ${name(e.actorSeatId)}: ` : e.type === 'notes' ? `(notes) ${name(e.actorSeatId)}: ` : '';
    return console.log(`${c.red}  🔒 ${who}${e.text}${c.reset}`);
  }
  switch (e.type) {
    case 'phase':
      return console.log(`\n${c.bold}${c.cyan}── ${e.text}${c.reset}`);
    case 'speech':
      return console.log(`${c.bold}${name(e.actorSeatId)}:${c.reset} ${e.text}`);
    case 'thought':
      return console.log(`${c.dim}   💭 ${name(e.actorSeatId)}: ${e.text}${c.reset}`);
    case 'fallback':
      return console.log(`${c.dim}   ⚠️  ${e.text}${c.reset}`);
    case 'death':
    case 'eliminated':
    case 'game_over':
      return console.log(`${c.yellow}${c.bold}${e.text}${c.reset}`);
    default:
      return console.log(`${c.dim}${e.text}${c.reset}`);
  }
}

let printed = 0;
const flush = (s: GameState) => {
  state = s;
  for (; printed < s.events.length; printed++) print(s.events[printed]);
};

const seatLabel = (s: GameState['seats'][number]) => `${s.name}:${s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind}`;
console.log(`${c.bold}AI MAFIA${c.reset}  seed=${seed}  preset=${preset}  prompt=${PROMPT_VERSION}${dryRun ? '  (dry run: mocked models)' : ''}`);
console.log(`seats: ${state.seats.map(seatLabel).join('  ')}`);
flush(state);
const result = await drive(state, responders, { onState: flush });

mkdirSync(values.out!, { recursive: true });
const file = `${values.out}/game-${seed}.json`;
const replayFile = { config, promptVersion: PROMPT_VERSION, outcome: result.outcome, seats: result.seats, events: result.events, agentCalls: meter.calls };
writeFileSync(file, JSON.stringify(replayFile, null, 2));

// ── cost / token report ──
if (meter.calls.length) {
  const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
  const rows = [...meter.byModel()].map(([id, m]) => [
    id,
    String(m.calls),
    m.inputTokens.toLocaleString('en-US'),
    m.outputTokens.toLocaleString('en-US'),
    `$${m.costUsd.toFixed(4)}`,
    String(m.fallbacks),
    `${pct(m.latencies, 50)}ms`,
    `${pct(m.latencies, 95)}ms`,
  ]);
  const head = ['model', 'calls', 'in tok', 'out tok', 'cost', 'fallbk', 'p50', 'p95'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ');
  console.log(`\n${c.bold}${line(head)}${c.reset}`);
  for (const r of rows) console.log(line(r));
  const tin = meter.calls.reduce((a, x) => a + x.inputTokens, 0);
  const tout = meter.calls.reduce((a, x) => a + x.outputTokens, 0);
  const total = `total: ${meter.calls.length} calls · ${tin.toLocaleString('en-US')} in / ${tout.toLocaleString('en-US')} out tokens · $${meter.totalUsd.toFixed(4)}`;
  console.log(`${c.bold}${total}${dryRun ? ' (simulated)' : ''}${c.reset}`);
}
console.log(`\nSaved replay → ${file}`);
