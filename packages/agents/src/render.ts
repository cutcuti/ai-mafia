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

/** Facts that stay in the transcript even in notes mode: setup, your role/team, and every death. */
const KEY_FACTS = new Set(['game_start', 'role_reveal', 'team_reveal', 'death', 'eliminated']);

/**
 * Full transcript by default. In notes mode (ctx.notes set, BRD §7.8): your latest notes + key facts + the current day only.
 * Your own notes events are never rendered inline — the latest one is shown once, escaped, as its own block.
 */
export function renderTranscript(ctx: Pick<AgentContext, 'roster' | 'observations' | 'day'> & { notes?: string }): string {
  const nameOf = (id?: string) => ctx.roster.find((r) => r.seatId === id)?.name ?? '?';
  const notesMode = ctx.notes !== undefined;
  const lines = ctx.observations
    .filter((e) => e.visibility.kind !== 'spectator' && e.type !== 'notes')
    .filter((e) => !notesMode || KEY_FACTS.has(e.type) || e.day === ctx.day)
    .map((e) => renderEvent(e, nameOf));
  if (notesMode) lines.unshift(`<notes>${escapeSpeech(ctx.notes!)}</notes>\n(Above: your private notes from earlier days. Older transcript lines are omitted; key facts and today follow.)`);
  return lines.join('\n');
}
