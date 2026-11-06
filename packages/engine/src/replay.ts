import { applyResponse, createGame, nextRequest } from './state.js';
import type { GameConfig, GameEvent, GameState, InputRequest, InputResponse, Role } from './types.js';

const same = (a: GameEvent, b: GameEvent) => JSON.stringify(a) === JSON.stringify(b);

function assertPrefix(s: GameState, events: readonly GameEvent[]) {
  if (s.events.length > events.length) throw new Error(`replay: log ends mid-step at seq ${events.length}`);
  for (let i = 0; i < s.events.length; i++) {
    if (!same(s.events[i], events[i])) throw new Error(`replay: divergence at seq ${i}`);
  }
}

/** Recover the response that produced the events starting at `at`. */
function responseAt(events: readonly GameEvent[], at: number, req: InputRequest): InputResponse {
  const first = events[at];
  // An invalid response is preserved verbatim in its fallback event; re-feed it so the RNG draw repeats.
  if (first?.type === 'fallback' && first.actorSeatId === req.seatId) return first.payload?.rawOutput as InputResponse;
  const action = first;
  if (!action || action.actorSeatId !== req.seatId) throw new Error(`replay: no action for ${req.id}`);
  const next = events[at + 1];
  const thought = next?.type === 'thought' && next.replyToSeq === action.seq ? next.text : '';
  if (req.kind === 'choose') return { kind: 'choose', thought, target: action.targetSeatId ?? '' };
  const p = action.payload ?? {};
  // Truncated speech is stored cut to maxChars; one extra char makes the engine cut (and flag) it identically.
  const speech = p.truncated ? `${action.text}…` : action.text;
  const res: Extract<InputResponse, { kind: 'speak' }> = { kind: 'speak', thought, speech };
  const accuses = (p.accuses ?? p.suggests) as string | undefined;
  if (accuses) res.accuses = accuses;
  if (p.claimRole) res.claimRole = p.claimRole as Role;
  return res;
}

/**
 * Rebuild GameState from config + events by re-executing the engine (I4).
 * Accepts a partial log that ends at a request boundary (e.g. a live game in progress).
 * Throws if the log could not have been produced by this engine and config.
 */
export function replay(config: GameConfig, events: readonly GameEvent[]): GameState {
  let s = createGame(config);
  assertPrefix(s, events);
  for (let req = nextRequest(s); req && s.events.length < events.length; req = nextRequest(s)) {
    s = applyResponse(s, req.id, responseAt(events, s.events.length, req));
    assertPrefix(s, events);
  }
  if (s.events.length !== events.length) throw new Error(`replay: ${events.length - s.events.length} trailing events`);
  return s;
}
