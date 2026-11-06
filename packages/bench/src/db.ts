import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameEvent } from '@ai-mafia/engine';
import { MODELS, type ModelSpec } from '@ai-mafia/agents';
import { computeRatings, type RatingRow } from './ratings.ts';
import { RANDOM, type GameRecord } from './runner.ts';

/** The rows upload_game(p) expects (see supabase/migrations). */
export interface UploadPayload {
  models: { id: string; provider: string; model: string; display_name: string; pricing: ModelSpec['pricing']; enabled: boolean }[];
  game: {
    external_id: string;
    mode: 'bench';
    format: string;
    run_id: string;
    preset: string;
    config: unknown;
    seed: number;
    prompt_version: string;
    status: 'finished';
    outcome: string;
    has_human: false;
    cost_usd: number;
    created_at: string;
    finished_at: string;
  };
  seats: { seat_id: string; name: string; role: string; persona_id: string; controller: unknown }[];
  events: {
    seq: number;
    day: number;
    phase: string;
    type: string;
    visibility: unknown;
    actor_seat_id: string | null;
    target_seat_id: string | null;
    text: string;
    payload: unknown;
    reply_to_seq: number | null;
    created_at: string;
  }[];
  agent_calls: {
    seq: number;
    seat_id: string;
    model_id: string;
    prompt_version: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    retries: number;
    fallback: boolean;
    raw?: unknown;
  }[];
}

/** Server-side DB operations the bench needs. Implemented by Supabase (prod) and PGlite (tests). */
export interface BenchDb {
  uploadGame(p: UploadPayload): Promise<string>;
  /** Finished games with just what ratings need. */
  fetchRatedGames(): Promise<Pick<GameRecord, 'gameId' | 'seats' | 'outcome' | 'promptVersion' | 'preset'>[]>;
  replaceRatings(rows: RatingRow[]): Promise<number>;
}

const RANDOM_MODEL = { id: RANDOM, provider: 'none', model: 'random', display_name: 'Random (baseline)', pricing: { inputPerMTok: 0, outputPerMTok: 0 }, enabled: true };

function modelRow(id: string, registry: readonly ModelSpec[]) {
  if (id === RANDOM) return RANDOM_MODEL;
  const m = registry.find((x) => x.id === id);
  if (!m) throw new Error(`model ${id} is not in the registry`);
  return { id: m.id, provider: m.provider, model: m.model, display_name: m.displayName, pricing: m.pricing, enabled: m.enabled };
}

/** Pure mapping GameRecord → upload_game payload. Persona ids fall back to the public game_start roster for older records. */
export function toUploadPayload(r: GameRecord, registry: readonly ModelSpec[] = MODELS): UploadPayload {
  const used = [...new Set([...r.seats.map((s) => s.modelId), ...r.agentCalls.map((c) => c.modelId)])];
  const roster = (r.events.find((e) => e.type === 'game_start')?.payload?.seats ?? []) as { id: string; persona?: { id?: string } }[];
  return {
    models: used.map((id) => modelRow(id, registry)),
    game: {
      external_id: r.gameId,
      mode: 'bench',
      format: r.format,
      run_id: r.runId,
      preset: r.preset,
      config: r.config,
      seed: r.seed,
      prompt_version: r.promptVersion,
      status: 'finished',
      outcome: r.outcome,
      has_human: false,
      cost_usd: Number(r.costUsd.toFixed(5)),
      created_at: r.startedAt,
      finished_at: r.finishedAt,
    },
    seats: r.seats.map((s, i) => ({
      seat_id: s.id,
      name: s.name,
      role: s.role,
      persona_id: s.personaId ?? roster.find((x) => x.id === s.id)?.persona?.id ?? 'unknown',
      controller: r.config.controllers[i],
    })),
    events: r.events.map((e) => ({
      seq: e.seq,
      day: e.day,
      phase: e.phase,
      type: e.type,
      visibility: e.visibility,
      actor_seat_id: e.actorSeatId ?? null,
      target_seat_id: e.targetSeatId ?? null,
      text: e.text,
      payload: e.payload ?? null,
      reply_to_seq: e.replyToSeq ?? null,
      created_at: e.createdAt,
    })),
    agent_calls: r.agentCalls.map((c) => ({
      seq: c.seq,
      seat_id: c.seatId,
      model_id: c.modelId,
      prompt_version: c.promptVersion,
      input_tokens: c.inputTokens,
      output_tokens: c.outputTokens,
      cost_usd: Number(c.costUsd.toFixed(6)),
      latency_ms: Math.round(c.latencyMs),
      retries: c.retries,
      fallback: c.fallback,
      ...(c.raw !== undefined ? { raw: c.raw } : {}),
    })),
  };
}

