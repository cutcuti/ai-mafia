import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GameConfig, GameEvent, Outcome, Role } from '@ai-mafia/engine';
import { dryRunAwards, toHighlights, type Highlight } from '@ai-mafia/agents';
import type { LeaderboardSnapshot, PairGame } from './leaderboard';
import { modelName } from './roster';
import { modelsOf, pairGameOf, type GameStore, type ListQuery, type ModelMoment, type StoredGame } from './types';

/** The bench's on-disk GameRecord (schema 1) — just the fields we read. */
interface RecordFile {
  schema: 1;
  gameId: string;
  runId: string;
  format: string;
  preset: string;
  promptVersion: string;
  config: GameConfig;
  outcome: Outcome;
  seats: { id: string; name: string; role: Role; modelId: string; personaId?: string }[];
  events: GameEvent[];
  /** Judged awards, if the record has them; otherwise fixtures get offline (dry-run) awards. */
  highlights?: Highlight[];
  costUsd: number;
  startedAt: string;
  finishedAt: string;
}

function toStored(r: RecordFile): StoredGame {
  const roster = (r.events.find((e) => e.type === 'game_start')?.payload?.seats ?? []) as { id: string; persona?: { id?: string } }[];
  return {
    id: r.gameId,
    externalId: r.gameId,
    mode: 'bench',
    format: r.format,
    runId: r.runId,
    preset: r.preset,
    promptVersion: r.promptVersion,
    status: 'finished',
    outcome: r.outcome,
    hasHuman: false,
    costUsd: r.costUsd,
    createdAt: r.startedAt,
    finishedAt: r.finishedAt,
    config: r.config,
    seats: r.seats.map((s, i) => ({
      seatId: s.id,
      name: s.name,
      role: s.role,
      personaId: s.personaId ?? roster.find((x) => x.id === s.id)?.persona?.id ?? 'unknown',
      controller: r.config.controllers[i],
    })),
  };
}

export function fixtureHighlights(g: StoredGame, events: GameEvent[]): Highlight[] {
  const seats = g.seats.map((s) => ({ id: s.seatId, name: s.name, role: s.role, modelId: s.controller.kind === 'model' ? s.controller.modelId : s.controller.kind }));
  return toHighlights(dryRunAwards(events, seats), events, seats);
}

/**
 * In-memory store over bench GameRecords. Used by tests and Playwright, and for local dev without Supabase
 * (MAFIA_FIXTURE_DIR=../../games). Games may also be added directly (tests use this for live/human cases).
 */
export class FixtureStore implements GameStore {
  private readonly games = new Map<string, { game: StoredGame; events: GameEvent[]; highlights: Highlight[] }>();

  static fromDir(dir: string): FixtureStore {
    const store = new FixtureStore();
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.json')) {
          try {
            const r = JSON.parse(readFileSync(p, 'utf8'));
            if (r?.schema === 1) store.addRecord(r);
          } catch {
            // skip non-records
          }
        }
      }
    };
    walk(dir);
    try {
      store.setLeaderboard(JSON.parse(readFileSync(join(dir, 'leaderboard.json'), 'utf8')));
    } catch {
      // no leaderboard snapshot in this fixture dir
    }
    return store;
  }

  addRecord(r: RecordFile) {
    const game = toStored(r);
    this.games.set(r.gameId, { game, events: r.events, highlights: r.highlights ?? fixtureHighlights(game, r.events) });
  }

  add(game: StoredGame, events: GameEvent[], highlights: Highlight[] = []) {
    this.games.set(game.id, { game, events, highlights });
  }

  async getHighlights(id: string) {
    return [...(this.games.get(id)?.highlights ?? [])];
  }

  async modelMoments(modelId: string, limit: number): Promise<ModelMoment[]> {
    return [...this.games.values()]
      .filter((x) => x.game.status === 'finished')
      .sort((a, b) => ((a.game.finishedAt ?? '') < (b.game.finishedAt ?? '') ? 1 : -1))
      .flatMap((x) => x.highlights.filter((h) => h.modelId === modelId && h.seq !== null).map((h) => ({ ...h, gameId: x.game.id })))
      .slice(0, limit);
  }

  async listGames(q: ListQuery) {
    const all = [...this.games.values()]
      .map((x) => x.game)
      .filter((g) => g.status === 'finished' && g.finishedAt)
      .filter((g) => !q.mode || g.mode === q.mode)
      .filter((g) => !q.model || modelsOf(g.config).includes(q.model))
      .filter((g) => !q.before || g.finishedAt! < q.before)
      .sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : a.finishedAt! > b.finishedAt! ? -1 : a.id < b.id ? 1 : -1));
    const page = all.slice(0, q.limit);
    return {
      games: page.map((g) => ({
        id: g.id,
        mode: g.mode,
        format: g.format,
        preset: g.preset,
        outcome: g.outcome,
        models: modelsOf(g.config),
        seatCount: g.seats.length,
        createdAt: g.createdAt,
        finishedAt: g.finishedAt,
      })),
      ...(all.length > q.limit ? { nextCursor: page.at(-1)!.finishedAt! } : {}),
    };
  }

  async getGame(id: string) {
    return this.games.get(id)?.game ?? null;
  }

  async getEvents(id: string) {
    return [...(this.games.get(id)?.events ?? [])];
  }

  /** leaderboard.json written by `pnpm ratings:rebuild` (same shape as the DB tables). */
  private snapshot: LeaderboardSnapshot = { ratings: [], stats: [], models: [] };
  setLeaderboard(s: Omit<LeaderboardSnapshot, 'models'> & { models?: LeaderboardSnapshot['models'] }) {
    const ids = [...new Set([...s.ratings.map((r) => r.modelId), ...s.stats.map((r) => r.modelId)])];
    this.snapshot = { ...s, models: s.models ?? ids.map((id) => ({ id, displayName: modelName(id), provider: '', model: '' })) };
  }

  async getLeaderboard() {
    return this.snapshot;
  }

  async listPairGames() {
    return [...this.games.values()].map((x) => pairGameOf(x.game)).filter((g): g is PairGame => g !== null && this.games.get(g.id)!.game.status === 'finished');
  }
}
