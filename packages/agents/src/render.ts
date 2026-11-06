import type { AgentContext, GameEvent } from '@ai-mafia/engine';

/** Render a seat's (already filtered) observations as a transcript. Spectator events are dropped defensively (I2). */
export function renderTranscript(ctx: Pick<AgentContext, 'roster' | 'observations'>): string {
  const name = (id?: string) => ctx.roster.find((r) => r.seatId === id)?.name ?? '?';
  return ctx.observations
    .filter((e: GameEvent) => e.visibility.kind !== 'spectator')
    .map((e) => {
      const tag = `[Day ${e.day} · ${e.phase}]`;
      switch (e.type) {
        case 'speech':
          return `${tag} ${name(e.actorSeatId)}: "${e.text}"`;
        case 'mafia_chat':
          return `${tag} (mafia chat) ${name(e.actorSeatId)}: "${e.text}"`;
        default:
          return `${tag} ${e.text}`;
      }
    })
    .join('\n');
}
