import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  /** Games in flight at once (BRD §7.6, default 4). Calls inside a game stay sequential. */
  concurrency?: number;
  /** Hard stop: no new game launches once spend (+ the expected cost of one more game) would exceed this. */
  budgetUsd?: number;
  /** Progress hook: called as each game finishes. */
  onGame?: (r: GameRecord, done: number, total: number, spentUsd: number) => void;
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
  personaId?: string;
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
export async function runGame(
  spec: GameSpec,
  o: BenchOptions,
  runId = o.runId ?? defaultRunId(o),
  onCall?: (c: AgentCall) => void,
): Promise<GameRecord> {
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
  const log = (c: AgentCall) => {
    meter.add(c);
    onCall?.(c);
  };
  const responders = new Map(start.seats.map((s, i) => [s.id, responderFor(o, spec.seatModels[i], i, spec.seed, log)]));
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
    seats: end.seats.map((s, i) => ({ id: s.id, name: s.name, role: s.role, modelId: spec.seatModels[i], personaId: s.persona.id })),
    events: end.events,
    agentCalls: meter.calls,
    costUsd: meter.totalUsd,
    startedAt,
    finishedAt: now().toISOString(),
  };
}

export const runDir = (outDir: string, runId: string) => join(outDir, runId);

/** Atomic write (temp file + rename): a crash never leaves a half-written game for a resume to trip over. */
export function writeRecord(outDir: string, r: GameRecord): string {
  const dir = runDir(outDir, r.runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.gameId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r));
  renameSync(tmp, file);
  return file;
}

/** A finished game already on disk for this spec, if any. Throws if the run id was reused with different options. */
export function existingRecord(outDir: string, runId: string, spec: GameSpec): GameRecord | undefined {
  const file = join(runDir(outDir, runId), `${spec.gameId}.json`);
  if (!existsSync(file)) return undefined;
  let r: GameRecord;
  try {
    r = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // unreadable: replay the game
  }
  if (r?.schema !== 1 || r.gameId !== spec.gameId || !r.outcome) return undefined;
  if (r.seed !== spec.seed || r.preset !== spec.preset || r.seats.map((s) => s.modelId).join() !== spec.seatModels.join()) {
    throw new Error(`run "${runId}" already has ${spec.gameId} with different settings — pick a new --run-id`);
  }
  return r;
}

export interface BenchResult {
  runId: string;
  /** All finished games of the run (resumed + new), in plan order. */
  records: GameRecord[];
  planned: number;
  /** Games already on disk from an earlier invocation (skipped, not replayed). */
  resumed: number;
  /** Games never launched because of the budget. */
  skippedForBudget: number;
  /** New spend in this invocation only. */
  spentUsd: number;
}

/** Rough calls per seat per game and tokens per call, used only to guard the budget before any game has finished. */
const PRIOR = { callsPerSeat: 8, inputTokens: 2500, outputTokens: 300 };

/** A-priori cost of one game from registry prices (random seats cost nothing). Replaced by the observed average once games finish. */
export function estimateGameCostUsd(spec: GameSpec): number {
  return spec.seatModels.reduce((sum, m) => {
    if (m === RANDOM) return sum;
    const { inputPerMTok, outputPerMTok } = getModel(m).pricing;
    return sum + (PRIOR.callsPerSeat * (PRIOR.inputTokens * inputPerMTok + PRIOR.outputTokens * outputPerMTok)) / 1e6;
  }, 0);
}

/**
 * Run the plan with up to `concurrency` games in flight, writing each finished game to `<outDir>/<runId>/<gameId>.json`.
 * Budget: live spend is summed call by call. A game launches only if
 *   finished cost + Σ in-flight max(spent so far, expected) + expected(next) ≤ budget,
 * where "expected" is the observed average game cost (or the registry-price prior before any game finishes).
 * One probe game always runs; a worker that doesn't fit waits for in-flight games (estimates improve) and only
 * stops when nothing in flight could change the answer. In-flight games always finish (BRD §8.2).
 */
export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const runId = o.runId ?? defaultRunId(o);
  const outDir = o.outDir ?? 'games';
  const specs = planGames(o);
  const concurrency = Math.max(1, o.concurrency ?? 4);
  const budget = o.budgetUsd ?? Infinity;

  // Resume: games already on disk are kept and not replayed (BRD §8.2).
  const done = new Map<number, GameRecord>();
  specs.forEach((s, i) => {
    const r = existingRecord(outDir, runId, s);
    if (r) done.set(i, r);
  });
  const resumed = done.size;
  const todo = specs.map((_, i) => i).filter((i) => !done.has(i));

  let spent = 0; // this invocation only — the budget applies to new spend
  let newCost = 0;
  // estimates use every finished game, including resumed ones
  let finished = resumed;
  let finishedCost = [...done.values()].reduce((a, r) => a + r.costUsd, 0);
  let next = 0; // index into todo
  let stopped = false;
  const inFlight = new Map<number, number>(); // spec index → live spend

  const expected = (i: number) => (finished ? finishedCost / finished : estimateGameCostUsd(specs[i]));
  let wake: (() => void)[] = [];
  const notify = () => {
    const w = wake;
    wake = [];
    for (const f of w) f();
  };

  /** 'go' launch now · 'wait' until an in-flight game finishes (estimates will improve) · 'stop' for good. */
  const decide = (i: number): 'go' | 'wait' | 'stop' => {
    if (stopped || spent >= budget) return 'stop';
    if (finished === 0 && inFlight.size === 0) return 'go'; // one probe game always runs so costs get measured
    let committed = newCost;
    for (const [j, live] of inFlight) committed += Math.max(live, expected(j));
    if (committed + expected(i) <= budget) return 'go';
    return inFlight.size ? 'wait' : 'stop';
  };

  async function worker() {
    while (next < todo.length) {
      const d = decide(todo[next]);
      if (d === 'stop') {
        stopped = true;
        notify();
        return;
      }
      if (d === 'wait') {
        await new Promise<void>((r) => wake.push(r));
        continue;
      }
      const i = todo[next++];
      inFlight.set(i, 0);
      const r = await runGame(specs[i], o, runId, (c) => {
        spent += c.costUsd;
        inFlight.set(i, (inFlight.get(i) ?? 0) + c.costUsd);
      });
      inFlight.delete(i);
      writeRecord(outDir, r);
      done.set(i, r);
      finished++;
      finishedCost += r.costUsd;
      newCost += r.costUsd;
      o.onGame?.(r, done.size, specs.length, spent);
      notify();
    }
    notify();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  const records = [...done.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return { runId, records, planned: specs.length, resumed, skippedForBudget: specs.length - records.length, spentUsd: spent };
}
