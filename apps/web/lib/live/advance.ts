import { applyResponse, contextFor, nextRequest, type GameState, type InputRequest, type InputResponse, type Responder } from '@ai-mafia/engine';
import type { AgentCall } from '@ai-mafia/agents';
import type { StoredGame } from '../types';
import { authorizeView, eventsForViewer, spectatorAllowed, type Caller } from '../views';
import type { Viewer } from '@ai-mafia/engine';
import type { Limits, LiveGame, LiveStore } from './types';

export interface AdvanceDeps {
  store: LiveStore;
  limits: Limits;
  /** Build the controller for a model seat; it must report every provider call through onCall (cost accounting). */
  makeResponder: (modelId: string, onCall: (c: AgentCall) => void) => Responder;
  /** Best-effort "new events up to seq" ping to viewers (Realtime). Never carries event content (I3). */
  notify?: (gameId: string, seq: number) => Promise<void>;
  /** How long one caller may hold the step (must exceed the model call's worst case). */
  leaseMs?: number;
}

/**
 * Who the table is waiting on, safe for every viewer: a seat only for public speech and votes.
 * At night the seat being asked (to kill / save / investigate) would reveal its role, so it's never named.
 */
export function waitingOn(state: GameState): { kind: 'speak' | 'vote'; seatId: string } | { kind: 'night' } | null {
  if (state.status === 'finished') return null;
  const req = nextRequest(state);
  if (!req) return null;
  if (req.kind === 'speak' && req.channel === 'public') return { kind: 'speak', seatId: req.seatId };
  if (req.kind === 'choose' && req.action === 'vote') return { kind: 'vote', seatId: req.seatId };
  return state.phase === 'night' ? { kind: 'night' } : null;
}

/** The pending request, only for the seat it belongs to (the human player). Never reveals anything they can't see. */
export function yourTurn(state: GameState, viewer: Viewer): InputRequest | null {
  if (viewer.kind !== 'seat' || state.status === 'finished') return null;
  const req = nextRequest(state);
  return req && req.seatId === viewer.seat.id ? req : null;
}

/** The persisted game as the view rules expect it. */
export function storedFromLive(g: LiveGame): StoredGame {
  const s = g.state;
  return {
    id: g.id,
    externalId: s.id,
    mode: g.mode,
    format: null,
    runId: null,
    preset: s.config.preset,
    promptVersion: 'p1',
    status: g.status,
    outcome: s.outcome ?? null,
    hasHuman: s.seats.some((x) => x.controller.kind === 'human'),
    costUsd: g.costUsd,
    createdAt: g.createdAt,
    finishedAt: null,
    config: s.config,
    seats: s.seats.map((x) => ({ seatId: x.id, name: x.name, role: x.role, personaId: x.persona.id, controller: x.controller })),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });

function emptyResponse(req: InputRequest, why: string): InputResponse {
  const thought = `(agent error: ${why})`;
  return req.kind === 'speak' ? { kind: 'speak', thought, speech: '' } : req.kind === 'notes' ? { kind: 'notes', notes: '' } : { kind: 'choose', thought, target: '' };
}

/** POST /api/games/:id/advance?view=&after= — execute at most ONE step, return new events for the caller's view. */
export async function advanceResponse(deps: AdvanceDeps, id: string, url: URL, caller: Caller, ip: string): Promise<Response> {
  if (!(await deps.store.takeToken(`advance:ip:${ip}`, 60, 1))) return json({ error: 'Too many requests.' }, 429);
  const g = await deps.store.loadLive(id);
  if (!g) return json({ error: 'game not found' }, 404);
  if (g.mode === 'bench') return json({ error: 'not a live game' }, 409);

  const stored = storedFromLive(g);
  const d = authorizeView(stored, url.searchParams.get('view'), caller);
  if (!d.ok) return json({ error: d.error }, d.status);
  const afterRaw = url.searchParams.get('after');
  const after = afterRaw === null ? undefined : Number(afterRaw);
  if (after !== undefined && !Number.isInteger(after)) return json({ error: 'after must be an integer seq' }, 400);

  const reply = (state: GameState, status: string, extra: Record<string, unknown> = {}) =>
    json({
      status,
      version: extra.version ?? g.version,
      events: eventsForViewer(state.events, d.viewer, after),
      waitingOn: waitingOn(state),
      yourTurn: yourTurn(state, d.viewer),
      spectatorAvailable: spectatorAllowed(stored),
      ...extra,
    });

  if (g.status !== 'running') return reply(g.state, g.status);

  // per-game cost cap (BRD §9.5): stop before spending more
  if (g.costUsd >= deps.limits.maxGameCostUsd) {
    await deps.store.abort(id);
    return reply(g.state, 'aborted', { reason: 'cost_cap' });
  }

  const req = nextRequest(g.state);
  if (!req) return reply(g.state, 'finished');
  const seat = g.state.seats.find((s) => s.id === req.seatId)!;
  if (seat.controller.kind === 'human') return reply(g.state, 'awaiting_input');

  if (!(await deps.store.claimStep(id, g.version, deps.leaseMs ?? 75_000))) return reply(g.state, 'busy');

  const calls: AgentCall[] = [];
  let res: InputResponse;
  try {
    const modelId = seat.controller.kind === 'model' ? seat.controller.modelId : 'random';
    res = await deps.makeResponder(modelId, (c) => calls.push(c)).respond(contextFor(g.state, req.seatId), req);
  } catch (e) {
    res = emptyResponse(req, (e as Error)?.message ?? 'unknown'); // engine falls back (I5); the game never stalls
  }
  const next = applyResponse(g.state, req.id, res);
  const newEvents = next.events.slice(g.state.events.length);
  const cost = calls.reduce((a, c) => a + c.costUsd, 0);
  const ok = await deps.store.commitStep(id, g.version, { state: next, newEvents, calls, costUsd: cost });
  if (!ok) {
    const latest = await deps.store.loadLive(id);
    return reply(latest?.state ?? g.state, 'busy');
  }
  if (newEvents.length) await deps.notify?.(id, newEvents.at(-1)!.seq).catch(() => {});
  return reply(next, next.status === 'finished' ? 'finished' : 'running', { version: g.version + 1, stepped: true });
}
