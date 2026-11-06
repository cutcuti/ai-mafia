import type { GameEvent, Seat } from './types.js';

/**
 * Can this seat see this event? The single source of truth for information isolation (I1, I2).
 * Every path that feeds game information to an agent or a client goes through here.
 */
export function canSee(seat: Pick<Seat, 'id' | 'role'>, e: GameEvent): boolean {
  switch (e.visibility.kind) {
    case 'public':
      return true;
    case 'team':
      return seat.role === 'mafia';
    case 'seat':
      return e.visibility.seatId === seat.id;
    case 'spectator':
      return false; // thoughts and fallbacks: never any seat
  }
}

export function observationsFor(seat: Pick<Seat, 'id' | 'role'>, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => canSee(seat, e));
}
