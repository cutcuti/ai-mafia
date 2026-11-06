import type { GameEvent, Player } from './types.js';

/** Can this player see this event? Single source of truth for information isolation. */
export function canSee(player: Player, e: GameEvent): boolean {
  switch (e.visibility.kind) {
    case 'public':
      return true;
    case 'team':
      return player.role === 'mafia';
    case 'player':
      return e.visibility.playerId === player.id;
    case 'spectator':
      return false;
  }
}

export function observationsFor(player: Player, events: GameEvent[]): GameEvent[] {
  return events.filter((e) => canSee(player, e));
}

/** Render events as a transcript an LLM (or a human) can read. */
export function renderTranscript(events: GameEvent[]): string {
  return events
    .map((e) => {
      const tag = `[Day ${e.day} · ${e.phase}]`;
      switch (e.type) {
        case 'speech':
          return `${tag} ${e.actor}: "${e.text}"`;
        case 'mafia_chat':
          return `${tag} (mafia chat) ${e.actor}: "${e.text}"`;
        case 'thought':
          return `${tag} 💭 ${e.actor} thinks: ${e.text}`;
        default:
          return `${tag} ${e.text}`;
      }
    })
    .join('\n');
}
