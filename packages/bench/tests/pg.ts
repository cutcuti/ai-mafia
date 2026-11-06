import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

/**
 * In-process Postgres that looks enough like Supabase for our migrations: the anon / authenticated / service_role
 * roles (service_role bypasses RLS), an auth.users table, and Supabase's default grants on new public objects.
 */
export async function supabaseLikeDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  return db;
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
