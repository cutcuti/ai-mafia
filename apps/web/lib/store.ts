import 'server-only';
import { FixtureStore } from './fixture-store';
import { SupabaseStore } from './supabase-store';
import type { GameStore } from './types';

let store: GameStore | undefined;

/**
 * The server's game store. MAFIA_FIXTURE_DIR (local dev / Playwright) serves bench JSON files;
 * otherwise Supabase with the service role. Never reachable from client code ('server-only').
 */
export function getStore(): GameStore {
  if (!store) {
    const dir = process.env.MAFIA_FIXTURE_DIR;
    store = dir ? FixtureStore.fromDir(dir) : SupabaseStore.fromEnv();
  }
  return store;
}
