import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, createRng, drive, makeConfig } from '@ai-mafia/engine';
import type { Controller, GameConfig, GameEvent, Outcome, PresetName, Responder, Role } from '@ai-mafia/engine';
import { CostMeter, PROMPT_VERSION, RandomController, createModelController, dryRunProvider, getModel } from '@ai-mafia/agents';
import type { AgentCall } from '@ai-mafia/agents';

export type Format = 'h2h' | 'ffa' | 'self';

/** `random` is a valid bench "model": zero-cost baseline, and what the tests use. */
export const RANDOM = 'random';

export interface BenchOptions {
  format: Format;
  /** h2h: model A and B (registry ids or 'random'). */
  a?: string;
  b?: string;
  /** ffa: pool of models, one drawn per seat. */
  models?: string[];
  /** self: one model in every seat. */
  model?: string;
  /** Total games. h2h must be even: games/2 seeds, each played both ways. */
  games: number;
  preset: PresetName;
  seedBase?: number;
  personaMode?: 'default' | 'neutral';
  rounds?: number;
  runId?: string;
  outDir?: string; // default "games"
  dryRun?: boolean;
  logRaw?: boolean;
  /** Override controller construction (tests). */
  makeResponder?: (modelId: string, seat: number, seed: number, onCall: (c: AgentCall) => void) => Responder;
  /** Clock for timestamps (tests). Never used inside the engine. */
  now?: () => Date;
}

export interface GameSpec {
  gameId: string;
  seed: number;
  format: Format;
  preset: PresetName;
  /** h2h only: which side played mafia. */
  direction?: 'a-mafia' | 'b-mafia';
  /** Registry id per seat index. */
  seatModels: string[];
}

export interface SeatRecord {
  id: string;
  name: string;
  role: Role;
  modelId: string;
}

/** One finished game on disk — the unit every metric and rating is computed from. */
export interface GameRecord {
  schema: 1;
  runId: string;
  gameId: string;
  format: Format;
  preset: PresetName;
  seed: number;
  direction?: 'a-mafia' | 'b-mafia';
  promptVersion: string;
  config: GameConfig;
  outcome: Outcome;
  days: number;
  seats: SeatRecord[];
  events: GameEvent[];
  agentCalls: AgentCall[];
  costUsd: number;
  startedAt: string;
  finishedAt: string;
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '-');

export function defaultRunId(o: BenchOptions): string {
  const who = o.format === 'h2h' ? `${o.a}-vs-${o.b}` : o.format === 'self' ? o.model : (o.models ?? []).join('+');
  return slug(`${o.format}_${who}_${o.preset}_s${o.seedBase ?? 1}${o.personaMode === 'neutral' ? '_neutral' : ''}`);
}

function validate(o: BenchOptions) {
  const check = (id: string | undefined, flag: string) => {
    if (!id) throw new Error(`${o.format} needs --${flag}`);
    if (id !== RANDOM) getModel(id);
  };
  if (o.format === 'h2h') {
    check(o.a, 'a');
    check(o.b, 'b');
    if (o.a === o.b) throw new Error('h2h needs two different models (use --format self for one)');
    if (o.games % 2) throw new Error('h2h --games must be even (each seed is played both ways)');
  } else if (o.format === 'self') check(o.model, 'model');
  else {
    if (!o.models || o.models.length < 2) throw new Error('ffa needs --models with at least two ids');
    for (const m of o.models) check(m, 'models');
  }
  if (!Number.isInteger(o.games) || o.games < 1) throw new Error('--games must be a positive integer');
}

/** Roles for a seed depend only on seed + preset, never on who plays — so we can seat models by role. */
function rolesFor(seed: number, preset: PresetName): Role[] {
  return createGame(makeConfig({ seed, preset })).seats.map((s) => s.role);
}

