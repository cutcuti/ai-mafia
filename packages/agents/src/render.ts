import type { AgentContext, GameEvent } from '@ai-mafia/engine';

/** Neutralise anything that could pass for prompt structure (BRD §11.2). */
export function escapeSpeech(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;');
}

/**
 * One line per event. Player-authored text only ever appears inside `<speech>` tags, escaped.
 * Spectator events are dropped defensively (I2) — contextFor never includes them anyway.
 */
export function renderEvent(e: GameEvent, nameOf: (seatId?: string) => string): string {
  const tag = `[Day ${e.day} · ${e.phase}]`;
  switch (e.type) {
    case 'speech':
      return `${tag} <speech from="${nameOf(e.actorSeatId)}">${escapeSpeech(e.text)}</speech>`;
    case 'mafia_chat':
      return `${tag} (mafia channel) <speech from="${nameOf(e.actorSeatId)}">${escapeSpeech(e.text)}</speech>`;
    default:
      return `${tag} ${e.text}`;
  }
}

export function renderTranscript(ctx: Pick<AgentContext, 'roster' | 'observations'>): string {
  const nameOf = (id?: string) => ctx.roster.find((r) => r.seatId === id)?.name ?? '?';
  return ctx.observations
    .filter((e) => e.visibility.kind !== 'spectator')
    .map((e) => renderEvent(e, nameOf))
    .join('\n');
}
