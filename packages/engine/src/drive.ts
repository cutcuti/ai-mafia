import { applyResponse, contextFor, nextRequest } from './state.ts';
import type { AgentContext, GameState, InputRequest, InputResponse } from './types.ts';

/** Anything that can answer an InputRequest. `@ai-mafia/agents` Controllers satisfy this. */
export interface Responder {
  respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse>;
}

export interface DriveOptions {
  /** Called after every applied response (persist / stream). */
  onState?: (state: GameState) => void | Promise<void>;
}

/** Shared driver for CLI, bench and web: ask → apply → repeat until finished. A throwing responder becomes a fallback, never a crash. */
export async function drive(state: GameState, responders: ReadonlyMap<string, Responder>, opts: DriveOptions = {}): Promise<GameState> {
  for (let req = nextRequest(state); req; req = nextRequest(state)) {
    const responder = responders.get(req.seatId);
    if (!responder) throw new Error(`no responder for seat ${req.seatId}`);
    let res: InputResponse;
    try {
      res = await responder.respond(contextFor(state, req.seatId), req);
    } catch (err) {
      const thought = `(agent error: ${(err as Error)?.message ?? String(err)})`;
      res =
        req.kind === 'speak'
          ? { kind: 'speak', thought, speech: '' }
          : req.kind === 'notes'
            ? { kind: 'notes', notes: '' }
            : { kind: 'choose', thought, target: '' };
    }
    const next = applyResponse(state, req.id, res);
    if (next === state) throw new Error(`engine did not advance on ${req.id}`);
    state = next;
    await opts.onState?.(state);
  }
  return state;
}