/** DB row → engine event, in the engine's own field order, nulls dropped. M4's API uses this too. */
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

export interface UploadSummary {
  uploaded: number;
  failed: { gameId: string; error: string }[];
}

/** Upload records one game per transaction. Already-uploaded games are no-ops; a failure never stops the rest. */
export async function uploadRecords(db: BenchDb, records: readonly GameRecord[], onProgress?: (done: number, total: number) => void): Promise<UploadSummary> {
  const failed: UploadSummary['failed'] = [];
  let i = 0;
  for (const r of records) {
    try {
      await db.uploadGame(toUploadPayload(r));
    } catch (e) {
      failed.push({ gameId: r.gameId, error: (e as Error).message });
    }
    onProgress?.(++i, records.length);
  }
  return { uploaded: records.length - failed.length, failed };
}

// ── Supabase implementation (service role, server-side only) ─────────────────

export function supabaseFromEnv(env: NodeJS.ProcessEnv = process.env): BenchDb {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  return supabaseDb(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

export function supabaseDb(client: SupabaseClient): BenchDb {
  return {
    async uploadGame(p) {
      const { data, error } = await client.rpc('upload_game', { p });
      if (error) throw new Error(`upload_game: ${error.message}`);
      return data as string;
    },
    async fetchRatedGames() {
      const out: Awaited<ReturnType<BenchDb['fetchRatedGames']>> = [];
      const page = 500;
      for (let from = 0; ; from += page) {
        const { data, error } = await client
          .from('games')
          .select('external_id, outcome, preset, prompt_version, seats(seat_id, name, role, controller)')
          .eq('status', 'finished')
          .order('external_id')
          .range(from, from + page - 1);
        if (error) throw new Error(`fetch games: ${error.message}`);
        for (const g of data ?? []) out.push(ratedGameFromRow(g));
        if (!data || data.length < page) break;
      }
      return out;
    },
    async replaceRatings(rows) {
      const { data, error } = await client.rpc('replace_ratings', { p: rows.map(ratingToRow) });
      if (error) throw new Error(`replace_ratings: ${error.message}`);
      return data as number;
    },
  };
}

export function ratedGameFromRow(g: Record<string, unknown>) {
  const seats = (g.seats as { seat_id: string; name: string; role: GameRecord['seats'][number]['role']; controller: { kind: string; modelId?: string } }[]).map((s) => ({
    id: s.seat_id,
    name: s.name,
    role: s.role,
    modelId: s.controller.kind === 'model' ? s.controller.modelId! : RANDOM,
  }));
  seats.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return {
    gameId: String(g.external_id),
    outcome: g.outcome as GameRecord['outcome'],
    preset: g.preset as GameRecord['preset'],
    promptVersion: String(g.prompt_version),
    seats,
  };
}

/** BRD §8.4 rebuild: every finished game in the DB → ratings computed from scratch → ratings table replaced atomically. */
export async function rebuildRatingsInDb(db: BenchDb): Promise<{ games: number; rows: RatingRow[] }> {
  const games = await db.fetchRatedGames();
  const rows = computeRatings(games);
  await db.replaceRatings(rows);
  return { games: games.length, rows };
}

export const ratingToRow = (r: RatingRow) => ({
  model_id: r.modelId,
  scope: r.scope,
  prompt_version: r.promptVersion,
  preset: r.preset,
  mu: r.mu,
  sigma: r.sigma,
  ordinal: r.ordinal,
  games: r.games,
});
