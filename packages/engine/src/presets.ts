import type { GameConfig, RoleCounts } from './types.js';

export const PRESETS = {
  classic6: { mafia: 2, detective: 1, doctor: 1, villager: 2 },
  mini5: { mafia: 1, detective: 1, doctor: 1, villager: 2 },
  big8: { mafia: 2, detective: 1, doctor: 1, villager: 4 },
} as const satisfies Record<string, RoleCounts>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];
export const isPreset = (x: string): x is PresetName => Object.hasOwn(PRESETS, x);

export const MIN_SEATS = 5;
export const MAX_SEATS = 10;

/** Problems with a role table (BRD §3.1); empty when valid. */
export function roleErrors(r: RoleCounts): string[] {
  const errs: string[] = [];
  for (const k of ['mafia', 'detective', 'doctor', 'villager'] as const) {
    if (!Number.isInteger(r[k]) || r[k] < 0) errs.push(`${k} must be a non-negative integer`);
  }
  if (errs.length) return errs;
  const total = r.mafia + r.detective + r.doctor + r.villager;
  const town = total - r.mafia;
  if (total < MIN_SEATS || total > MAX_SEATS) errs.push(`table must have ${MIN_SEATS}–${MAX_SEATS} players, got ${total}`);
  if (r.mafia < 1) errs.push('need at least 1 mafia');
  if (r.mafia >= town) errs.push(`mafia (${r.mafia}) must be fewer than town (${town})`);
  if (r.detective > 1) errs.push('at most 1 detective');
  if (r.doctor > 1) errs.push('at most 1 doctor');
  return errs;
}

/** Problems with a full config; empty when valid. */
export function configErrors(c: GameConfig): string[] {
  const errs = roleErrors(c.roles);
  const total = c.roles.mafia + c.roles.detective + c.roles.doctor + c.roles.villager;
  if (!Array.isArray(c.controllers) || c.controllers.length !== total) errs.push(`need ${total} controllers, got ${c.controllers?.length}`);
  if (isPreset(c.preset)) {
    const p = PRESETS[c.preset];
    if (p.mafia !== c.roles.mafia || p.detective !== c.roles.detective || p.doctor !== c.roles.doctor || p.villager !== c.roles.villager) {
      errs.push(`roles do not match preset ${c.preset}`);
    }
  } else if (c.preset !== 'custom') errs.push(`unknown preset ${c.preset}`);
  if (!c.gameId) errs.push('gameId required');
  if (!Number.isInteger(c.seed)) errs.push('seed must be an integer');
  if (!Number.isInteger(c.rounds) || c.rounds < 1) errs.push('rounds must be ≥ 1');
  if (!Number.isInteger(c.maxDays) || c.maxDays < 1) errs.push('maxDays must be ≥ 1');
  if (!Number.isInteger(c.maxSpeechChars) || c.maxSpeechChars < 1) errs.push('maxSpeechChars must be ≥ 1');
  return errs;
}

export function assertValidConfig(c: GameConfig): void {
  const errs = configErrors(c);
  if (errs.length) throw new Error(`invalid game config: ${errs.join('; ')}`);
}
