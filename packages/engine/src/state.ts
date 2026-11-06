import { assertValidConfig } from './presets.js';
import { createRng, type Rng } from './rng.js';
import { createSeats } from './setup.js';
import type {
  AgentContext,
  ChooseAction,
  EventType,
  GameConfig,
  GameEvent,
  GameState,
  InputRequest,
  InputResponse,
  Outcome,
  Role,
  Seat,
  Step,
  Team,
  Visibility,
} from './types.js';
import { observationsFor } from './visibility.js';

const PUBLIC: Visibility = { kind: 'public' };
const MAFIA: Visibility = { kind: 'team', team: 'mafia' };
const SPECTATOR: Visibility = { kind: 'spectator' };
const only = (seatId: string): Visibility => ({ kind: 'seat', seatId });
const ROLES: readonly Role[] = ['mafia', 'detective', 'doctor', 'villager'];

// ── pure helpers ─────────────────────────────────────────────────────────────

export function checkWinner(seats: readonly Pick<Seat, 'role' | 'alive'>[]): Team | null {
  const alive = seats.filter((p) => p.alive);
  const mafia = alive.filter((p) => p.role === 'mafia').length;
  const town = alive.length - mafia;
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}

/** Plurality winner; null on a tie or no votes. */
export function tally(votes: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [k, n] of counts) {
    if (n > bestN) [best, bestN, tied] = [k, n, false];
    else if (n === bestN) tied = true;
  }
  return tied ? null : best;
}

/** Copy-on-write: events and seat sub-objects are never mutated once created, so a shallow copy suffices. */
function clone(s: GameState): GameState {
  return {
    ...s,
    seats: s.seats.map((x) => ({ ...x })),
    events: [...s.events],
    queue: [...s.queue],
    memory: { ...s.memory, investigated: [...s.memory.investigated] },
  };
}

function withRng<T>(d: GameState, fn: (r: Rng) => T): T {
  const r = createRng(d.rngState);
  const out = fn(r);
  d.rngState = r.state;
  return out;
}

interface EmitExtra {
  actor?: string;
  target?: string;
  payload?: Record<string, unknown>;
  replyToSeq?: number;
}

function emit(d: GameState, type: EventType, visibility: Visibility, text: string, x: EmitExtra = {}): GameEvent {
  const e: GameEvent = {
    gameId: d.id,
    seq: d.events.length,
    day: d.day,
    phase: d.phase,
    type,
    visibility,
    text,
    createdAt: d.config.createdAt,
  };
  if (x.actor !== undefined) e.actorSeatId = x.actor;
  if (x.target !== undefined) e.targetSeatId = x.target;
  if (x.payload !== undefined) e.payload = x.payload;
  if (x.replyToSeq !== undefined) e.replyToSeq = x.replyToSeq;
  d.events.push(e);
  return e;
}

const alive = (d: GameState) => d.seats.filter((s) => s.alive);
function seat(d: GameState, id: string): Seat {
  const s = d.seats.find((x) => x.id === id);
  if (!s) throw new Error(`unknown seat ${id}`);
  return s;
}
const nameOf = (d: GameState, id: string) => seat(d, id).name;

/** JSON-safe copy of an untrusted value for the fallback log. */
function safeRaw(raw: unknown): unknown {
  try {
    const s = JSON.stringify(raw);
    return s === undefined ? String(raw) : JSON.parse(s);
  } catch {
    return String(raw);
  }
}

// ── auto steps ───────────────────────────────────────────────────────────────

function finish(d: GameState, outcome: Outcome) {
  d.phase = 'end';
  d.queue = [];
  d.status = 'finished';
  d.outcome = outcome;
  const roles = Object.fromEntries(d.seats.map((s) => [s.id, s.role]));
  const list = d.seats.map((s) => `${s.name} (${s.role})`).join(', ');
  const head = outcome === 'draw' ? 'DRAW — nobody wins.' : `${outcome.toUpperCase()} WINS.`;
  emit(d, 'game_over', PUBLIC, `${head} Roles were: ${list}`, { payload: { outcome, roles } });
}

