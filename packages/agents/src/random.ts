import { createRng } from '@ai-mafia/engine';
import type { AgentContext, InputRequest, InputResponse, Rng } from '@ai-mafia/engine';
import type { Controller } from './controller.js';

const LINES = [
  'idk, something feels off about {x}',
  '{x} has been way too quiet',
  "I'm town, I promise. Look at {x} instead.",
  'not me voting with the crowd again',
  '{x} is giving mafia energy fr',
];

/** Zero-cost controller for tests and dev runs. */
export class RandomController implements Controller {
  private readonly rng: Rng;
  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  async respond(ctx: AgentContext, req: InputRequest): Promise<InputResponse> {
    if (req.kind === 'choose') return { kind: 'choose', thought: 'random pick', target: this.rng.pick(req.options) };
    if (req.kind === 'notes') return { kind: 'notes', notes: `Day ${ctx.day}: no idea, vibes only. Alive: ${ctx.alive.join(', ')}.` };
    const others = ctx.roster.filter((r) => r.seatId !== ctx.self.seatId && ctx.alive.includes(r.name));
    const x = others.length ? this.rng.pick(others) : undefined;
    return { kind: 'speak', thought: 'rolling dice', speech: this.rng.pick(LINES).replace('{x}', x?.name ?? 'nobody'), accuses: x?.seatId };
  }
}
