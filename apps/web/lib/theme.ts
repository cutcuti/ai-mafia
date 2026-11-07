import type { Role } from '@ai-mafia/engine';

/** One colour per seat index (s1..s10). High-chroma, distinguishable on the dark ink background. */
export const SEAT_COLORS = ['#ff6fa8', '#63e6f0', '#ffd04f', '#a8ea5f', '#b98bff', '#ff9b4f', '#4fe0b8', '#ff7f6e', '#d6f05a', '#8fb4ff'] as const;

export function seatColor(seatId: string): string {
  const i = Number(seatId.replace(/\D/g, '')) - 1;
  return SEAT_COLORS[((i % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

export const ROLE_META: Record<Role, { label: string; emoji: string; color: string }> = {
  mafia: { label: 'Mafia', emoji: '🔪', color: 'var(--color-mafia)' },
  detective: { label: 'Detective', emoji: '🔍', color: 'var(--color-detective)' },
  doctor: { label: 'Doctor', emoji: '💉', color: 'var(--color-doctor)' },
  villager: { label: 'Villager', emoji: '🧑‍🌾', color: 'var(--color-villager)' },
};

/** Tiny deterministic hash for avatar shapes. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