function startPhase(d: GameState, phase: 'night' | 'day' | 'vote'): Step[] {
  if (phase === 'night') {
    d.day += 1;
    if (d.day > d.config.maxDays) {
      d.day -= 1;
      finish(d, 'draw'); // safety valve: no winner after maxDays
      return [];
    }
    d.phase = 'night';
    emit(d, 'phase', PUBLIC, `Night ${d.day} falls. Everyone closes their eyes.`, { payload: { phase, day: d.day } });
    const mafia = withRng(d, (r) => r.shuffle(alive(d).filter((s) => s.role === 'mafia')));
    const doctor = alive(d).find((s) => s.role === 'doctor');
    const detective = alive(d).find((s) => s.role === 'detective');
    return [
      ...mafia.map((s): Step => ({ kind: 'request', seatId: s.id, ask: 'speak_mafia' })),
      ...mafia.map((s): Step => ({ kind: 'request', seatId: s.id, ask: 'kill' })),
      ...(doctor ? [{ kind: 'request', seatId: doctor.id, ask: 'save' } as Step] : []),
      ...(detective ? [{ kind: 'request', seatId: detective.id, ask: 'investigate' } as Step] : []),
      { kind: 'auto', op: 'resolve_night' },
      { kind: 'auto', op: 'check_win' },
      { kind: 'auto', op: 'start_phase', phase: 'day' },
    ];
  }
  if (phase === 'day') {
    d.phase = 'day';
    const names = alive(d).map((s) => s.name).join(', ');
    emit(d, 'phase', PUBLIC, `Day ${d.day}. Discuss. Alive: ${names}`, { payload: { phase, day: d.day } });
    const steps: Step[] = [];
    for (let round = 0; round < d.config.rounds; round++) {
      // re-shuffle each round so nobody always goes first
      const order = withRng(d, (r) => r.shuffle(alive(d)));
      steps.push(...order.map((s): Step => ({ kind: 'request', seatId: s.id, ask: 'speak_public' })));
    }
    steps.push({ kind: 'auto', op: 'start_phase', phase: 'vote' });
    return steps;
  }
  d.phase = 'vote';
  emit(d, 'phase', PUBLIC, `Voting time. Each player votes to eliminate someone.`, { payload: { phase, day: d.day } });
  const order = withRng(d, (r) => r.shuffle(alive(d)));
  return [
    ...order.map((s): Step => ({ kind: 'request', seatId: s.id, ask: 'vote' })),
    { kind: 'auto', op: 'resolve_vote' },
    { kind: 'auto', op: 'check_win' },
    { kind: 'auto', op: 'start_phase', phase: 'night' },
  ];
}

function resolveNight(d: GameState) {
  const tonight = d.events.filter((e) => e.day === d.day && e.phase === 'night');
  const kills = tonight.filter((e) => e.type === 'kill_vote' && e.targetSeatId);
  if (kills.length === 0) return;
  let victim = tally(kills.map((e) => e.targetSeatId!));
  if (!victim) {
    // tie → the target chosen by the mafia member who spoke first in mafia chat
    const firstSpeaker = tonight.find((e) => e.type === 'mafia_chat')?.actorSeatId;
    victim = (kills.find((e) => e.actorSeatId === firstSpeaker) ?? kills[0]).targetSeatId!;
  }
  const saved = tonight.find((e) => e.type === 'save')?.targetSeatId;
  if (victim === saved) {
    emit(d, 'survived_attack', PUBLIC, `Morning comes. Somebody was attacked, but survived.`);
    return;
  }
  const v = seat(d, victim);
  v.alive = false;
  emit(d, 'death', PUBLIC, `Morning comes. ${v.name} was found dead. They were ${v.role.toUpperCase()}.`, {
    target: v.id,
    payload: { role: v.role },
  });
}

function resolveVote(d: GameState) {
  const votes = d.events.filter((e) => e.day === d.day && e.type === 'vote' && e.targetSeatId).map((e) => e.targetSeatId!);
  const out = tally(votes);
  if (!out) {
    const counts: Record<string, number> = {};
    for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
    emit(d, 'no_elimination', PUBLIC, `The vote is tied. Nobody is eliminated.`, { payload: { tally: counts } });
    return;
  }
  const o = seat(d, out);
  o.alive = false;
  emit(d, 'eliminated', PUBLIC, `${o.name} is eliminated by vote. They were ${o.role.toUpperCase()}.`, {
    target: o.id,
    payload: { role: o.role },
  });
}

function runAuto(d: GameState, step: Extract<Step, { kind: 'auto' }>) {
  switch (step.op) {
    case 'start_phase':
      d.queue.unshift(...startPhase(d, step.phase ?? 'night'));
      return;
    case 'resolve_night':
      return resolveNight(d);
    case 'resolve_vote':
      return resolveVote(d);
    case 'check_win': {
      const w = checkWinner(d.seats);
      if (w) finish(d, w);
      return;
    }
  }
}

