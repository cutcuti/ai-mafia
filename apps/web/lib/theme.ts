import type { Role } from '@ai-mafia/engine';

/** One colour per seat index (s1..s10). High-chroma, distinguishable on the dark ink background. */
export const SEAT_COLORS = ['#d9467a', '#1f93a8', '#c08a12', '#4a952c', '#8a5cd0', '#dd6a24', '#18a185', '#d1453f', '#7d9418', '#3f78cf'] as const;

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
