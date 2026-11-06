import type { GameEvent, Seat } from './types.ts';

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

/** Who is looking at a game from outside the engine (web clients, BRD §9.3). */
export type Viewer =
  | { kind: 'spectator' } // everything, incl. thoughts — only when the spectator lock allows it (I8)
  | { kind: 'public' } // what any player at the table hears
  | { kind: 'seat'; seat: Pick<Seat, 'id' | 'role'> }; // exactly that seat's view (human player)

/** The one filter for clients (I3). Same rules as agents for a seat; public = public events only. */
export function viewerCanSee(viewer: Viewer, e: GameEvent): boolean {
  switch (viewer.kind) {
    case 'spectator':
      return true;
    case 'public':
      return e.visibility.kind === 'public';
    case 'seat':
      return canSee(viewer.seat, e);
  }
}

export function observationsFor(seat: Pick<Seat, 'id' | 'role'>, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => canSee(seat, e));
}
