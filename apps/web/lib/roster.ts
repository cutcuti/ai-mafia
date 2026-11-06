import type { GameEvent } from '@ai-mafia/engine';
import type { PublicSeat } from './views';

export interface RosterSeat extends PublicSeat {
  personaLabel: string;
  avatarSeed: string;
}

/** Seat list for the UI: meta seats + persona labels from the public game_start event. */
export function rosterFrom(seats: readonly PublicSeat[], events: readonly GameEvent[]): RosterSeat[] {
  const start = events.find((e) => e.type === 'game_start');
  const ps = (start?.payload?.seats ?? []) as { id: string; persona?: { label?: string; avatarSeed?: string } }[];
  return seats.map((s) => {
    const p = ps.find((x) => x.id === s.seatId)?.persona;
    return { ...s, personaLabel: p?.label ?? '', avatarSeed: p?.avatarSeed ?? s.personaId };
  });
}

const DISPLAY: Record<string, string> = {
  'claude-haiku': 'Claude Haiku',
  'claude-sonnet': 'Claude Sonnet',
  'claude-opus': 'Claude Opus',
  'gpt-mini': 'GPT mini',
  'gpt-nano': 'GPT nano',
  'llama-70b': 'Llama 70B',
  'deepseek-v3': 'DeepSeek V3',
  'qwen3-235b': 'Qwen3 235B',
  'gemini-flash': 'Gemini Flash',
  random: 'Random bot',
  human: 'Human',
};
export const modelName = (id: string) => DISPLAY[id] ?? id;
