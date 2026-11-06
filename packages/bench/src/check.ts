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

const TABLES = ['models', 'ratings', 'games', 'seats', 'events', 'agent_calls', 'highlights'] as const;
const PUBLIC = new Set(['models', 'ratings']);
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
for (const fn of ['upload_game', 'replace_ratings']) {
  const { error } = await browser.rpc(fn, { p: fn === 'upload_game' ? {} : [] });
  line(!!error, `rpc ${fn.padEnd(15)} ${error ? 'refused' : 'CALLABLE BY BROWSER'}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
