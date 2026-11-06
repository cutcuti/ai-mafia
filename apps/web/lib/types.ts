import type { Controller, GameConfig, GameEvent, Outcome, Role } from '@ai-mafia/engine';
import type { LeaderboardSnapshot, PairGame } from './leaderboard';

export interface StoredSeat {
  seatId: string;
  name: string;
  role: Role;
  personaId: string;
  controller: Controller;
}

/** A game as persisted (server-side only — contains hidden information). */
export interface StoredGame {
  id: string;
  externalId: string;
  mode: 'bench' | 'live' | 'human';
  format: string | null;
  runId: string | null;
  preset: string;
  promptVersion: string;
  status: 'running' | 'awaiting_input' | 'finished' | 'aborted';
  outcome: Outcome | null;
  hasHuman: boolean;
  costUsd: number;
  createdAt: string;
  finishedAt: string | null;
  config: GameConfig;
  seats: StoredSeat[];
}

/** Card for game lists — public information only. */
export interface GameSummary {
  id: string;
  mode: StoredGame['mode'];
  format: string | null;
  preset: string;
  outcome: Outcome | null;
  models: string[];
  seatCount: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ListQuery {
  limit: number;
  /** finishedAt cursor: return games finished strictly before this. */
  before?: string;
  mode?: string;
  model?: string;
}

/** Storage behind the API. Returns raw data; every filtering decision is made in lib/views.ts (one code path, I3). */
export interface GameStore {
  listGames(q: ListQuery): Promise<{ games: GameSummary[]; nextCursor?: string }>;
  getGame(id: string): Promise<StoredGame | null>;
  getEvents(id: string): Promise<GameEvent[]>;
  /** Ratings + per-model stats + model registry (public aggregates). */
  getLeaderboard(): Promise<LeaderboardSnapshot>;
  /** Finished games reduced to which models held the mafia / town seats (for head-to-head pages). */
  listPairGames(): Promise<PairGame[]>;
}

/** Finished game → mafia / town model lists (roles of a finished game are public). */
export function pairGameOf(g: Pick<StoredGame, 'id' | 'outcome' | 'preset' | 'promptVersion' | 'seats'>): PairGame | null {
  if (!g.outcome) return null;
  const model = (s: StoredSeat) => (s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind);
  return {
    id: g.id,
    outcome: g.outcome,
    preset: g.preset,
    promptVersion: g.promptVersion,
    mafiaModels: g.seats.filter((s) => s.role === 'mafia').map(model),
    townModels: g.seats.filter((s) => s.role !== 'mafia').map(model),
  };
}

export const modelsOf = (config: GameConfig): string[] =>
  [...new Set(config.controllers.map((c) => (c.kind === 'model' ? c.modelId : c.kind)))].sort();