/** Execute leading auto steps and drop requests for dead seats until a live request (or the end) is at the head. */
function settle(d: GameState) {
  while (d.status !== 'finished') {
    const head = d.queue[0];
    if (!head) throw new Error('engine queue drained without game_over');
    if (head.kind === 'request') {
      if (!seat(d, head.seatId).alive) {
        d.queue.shift();
        continue;
      }
      d.status = seat(d, head.seatId).controller.kind === 'human' ? 'awaiting_input' : 'running';
      return;
    }
    d.queue.shift();
    runAuto(d, head);
  }
}

// ── requests ─────────────────────────────────────────────────────────────────

function optionsFor(d: GameState, s: Seat, action: ChooseAction): string[] {
  const others = alive(d).filter((o) => o.id !== s.id);
  switch (action) {
    case 'kill':
      return alive(d).filter((o) => o.role !== 'mafia').map((o) => o.id);
    case 'save':
      // self allowed; never the same player two nights running
      return alive(d).filter((o) => o.id !== d.memory.lastSave).map((o) => o.id);
    case 'investigate': {
      // never re-investigate; if everyone alive has been checked, anyone else is fine
      const fresh = others.filter((o) => !d.memory.investigated.includes(o.id));
      return (fresh.length ? fresh : others).map((o) => o.id);
    }
    case 'vote':
      return others.map((o) => o.id);
  }
}

function materialize(d: GameState, step: Extract<Step, { kind: 'request' }>): InputRequest {
  const kind = step.ask === 'speak_public' || step.ask === 'speak_mafia' ? 'speak' : 'choose';
  const id = `${d.id}:${d.events.length}:${step.seatId}:${kind}`;
  if (step.ask === 'speak_public' || step.ask === 'speak_mafia') {
    return { id, seatId: step.seatId, kind: 'speak', channel: step.ask === 'speak_mafia' ? 'mafia' : 'public', maxChars: d.config.maxSpeechChars };
  }
  return { id, seatId: step.seatId, kind: 'choose', action: step.ask, options: optionsFor(d, seat(d, step.seatId), step.ask) };
}

function currentRequest(d: GameState): InputRequest | null {
  if (d.status === 'finished') return null;
  const head = d.queue[0];
  return head && head.kind === 'request' ? materialize(d, head) : null;
}

function applySpeak(d: GameState, s: Seat, req: Extract<InputRequest, { kind: 'speak' }>, raw: unknown) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const thought = typeof r.thought === 'string' ? r.thought.trim() : '';
  let speech = r.kind === 'speak' && typeof r.speech === 'string' ? r.speech.trim() : '';
  if (!speech) {
    emit(d, 'fallback', SPECTATOR, `${s.name} gave no valid speech; saying "…" instead.`, {
      actor: s.id,
      payload: { reason: 'empty or invalid speech', rawOutput: safeRaw(raw) },
    });
    speech = '…';
  }
  const truncated = speech.length > req.maxChars;
  if (truncated) speech = speech.slice(0, req.maxChars);
  const accuses =
    typeof r.accuses === 'string' && r.accuses !== s.id && alive(d).some((o) => o.id === r.accuses) ? r.accuses : undefined;
  const claimRole = typeof r.claimRole === 'string' && ROLES.includes(r.claimRole as Role) ? (r.claimRole as Role) : undefined;

  const type = req.channel === 'mafia' ? 'mafia_chat' : 'speech';
  const payload: Record<string, unknown> = {};
  if (req.channel === 'mafia') {
    if (accuses) payload.suggests = accuses;
  } else {
    if (accuses) payload.accuses = accuses;
    if (claimRole) payload.claimRole = claimRole;
  }
  if (truncated) payload.truncated = true;
  const e = emit(d, type, req.channel === 'mafia' ? MAFIA : PUBLIC, speech, {
    actor: s.id,
    payload: Object.keys(payload).length ? payload : undefined,
  });
  if (thought) emit(d, 'thought', SPECTATOR, thought, { actor: s.id, replyToSeq: e.seq, payload: { forType: type } });
}

