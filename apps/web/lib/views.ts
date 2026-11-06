import { viewerCanSee, type GameEvent, type Role, type Viewer } from '@ai-mafia/engine';
import { modelsOf, type StoredGame } from './types';

export type ViewName = 'public' | 'spectator' | 'seat';
export const VIEW_NAMES: readonly ViewName[] = ['public', 'spectator', 'seat'];

/** Who is calling. userId comes from auth (M7); undefined = anonymous. */
export interface Caller {
  userId?: string;
}

export type ViewDecision = { ok: true; viewer: Viewer; view: ViewName } | { ok: false; status: 400 | 403; error: string };

/** I8 spectator lock: a game with a human seat hides spectator data from everyone until it is over. */
export const spectatorAllowed = (g: Pick<StoredGame, 'hasHuman' | 'status'>) => !g.hasHuman || g.status === 'finished';

/** Decide which view a caller may have. All server-side; the client never filters (I3). */
export function authorizeView(g: StoredGame, requested: string | null, caller: Caller): ViewDecision {
  const view = (requested ?? 'public') as ViewName;
  if (!VIEW_NAMES.includes(view)) return { ok: false, status: 400, error: `unknown view "${requested}"` };
  if (view === 'public') return { ok: true, view, viewer: { kind: 'public' } };
  if (view === 'spectator') {
    return spectatorAllowed(g)
      ? { ok: true, view, viewer: { kind: 'spectator' } }
      : { ok: false, status: 403, error: 'spectator view is locked until this game is over' };
  }
  const seat = caller.userId ? g.seats.find((s) => s.controller.kind === 'human' && s.controller.userId === caller.userId) : undefined;
  if (!seat) return { ok: false, status: 403, error: 'seat view is only available to that seat’s player' };
  return { ok: true, view, viewer: { kind: 'seat', seat: { id: seat.seatId, role: seat.role } } };
}

/** Events a viewer may receive, optionally only those after a seq. */
export function eventsForViewer(events: readonly GameEvent[], viewer: Viewer, after?: number): GameEvent[] {
  return events.filter((e) => viewerCanSee(viewer, e) && (after === undefined || e.seq > after));
}

export interface PublicSeat {
  seatId: string;
  name: string;
  personaId: string;
  /** Present only when the viewer may know it. */
  role?: Role;
  /** Hidden like roles: in head-to-head games, who plays a seat reveals the seat's team. */
  modelId?: string;
}

export interface GameMeta {
  id: string;
  mode: StoredGame['mode'];
  format: string | null;
  preset: string;
  promptVersion: string;
  status: StoredGame['status'];
  outcome: StoredGame['outcome'];
  hasHuman: boolean;
  createdAt: string;
  finishedAt: string | null;
  /** Unordered set of models in the game — safe to show; per-seat mapping is not. */
  models: string[];
  spectatorAvailable: boolean;
  seats: PublicSeat[];
}

/**
 * Game metadata for a viewer. Roles and per-seat models are included only when the game is finished
 * or the viewer is a spectator of a game without a human seat (BRD §9.3). A seat viewer learns only their own role.
 */
export function gameMeta(g: StoredGame, viewer: Viewer): GameMeta {
  const reveal = g.status === 'finished' || (viewer.kind === 'spectator' && spectatorAllowed(g));
  return {
    id: g.id,
    mode: g.mode,
    format: g.format,
    preset: g.preset,
    promptVersion: g.promptVersion,
    status: g.status,
    outcome: g.status === 'finished' ? g.outcome : null,
    hasHuman: g.hasHuman,
    createdAt: g.createdAt,
    finishedAt: g.finishedAt,
    models: modelsOf(g.config),
    spectatorAvailable: spectatorAllowed(g),
    seats: g.seats.map((s) => {
      const own = viewer.kind === 'seat' && viewer.seat.id === s.seatId;
      const seat: PublicSeat = { seatId: s.seatId, name: s.name, personaId: s.personaId };
      if (reveal || own) seat.role = s.role;
      if (reveal) seat.modelId = s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind;
      return seat;
    }),
  };
}

/** Finished games never change, so their filtered views are cacheable at the edge; anything live is not. */
export function cacheControl(g: Pick<StoredGame, 'status'>, view: ViewName): string {
  if (g.status === 'finished' && view !== 'seat') return 'public, max-age=60, s-maxage=86400, stale-while-revalidate=604800';
  return 'private, no-store';
}
