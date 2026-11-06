import { renderTranscript } from './events.js';
import type { Action, AgentContext } from './types.js';

const RULES = `You are playing the social deduction game Mafia with other AI players.
Roles: 2 MAFIA (know each other, kill one person each night), 1 DETECTIVE (learns one player's alignment each night),
1 DOCTOR (protects one player each night), VILLAGERS (no power). Dead players' roles are revealed.
Each day everyone discusses, then votes; the plurality is eliminated (ties eliminate nobody).
Town wins when all mafia are dead. Mafia wins when they equal or outnumber town.`;

const STRATEGY: Record<string, string> = {
  mafia: `You are MAFIA. Blend in. Never reveal your role or your teammate in public. Deflect suspicion, build alliances,
and push votes onto town players. Coordinate with your teammate only in mafia chat. Claiming a fake role is allowed but risky.`,
  detective: `You are the DETECTIVE. Use your investigation results to steer votes. Revealing yourself makes you a night target,
so decide carefully when to claim.`,
  doctor: `You are the DOCTOR. Protect whoever the mafia most likely wants dead (often the loudest town voice or a revealed detective).
Revealing yourself makes you a target.`,
  villager: `You are a VILLAGER. You have no powers. Read behaviour, voting patterns, and contradictions to find the mafia.`,
};

export function systemPrompt(ctx: AgentContext): string {
  const team = ctx.teammates.length ? `\nYour mafia teammate(s): ${ctx.teammates.join(', ')}.` : '';
  return `${RULES}

You are ${ctx.self.id}. ${STRATEGY[ctx.self.role]}${team}

Personality (stay in character, it's part of the fun): ${ctx.self.persona}.
Keep public speech short: 1-3 sentences, like a real group chat. No narration, no stage directions.
Your "thought" is private and never shown to other players, so be honest about your real reasoning there.`;
}

export function userPrompt(ctx: AgentContext, task: string): string {
  return `Everything you have seen so far:
${renderTranscript(ctx.observations)}

Current: Day ${ctx.day}, ${ctx.phase}. Alive: ${ctx.alive.join(', ')}.

${task}`;
}

export function speakTask(channel: 'public' | 'mafia'): string {
  return channel === 'mafia'
    ? 'It is night. Talk privately with your mafia teammate about who to kill and how to play tomorrow.'
    : 'It is your turn to speak to the whole table.';
}

export function chooseTask(action: Action): string {
  switch (action) {
    case 'kill':
      return 'Choose who the mafia should kill tonight.';
    case 'save':
      return 'Choose who to protect tonight.';
    case 'investigate':
      return 'Choose who to investigate tonight.';
    case 'vote':
      return 'Vote for who to eliminate today.';
  }
}