/** Deterministic list of games for a run. Same options ⇒ same specs, which is what makes runs reproducible and resumable. */
export function planGames(o: BenchOptions): GameSpec[] {
  validate(o);
  const runId = o.runId ?? defaultRunId(o);
  const base = o.seedBase ?? 1;
  const specs: GameSpec[] = [];
  if (o.format === 'h2h') {
    for (let i = 0; i < o.games / 2; i++) {
      const seed = base + i;
      const roles = rolesFor(seed, o.preset);
      for (const direction of ['a-mafia', 'b-mafia'] as const) {
        const [mafia, town] = direction === 'a-mafia' ? [o.a!, o.b!] : [o.b!, o.a!];
        specs.push({ gameId: `${runId}.s${seed}.${direction}`, seed, format: 'h2h', preset: o.preset, direction, seatModels: roles.map((r) => (r === 'mafia' ? mafia : town)) });
      }
    }
    return specs;
  }
  const n = rolesFor(base, o.preset).length;
  for (let i = 0; i < o.games; i++) {
    const seed = base + i;
    const seatModels =
      o.format === 'self'
        ? Array<string>(n).fill(o.model!)
        : (() => {
            const rng = createRng((seed * 2654435761) >>> 0); // independent stream from the game's own RNG
            return Array.from({ length: n }, () => rng.pick(o.models!));
          })();
    specs.push({ gameId: `${runId}.s${seed}`, seed, format: o.format, preset: o.preset, seatModels });
  }
  return specs;
}

function responderFor(o: BenchOptions, modelId: string, seat: number, seed: number, onCall: (c: AgentCall) => void): Responder {
  if (o.makeResponder) return o.makeResponder(modelId, seat, seed, onCall);
  if (modelId === RANDOM) return new RandomController(seed * 1000 + seat);
  return createModelController(modelId, {
    onCall,
    logRaw: o.logRaw,
    ...(o.dryRun ? { makeProvider: (spec) => dryRunProvider(spec, seed * 1000 + seat) } : {}),
  });
}

/** Play one planned game to the end and return its record (not yet written). */
export async function runGame(spec: GameSpec, o: BenchOptions, runId = o.runId ?? defaultRunId(o)): Promise<GameRecord> {
  const now = o.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const controllers: Controller[] = spec.seatModels.map((m) => (m === RANDOM ? { kind: 'random' } : { kind: 'model', modelId: m }));
  const config = makeConfig({
    gameId: spec.gameId,
    seed: spec.seed,
    preset: spec.preset,
    controllers,
    rounds: o.rounds,
    personaMode: o.personaMode ?? 'default',
    createdAt: startedAt,
  });
  const start = createGame(config);
  const meter = new CostMeter();
  const responders = new Map(start.seats.map((s, i) => [s.id, responderFor(o, spec.seatModels[i], i, spec.seed, meter.add)]));
  const end = await drive(start, responders);
  return {
    schema: 1,
    runId,
    gameId: spec.gameId,
    format: spec.format,
    preset: spec.preset,
    seed: spec.seed,
    ...(spec.direction ? { direction: spec.direction } : {}),
    promptVersion: PROMPT_VERSION,
    config,
    outcome: end.outcome!,
    days: end.day,
    seats: end.seats.map((s, i) => ({ id: s.id, name: s.name, role: s.role, modelId: spec.seatModels[i] })),
    events: end.events,
    agentCalls: meter.calls,
    costUsd: meter.totalUsd,
    startedAt,
    finishedAt: now().toISOString(),
  };
}

export const runDir = (outDir: string, runId: string) => join(outDir, runId);

export function writeRecord(outDir: string, r: GameRecord): string {
  const dir = runDir(outDir, r.runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.gameId}.json`);
  writeFileSync(file, JSON.stringify(r));
  return file;
}

export interface BenchResult {
  runId: string;
  records: GameRecord[];
}

/** Run every planned game sequentially and write each to `<outDir>/<runId>/<gameId>.json`. */
export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const runId = o.runId ?? defaultRunId(o);
  const outDir = o.outDir ?? 'games';
  const records: GameRecord[] = [];
  for (const spec of planGames(o)) {
    const r = await runGame(spec, o, runId);
    writeRecord(outDir, r);
    records.push(r);
  }
  return { runId, records };
}
