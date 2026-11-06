import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { ratedGameFromRow, ratingToRow, statsGameFromRows, type BenchDb } from '../src/db.ts';
import { statsToRow } from '../src/modelstats.ts';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

/**
 * In-process Postgres that looks enough like Supabase for our migrations: the anon / authenticated / service_role
 * roles (service_role bypasses RLS), an auth.users table, and Supabase's default grants on new public objects.
 */
export async function supabaseLikeDb(opts: { autoExpose?: boolean } = {}): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
  `);
  // Supabase's "Automatically expose new tables" project setting = these default privileges.
  if (opts.autoExpose ?? true) {
    await db.exec(`
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `);
  }
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  return db;
}

/** BenchDb over PGlite, acting as the service role — same SQL functions the Supabase RPCs call. */
export function pgliteDb(db: PGlite): BenchDb {
  return {
    async uploadGame(p) {
      const { rows } = await as(db, 'service_role', () => db.query<{ id: string }>('select public.upload_game($1) as id', [p]));
      return rows[0].id;
    },
    async fetchRatedGames() {
      const { rows } = await as(db, 'service_role', () =>
        db.query<Record<string, unknown>>(`
          select g.external_id, g.outcome, g.preset, g.prompt_version,
                 (select jsonb_agg(jsonb_build_object('seat_id', s.seat_id, 'name', s.name, 'role', s.role, 'controller', s.controller))
                    from public.seats s where s.game_id = g.id) as seats
          from public.games g where g.status = 'finished' order by g.external_id`),
      );
      return rows.map(ratedGameFromRow);
    },
    async replaceRatings(rows) {
      const r = await as(db, 'service_role', () => db.query<{ n: number }>('select public.replace_ratings($1) as n', [rows.map(ratingToRow)]));
      return r.rows[0].n;
    },
    async fetchStatsGames() {
      return as(db, 'service_role', async () => {
        const games = (
          await db.query<Record<string, unknown>>(`
            select g.id, g.external_id, g.outcome, g.preset, g.prompt_version, g.config,
                   (select jsonb_agg(jsonb_build_object('seat_id', s.seat_id, 'name', s.name, 'role', s.role, 'controller', s.controller))
                      from public.seats s where s.game_id = g.id) as seats
            from public.games g where g.status = 'finished' order by g.external_id`)
        ).rows;
        const out = [];
        for (const g of games) {
          const ev = (await db.query<Record<string, unknown>>('select * from public.events where game_id = $1 order by seq', [g.id])).rows;
          const calls = (await db.query<Record<string, unknown>>('select * from public.agent_calls where game_id = $1 order by id', [g.id])).rows;
          out.push(statsGameFromRows(g, ev, calls));
        }
        return out;
      });
    },
    async replaceLeaderboard(ratings, stats) {
      await as(db, 'service_role', () => db.query('select public.replace_leaderboard($1, $2)', [ratings.map(ratingToRow), stats.map(statsToRow)]));
    },
  };
}

/** Run `sql` as a given role, then reset. */
export async function as<T>(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
