import type { Rng } from '@ai-mafia/engine';
import type { Action, Agent, V0AgentContext, ChooseResult, SpeakResult } from '@ai-mafia/engine';

const LINES = [
  'idk, something feels off about {x}',
  '{x} has been way too quiet',
  "I'm town, I promise. Look at {x} instead.",
  'not me voting with the crowd again',
  '{x} is giving mafia energy fr',
];

/** Zero-cost agent for tests and dev runs. */
export class RandomAgent implements Agent {
  constructor(private readonly rng: Rng) {}

  async speak(ctx: V0AgentContext): Promise<SpeakResult> {
    const others = ctx.alive.filter((id) => id !== ctx.self.id);
    const x = others.length ? this.rng.pick(others) : 'nobody';
    return { thought: 'rolling dice', speech: this.rng.pick(LINES).replace('{x}', x) };
  }

  async choose(_ctx: V0AgentContext, _action: Action, options: string[]): Promise<ChooseResult> {
    return { thought: 'random pick', target: this.rng.pick(options) };
  }
}
