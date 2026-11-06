import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GameConfig, GameEvent, Outcome, Role } from '@ai-mafia/engine';
import { modelsOf, type GameStore, type ListQuery, type StoredGame } from './types';

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

/**
 * In-memory store over bench GameRecords. Used by tests and Playwright, and for local dev without Supabase
 * (MAFIA_FIXTURE_DIR=../../games). Games may also be added directly (tests use this for live/human cases).
 */
export class FixtureStore implements GameStore {
  private readonly games = new Map<string, { game: StoredGame; events: GameEvent[] }>();

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
    return store;
  }

  addRecord(r: RecordFile) {
    this.games.set(r.gameId, { game: toStored(r), events: r.events });
  }

  add(game: StoredGame, events: GameEvent[]) {
    this.games.set(game.id, { game, events });
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
}
