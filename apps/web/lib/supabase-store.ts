import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameEvent } from '@ai-mafia/engine';
import type { LeaderboardSnapshot, PairGame } from './leaderboard';
import { modelsOf, pairGameOf, type GameStore, type ListQuery, type StoredGame } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME_COLS = 'id, external_id, mode, format, run_id, preset, prompt_version, status, outcome, has_human, cost_usd, created_at, finished_at, config';

/** DB row → engine event, in the engine's field order, nulls dropped. (Mirrors packages/bench/src/db.ts rowToEvent.) */
export function rowToEvent(gameId: string, row: Record<string, unknown>): GameEvent {
  const e: GameEvent = {
    gameId,
    seq: Number(row.seq),
    day: Number(row.day),
    phase: row.phase as GameEvent['phase'],
    type: row.type as GameEvent['type'],
    visibility: row.visibility as GameEvent['visibility'],
    text: String(row.text),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
  if (row.actor_seat_id != null) e.actorSeatId = String(row.actor_seat_id);
  if (row.target_seat_id != null) e.targetSeatId = String(row.target_seat_id);
  if (row.payload != null) e.payload = row.payload as Record<string, unknown>;
  if (row.reply_to_seq != null) e.replyToSeq = Number(row.reply_to_seq);
  return e;
}

function toStored(g: Record<string, unknown>, seats: Record<string, unknown>[]): StoredGame {
  return {
    id: String(g.id),
    externalId: String(g.external_id),
    mode: g.mode as StoredGame['mode'],
    format: (g.format as string) ?? null,
    runId: (g.run_id as string) ?? null,
    preset: String(g.preset),
    promptVersion: String(g.prompt_version),
    status: g.status as StoredGame['status'],
    outcome: (g.outcome as StoredGame['outcome']) ?? null,
    hasHuman: Boolean(g.has_human),
    costUsd: Number(g.cost_usd ?? 0),
    createdAt: new Date(g.created_at as string).toISOString(),
    finishedAt: g.finished_at ? new Date(g.finished_at as string).toISOString() : null,
    config: g.config as StoredGame['config'],
    seats: seats
      .map((s) => ({
        seatId: String(s.seat_id),
        name: String(s.name),
        role: s.role as StoredGame['seats'][number]['role'],
        personaId: String(s.persona_id),
        controller: s.controller as StoredGame['seats'][number]['controller'],
      }))
      .sort((a, b) => a.seatId.localeCompare(b.seatId, 'en', { numeric: true })),
  };
}

/** Supabase-backed store. Service role, server-side only — never imported by client components. */
export class SupabaseStore implements GameStore {
  constructor(private readonly db: SupabaseClient) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseStore {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server');
    return new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  }

  async listGames(q: ListQuery) {
    let query = this.db
      .from('games')
      .select('id, mode, format, preset, outcome, created_at, finished_at, config')
      .eq('status', 'finished')
      .order('finished_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(q.limit + 1);
    if (q.before) query = query.lt('finished_at', q.before);
    if (q.mode) query = query.eq('mode', q.mode);
    if (q.model) query = query.contains('config', { controllers: [{ modelId: q.model }] });
    const { data, error } = await query;
    if (error) throw new Error(`list games: ${error.message}`);
    const rows = data ?? [];
    const page = rows.slice(0, q.limit);
    return {
      games: page.map((g) => ({
        id: String(g.id),
        mode: g.mode as StoredGame['mode'],
        format: (g.format as string) ?? null,
        preset: String(g.preset),
        outcome: (g.outcome as StoredGame['outcome']) ?? null,
        models: modelsOf(g.config as StoredGame['config']),
        seatCount: (g.config as StoredGame['config']).controllers.length,
        createdAt: new Date(g.created_at as string).toISOString(),
        finishedAt: g.finished_at ? new Date(g.finished_at as string).toISOString() : null,
      })),
      ...(rows.length > q.limit && page.at(-1)?.finished_at ? { nextCursor: new Date(page.at(-1)!.finished_at as string).toISOString() } : {}),
    };
  }

  async getGame(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.from('games').select(`${GAME_COLS}, seats(seat_id, name, role, persona_id, controller)`).eq('id', id).maybeSingle();
    if (error) throw new Error(`get game: ${error.message}`);
    if (!data) return null;
    return toStored(data, (data.seats as Record<string, unknown>[]) ?? []);
  }

  async getLeaderboard(): Promise<LeaderboardSnapshot> {
    const [r, s, m] = await Promise.all([
      this.db.from('ratings').select('*'),
      this.db.from('model_stats').select('*'),
      this.db.from('models').select('id, provider, model, display_name'),
    ]);
    for (const x of [r, s, m]) if (x.error) throw new Error(`leaderboard: ${x.error.message}`);
    const updated = (r.data ?? []).map((x) => String(x.updated_at)).sort().at(-1);
    return {
      generatedAt: updated ? new Date(updated).toISOString() : undefined,
      ratings: (r.data ?? []).map((x) => ({
        modelId: x.model_id,
        scope: x.scope,
        promptVersion: x.prompt_version,
        preset: x.preset,
        mu: Number(x.mu),
        sigma: Number(x.sigma),
        ordinal: Number(x.ordinal),
        games: Number(x.games),
      })),
      stats: (s.data ?? []).map((x) => ({ modelId: x.model_id, promptVersion: x.prompt_version, preset: x.preset, games: Number(x.games), stats: x.stats })),
      models: (m.data ?? []).map((x) => ({ id: x.id, displayName: x.display_name, provider: x.provider, model: x.model })),
    };
  }

  async listPairGames(): Promise<PairGame[]> {
    const out: PairGame[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db
        .from('games')
        .select('id, outcome, preset, prompt_version, seats(seat_id, role, controller)')
        .eq('status', 'finished')
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`pair games: ${error.message}`);
      for (const g of data ?? []) {
        const p = pairGameOf({
          id: String(g.id),
          outcome: g.outcome as StoredGame['outcome'],
          preset: String(g.preset),
          promptVersion: String(g.prompt_version),
          seats: ((g.seats as Record<string, unknown>[]) ?? []).map((s) => ({
            seatId: String(s.seat_id),
            name: '',
            role: s.role as StoredGame['seats'][number]['role'],
            personaId: '',
            controller: s.controller as StoredGame['seats'][number]['controller'],
          })),
        });
        if (p) out.push(p);
      }
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async getEvents(id: string) {
    if (!UUID.test(id)) return [];
    const g = await this.getGame(id);
    if (!g) return [];
    const out: GameEvent[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await this.db.from('events').select('*').eq('game_id', id).order('seq').range(from, from + page - 1);
      if (error) throw new Error(`get events: ${error.message}`);
      for (const row of data ?? []) out.push(rowToEvent(g.config.gameId, row));
      if (!data || data.length < page) break;
    }
    return out;
  }
}