function applyChoose(d: GameState, s: Seat, req: Extract<InputRequest, { kind: 'choose' }>, raw: unknown) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const thought = typeof r.thought === 'string' ? r.thought.trim() : '';
  let target = r.kind === 'choose' && typeof r.target === 'string' ? r.target : '';
  if (!req.options.includes(target)) {
    const picked = withRng(d, (rng) => rng.pick(req.options));
    emit(d, 'fallback', SPECTATOR, `${s.name} gave invalid ${req.action} target; using ${nameOf(d, picked)}.`, {
      actor: s.id,
      payload: { reason: `invalid ${req.action} target`, rawOutput: safeRaw(raw) },
    });
    target = picked;
  }
  const t = seat(d, target);
  let e: GameEvent;
  switch (req.action) {
    case 'kill':
      e = emit(d, 'kill_vote', MAFIA, `${s.name} wants to kill ${t.name}.`, { actor: s.id, target });
      break;
    case 'save':
      d.memory.lastSave = target;
      e = emit(d, 'save', only(s.id), `You protected ${t.name} tonight.`, { actor: s.id, target });
      break;
    case 'investigate': {
      d.memory.investigated.push(target);
      const isMafia = t.role === 'mafia';
      e = emit(d, 'investigate_result', only(s.id), `Investigation: ${t.name} is ${isMafia ? 'MAFIA' : 'NOT mafia'}.`, {
        actor: s.id,
        target,
        payload: { isMafia },
      });
      break;
    }
    case 'vote':
      e = emit(d, 'vote', PUBLIC, `${s.name} votes for ${t.name}.`, { actor: s.id, target });
      break;
  }
  if (thought) emit(d, 'thought', SPECTATOR, thought, { actor: s.id, replyToSeq: e.seq, payload: { forType: e.type } });
}

// ── public API (BRD §6.2) ────────────────────────────────────────────────────

export function createGame(config: GameConfig): GameState {
  assertValidConfig(config);
  const rng = createRng(config.seed);
  const seats = createSeats(config, rng);
  const d: GameState = {
    id: config.gameId,
    config,
    rngState: rng.state,
    seats,
    events: [],
    day: 0,
    phase: 'setup',
    queue: [{ kind: 'auto', op: 'start_phase', phase: 'night' }],
    memory: { investigated: [] },
    status: 'running',
    version: 0,
  };
  emit(d, 'game_start', PUBLIC, `Players at the table: ${seats.map((s) => s.name).join(', ')}`, {
    payload: { seats: seats.map((s) => ({ id: s.id, name: s.name, persona: s.persona })) },
  });
  for (const s of seats) {
    emit(d, 'role_reveal', only(s.id), `You are ${s.name}. Your secret role is ${s.role.toUpperCase()}.`, { payload: { role: s.role } });
  }
  const mafia = seats.filter((s) => s.role === 'mafia');
  emit(d, 'team_reveal', MAFIA, `The mafia team is: ${mafia.map((s) => s.name).join(' and ')}.`, {
    payload: { mafiaSeatIds: mafia.map((s) => s.id) },
  });
  settle(d);
  return d;
}

/** The request the game is waiting on, or null when finished. Pure: never changes `state`. */
export function nextRequest(state: GameState): InputRequest | null {
  if (state.status === 'finished') return null;
  const head = state.queue[0];
  if (head && head.kind === 'request' && state.seats.find((s) => s.id === head.seatId)?.alive) return materialize(state, head);
  const d = clone(state);
  settle(d);
  return currentRequest(d);
}

/**
 * Apply a response to the current request. Returns a new state; never mutates the input.
 * A response for any other requestId is a no-op that returns `state` unchanged (idempotent retries).
 * The response is untrusted: invalid fields fall back to seeded random valid choices (I5).
 */
export function applyResponse(state: GameState, requestId: string, response: InputResponse): GameState {
  const d = clone(state);
  settle(d);
  const req = currentRequest(d);
  if (!req || req.id !== requestId) return state;
  d.queue.shift();
  const s = seat(d, req.seatId);
  if (req.kind === 'speak') applySpeak(d, s, req, response);
  else applyChoose(d, s, req, response);
  d.version += 1;
  settle(d);
  return d;
}

/** The filtered view a seat is allowed to act on (I1). The only way game info reaches an agent. */
export function contextFor(state: GameState, seatId: string): AgentContext {
  const s = state.seats.find((x) => x.id === seatId);
  if (!s) throw new Error(`unknown seat ${seatId}`);
  return {
    self: { seatId: s.id, name: s.name, role: s.role, persona: s.persona },
    teammates: s.role === 'mafia' ? state.seats.filter((o) => o.role === 'mafia' && o.id !== s.id).map((o) => o.name) : [],
    alive: state.seats.filter((o) => o.alive).map((o) => o.name),
    roster: state.seats.map((o) => ({ seatId: o.id, name: o.name })),
    day: state.day,
    phase: state.phase,
    observations: observationsFor(s, state.events),
  };
}
