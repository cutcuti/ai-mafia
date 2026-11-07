/**
 * Backfill post-game awards for finished games that have none (BRD §10.6).
 *   pnpm judge -- [--limit 20] [--budget-usd 0.2] [--dry-run] [--redo]
 * One Haiku call per game (~$0.002). --dry-run uses the offline judge (no API call).
 */
import { defaultProvider, dryRunAwards, getModel, highlightRow, judgeGame, toHighlights, type Award, type JudgeSeat } from '@ai-mafia/agents';
import { createClient } from '@supabase/supabase-js';
import { rowToEvent } from './db.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const limit = Number(opt('limit', '20'));
const budget = Number(opt('budget-usd', '0.2'));
const dry = args.includes('--dry-run');
const redo = args.includes('--redo');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const spec = getModel('claude-haiku');
const provider = dry ? null : defaultProvider(spec);

const { data: games, error } = await db
  .from('games')
  .select('id, config, seats(seat_id, name, role, controller), highlights(rank)')
  .eq('status', 'finished')
  .order('finished_at', { ascending: false })
  .limit(500);
if (error) throw new Error(error.message);

let spent = 0;
let done = 0;
for (const g of games ?? []) {
  if (done >= limit || spent >= budget) break;
  if (!redo && ((g.highlights as unknown[]) ?? []).length) continue;
  const seats = ((g.seats as Record<string, unknown>[]) ?? []).map((s) => {
    const c = s.controller as { kind: string; modelId?: string };
    return { id: String(s.seat_id), name: String(s.name), role: s.role as JudgeSeat['role'], modelId: c.kind === 'model' ? (c.modelId ?? null) : null };
  });
  const { data: rows, error: e2 } = await db.from('events').select('*').eq('game_id', g.id).order('seq').limit(2000);
  if (e2) throw new Error(e2.message);
  const events = (rows ?? []).map((r) => rowToEvent((g.config as { gameId: string }).gameId, r));
  let awards: Award[];
  if (provider) {
    const r = await judgeGame(provider, spec, events, seats);
    spent += r.costUsd;
    awards = r.awards;
    if (r.error) console.warn(`  ${g.id}: judge failed (${r.error})`);
  } else awards = dryRunAwards(events, seats);
  const { error: e3 } = await db.rpc('save_highlights', { p_game: g.id, p: toHighlights(awards, events, seats).map(highlightRow) });
  if (e3) throw new Error(e3.message);
  done++;
  console.log(`✓ ${g.id}: ${awards.map((a) => a.kind).join(', ') || 'no awards'}`);
}
console.log(`judged ${done} game(s), $${spent.toFixed(4)}`);
