import { createRng } from '@ai-mafia/engine';
import type { AgentContext, InputRequest, InputResponse, Responder, Rng } from '@ai-mafia/engine';

const LINES = [
  'idk, something feels off about {x}',
  '{x} has been way too quiet',
  "I'm town, I promise. Look at {x} instead.",
  'not me voting with the crowd again',
  '{x} is giving mafia energy fr',
];

/** Zero-cost controller for tests and dev runs. */
export class RandomController implements Responder {
  private readonly rng: Rng;
  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  async respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse> {
    if (req.kind === 'choose') return { kind: 'choose', thought: 'random pick', target: this.rng.pick(req.options) };
    const others = ctx.roster.filter((r) => r.seatId !== ctx.self.seatId && ctx.alive.includes(r.name));
    const x = others.length ? this.rng.pick(others) : undefined;
    return { kind: 'speak', thought: 'rolling dice', speech: this.rng.pick(LINES).replace('{x}', x?.name ?? 'nobody'), accuses: x?.seatId };
  }
}
