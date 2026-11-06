import { createRng } from '../src/rng.ts';
import { makeConfig } from '../src/setup.ts';
import { createGame } from '../src/state.ts';
import { drive, type Responder } from '../src/drive.ts';
import type { AgentContext, GameConfig, InputRequest, InputResponse } from '../src/types.ts';

const LINES = ['idk, something feels off about {x}', '{x} has been way too quiet', "I'm town, I promise. Look at {x} instead.", '{x} is giving mafia energy fr'];

/** Zero-cost seeded responder (engine must not depend on @ai-mafia/agents). */
export function randomResponder(seed: number): Responder {
  const rng = createRng(seed);
  return {
    async respond(ctx, req) {
      if (req.kind === 'choose') return { kind: 'choose', thought: 'random pick', target: rng.pick(req.options) };
      if (req.kind === 'notes') return { kind: 'notes', notes: `day ${ctx.day}: suspect ${rng.pick(ctx.alive)}. ${'filler '.repeat(Math.floor(rng.next() * 200))}` };
      const others = ctx.roster.filter((r) => r.seatId !== ctx.self.seatId && ctx.alive.includes(r.name));
      const x = others.length ? rng.pick(others) : undefined;
      return {
        kind: 'speak',
        thought: 'rolling dice',
        speech: rng.pick(LINES).replace('{x}', x?.name ?? 'nobody'),
        accuses: x?.seatId,
      };
    },
  };
}

/** Returns junk a fraction of the time: wrong kinds, bad targets, huge speeches, throws. */
export function chaosResponder(seed: number): Responder {
  const rng = createRng(seed);
  const good = randomResponder(seed + 1);
  return {
    async respond(ctx, req) {
      const roll = rng.next();
      if (roll < 0.1) throw new Error('provider exploded');
      if (roll < 0.2) return { kind: 'choose', thought: 'oops', target: 'nobody' } as InputResponse;
      if (roll < 0.3) return { kind: 'speak', thought: 42, speech: 'x'.repeat(1000) } as unknown as InputResponse;
      if (roll < 0.35) return null as unknown as InputResponse;
      return good.respond(ctx, req);
    },
  };
}

/** Records every context and request a seat was handed. */
export class Spy implements Responder {
  seen: { ctx: AgentContext; req: InputRequest }[] = [];
  constructor(private inner: Responder) {}
  respond(ctx: AgentContext, req: InputRequest) {
    this.seen.push({ ctx: structuredClone(ctx), req });
    return this.inner.respond(ctx, req);
  }
}

export async function play(seed: number, opts: { config?: Partial<GameConfig>; chaos?: boolean } = {}) {
  const config = makeConfig({ seed, ...opts.config });
  const start = createGame(config);
  const spies = new Map(
    start.seats.map((s, i) => [s.id, new Spy((opts.chaos ? chaosResponder : randomResponder)(seed * 31 + i))]),
  );
  const result = await drive(start, spies);
  return { config, start, spies, result };
}
