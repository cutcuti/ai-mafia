import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * pnpm db:migrate — apply supabase/migrations + seed.sql to the hosted project via the official Supabase CLI
 * (pinned, fetched on demand). The DB URL comes from .env and is passed by environment, not echoed.
 */
const SUPABASE_CLI = 'supabase@2.122.0';
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('error: missing SUPABASE_DB_URL in .env (Supabase → Project Settings → Database → Connection string → URI)');
  process.exit(1);
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = ['-y', SUPABASE_CLI, 'db', 'push', '--db-url', url, '--include-seed', ...process.argv.slice(2).filter((a) => a !== '--')];
const r = spawnSync('npx', args, { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
