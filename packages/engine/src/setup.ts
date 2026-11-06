import type { Player, Role } from './types.js';
import type { Rng } from './rng.js';

export const NAMES = ['Zara', 'Omar', 'Priya', 'Leo', 'Maya', 'Kai', 'Noor', 'Rafi'];

export const PERSONAS = [
  'chronically online, types in lowercase, says "fr", "lowkey" and "no cap", gets defensive fast',
  'overconfident finance bro who treats every vote like a trade and loves the word "alpha"',
  'dramatic theatre kid, gasps at everything, accuses people with monologues',
  'quiet analyst who tracks who voted for whom and speaks rarely but precisely',
  'chaotic gremlin who throws wild accusations to see who flinches',
  'conflict-avoidant peacemaker who always proposes "let\'s hear everyone out"',
  'conspiracy theorist who connects dots that may not exist',
  'deadpan sarcastic, short sentences, never shows their hand',
];

/** Default 6-player table: 2 mafia, 1 detective, 1 doctor, 2 villagers. */
export const DEFAULT_ROLES: Role[] = ['mafia', 'mafia', 'detective', 'doctor', 'villager', 'villager'];

export function createPlayers(rng: Rng, models: string[], roles: Role[] = DEFAULT_ROLES): Player[] {
  if (models.length !== roles.length) throw new Error('models and roles must have the same length');
  const names = rng.shuffle(NAMES).slice(0, roles.length);
  const personas = rng.shuffle(PERSONAS);
  const shuffledRoles = rng.shuffle(roles);
  return names.map((id, i) => ({
    id,
    role: shuffledRoles[i],
    persona: personas[i % personas.length],
    model: models[i],
    alive: true,
  }));
}
