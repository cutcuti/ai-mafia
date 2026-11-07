import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameEvent, GameState } from '@ai-mafia/engine';
import { highlightRow, PROMPT_VERSION, type Highlight } from '@ai-mafia/agents';
import type { LiveGame, LiveStore, StepCommit } from './types';

const eventRow = (e: GameEvent) => ({
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
});

const utcMidnight = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

function toLive(g: Record<string, unknown>): LiveGame {
  return {
    id: String(g.id),
    state: g.state as GameState,
    version: Number(g.version),
    status: g.status as LiveGame['status'],
    costUsd: Number(g.cost_usd ?? 0),
    mode: g.mode as LiveGame['mode'],
    createdBy: (g.created_by as string) ?? null,
    createdAt: String(g.created_at),
  };
}

/** Service-role, server-side only. Every write goes through a SQL function (atomic, CAS-checked). */
export class SupabaseLiveStore implements LiveStore {
  constructor(private readonly db: SupabaseClient) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseLiveStore {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured on the server');
    return new SupabaseLiveStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  async createLiveGame(state: GameState, createdBy: string | null) {
    return this.rpc<string>('create_live_game', {
      p: {
        game: {
          external_id: state.id,
          mode: 'live',
          format: null,
          preset: state.config.preset,
          config: state.config,
          seed: state.config.seed,
          prompt_version: PROMPT_VERSION,
          state,
          has_human: state.seats.some((x) => x.controller.kind === 'human'),
          created_by: createdBy,
        },
        seats: state.seats.map((s) => ({ seat_id: s.id, name: s.name, role: s.role, persona_id: s.persona.id, controller: s.controller })),
        events: state.events.map(eventRow),
      },
    });
  }

  async loadLive(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await this.db.from('games').select('id, state, version, status, cost_usd, mode, created_by, created_at').eq('id', id).maybeSingle();
    if (error) throw new Error(`load live: ${error.message}`);
    return data && data.state ? toLive(data) : null;
  }

  claimStep(id: string, version: number, leaseMs: number) {
    return this.rpc<boolean>('claim_step', { p_id: id, p_version: version, p_lease_ms: leaseMs });
  }

  commitStep(id: string, version: number, c: StepCommit) {
    return this.rpc<boolean>('commit_step', {
      p_id: id,
      p_version: version,
      p: {
        state: c.state,
        status: c.state.status === 'finished' ? 'finished' : c.state.status === 'awaiting_input' ? 'awaiting_input' : 'running',
        outcome: c.state.outcome ?? null,
        cost_usd: Number(c.costUsd.toFixed(6)),
        events: c.newEvents.map(eventRow),
        agent_calls: c.calls.map((a) => ({
          seq: a.seq,
          seat_id: a.seatId,
          model_id: a.modelId,
          prompt_version: a.promptVersion,
          input_tokens: a.inputTokens,
          output_tokens: a.outputTokens,
          cost_usd: Number(a.costUsd.toFixed(6)),
          latency_ms: Math.round(a.latencyMs),
          retries: a.retries,
          fallback: a.fallback,
        })),
      },
    });
  }

  async saveHighlights(id: string, h: Highlight[]) {
    await this.rpc<number>('save_highlights', { p_game: id, p: h.map(highlightRow) });
  }

  abort(id: string) {
    return this.rpc<boolean>('abort_game', { p_id: id });
  }

  takeToken(key: string, capacity: number, refillPerSec: number) {
    return this.rpc<boolean>('take_token', { p_key: key, p_capacity: capacity, p_refill_per_sec: refillPerSec });
  }

  async spendToday() {
    return Number(await this.rpc<number | string>('live_spend_today', {}));
  }

  async gamesCreatedToday(userId: string) {
    const { count, error } = await this.db.from('games').select('id', { count: 'exact', head: true }).eq('created_by', userId).gte('created_at', utcMidnight());
    if (error) throw new Error(`games today: ${error.message}`);
    return count ?? 0;
  }

  async listActive(limit: number) {
    const { data, error } = await this.db
      .from('games')
      .select('id, state, version, status, cost_usd, mode, created_by, created_at')
      .in('status', ['running', 'awaiting_input'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`list active: ${error.message}`);
    return (data ?? []).map(toLive);
  }

  async recentFallbacks(limit: number) {
    const { data, error } = await this.db
      .from('events')
      .select('game_id, seq, actor_seat_id, text, payload, created_at')
      .eq('type', 'fallback')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`fallbacks: ${error.message}`);
    return (data ?? []).map((e) => ({
      gameId: String(e.game_id),
      seq: Number(e.seq),
      seatId: (e.actor_seat_id as string) ?? null,
      text: String(e.text),
      reason: String((e.payload as Record<string, unknown>)?.reason ?? ''),
      rawOutput: (e.payload as Record<string, unknown>)?.rawOutput,
      createdAt: String(e.created_at),
    }));
  }
}
