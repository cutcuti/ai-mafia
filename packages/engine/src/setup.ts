import { PRESETS, isPreset } from './presets.ts';
import type { Rng } from './rng.ts';
import type { Controller, GameConfig, Persona, Role, RoleCounts, Seat } from './types.ts';

export const NAMES = ['Zara', 'Omar', 'Priya', 'Leo', 'Maya', 'Kai', 'Noor', 'Rafi', 'Ines', 'Theo'];

const persona = (id: string, label: string, description: string): Persona => ({ id, label, description, avatarSeed: id });

/** Benchmark persona: same for every seat so personality doesn't add variance. */
export const NEUTRAL_PERSONA: Persona = persona('neutral', 'Neutral', 'plain and clear; no particular personality or slang');

/** Tone only — personas never change rules. Code-reviewed: no real people, no stereotypes of protected groups. */
export const PERSONAS: Persona[] = [
  persona('online', 'Chronically online', 'types in lowercase, says "fr", "lowkey" and "no cap", gets defensive fast'),
  persona('finbro', 'Finance bro', 'overconfident, treats every vote like a trade and loves the word "alpha"'),
  persona('theatre', 'Theatre kid', 'dramatic, gasps at everything, accuses people with monologues'),
  persona('analyst', 'Quiet analyst', 'tracks who voted for whom; speaks rarely but precisely'),
  persona('gremlin', 'Chaos gremlin', 'throws wild accusations just to see who flinches'),
  persona('peacemaker', 'Peacemaker', 'conflict-avoidant, always proposes "let\'s hear everyone out"'),
  persona('conspiracy', 'Conspiracy theorist', 'connects dots that may not exist'),
  persona('deadpan', 'Deadpan', 'sarcastic, short sentences, never shows their hand'),
  persona('hype', 'Hype-beast', 'everything is either "insane" or "mid", hypes up allies loudly'),
  persona('npc', 'NPC energy', 'agrees with whoever spoke last, oddly calm, occasionally says something unsettlingly sharp'),
];

export const totalSeats = (r: RoleCounts) => r.mafia + r.detective + r.doctor + r.villager;

export function roleList(r: RoleCounts): Role[] {
  return [
    ...Array<Role>(r.mafia).fill('mafia'),
    ...Array<Role>(r.detective).fill('detective'),
    ...Array<Role>(r.doctor).fill('doctor'),
    ...Array<Role>(r.villager).fill('villager'),
  ];
}

/**
 * Fill in defaults. Only `seed` is required. `preset` picks the role table (default classic6);
 * passing `roles` without a preset makes it a 'custom' table.
 */
export function makeConfig(o: Partial<GameConfig> & { seed: number }): GameConfig {
  const preset = o.preset ?? (o.roles ? 'custom' : 'classic6');
  const roles: RoleCounts = o.roles ?? (isPreset(preset) ? { ...PRESETS[preset] } : { ...PRESETS.classic6 });
  const controllers: Controller[] = o.controllers ?? Array.from({ length: totalSeats(roles) }, () => ({ kind: 'random' }));
  return {
    gameId: o.gameId ?? `game-${o.seed}`,
    preset,
    roles,
    controllers,
    seed: o.seed,
    rounds: o.rounds ?? 2,
    maxDays: o.maxDays ?? 8,
    maxSpeechChars: o.maxSpeechChars ?? 280,
    personaMode: o.personaMode ?? 'default',
    notesBudgetTokens: o.notesBudgetTokens ?? 12_000,
    createdAt: o.createdAt ?? '1970-01-01T00:00:00.000Z',
  };
}

/** Seat players: names, personas and roles all come from the seeded RNG (BRD §3.2). */
export function createSeats(config: GameConfig, rng: Rng): Seat[] {
  const roles = roleList(config.roles);
  if (config.controllers.length !== roles.length) {
    throw new Error(`need ${roles.length} controllers, got ${config.controllers.length}`);
  }
  if (roles.length > NAMES.length) throw new Error(`at most ${NAMES.length} seats supported`);
  const names = rng.shuffle(NAMES).slice(0, roles.length);
  // always draw personas so names/roles for a seed are identical in both persona modes
  const personas = rng.shuffle(PERSONAS);
  const shuffledRoles = rng.shuffle(roles);
  const neutral = config.personaMode === 'neutral';
  return names.map((name, i) => ({
    id: `s${i + 1}`,
    name,
    role: shuffledRoles[i],
    persona: neutral ? { ...NEUTRAL_PERSONA, avatarSeed: name } : personas[i % personas.length],
    controller: config.controllers[i],
    alive: true,
  }));
}
