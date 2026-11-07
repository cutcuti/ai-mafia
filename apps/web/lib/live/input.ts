import { applyResponse, nextRequest, type InputResponse } from '@ai-mafia/engine';
import { eventsForViewer } from '../views';
import type { LiveStore, SessionUser } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });

/** v1 moderation (BRD §11.1): a small blocklist; hard hits are rejected and never stored. */
const BLOCK = [/\bn[i1]gg/i, /\bf[a@]gg?[o0]t/i, /\bk[i1]ke\b/i, /\bkill\s+yourself\b/i, /\bkys\b/i];
export const moderate = (text: string) => !BLOCK.some((re) => re.test(text));

/**
 * POST /api/games/:id/input — the human seat's move. Only that seat's player, only on their turn, only for the
 * current request id (double submits are no-ops). Speech is data, never instructions (I6): it goes through the same
 * engine validation as model output and is escaped when rendered into prompts.
 */
export async function inputResponse(store: LiveStore, id: string, req: Request, user: Pick<SessionUser, 'id'> | null): Promise<Response> {
  if (!user) return json({ error: 'sign in first' }, 401);
  if (!(await store.takeToken(`input:user:${user.id}`, 20, 1))) return json({ error: 'Too many requests.' }, 429);
  const g = await store.loadLive(id);
  if (!g) return json({ error: 'game not found' }, 404);
  const mine = g.state.seats.find((s) => s.controller.kind === 'human' && s.controller.userId === user.id);
  if (!mine) return json({ error: 'you are not playing in this game' }, 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  const current = nextRequest(g.state);
  // the engine's state is authoritative for whose turn it is (a new game's DB row starts as 'running')
  if (g.status === 'finished' || g.status === 'aborted' || g.state.status !== 'awaiting_input' || !current || current.seatId !== mine.id) return json({ error: 'not your turn' }, 409);
  if (body.requestId !== current.id) return json({ error: 'stale request', requestId: current.id }, 409);

  let res: InputResponse;
  if (current.kind === 'speak') {
    const speech = typeof body.speech === 'string' ? body.speech.trim() : '';
    if (!speech) return json({ error: 'Say something.' }, 400);
    if (speech.length > current.maxChars) return json({ error: `Max ${current.maxChars} characters.` }, 400);
    if (!moderate(speech)) return json({ error: 'That message isn’t allowed.' }, 422);
    res = { kind: 'speak', thought: '', speech };
  } else if (current.kind === 'choose') {
    if (typeof body.target !== 'string' || !current.options.includes(body.target)) return json({ error: 'Pick one of the options.' }, 400);
    res = { kind: 'choose', thought: '', target: body.target };
  } else {
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '';
    res = { kind: 'notes', notes: notes || '(no notes)' };
  }

  const next = applyResponse(g.state, current.id, res);
  const newEvents = next.events.slice(g.state.events.length);
  if (!(await store.commitStep(id, g.version, { state: next, newEvents, calls: [], costUsd: 0 }))) return json({ error: 'stale request' }, 409);
  return json({ ok: true, status: next.status, events: eventsForViewer(newEvents, { kind: 'seat', seat: mine }) });
}
