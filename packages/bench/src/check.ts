import { createClient } from '@supabase/supabase-js';

/**
 * pnpm db:check — prove the live project's access rules from both sides (I3):
 *   server (secret key): sees everything;
 *   browser (publishable key): reads models + ratings only, is refused everything else, cannot call write RPCs.
 * Prints counts and pass/fail only — never keys or row contents.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('error: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const server = createClient(url, serviceKey, opts);
const browser = createClient(url, anonKey, opts);

const TABLES = ['models', 'ratings', 'model_stats', 'games', 'seats', 'events', 'agent_calls', 'highlights', 'rate_limits'] as const;
const PUBLIC = new Set(['models', 'ratings', 'model_stats']);
const RPCS: Record<string, Record<string, unknown>> = {
  upload_game: { p: {} },
  replace_ratings: { p: [] },
  replace_leaderboard: { p_ratings: [], p_stats: [] },
  create_live_game: { p: {} },
  claim_step: { p_id: '00000000-0000-0000-0000-000000000000', p_version: 0, p_lease_ms: 1 },
  commit_step: { p_id: '00000000-0000-0000-0000-000000000000', p_version: 0, p: {} },
  abort_game: { p_id: '00000000-0000-0000-0000-000000000000' },
  take_token: { p_key: 'x', p_capacity: 1, p_refill_per_sec: 1 },
  live_spend_today: {},
};
let failures = 0;
const line = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
};

async function count(client: typeof server, table: string) {
  const { count: n, error } = await client.from(table).select('*', { count: 'exact', head: true });
  return { n: n ?? 0, error: error?.message };
}

console.log('server (secret key)');
for (const t of TABLES) {
  const r = await count(server, t);
  line(!r.error, `${t.padEnd(12)} ${r.error ? `error: ${r.error}` : `${r.n} rows`}`);
}

console.log('\nbrowser (publishable key)');
for (const t of TABLES) {
  const { data, error } = await browser.from(t).select('*').limit(1);
  if (PUBLIC.has(t)) line(!error && (data?.length ?? 0) > 0, `${t.padEnd(12)} readable (public by design)${error ? ` — error: ${error.message}` : ''}`);
  else line(!!error || (data?.length ?? 0) === 0, `${t.padEnd(12)} ${error ? 'refused' : (data?.length ?? 0) === 0 ? 'returns nothing' : 'LEAKED ROWS'}`);
}
for (const [fn, args] of Object.entries(RPCS)) {
  const { error } = await browser.rpc(fn, args);
  line(!!error, `rpc ${fn.padEnd(19)} ${error ? 'refused' : 'CALLABLE BY BROWSER'}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
